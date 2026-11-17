import { supportsConfigurableSandboxTimeout } from "@open-inspect/shared/types/integrations";
import { createLogger } from "../../logger";
import type { SourceControlProviderName } from "../../source-control";
import {
  generateSandboxBootstrapToken,
  SANDBOX_BOOTSTRAP_TOKEN_TTL_MS,
  type SandboxBootstrapStore,
} from "../bootstrap";
import {
  EC2_INSTANCE_NOT_FOUND_CODE,
  Ec2ApiError,
  type Ec2Instance,
  type Ec2SandboxApi,
} from "../ec2-api";
import {
  DEFAULT_SANDBOX_TIMEOUT_SECONDS,
  SandboxProviderError,
  signalUntilDeadline,
  type CreateSandboxConfig,
  type CreateSandboxResult,
  type ResumeConfig,
  type ResumeResult,
  type SandboxLifetime,
  type SandboxProvider,
  type SandboxProviderCapabilities,
  type StopConfig,
  type StopResult,
} from "../provider";
import {
  buildSandboxEnvVars,
  DEFERRED_START_ENV_VAR,
  IMAGE_BUILD_MODE_ENV_VAR,
  scmCloneIdentity,
} from "../sandbox-env";
import { resolveSandboxPortPlan } from "./port-resolution";

const log = createLogger("ec2-provider");

export const EC2_DEPLOYMENT_TAG = "openinspect:deployment";
export const EC2_SESSION_TAG = "openinspect:session-id";
export const EC2_SANDBOX_TAG = "openinspect:sandbox-id";
const EC2_TAG_VALUE_MAX_LENGTH = 255;

const BOOTSTRAP_PATH_SUFFIX = "/sandbox-bootstrap";

const RESUME_STOPPING_WAIT_MS = 120_000;
const RESUME_POLL_INTERVAL_MS = 5_000;
const MS_PER_SECOND = 1000;

