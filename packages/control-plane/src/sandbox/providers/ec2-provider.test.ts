import { describe, expect, it, vi } from "vitest";
import type { SandboxBootstrapRecord, SandboxBootstrapStore } from "../bootstrap";
import {
  EC2_INSTANCE_NOT_FOUND_CODE,
  Ec2ApiError,
  type Ec2Instance,
  type Ec2InstanceState,
  type Ec2LaunchRequest,
  type Ec2SandboxApi,
} from "../ec2-api";
import { SandboxProviderError, type CreateSandboxConfig } from "../provider";
import {
  EC2_DEPLOYMENT_TAG,
  EC2_SANDBOX_TAG,
  EC2_SESSION_TAG,
  Ec2SandboxProvider,
  renderEc2UserData,
} from "./ec2-provider";

const NOW = 1_700_000_000_000;
const LAUNCHED_AT = NOW - 3_500_000;

function fakeApi(states: Array<Ec2InstanceState | null> = ["running"]) {
  const queue = [...states];
  const describe = vi.fn(async (instanceId: string): Promise<Ec2Instance | null> => {
    const state = queue.length > 1 ? queue.shift()! : queue[0];
    return state ? { instanceId, state, launchTimeMs: LAUNCHED_AT } : null;
  });
  return {
    launchInstance: vi.fn(async (_request: Ec2LaunchRequest) => ({
      instanceId: "i-123",
      state: "pending" as const,
      launchTimeMs: null,
    })),
    describeInstance: describe,
    startInstance: vi.fn(async () => {}),
    stopInstance: vi.fn(async () => {}),
    terminateInstance: vi.fn(async () => {}),
  } satisfies Ec2SandboxApi;
}

function fakeStore() {
  const puts: Array<{ record: SandboxBootstrapRecord; token: string; expiresAtMs: number }> = [];
  const store: SandboxBootstrapStore = {
    put: vi.fn(async (record, token, expiresAtMs) => {
      puts.push({ record, token, expiresAtMs });
    }),
    consume: vi.fn(async () => null),
  };
  return { store, puts };
}

function createProvider(api: Ec2SandboxApi, store: SandboxBootstrapStore) {
  return new Ec2SandboxProvider(
    api,
    store,
    {
      scmProvider: "github",
      imageId: "ami-base",
      instanceType: "m7i.large",
      subnetId: "subnet-1",
      securityGroupId: "sg-1",
      instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/sandbox",
      deploymentName: "test-deployment",
    },
    () => NOW,
    async () => {}
  );
}

const createConfig: CreateSandboxConfig = {
  sessionId: "session-1",
  sandboxId: "sandbox-acme-web-app-1700000000000",
  repoOwner: "acme",
  repoName: "web-app",
  controlPlaneUrl: "https://control.example.com/",
  sandboxAuthToken: "sandbox-auth-secret",
  harness: "opencode",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  userEnvVars: { MY_SECRET: "repo-secret" },
  timeoutSeconds: 3600,
  generationCreatedAtMs: NOW - 1000,
  codeServerEnabled: true,
};

describe("Ec2SandboxProvider.createSandbox", () => {
  it("stores the environment behind a bootstrap token and launches with only the token", async () => {
    const api = fakeApi();
    const { store, puts } = fakeStore();

    const result = await createProvider(api, store).createSandbox(createConfig);

    expect(puts).toHaveLength(1);
    const [{ record, token, expiresAtMs }] = puts;
    expect(record.sandboxId).toBe(createConfig.sandboxId);
    expect(record.env).toMatchObject({
      SANDBOX_AUTH_TOKEN: "sandbox-auth-secret",
      MY_SECRET: "repo-secret",
      SANDBOX_TIMEOUT_SECONDS: "3600",
      RESTORED_FROM_SNAPSHOT: "false",
      FROM_REPO_IMAGE: "false",
    });
    // No preview URLs: code-server is not offered even when enabled.
    expect(record.env.CODE_SERVER_PORT).toBeUndefined();
    expect(expiresAtMs).toBeGreaterThan(NOW);

    const request = api.launchInstance.mock.calls[0][0];
    expect(request).toMatchObject({
      imageId: "ami-base",
      instanceType: "m7i.large",
      subnetId: "subnet-1",
      securityGroupId: "sg-1",
      instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/sandbox",
      tags: {
        [EC2_DEPLOYMENT_TAG]: "test-deployment",
        [EC2_SESSION_TAG]: "session-1",
        [EC2_SANDBOX_TAG]: createConfig.sandboxId,
      },
    });
    expect(request.clientToken).toMatch(/^[0-9a-f]{64}$/);

    // A retry of the same sandbox under a new generation is a new launch.
    await createProvider(api, fakeStore().store).createSandbox({
      ...createConfig,
      generationCreatedAtMs: NOW,
    });
    expect(api.launchInstance.mock.calls[1][0].clientToken).not.toBe(request.clientToken);
    expect(request.userData).toContain(
      "OPENINSPECT_BOOTSTRAP_URL=https://control.example.com/sessions/session-1/sandbox-bootstrap"
    );
    expect(request.userData).toContain(`OPENINSPECT_BOOTSTRAP_TOKEN=${token}`);
    expect(request.userData).not.toContain("sandbox-auth-secret");
    expect(request.userData).not.toContain("repo-secret");

    expect(result).toEqual({
      sandboxId: createConfig.sandboxId,
      providerObjectId: "i-123",
      createdAt: NOW,
      lifetime: {
        kind: "finite",
        expiresAtMs: NOW - 1000 + 3600 * 1000,
        observedAtMs: NOW,
        source: "conservative_start_bound",
      },
    });
  });

  it.each([
    [true, "transient"],
    [false, "permanent"],
  ] as const)("classifies a launch failure with retryable=%s as %s", async (retryable, type) => {
    const api = fakeApi();
    api.launchInstance.mockRejectedValue(new Ec2ApiError("nope", "Code", retryable));

    const error = await createProvider(api, fakeStore().store)
      .createSandbox(createConfig)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SandboxProviderError);
    expect((error as SandboxProviderError).errorType).toBe(type);
  });
});

