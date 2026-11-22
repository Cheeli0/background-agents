import {
  DescribeInstancesCommand,
  EC2Client,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  type Instance,
} from "@aws-sdk/client-ec2";
import {
  EC2_INSTANCE_NOT_FOUND_CODE,
  Ec2ApiError,
  type Ec2Instance,
  type Ec2InstanceState,
  type Ec2LaunchRequest,
  type Ec2SandboxApi,
} from "../sandbox/ec2-api";

const RETRYABLE_ERROR_CODES = new Set([
  "RequestLimitExceeded",
  "Throttling",
  "ThrottlingException",
  "InsufficientInstanceCapacity",
  "InternalError",
  "ServiceUnavailable",
  "Unavailable",
]);

const FIRST_SERVER_ERROR_STATUS = 500;

const INSTANCE_STATES: ReadonlySet<string> = new Set<Ec2InstanceState>([
  "pending",
  "running",
  "shutting-down",
  "terminated",
  "stopping",
  "stopped",
]);

export function createEc2SandboxApi(region: string): Ec2SandboxApi {
  return new SdkEc2SandboxApi(new EC2Client({ region }));
}

export class SdkEc2SandboxApi implements Ec2SandboxApi {
  constructor(private readonly client: Pick<EC2Client, "send">) {}

  async launchInstance(request: Ec2LaunchRequest, signal?: AbortSignal): Promise<Ec2Instance> {
    const tags = toTags(request.tags);
    const output = await this.call("RunInstances", signal, () =>
      this.client.send(
        new RunInstancesCommand({
          ClientToken: request.clientToken,
          ImageId: request.imageId,
          InstanceType: request.instanceType as never,
          MinCount: 1,
          MaxCount: 1,
          SubnetId: request.subnetId,
          SecurityGroupIds: [request.securityGroupId],
          IamInstanceProfile: { Arn: request.instanceProfileArn },
          UserData: Buffer.from(request.userData, "utf8").toString("base64"),
          InstanceInitiatedShutdownBehavior: "terminate",
          MetadataOptions: { HttpTokens: "required", HttpPutResponseHopLimit: 1 },
          TagSpecifications: [
            { ResourceType: "instance", Tags: tags },
            { ResourceType: "volume", Tags: tags },
          ],
        }),
        { abortSignal: signal }
      )
    );
    const instance = output.Instances?.[0];
    const parsed = instance ? parseInstance(instance) : null;
    if (!parsed) {
      throw new Ec2ApiError("RunInstances returned no instance", "MalformedResponse", false);
    }
    return parsed;
  }

  async describeInstance(instanceId: string, signal?: AbortSignal): Promise<Ec2Instance | null> {
    try {
      const output = await this.call("DescribeInstances", signal, () =>
        this.client.send(new DescribeInstancesCommand({ InstanceIds: [instanceId] }), {
          abortSignal: signal,
        })
      );
      const instance = output.Reservations?.flatMap(
        (reservation) => reservation.Instances ?? []
      ).find((candidate) => candidate.InstanceId === instanceId);
      return instance ? parseInstance(instance) : null;
    } catch (error) {
      if (error instanceof Ec2ApiError && error.code === EC2_INSTANCE_NOT_FOUND_CODE) return null;
      throw error;
    }
  }

  async startInstance(instanceId: string, signal?: AbortSignal): Promise<void> {
    const command = new StartInstancesCommand({ InstanceIds: [instanceId] });
    await this.call("StartInstances", signal, () =>
      this.client.send(command, { abortSignal: signal })
    );
  }

  async stopInstance(instanceId: string, signal?: AbortSignal): Promise<void> {
    const command = new StopInstancesCommand({ InstanceIds: [instanceId] });
    await this.call("StopInstances", signal, () =>
      this.client.send(command, { abortSignal: signal })
    );
  }

  async terminateInstance(instanceId: string, signal?: AbortSignal): Promise<void> {
    const command = new TerminateInstancesCommand({ InstanceIds: [instanceId] });
    await this.call("TerminateInstances", signal, () =>
      this.client.send(command, { abortSignal: signal })
    );
  }

  private async call<T>(
    operation: string,
    signal: AbortSignal | undefined,
    send: () => Promise<T>
  ): Promise<T> {
    try {
      return await send();
    } catch (error) {
      throw toEc2ApiError(operation, error, signal);
    }
  }
}

function toTags(tags: Record<string, string>): Array<{ Key: string; Value: string }> {
  return Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));
}

function parseInstance(instance: Instance): Ec2Instance | null {
  const state = instance.State?.Name;
  if (!instance.InstanceId || !state || !INSTANCE_STATES.has(state)) return null;
  return {
    instanceId: instance.InstanceId,
    state: state as Ec2InstanceState,
    launchTimeMs: instance.LaunchTime ? instance.LaunchTime.getTime() : null,
  };
}

export function toEc2ApiError(
  operation: string,
  error: unknown,
  signal?: AbortSignal
): Ec2ApiError {
  if (error instanceof Ec2ApiError) return error;
  if (signal?.aborted) {
    return new Ec2ApiError(`${operation} was cancelled`, "Aborted", true, error);
  }
  const details = error as {
    name?: unknown;
    Code?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  } | null;
  const code =
    (typeof details?.Code === "string" && details.Code) ||
    (typeof details?.name === "string" && details.name) ||
    "Unknown";
  const status =
    typeof details?.$metadata?.httpStatusCode === "number"
      ? details.$metadata.httpStatusCode
      : undefined;
  // A request with no HTTP status never reached EC2.
  const isRetryable =
    RETRYABLE_ERROR_CODES.has(code) || status === undefined || status >= FIRST_SERVER_ERROR_STATUS;
  return new Ec2ApiError(
    `${operation} failed: ${code}${status === undefined ? "" : ` (HTTP ${status})`}`,
    code,
    isRetryable,
    error
  );
}