const USER_DATA_VALUE_PATTERN = /^[A-Za-z0-9._~:/?#[\]@!$&()*+,;=%-]+$/;
const HOSTNAME_PATTERN = /^[A-Za-z0-9.-]+$/;

export interface Ec2ProviderConfig {
  scmProvider: SourceControlProviderName;
  imageId: string;
  instanceType: string;
  subnetId: string;
  securityGroupId: string;
  instanceProfileArn: string;
  deploymentName: string;
  controlPlanePrivateHost?: string;
}

export class Ec2SandboxProvider implements SandboxProvider {
  readonly name = "ec2";

  readonly capabilities: SandboxProviderCapabilities = {
    supportsSandboxTimeout: supportsConfigurableSandboxTimeout(this.name),
    supportsSnapshots: false,
    supportsRestore: false,
    supportsPersistentResume: true,
    supportsExplicitStop: true,
  };

  constructor(
    private readonly api: Ec2SandboxApi,
    private readonly bootstrapStore: SandboxBootstrapStore,
    private readonly config: Ec2ProviderConfig,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  async createSandbox(config: CreateSandboxConfig): Promise<CreateSandboxResult> {
    const bootstrapUrl = `${config.controlPlaneUrl.replace(/\/+$/, "")}/sessions/${encodeURIComponent(
      config.sessionId
    )}${BOOTSTRAP_PATH_SUFFIX}`;
    const token = generateSandboxBootstrapToken();
    const userData = renderEc2UserData(bootstrapUrl, token, this.config.controlPlanePrivateHost);

    // Stored before the launch: a booting instance redeems it immediately.
    await this.bootstrapStore.put(
      { sandboxId: config.sandboxId, env: this.buildEnvVars(config) },
      token,
      this.now() + SANDBOX_BOOTSTRAP_TOKEN_TTL_MS
    );

    try {
      const instance = await this.api.launchInstance({
        // The SDK retries an unanswered request; EC2 answers a repeated token with the first instance.
        clientToken: await deriveClientToken(config.sandboxId, config.generationCreatedAtMs),
        imageId: this.config.imageId,
        instanceType: this.config.instanceType,
        subnetId: this.config.subnetId,
        securityGroupId: this.config.securityGroupId,
        instanceProfileArn: this.config.instanceProfileArn,
        userData,
        tags: {
          Name: `openinspect-${config.sandboxId}`.slice(0, EC2_TAG_VALUE_MAX_LENGTH),
          [EC2_DEPLOYMENT_TAG]: this.config.deploymentName,
          [EC2_SESSION_TAG]: config.sessionId,
          [EC2_SANDBOX_TAG]: config.sandboxId,
        },
      });
      log.info("ec2.instance_launched", {
        session_id: config.sessionId,
        sandbox_id: config.sandboxId,
        instance_id: instance.instanceId,
      });
      const createdAt = this.now();
      return {
        sandboxId: config.sandboxId,
        providerObjectId: instance.instanceId,
        createdAt,
        lifetime: this.computeLifetime(
          config.generationCreatedAtMs ?? createdAt,
          config.timeoutSeconds
        ),
      };
    } catch (error) {
      throw classifyEc2Error("Failed to launch EC2 sandbox", error);
    }
  }

  async resumeSandbox(config: ResumeConfig): Promise<ResumeResult> {
    try {
      let instance = await this.api.describeInstance(config.providerObjectId);
      const deadline = this.now() + RESUME_STOPPING_WAIT_MS;
      while (instance?.state === "stopping" && this.now() < deadline) {
        await this.sleep(RESUME_POLL_INTERVAL_MS);
        instance = await this.api.describeInstance(config.providerObjectId);
      }
      if (isGone(instance)) {
        return { success: false, error: "EC2 instance no longer exists", shouldSpawnFresh: true };
      }
      if (instance.state === "stopping") {
        throw new SandboxProviderError("EC2 instance is still stopping", "transient");
      }
      let startedAtMs = this.now();
      if (instance.state === "stopped") {
        await this.api.startInstance(config.providerObjectId);
      } else if (instance.launchTimeMs !== null) {
        // Still running: its backstop was armed when it booted, not now.
        startedAtMs = instance.launchTimeMs;
      }
      return {
        success: true,
        providerObjectId: config.providerObjectId,
        lifetime: this.computeLifetime(startedAtMs, config.timeoutSeconds),
      };
    } catch (error) {
      throw classifyEc2Error("Failed to resume EC2 sandbox", error);
    }
  }

  async stopSandbox(config: StopConfig): Promise<StopResult> {
    const signal = signalUntilDeadline(config.deadlineAtMs, config.signal);
    try {
      if (config.intent === "destroy") {
        await this.terminateIfKnown(config.providerObjectId, signal);
        return { success: true };
      }
      const instance = await this.api.describeInstance(config.providerObjectId, signal);
      if (isGone(instance)) {
        return {
          success: false,
          error: "Sandbox disappeared before graceful shutdown was verified",
        };
      }
      if (instance.state === "pending" || instance.state === "running") {
        await this.api.stopInstance(config.providerObjectId, signal);
      }
      return { success: true };
    } catch (error) {
      throw classifyEc2Error(
        `Failed to ${config.intent === "destroy" ? "terminate" : "stop"} EC2 sandbox`,
        error
      );
    }
  }

  // Terminating an already-terminated instance succeeds; only one EC2 has forgotten is NotFound.
  private async terminateIfKnown(instanceId: string, signal?: AbortSignal): Promise<void> {
    try {
      await this.api.terminateInstance(instanceId, signal);
    } catch (error) {
      if (error instanceof Ec2ApiError && error.code === EC2_INSTANCE_NOT_FOUND_CODE) return;
      throw error;
    }
  }

  private buildEnvVars(config: CreateSandboxConfig): Record<string, string> {
    const envVars = buildSandboxEnvVars(config, {
      scmIdentity: scmCloneIdentity(this.config.scmProvider),
      portPlan: resolveSandboxPortPlan({ codeServer: false, terminal: false, vnc: false }, {}),
      emitDisabledTerminalEnv: true,
    });
    Object.assign(envVars, {
      [DEFERRED_START_ENV_VAR]: "false",
      [IMAGE_BUILD_MODE_ENV_VAR]: "false",
      RESTORED_FROM_SNAPSHOT: "false",
      FROM_REPO_IMAGE: "false",
    });
    return envVars;
  }

  // Must stay before the launcher's backstop (lifetime plus grace, from boot; ec2-infra/launcher.sh).
  private computeLifetime(
    startAtMs: number,
    timeoutSeconds: number | undefined
  ): Extract<SandboxLifetime, { kind: "finite" }> {
    return {
      kind: "finite",
      expiresAtMs: startAtMs + (timeoutSeconds ?? DEFAULT_SANDBOX_TIMEOUT_SECONDS) * MS_PER_SECOND,
      observedAtMs: this.now(),
      source: "conservative_start_bound",
    };
  }
}

function isGone(
  instance: Ec2Instance | null
): instance is null | (Ec2Instance & { state: "terminated" | "shutting-down" }) {
  return !instance || instance.state === "terminated" || instance.state === "shutting-down";
}

export function renderEc2UserData(
  bootstrapUrl: string,
  token: string,
  controlPlanePrivateHost?: string
): string {
  for (const value of [bootstrapUrl, token]) {
    if (!USER_DATA_VALUE_PATTERN.test(value)) {
      throw new SandboxProviderError("EC2 bootstrap value is not user-data safe", "permanent");
    }
  }
  if (new URL(bootstrapUrl).protocol !== "https:") {
    throw new SandboxProviderError(
      "EC2 sandboxes need an https:// control plane URL to receive their environment",
      "permanent"
    );
  }
  const routeLines: string[] = [];
  if (controlPlanePrivateHost) {
    const hostname = new URL(bootstrapUrl).hostname;
    if (!HOSTNAME_PATTERN.test(controlPlanePrivateHost) || !HOSTNAME_PATTERN.test(hostname)) {
      throw new SandboxProviderError(
        "EC2 control plane private host is not user-data safe",
        "permanent"
      );
    }
    routeLines.push(
      `echo 'OPENINSPECT_CONTROL_PLANE_HOST=${hostname}' > /etc/openinspect/control-plane-route`,
      `echo 'OPENINSPECT_CONTROL_PLANE_PRIVATE_HOST=${controlPlanePrivateHost}' >> /etc/openinspect/control-plane-route`
    );
  }
  // Paths and unit name match packages/ec2-infra/launcher.sh and openinspect-sandbox.service.
  return [
    "#!/bin/bash",
    "set -euo pipefail",
    "install -d -m 0700 /etc/openinspect",
    "umask 077",
    ...routeLines,
    "cat > /etc/openinspect/bootstrap <<'OPENINSPECT_BOOTSTRAP'",
    `OPENINSPECT_BOOTSTRAP_URL=${bootstrapUrl}`,
    `OPENINSPECT_BOOTSTRAP_TOKEN=${token}`,
    "OPENINSPECT_BOOTSTRAP",
    "systemctl start --no-block openinspect-sandbox.service",
    "",
  ].join("\n");
}

// EC2 client tokens are at most 64 ASCII characters.
async function deriveClientToken(
  sandboxId: string,
  generationCreatedAtMs: number | undefined
): Promise<string> {
  const identity = `${sandboxId}:${generationCreatedAtMs ?? ""}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function classifyEc2Error(message: string, error: unknown): SandboxProviderError {
  if (error instanceof SandboxProviderError) return error;
  if (error instanceof Ec2ApiError) {
    return new SandboxProviderError(
      `${message}: ${error.message}`,
      error.isRetryable ? "transient" : "permanent",
      error
    );
  }
  return SandboxProviderError.fromFetchError(`${message}: ${String(error)}`, error);
}

export function createEc2Provider(
  api: Ec2SandboxApi,
  bootstrapStore: SandboxBootstrapStore,
  config: Ec2ProviderConfig
): Ec2SandboxProvider {
  return new Ec2SandboxProvider(api, bootstrapStore, config);
}
