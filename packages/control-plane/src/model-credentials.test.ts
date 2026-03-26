import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENCODE_AUTH_JSON_SECRET,
  ZAI_API_KEY_SECRET,
  extractCopilotAccessTokenFromAuthJson,
  isGitHubCopilotModel,
  isZaiCodingPlanModel,
  validateModelCredentialsForRepo,
} from "./model-credentials";

const mockGetGlobalSecrets = vi.fn<() => Promise<Record<string, string>>>();
const mockGetRepoSecrets = vi.fn<() => Promise<Record<string, string>>>();

vi.mock("./db/global-secrets", () => ({
  GlobalSecretsStore: vi.fn().mockImplementation(() => ({
    getDecryptedSecrets: mockGetGlobalSecrets,
  })),
}));

vi.mock("./db/repo-secrets", () => ({
  RepoSecretsStore: vi.fn().mockImplementation(() => ({
    getDecryptedSecrets: mockGetRepoSecrets,
  })),
}));

describe("model-credentials", () => {
  const futureExpiresAt = Date.now() + 10 * 60 * 1000;
  const pastExpiresAt = Date.now() - 10 * 60 * 1000;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGlobalSecrets.mockResolvedValue({});
    mockGetRepoSecrets.mockResolvedValue({});
  });

  describe("isGitHubCopilotModel", () => {
    it("detects GitHub Copilot-backed models", () => {
      expect(isGitHubCopilotModel("github-copilot/gpt-5.1")).toBe(true);
      expect(isGitHubCopilotModel("github-copilot/claude-sonnet-4")).toBe(true);
      expect(isGitHubCopilotModel("openai/gpt-5.4")).toBe(false);
    });
  });

  describe("isZaiCodingPlanModel", () => {
    it("detects Z.AI Coding Plan-backed models", () => {
      expect(isZaiCodingPlanModel("zai-coding-plan/glm-5")).toBe(true);
      expect(isZaiCodingPlanModel("zai-coding-plan/glm-4.7")).toBe(true);
      expect(isZaiCodingPlanModel("openai/gpt-5.4")).toBe(false);
    });
  });

  describe("validateModelCredentialsForRepo", () => {
    const env = {
      DB: {} as D1Database,
      REPO_SECRETS_ENCRYPTION_KEY: "test-key",
    };

    it("skips validation for non-Copilot models", async () => {
      const result = await validateModelCredentialsForRepo(env, "openai/gpt-5.4", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
      expect(mockGetGlobalSecrets).not.toHaveBeenCalled();
      expect(mockGetRepoSecrets).not.toHaveBeenCalled();
    });

    it("returns an error when secrets storage is unavailable", async () => {
      const result = await validateModelCredentialsForRepo(
        { DB: {} as D1Database, REPO_SECRETS_ENCRYPTION_KEY: undefined },
        "github-copilot/gpt-5.1",
        {
          repoId: 1,
          repoOwner: "acme",
          repoName: "widgets",
        }
      );

      expect(result).toContain("secrets storage");
    });

    it("returns an error when OPENCODE_AUTH_JSON is missing", async () => {
      const result = await validateModelCredentialsForRepo(env, "github-copilot/gpt-5.1", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain(OPENCODE_AUTH_JSON_SECRET);
    });

    it("accepts a repo-scoped GitHub Copilot auth blob", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          "github-copilot": { type: "oauth", access: "token", expires: futureExpiresAt },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "github-copilot/claude-sonnet-4", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("accepts a full auth blob with a copilot key", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          copilot: { type: "oauth", access: "token", expires: futureExpiresAt },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "github-copilot/gpt-5.1", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("accepts a provider entry pasted directly", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          type: "oauth",
          access: "token",
          refresh: "refresh-token",
          expires: futureExpiresAt,
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "github-copilot/gpt-5-mini", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("accepts a global GitHub Copilot auth blob", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          "github-copilot": { type: "oauth", access: "token", expires: futureExpiresAt },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "github-copilot/gpt-4.1", {
        repoId: null,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("returns an error for invalid JSON", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: "{invalid",
      });

      const result = await validateModelCredentialsForRepo(env, "github-copilot/gpt-5.1", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain("valid JSON");
    });

    it("returns an error when the auth blob lacks GitHub Copilot credentials", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          openai: { type: "oauth", refresh: "managed-by-control-plane" },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "github-copilot/gpt-5-mini", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain("GitHub Copilot credentials");
    });

    it("accepts a Z.AI provider entry pasted directly", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          type: "api",
          key: "zai-key",
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-5", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("accepts a zai-coding-plan auth entry", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          "zai-coding-plan": { type: "api", key: "zai-key" },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-5-turbo", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("accepts a zai auth entry", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          zai: { type: "api", key: "zai-key" },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-4.7", {
        repoId: null,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("prioritizes zai-coding-plan when both Z.AI provider entries exist", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          "zai-coding-plan": { type: "oauth", key: "not-api" },
          zai: { type: "api", key: "zai-key" },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-4.7", {
        repoId: null,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain("type 'api'");
    });

    it("returns an error when Z.AI credentials are missing", async () => {
      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-4.5-air", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain(OPENCODE_AUTH_JSON_SECRET);
      expect(result).toContain(ZAI_API_KEY_SECRET);
      expect(result).toContain("Z.AI credentials");
    });

    it("accepts a direct ZAI_API_KEY secret", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [ZAI_API_KEY_SECRET]: "zai-key",
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-5", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("returns an error when the auth blob lacks Z.AI credentials", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          openai: { type: "oauth", refresh: "managed-by-control-plane" },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-5", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain("Z.AI credentials");
    });

    it("returns an error when Z.AI credentials use a non-api type", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          zai: { type: "oauth", key: "zai-key" },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-5", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain("type 'api'");
    });

    it("returns an error when Z.AI credentials have an empty key", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          zai: { type: "api", key: "   " },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-5", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain("non-empty key");
    });
  });

  describe("extractCopilotAccessTokenFromAuthJson", () => {
    it("extracts the access token from a full auth blob", () => {
      expect(
        extractCopilotAccessTokenFromAuthJson(
          JSON.stringify({
            "github-copilot": { type: "oauth", access: "copilot-token", expires: futureExpiresAt },
          })
        )
      ).toBe("copilot-token");
    });

    it("extracts the access token from a direct provider entry", () => {
      expect(
        extractCopilotAccessTokenFromAuthJson(
          JSON.stringify({
            type: "oauth",
            access: "copilot-token",
            refresh: "refresh-token",
            expires: futureExpiresAt,
          })
        )
      ).toBe("copilot-token");
    });

    it("returns null when the auth blob has no usable access token", () => {
      expect(
        extractCopilotAccessTokenFromAuthJson(
          JSON.stringify({
            "github-copilot": { type: "oauth", refresh: "refresh-token" },
          })
        )
      ).toBeNull();
    });

    it("returns null when the auth blob does not include an expiry", () => {
      expect(
        extractCopilotAccessTokenFromAuthJson(
          JSON.stringify({
            "github-copilot": { type: "oauth", access: "copilot-token" },
          })
        )
      ).toBeNull();
    });

    it("accepts access tokens when OpenCode stores expires as zero", () => {
      expect(
        extractCopilotAccessTokenFromAuthJson(
          JSON.stringify({
            "github-copilot": {
              type: "oauth",
              access: "copilot-token",
              refresh: "refresh-token",
              expires: 0,
            },
          })
        )
      ).toBe("copilot-token");
    });

    it("returns null when the Copilot access token is expired", () => {
      expect(
        extractCopilotAccessTokenFromAuthJson(
          JSON.stringify({
            "github-copilot": {
              type: "oauth",
              access: "copilot-token",
              refresh: "refresh-token",
              expires: pastExpiresAt,
            },
          })
        )
      ).toBeNull();
    });
  });
});
