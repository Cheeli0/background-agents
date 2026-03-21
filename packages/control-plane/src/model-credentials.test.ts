import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPENCODE_AUTH_JSON_SECRET,
  isGitHubCopilotModel,
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
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGlobalSecrets.mockResolvedValue({});
    mockGetRepoSecrets.mockResolvedValue({});
  });

  describe("isGitHubCopilotModel", () => {
    it("detects GitHub Copilot-backed models", () => {
      expect(isGitHubCopilotModel("github-copilot/gpt-5")).toBe(true);
      expect(isGitHubCopilotModel("github-copilot/claude-sonnet-4")).toBe(true);
      expect(isGitHubCopilotModel("openai/gpt-5.4")).toBe(false);
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
        "github-copilot/gpt-5",
        {
          repoId: 1,
          repoOwner: "acme",
          repoName: "widgets",
        }
      );

      expect(result).toContain("secrets storage");
    });

    it("returns an error when OPENCODE_AUTH_JSON is missing", async () => {
      const result = await validateModelCredentialsForRepo(env, "github-copilot/gpt-5", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toContain(OPENCODE_AUTH_JSON_SECRET);
    });

    it("accepts a repo-scoped GitHub Copilot auth blob", async () => {
      mockGetRepoSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          "github-copilot": { type: "oauth", access: "token" },
        }),
      });

      const result = await validateModelCredentialsForRepo(env, "github-copilot/claude-sonnet-4", {
        repoId: 1,
        repoOwner: "acme",
        repoName: "widgets",
      });

      expect(result).toBeNull();
    });

    it("accepts a global GitHub Copilot auth blob", async () => {
      mockGetGlobalSecrets.mockResolvedValue({
        [OPENCODE_AUTH_JSON_SECRET]: JSON.stringify({
          "github-copilot": { type: "oauth", access: "token" },
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

      const result = await validateModelCredentialsForRepo(env, "github-copilot/gpt-5", {
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
  });
});
