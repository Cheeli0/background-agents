import { describe, expect, it, vi } from "vitest";
import { createTestEnv } from "../router.test-support";
import type { Env } from "../types";
import { createSandboxProviderFromEnv } from "./provider-factory";
import type { SandboxBootstrapStore } from "./bootstrap";
import type { Ec2SandboxApi } from "./ec2-api";

function createEnv(overrides: Partial<Env>): Env {
  return createTestEnv({ TOKEN_ENCRYPTION_KEY: "test-token-key", ...overrides });
}

describe("createSandboxProviderFromEnv", () => {
  it("rejects malformed Vercel numeric configuration", () => {
    const env = createEnv({
      VERCEL_TOKEN: "vercel-token",
      VERCEL_PROJECT_ID: "project-id",
      VERCEL_SNAPSHOT_EXPIRATION_MS: "10m",
    });

    expect(() => createSandboxProviderFromEnv(env, "vercel")).toThrow(
      "VERCEL_SNAPSHOT_EXPIRATION_MS must be a valid number"
    );
  });

  it("rejects malformed Daytona auto-stop configuration", () => {
    const env = createEnv({
      DAYTONA_API_URL: "https://daytona.test",
      DAYTONA_API_KEY: "daytona-key",
      DAYTONA_BASE_SNAPSHOT: "base",
      DAYTONA_AUTO_STOP_INTERVAL_MINUTES: "abc",
    });

    expect(() => createSandboxProviderFromEnv(env, "daytona")).toThrow(
      "DAYTONA_AUTO_STOP_INTERVAL_MINUTES must be a valid number"
    );
  });

  it("rejects malformed Daytona auto-archive configuration", () => {
    const env = createEnv({
      DAYTONA_API_URL: "https://daytona.test",
      DAYTONA_API_KEY: "daytona-key",
      DAYTONA_BASE_SNAPSHOT: "base",
      DAYTONA_AUTO_STOP_INTERVAL_MINUTES: "30",
      DAYTONA_AUTO_ARCHIVE_INTERVAL_MINUTES: "abc",
    });

    expect(() => createSandboxProviderFromEnv(env, "daytona")).toThrow(
      "DAYTONA_AUTO_ARCHIVE_INTERVAL_MINUTES must be a valid number"
    );
  });

  it("needs a base snapshot to create Daytona sandboxes", () => {
    const env = createEnv({
      DAYTONA_API_URL: "https://daytona.test",
      DAYTONA_API_KEY: "daytona-key",
    });

    expect(() => createSandboxProviderFromEnv(env, "daytona")).toThrow(
      "DAYTONA_BASE_SNAPSHOT is required to create Daytona sandboxes"
    );
  });

  it("still requires Daytona credentials", () => {
    expect(() =>
      createSandboxProviderFromEnv(
        createEnv({ DAYTONA_API_URL: "https://daytona.test" }),
        "daytona"
      )
    ).toThrow("DAYTONA_API_URL and DAYTONA_API_KEY are required");
  });

  it("requires Boat credentials and a base snapshot", () => {
    expect(() =>
      createSandboxProviderFromEnv(createEnv({ BOAT_API_KEY: "boat_key" }), "boat")
    ).toThrow("BOAT_API_KEY and BOAT_BASE_SNAPSHOT are required");
    expect(() =>
      createSandboxProviderFromEnv(createEnv({ BOAT_BASE_SNAPSHOT: "open-inspect-abc" }), "boat")
    ).toThrow("BOAT_API_KEY and BOAT_BASE_SNAPSHOT are required");
  });

  it("rejects an unknown Boat machine type", () => {
    const env = createEnv({
      BOAT_API_KEY: "boat_key",
      BOAT_BASE_SNAPSHOT: "open-inspect-abc",
      BOAT_SANDBOX_TYPE: "huge",
    });

    expect(() => createSandboxProviderFromEnv(env, "boat")).toThrow(
      "BOAT_SANDBOX_TYPE must be one of small, default, large, xlarge"
    );
  });

  it("builds the Boat provider from its environment", () => {
    const provider = createSandboxProviderFromEnv(
      createEnv({ BOAT_API_KEY: "boat_key", BOAT_BASE_SNAPSHOT: "open-inspect-abc" }),
      "boat"
    );
    expect(provider.name).toBe("boat");
    expect(provider.capabilities).toMatchObject({
      supportsPersistentResume: true,
      supportsExplicitStop: true,
      supportsSnapshots: false,
    });
  });

  it("rejects malformed E2B auto-pause configuration", () => {
    const env = createEnv({
      E2B_API_KEY: "e2b-key",
      E2B_TEMPLATE_ID: "tmpl",
      E2B_AUTO_PAUSE: "tru",
    });

    expect(() => createSandboxProviderFromEnv(env, "e2b")).toThrow(
      "E2B_AUTO_PAUSE must be a valid boolean"
    );
  });

  describe("ec2", () => {
    const ec2Sandboxes: Ec2SandboxApi = {
      launchInstance: vi.fn(),
      describeInstance: vi.fn(),
      startInstance: vi.fn(),
      stopInstance: vi.fn(),
      terminateInstance: vi.fn(),
    };
    const bootstrapStore: SandboxBootstrapStore = { put: vi.fn(), consume: vi.fn() };
    const ec2Settings = {
      EC2_SANDBOX_AMI_ID: "ami-1",
      EC2_SANDBOX_SUBNET_ID: "subnet-1",
      EC2_SANDBOX_SECURITY_GROUP_ID: "sg-1",
      EC2_SANDBOX_INSTANCE_PROFILE_ARN: "profile",
    };

    it.each([
      ["the Node host's EC2 binding", {}, bootstrapStore, "requires the Node host"],
      [
        "a session bootstrap store",
        { EC2_SANDBOXES: ec2Sandboxes },
        undefined,
        "requires a session bootstrap store",
      ],
    ])("needs %s", (_name, overrides, store, message) => {
      const env = createEnv({ ...ec2Settings, ...overrides });
      expect(() => createSandboxProviderFromEnv(env, "ec2", store)).toThrow(message);
    });

    it("names every missing setting", () => {
      const env = createEnv({ EC2_SANDBOXES: ec2Sandboxes, EC2_SANDBOX_AMI_ID: "ami-1" });
      expect(() => createSandboxProviderFromEnv(env, "ec2", bootstrapStore)).toThrow(
        "EC2_SANDBOX_SUBNET_ID, EC2_SANDBOX_SECURITY_GROUP_ID, EC2_SANDBOX_INSTANCE_PROFILE_ARN required"
      );
    });

    it("creates the provider from complete configuration", () => {
      const env = createEnv({ EC2_SANDBOXES: ec2Sandboxes, ...ec2Settings });
      expect(createSandboxProviderFromEnv(env, "ec2", bootstrapStore).name).toBe("ec2");
    });
  });
});
