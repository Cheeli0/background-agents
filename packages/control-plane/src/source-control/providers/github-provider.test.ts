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
import { fetchWithTimeout, getCachedInstallationToken } from "../../auth/github-app";

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

  describe("getPullRequestStatus", () => {
    it("returns mapped merged status for a GitHub pull request", async () => {
      mockFetchWithTimeout.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            number: 15,
            title: "CHE-65: Add sidebar status icons",
            html_url: "https://github.com/acme/repo/pull/15",
            state: "closed",
            merged: true,
            draft: false,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });
      const result = await provider.getPullRequestStatus({
        owner: "acme",
        name: "repo",
        pullRequestNumber: 15,
      });

      expect(result).toEqual({
        number: 15,
        title: "CHE-65: Add sidebar status icons",
        url: "https://github.com/acme/repo/pull/15",
        status: "merged",
      });
    });

    it("falls back to unauthenticated lookup when app-auth request fails", async () => {
      mockFetchWithTimeout
        .mockResolvedValueOnce(new Response("forbidden", { status: 403 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              number: 10,
              title: "CHE-63: add request multiplier support to model selector metadata",
              html_url: "https://github.com/acme/repo/pull/10",
              state: "closed",
              merged: false,
              draft: false,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );

      const provider = new GitHubSourceControlProvider({ appConfig: fakeAppConfig });
      const result = await provider.getPullRequestStatus({
        owner: "acme",
        name: "repo",
        pullRequestNumber: 10,
      });

      expect(result).toEqual({
        number: 10,
        title: "CHE-63: add request multiplier support to model selector metadata",
        url: "https://github.com/acme/repo/pull/10",
        status: "closed",
      });
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