describe("Ec2SandboxProvider.resumeSandbox", () => {
  const resumeConfig = {
    providerObjectId: "i-123",
    sessionId: "session-1",
    sandboxId: "sb-1",
    timeoutSeconds: 60,
  };

  it("starts a stopped instance", async () => {
    const api = fakeApi(["stopped"]);

    const result = await createProvider(api, fakeStore().store).resumeSandbox(resumeConfig);

    expect(api.startInstance).toHaveBeenCalledWith("i-123");
    expect(result).toMatchObject({
      success: true,
      providerObjectId: "i-123",
      lifetime: { kind: "finite", expiresAtMs: NOW + 60_000 },
    });
  });

  it("waits for an instance that is still stopping", async () => {
    const api = fakeApi(["stopping", "stopping", "stopped"]);

    const result = await createProvider(api, fakeStore().store).resumeSandbox(resumeConfig);

    expect(api.startInstance).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
  });

  it("leaves a running instance alone and bounds its lifetime from its own start", async () => {
    const api = fakeApi(["running"]);

    const result = await createProvider(api, fakeStore().store).resumeSandbox(resumeConfig);

    expect(api.startInstance).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: true,
      lifetime: { expiresAtMs: LAUNCHED_AT + resumeConfig.timeoutSeconds * 1000 },
    });
  });

  it.each([null, "terminated", "shutting-down"] as const)(
    "asks for a fresh spawn when the instance is %s",
    async (state) => {
      const api = fakeApi([state]);

      const result = await createProvider(api, fakeStore().store).resumeSandbox(resumeConfig);

      expect(result).toMatchObject({ success: false, shouldSpawnFresh: true });
      expect(api.startInstance).not.toHaveBeenCalled();
    }
  );
});

describe("Ec2SandboxProvider.stopSandbox", () => {
  const stopConfig = { providerObjectId: "i-123", sessionId: "session-1", reason: "inactivity" };

  it("stops a running instance to preserve it", async () => {
    const api = fakeApi(["running"]);

    const result = await createProvider(api, fakeStore().store).stopSandbox({
      ...stopConfig,
      intent: "preserve",
    });

    expect(result).toEqual({ success: true });
    expect(api.stopInstance).toHaveBeenCalledOnce();
    expect(api.terminateInstance).not.toHaveBeenCalled();
  });

  it.each(["stopping", "stopped"] as const)("accepts an instance already %s", async (state) => {
    const api = fakeApi([state]);

    const result = await createProvider(api, fakeStore().store).stopSandbox({
      ...stopConfig,
      intent: "preserve",
    });

    expect(result).toEqual({ success: true });
    expect(api.stopInstance).not.toHaveBeenCalled();
  });

  it("cannot confirm a preserve-stop of an instance that is gone", async () => {
    const api = fakeApi([null]);

    const result = await createProvider(api, fakeStore().store).stopSandbox({
      ...stopConfig,
      intent: "preserve",
    });

    expect(result.success).toBe(false);
  });

  it("terminates to destroy even when a lookup cannot see the instance yet", async () => {
    const notYetVisible = fakeApi([null]);

    await expect(
      createProvider(notYetVisible, fakeStore().store).stopSandbox({
        ...stopConfig,
        intent: "destroy",
      })
    ).resolves.toEqual({ success: true });

    expect(notYetVisible.terminateInstance).toHaveBeenCalledOnce();
  });

  it("treats an instance EC2 has forgotten as destroyed", async () => {
    const api = fakeApi();
    api.terminateInstance.mockRejectedValue(
      new Ec2ApiError("gone", EC2_INSTANCE_NOT_FOUND_CODE, false)
    );

    await expect(
      createProvider(api, fakeStore().store).stopSandbox({ ...stopConfig, intent: "destroy" })
    ).resolves.toEqual({ success: true });
  });
});

describe("renderEc2UserData", () => {
  it("hands the launcher the control plane's private host to resolve on every boot", () => {
    const userData = renderEc2UserData(
      "https://control.example.com/sessions/s/sandbox-bootstrap",
      "token",
      "ec2-203-0-113-7.us-west-2.compute.amazonaws.com"
    );
    expect(userData).toContain("OPENINSPECT_CONTROL_PLANE_HOST=control.example.com");
    expect(userData).toContain(
      "OPENINSPECT_CONTROL_PLANE_PRIVATE_HOST=ec2-203-0-113-7.us-west-2.compute.amazonaws.com"
    );
    expect(userData).not.toContain("/etc/hosts");
  });

  it("refuses to send the bootstrap over plain HTTP", () => {
    expect(() =>
      renderEc2UserData("http://control.example.com/sessions/s/sandbox-bootstrap", "t")
    ).toThrow("need an https:// control plane URL");
  });

  it("refuses a private host that is not a plain hostname", () => {
    expect(() => renderEc2UserData("https://x.example/y", "t", "host; curl evil")).toThrow(
      "control plane private host is not user-data safe"
    );
  });

  it("refuses values that would need quoting", () => {
    expect(() => renderEc2UserData("https://x/sessions/a b/sandbox-bootstrap", "t")).toThrow(
      "bootstrap value is not user-data safe"
    );
    expect(() => renderEc2UserData("https://x/y", "t'; rm -rf /")).toThrow(
      "bootstrap value is not user-data safe"
    );
  });
});
