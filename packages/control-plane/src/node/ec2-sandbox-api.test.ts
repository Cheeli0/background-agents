import { describe, expect, it, vi } from "vitest";
import type { EC2Client } from "@aws-sdk/client-ec2";
import { SdkEc2SandboxApi, toEc2ApiError } from "./ec2-sandbox-api";

function sdkError(name: string, status?: number): Error {
  const error = new Error(name) as Error & { $metadata?: { httpStatusCode?: number } };
  error.name = name;
  if (status !== undefined) error.$metadata = { httpStatusCode: status };
  return error;
}

describe("toEc2ApiError", () => {
  it.each([
    ["RequestLimitExceeded", 400, true],
    ["InsufficientInstanceCapacity", 500, true],
    ["InternalError", 500, true],
    ["UnauthorizedOperation", 403, false],
    ["InvalidParameterValue", 400, false],
    ["InstanceLimitExceeded", 400, false],
  ])("classifies %s (HTTP %s) as retryable=%s", (name, status, isRetryable) => {
    expect(toEc2ApiError("RunInstances", sdkError(name, status))).toMatchObject({
      code: name,
      isRetryable,
    });
  });

  it("treats a request that never got an answer as retryable", () => {
    expect(toEc2ApiError("StopInstances", new TypeError("fetch failed")).isRetryable).toBe(true);
  });
});

describe("SdkEc2SandboxApi", () => {
  it("launches with the hardened instance settings", async () => {
    const send = vi.fn(async () => ({
      Instances: [{ InstanceId: "i-1", State: { Name: "pending" } }],
    }));
    const api = new SdkEc2SandboxApi({ send } as unknown as Pick<EC2Client, "send">);

    const instance = await api.launchInstance({
      clientToken: "token",
      imageId: "ami-1",
      instanceType: "m7i.large",
      subnetId: "subnet-1",
      securityGroupId: "sg-1",
      instanceProfileArn: "arn:aws:iam::123456789012:instance-profile/sandbox",
      userData: "#!/bin/bash\n",
      tags: { Name: "sandbox" },
    });

    expect(instance).toEqual({ instanceId: "i-1", state: "pending", launchTimeMs: null });
    const input = (send.mock.calls[0] as unknown as [{ input: Record<string, unknown> }])[0].input;
    expect(input).toMatchObject({
      ClientToken: "token",
      IamInstanceProfile: { Arn: "arn:aws:iam::123456789012:instance-profile/sandbox" },
      UserData: Buffer.from("#!/bin/bash\n").toString("base64"),
      InstanceInitiatedShutdownBehavior: "terminate",
      MetadataOptions: { HttpTokens: "required", HttpPutResponseHopLimit: 1 },
    });
  });

  it("reports an instance EC2 no longer knows as null", async () => {
    const send = vi.fn(async () => {
      throw sdkError("InvalidInstanceID.NotFound", 400);
    });
    const api = new SdkEc2SandboxApi({ send } as unknown as Pick<EC2Client, "send">);

    await expect(api.describeInstance("i-gone")).resolves.toBeNull();
  });
});
