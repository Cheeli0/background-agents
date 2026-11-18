import { describe, expect, it } from "vitest";
import { prepareManagedProviderEnv } from "./managed-provider-env";

describe("prepareManagedProviderEnv", () => {
  it.each(["api_key", "provider_account"] as const)(
    "removes competing native Codex authority in %s mode",
    (mode) => {
      const result = prepareManagedProviderEnv({
        harness: "codex",
        brokerSecrets: {},
        exposedSecrets: {
          OPENAI_API_KEY: "selected",
          OPENAI_BASE_URL: "https://other",
          OPENAI_ORG_ID: "other-org",
          CODEX_API_KEY: "unselected",
          CODEX_ACCESS_TOKEN: "unselected",
          CODEX_HOME: "/other",
          CODEX_SQLITE_HOME: "/other",
          OTEL_EXPORTER_OTLP_ENDPOINT: "https://other",
          USER_BUILD_VAR: "keep",
        },
        providerAuthModes: { openai: mode, xai: "api_key", anthropic: "api_key" },
      });
      expect(result).toEqual(
        mode === "api_key"
          ? { OPENAI_API_KEY: "selected", USER_BUILD_VAR: "keep" }
          : {
              OPENAI_OAUTH_MANAGED: "1",
              OPENINSPECT_USER_OPENAI_API_KEY: "selected",
              USER_BUILD_VAR: "keep",
            }
      );
    }
  );

  it("does not change OpenCode native environment compatibility", () => {
    expect(
      prepareManagedProviderEnv({
        harness: "opencode",
        exposedSecrets: {
          CODEX_HOME: "/custom",
          OPENAI_API_KEY: "selected",
          OPENAI_BASE_URL: "https://custom",
        },
        brokerSecrets: {},
        providerAuthModes: { openai: "api_key", xai: "api_key", anthropic: "api_key" },
      })
    ).toEqual({
      CODEX_HOME: "/custom",
      OPENAI_API_KEY: "selected",
      OPENAI_BASE_URL: "https://custom",
    });
  });

  it("keeps a withheld user API key under the prefixed name for each managed provider", () => {
    expect(
      prepareManagedProviderEnv({
        harness: "opencode",
        exposedSecrets: {
          OPENAI_API_KEY: "openai-key",
          XAI_API_KEY: "xai-key",
          ANTHROPIC_API_KEY: "anthropic-key",
        },
        brokerSecrets: {},
        providerAuthModes: {
          openai: "provider_account",
          xai: "provider_account",
          anthropic: "provider_account",
        },
      })
    ).toEqual({
      OPENAI_OAUTH_MANAGED: "1",
      OPENINSPECT_USER_OPENAI_API_KEY: "openai-key",
      XAI_OAUTH_MANAGED: "1",
      OPENINSPECT_USER_XAI_API_KEY: "xai-key",
      ANTHROPIC_OAUTH_MANAGED: "1",
      OPENINSPECT_USER_ANTHROPIC_API_KEY: "anthropic-key",
    });
  });

  it("keeps a secret the user stored under the prefixed name", () => {
    expect(
      prepareManagedProviderEnv({
        harness: "opencode",
        exposedSecrets: {
          OPENAI_API_KEY: "openai-key",
          OPENINSPECT_USER_OPENAI_API_KEY: "explicit",
        },
        brokerSecrets: {},
        providerAuthModes: { openai: "provider_account", xai: "api_key", anthropic: "api_key" },
      })
    ).toEqual({ OPENAI_OAUTH_MANAGED: "1", OPENINSPECT_USER_OPENAI_API_KEY: "explicit" });
  });

  it("adds no prefixed name when the user supplied no API key", () => {
    expect(
      prepareManagedProviderEnv({
        harness: "opencode",
        exposedSecrets: { USER_BUILD_VAR: "keep" },
        brokerSecrets: {},
        providerAuthModes: { openai: "provider_account", xai: "api_key", anthropic: "api_key" },
      })
    ).toEqual({ OPENAI_OAUTH_MANAGED: "1", USER_BUILD_VAR: "keep" });
  });
});
