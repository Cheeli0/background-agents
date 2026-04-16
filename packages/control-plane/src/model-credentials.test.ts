import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIREWORKS_API_KEY_SECRET,
  MINIMAX_API_KEY_SECRET,
  OLLAMA_CLOUD_API_KEY_SECRET,
  OPENCODE_GO_API_KEY_SECRET,
  OPENCODE_AUTH_JSON_SECRET,
  ZAI_API_KEY_SECRET,
  extractCopilotAccessTokenFromAuthJson,
  isFireworksAiModel,
  isGitHubCopilotModel,
  isMiniMaxCodingPlanModel,
  isOllamaCloudModel,
  isOpenCodeGoModel,
  isOpenCodeMiniMaxModel,
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
      expect(isZaiCodingPlanModel("zai-coding-plan/glm-5.1")).toBe(true);
      expect(isZaiCodingPlanModel("zai-coding-plan/glm-5")).toBe(true);
      expect(isZaiCodingPlanModel("zai-coding-plan/glm-4.7")).toBe(true);
      expect(isZaiCodingPlanModel("openai/gpt-5.4")).toBe(false);
    });
  });

  describe("isFireworksAiModel", () => {
    it("detects Fireworks AI-backed models", () => {
      expect(isFireworksAiModel("fireworks-ai/kimi-k2p5-turbo")).toBe(true);
      expect(isFireworksAiModel("openai/gpt-5.4")).toBe(false);
    });
  });

  describe("isOpenCodeMiniMaxModel", () => {
    it("detects OpenCode MiniMax models", () => {
      expect(isOpenCodeMiniMaxModel("opencode/minimax-m2.5")).toBe(true);
      expect(isOpenCodeMiniMaxModel("minimax-coding-plan/MiniMax-M2.7")).toBe(false);
      expect(isOpenCodeMiniMaxModel("opencode/kimi-k2.5")).toBe(false);
      expect(isOpenCodeMiniMaxModel("zai-coding-plan/glm-5")).toBe(false);
    });
  });

  describe("isMiniMaxCodingPlanModel", () => {
    it("detects MiniMax Coding Plan-backed models", () => {
      expect(isMiniMaxCodingPlanModel("minimax-coding-plan/MiniMax-M2.7")).toBe(true);
      expect(isMiniMaxCodingPlanModel("opencode/minimax-m2.5")).toBe(false);
    });
  });

  describe("isOpenCodeGoModel", () => {
    it("detects OpenCode Go-backed models", () => {
      expect(isOpenCodeGoModel("opencode-go/glm-5.1")).toBe(true);
      expect(isOpenCodeGoModel("opencode-go/qwen3.6-plus")).toBe(true);
      expect(isOpenCodeGoModel("opencode/kimi-k2.5")).toBe(false);
      expect(isOpenCodeGoModel("zai-coding-plan/glm-5.1")).toBe(false);
    });
  });

  describe("isOllamaCloudModel", () => {
    it("detects Ollama Cloud-backed models", () => {
      expect(isOllamaCloudModel("ollama-cloud/glm-5.1")).toBe(true);
      expect(isOllamaCloudModel("ollama-cloud/kimi-k2.5")).toBe(true);
      expect(isOllamaCloudModel("opencode-go/glm-5.1")).toBe(false);
      expect(isOllamaCloudModel("minimax-coding-plan/MiniMax-M2.7")).toBe(false);
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

    it("returns an error when Z.AI credentials are missing", async () => {
      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-4.5-air", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain(ZAI_API_KEY_SECRET);
      expect(result).toContain("Z.AI credentials");
    });

    it("accepts a direct ZAI_API_KEY secret", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [ZAI_API_KEY_SECRET]: "zai-key",
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-5.1", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("rejects OPENCODE_AUTH_JSON-only credentials for Z.AI", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          zai: { type: "api", key: "zai-key" },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-5", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain("Z.AI credentials");
      expect(result).toContain(ZAI_API_KEY_SECRET);
    });

    it("accepts ZAI_API_KEY even when OPENCODE_AUTH_JSON is invalid", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: "{invalid",
        [ZAI_API_KEY_SECRET]: "zai-key",
      });

      const result = await validateModelCredentialsForRepo(env, "zai-coding-plan/glm-5", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("returns an error when Fireworks AI credentials are missing", async () => {
      const result = await validateModelCredentialsForRepo(env, "fireworks-ai/kimi-k2p5-turbo", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain(FIREWORKS_API_KEY_SECRET);
      expect(result).toContain("Fireworks AI credentials");
    });

    it("accepts a direct FIREWORKS_API_KEY secret", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [FIREWORKS_API_KEY_SECRET]: "fireworks-key",
      });

      const result = await validateModelCredentialsForRepo(env, "fireworks-ai/kimi-k2p5-turbo", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("rejects OPENCODE_AUTH_JSON-only credentials for Fireworks AI", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          fireworks: { type: "api", key: "fireworks-key" },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "fireworks-ai/kimi-k2p5-turbo", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain("Fireworks AI credentials");
      expect(result).toContain(FIREWORKS_API_KEY_SECRET);
    });

    it("accepts FIREWORKS_API_KEY even when OPENCODE_AUTH_JSON is invalid", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: "{invalid",
        [FIREWORKS_API_KEY_SECRET]: "fireworks-key",
      });

      const result = await validateModelCredentialsForRepo(env, "fireworks-ai/kimi-k2p5-turbo", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("returns an error when MiniMax credentials are missing", async () => {
      const result = await validateModelCredentialsForRepo(
        env,
        "minimax-coding-plan/MiniMax-M2.7",
        {
          repoId: 1,
          repoOwner: "acme",
          repoName: "widgets",
        }
      );

      expect(result).toContain(MINIMAX_API_KEY_SECRET);
      expect(result).toContain("MiniMax credentials");
    });

    it("accepts a direct MINIMAX_API_KEY secret", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [MINIMAX_API_KEY_SECRET]: "minimax-key",
      });

      const result = await validateModelCredentialsForRepo(
        env,
        "minimax-coding-plan/MiniMax-M2.7",
        {
          repoId: 1,
          repoOwner: "acme",
          repoName: "widgets",
        }
      );

      expect(result).toBeNull();
    });

    it("accepts MINIMAX_API_KEY even when OPENCODE_AUTH_JSON is invalid", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: "{invalid",
        [MINIMAX_API_KEY_SECRET]: "minimax-key",
      });

      const result = await validateModelCredentialsForRepo(
        env,
        "minimax-coding-plan/MiniMax-M2.7",
        {
          repoId: 1,
          repoOwner: "acme",
          repoName: "widgets",
        }
      );

      expect(result).toBeNull();
    });

    it("returns an error when OpenCode Go credentials are missing", async () => {
      const result = await validateModelCredentialsForRepo(env, "opencode-go/glm-5.1", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain(OPENCODE_GO_API_KEY_SECRET);
      expect(result).toContain("OpenCode Go credentials");
    });

    it("accepts a direct OPENCODE_GO_API_KEY secret", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [OPENCODE_GO_API_KEY_SECRET]: "opencode-go-key",
      });

      const result = await validateModelCredentialsForRepo(env, "opencode-go/qwen3.6-plus", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("accepts OPENCODE_GO_API_KEY even when OPENCODE_AUTH_JSON is invalid", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: "{invalid",
        [OPENCODE_GO_API_KEY_SECRET]: "opencode-go-key",
      });

      const result = await validateModelCredentialsForRepo(env, "opencode-go/mimo-v2-pro", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("returns an error when Ollama Cloud credentials are missing", async () => {
      const result = await validateModelCredentialsForRepo(env, "ollama-cloud/glm-5.1", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain(OLLAMA_CLOUD_API_KEY_SECRET);
      expect(result).toContain("Ollama Cloud credentials");
    });

    it("accepts a direct OLLAMA_CLOUD_API_KEY secret", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [OLLAMA_CLOUD_API_KEY_SECRET]: "ollama-cloud-key",
      });

      const result = await validateModelCredentialsForRepo(env, "ollama-cloud/kimi-k2.5", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("accepts OLLAMA_CLOUD_API_KEY even when OPENCODE_AUTH_JSON is invalid", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: "{invalid",
        [OLLAMA_CLOUD_API_KEY_SECRET]: "ollama-cloud-key",
      });

      const result = await validateModelCredentialsForRepo(env, "ollama-cloud/minimax-m2.7", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
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
