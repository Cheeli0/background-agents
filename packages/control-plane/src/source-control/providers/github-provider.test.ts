import { beforeEach, describe, expect, it, vi } from "vitest";
import { GitHubSourceControlProvider } from "./github-provider";
import { SourceControlProviderError } from "../errors";

// Mock the upstream GitHub App auth functions
vi.mock("../../auth/github-app", () => ({
  getCachedInstallationToken: vi.fn(),
  getInstallationRepository: vi.fn(),
  listInstallationRepositories: vi.fn(),
  fetchWithTimeout: vi.fn(),
}));

import { getInstallationRepository, listInstallationRepositories } from "../../auth/github-app";
import { fetchWithTimeout } from "../../auth/github-app";
import { getCachedInstallationToken } from "../../auth/github-app";

const mockGetInstallationRepository = vi.mocked(getInstallationRepository);
const mockListInstallationRepositories = vi.mocked(listInstallationRepositories);
const mockFetchWithTimeout = vi.mocked(fetchWithTimeout);
const mockGetCachedInstallationToken = vi.mocked(getCachedInstallationToken);

const fakeAppConfig = {
  appId: "123",
  privateKey: "fake-key",
  installationId: "456",
};

describe("GitHubSourceControlProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCachedInstallationToken.mockResolvedValue("installation-token");
  });

  describe("checkRepositoryAccess", () => {
    it("throws permanent error with no httpStatus when appConfig is missing", async () => {
      const provider = new GitHubSourceControlProvider();
      const err = await provider
        .checkRepositoryAccess({ owner: "acme", name: "web" })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SourceControlProviderError);
      expect((err as SourceControlProviderError).errorType).toBe("permanent");
      expect((err as SourceControlProviderError).httpStatus).toBeUndefined();
    });

    it("classifies upstream 429 error as transient", async () => {
      const httpError = Object.assign(new Error("rate limited: 429"), { status: 429 });
      mockGetInstallationRepository.mockRejectedValueOnce(httpError);

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });
      const err = await provider
        .checkRepositoryAccess({ owner: "acme", name: "web" })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SourceControlProviderError);
      expect((err as SourceControlProviderError).errorType).toBe("transient");
      expect((err as SourceControlProviderError).httpStatus).toBe(429);
    });

    it("classifies upstream 502 error as transient", async () => {
      const httpError = Object.assign(new Error("bad gateway: 502"), { status: 502 });
      mockGetInstallationRepository.mockRejectedValueOnce(httpError);

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });
      const err = await provider
        .checkRepositoryAccess({ owner: "acme", name: "web" })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SourceControlProviderError);
      expect((err as SourceControlProviderError).errorType).toBe("transient");
      expect((err as SourceControlProviderError).httpStatus).toBe(502);
    });

    it("classifies upstream 401 error as permanent with httpStatus", async () => {
      const httpError = Object.assign(new Error("unauthorized: 401"), { status: 401 });
      mockGetInstallationRepository.mockRejectedValueOnce(httpError);

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });
      const err = await provider
        .checkRepositoryAccess({ owner: "acme", name: "web" })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SourceControlProviderError);
      expect((err as SourceControlProviderError).errorType).toBe("permanent");
      expect((err as SourceControlProviderError).httpStatus).toBe(401);
    });
  });

  describe("listRepositories", () => {
    it("throws permanent error with no httpStatus when appConfig is missing", async () => {
      const provider = new GitHubSourceControlProvider();
      const err = await provider.listRepositories().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SourceControlProviderError);
      expect((err as SourceControlProviderError).errorType).toBe("permanent");
      expect((err as SourceControlProviderError).httpStatus).toBeUndefined();
    });

    it("classifies upstream 429 error as transient", async () => {
      const httpError = Object.assign(new Error("rate limited: 429"), { status: 429 });
      mockListInstallationRepositories.mockRejectedValueOnce(httpError);

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });
      const err = await provider.listRepositories().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SourceControlProviderError);
      expect((err as SourceControlProviderError).errorType).toBe("transient");
      expect((err as SourceControlProviderError).httpStatus).toBe(429);
    });

    it("classifies upstream 502 error as transient", async () => {
      const httpError = Object.assign(new Error("bad gateway: 502"), { status: 502 });
      mockListInstallationRepositories.mockRejectedValueOnce(httpError);

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });
      const err = await provider.listRepositories().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SourceControlProviderError);
      expect((err as SourceControlProviderError).errorType).toBe("transient");
      expect((err as SourceControlProviderError).httpStatus).toBe(502);
    });

    it("classifies upstream 401 error as permanent with httpStatus", async () => {
      const httpError = Object.assign(new Error("unauthorized: 401"), { status: 401 });
      mockListInstallationRepositories.mockRejectedValueOnce(httpError);

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });
      const err = await provider.listRepositories().catch((e: unknown) => e);

      expect(err).toBeInstanceOf(SourceControlProviderError);
      expect((err as SourceControlProviderError).errorType).toBe("permanent");
      expect((err as SourceControlProviderError).httpStatus).toBe(401);
    });
  });

  describe("getPullRequestChecks", () => {
    it("returns aggregate success state for completed checks", async () => {
      mockFetchWithTimeout
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ head: { sha: "abc123" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ state: "success", total_count: 1, statuses: [{}] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              total_count: 2,
              check_runs: [
                { status: "completed", conclusion: "success" },
                { status: "completed", conclusion: "neutral" },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });

      const result = await provider.getPullRequestChecks({
        owner: "acme",
        name: "web",
        pullRequestNumber: 42,
      });

      expect(result).toEqual({
        state: "success",
        totalCount: 3,
        successfulCount: 3,
        failedCount: 0,
        pendingCount: 0,
      });
    });

    it("returns failure when any status or check run fails", async () => {
      mockFetchWithTimeout
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ head: { sha: "def456" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ state: "failure", total_count: 1, statuses: [{}] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              total_count: 1,
              check_runs: [{ status: "completed", conclusion: "success" }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });

      const result = await provider.getPullRequestChecks({
        owner: "acme",
        name: "web",
        pullRequestNumber: 99,
      });

      expect(result).toEqual({
        state: "failure",
        totalCount: 2,
        successfulCount: 1,
        failedCount: 1,
        pendingCount: 0,
      });
    });

    it("returns pending when checks are still running", async () => {
      mockFetchWithTimeout
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ head: { sha: "ghi789" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ state: "pending", total_count: 1, statuses: [{}] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              total_count: 1,
              check_runs: [{ status: "in_progress", conclusion: null }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });

      const result = await provider.getPullRequestChecks({
        owner: "acme",
        name: "web",
        pullRequestNumber: 100,
      });

      expect(result).toEqual({
        state: "pending",
        totalCount: 2,
        successfulCount: 0,
        failedCount: 0,
        pendingCount: 2,
      });
    });

    it("falls back to unauthenticated checks lookup when app config is missing", async () => {
      mockFetchWithTimeout
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ head: { sha: "xyz123" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ state: "success", total_count: 1, statuses: [{}] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              total_count: 1,
              check_runs: [{ status: "completed", conclusion: "success" }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );

      const provider = new GitHubSourceControlProvider();
      const result = await provider.getPullRequestChecks({
        owner: "acme",
        name: "web",
        pullRequestNumber: 101,
      });

      expect(result).toEqual({
        state: "success",
        totalCount: 2,
        successfulCount: 2,
        failedCount: 0,
        pendingCount: 0,
      });

      const firstCallHeaders = mockFetchWithTimeout.mock.calls[0]?.[1]?.headers as
        | Record<string, string>
        | undefined;
      expect(firstCallHeaders?.Authorization).toBeUndefined();
    });

    it("falls back to unauthenticated checks lookup when app-auth lookup fails", async () => {
      mockFetchWithTimeout
        .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ head: { sha: "xyz456" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ state: "success", total_count: 1, statuses: [{}] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              total_count: 1,
              check_runs: [{ status: "completed", conclusion: "success" }],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        );

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });
      const result = await provider.getPullRequestChecks({
        owner: "acme",
        name: "web",
        pullRequestNumber: 102,
      });

      expect(result).toEqual({
        state: "success",
        totalCount: 2,
        successfulCount: 2,
        failedCount: 0,
        pendingCount: 0,
      });

      const appCallHeaders = mockFetchWithTimeout.mock.calls[0]?.[1]?.headers as
        | Record<string, string>
        | undefined;
      const fallbackCallHeaders = mockFetchWithTimeout.mock.calls[1]?.[1]?.headers as
        | Record<string, string>
        | undefined;
      expect(appCallHeaders?.Authorization).toBe("Bearer installation-token");
      expect(fallbackCallHeaders?.Authorization).toBeUndefined();
    });
  });

  it("builds manual pull request URL with encoded components", () => {
    const provider = new GitHubSourceControlProvider();
    const url = provider.buildManualPullRequestUrl({
      owner: "acme org",
      name: "web/app",
      sourceBranch: "feature/test branch",
      targetBranch: "main",
    });

    expect(url).toBe(
      "https://github.com/acme%20org/web%2Fapp/pull/new/main...feature%2Ftest%20branch"
    );
  });

  it("builds provider push spec for bridge execution", () => {
    const provider = new GitHubSourceControlProvider();
    const spec = provider.buildGitPushSpec({
      owner: "acme",
      name: "web",
      sourceRef: "HEAD",
      targetBranch: "feature/one",
      auth: {
        authType: "app",
        token: "token-123",
      },
      force: false,
    });

    expect(spec).toEqual({
      remoteUrl: "https://x-access-token:token-123@github.com/acme/web.git",
      redactedRemoteUrl: "https://x-access-token:<redacted>@github.com/acme/web.git",
      refspec: "HEAD:refs/heads/feature/one",
      targetBranch: "feature/one",
      force: false,
    });
  });

  it("defaults push spec to non-force push", () => {
    const provider = new GitHubSourceControlProvider();
    const spec = provider.buildGitPushSpec({
      owner: "acme",
      name: "web",
      sourceRef: "HEAD",
      targetBranch: "feature/two",
      auth: {
        authType: "app",
        token: "token-456",
      },
    });

    expect(spec.force).toBe(false);
  });
});
