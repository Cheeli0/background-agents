export type Ec2InstanceState =
  "pending" | "running" | "shutting-down" | "terminated" | "stopping" | "stopped";

export const EC2_INSTANCE_NOT_FOUND_CODE = "InvalidInstanceID.NotFound";

export interface Ec2Instance {
  instanceId: string;
  state: Ec2InstanceState;
  /** When the instance last started; EC2 resets it on every start. */
  launchTimeMs: number | null;
}

export interface Ec2LaunchRequest {
  clientToken: string;
  imageId: string;
  instanceType: string;
  subnetId: string;
  securityGroupId: string;
  instanceProfileArn: string;
  userData: string;
  tags: Record<string, string>;
}

export class Ec2ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly isRetryable: boolean,
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "Ec2ApiError";
  }
}

export interface Ec2SandboxApi {
  launchInstance(request: Ec2LaunchRequest, signal?: AbortSignal): Promise<Ec2Instance>;
  describeInstance(instanceId: string, signal?: AbortSignal): Promise<Ec2Instance | null>;
  startInstance(instanceId: string, signal?: AbortSignal): Promise<void>;
  stopInstance(instanceId: string, signal?: AbortSignal): Promise<void>;
  terminateInstance(instanceId: string, signal?: AbortSignal): Promise<void>;
}
