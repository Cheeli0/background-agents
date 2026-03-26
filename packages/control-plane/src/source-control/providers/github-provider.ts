/**
 * GitHub source control provider implementation.
 *
 * Implements the SourceControlProvider interface for GitHub,
 * wrapping existing GitHub API functions.
 */

import type { InstallationRepository } from "@open-inspect/shared";
import type {
  SourceControlProvider,
  SourceControlAuthContext,
  GetRepositoryConfig,
  RepositoryAccessResult,
  RepositoryInfo,
  CreatePullRequestConfig,
  CreatePullRequestResult,
  GetPullRequestChecksConfig,
  PullRequestChecks,
  BuildManualPullRequestUrlConfig,
  BuildGitPushSpecConfig,
  GitPushSpec,
  GitPushAuthContext,
} from "../types";
import { SourceControlProviderError } from "../errors";
import {
  getCachedInstallationToken,
  getInstallationRepository,
  listInstallationRepositories,
  listRepositoryBranches,
  fetchWithTimeout,
} from "../../auth/github-app";
import type { GitHubProviderConfig } from "./types";
import { USER_AGENT, GITHUB_API_BASE } from "./constants";

/** Extract HTTP status from upstream errors (GitHubHttpError has a .status property). */
function extractHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    return error.status;
  }
  return undefined;
}

function getGitHubApiHeaders(token?: string, extraHeaders?: HeadersInit): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
    ...extraHeaders,
  };
}

function isSuccessfulConclusion(conclusion: string | null): boolean {
  return ["success", "neutral", "skipped", "stale"].includes(conclusion ?? "");
}

function isFailedConclusion(conclusion: string | null): boolean {
  return ["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(
    conclusion ?? ""
  );
}

/**
 * GitHub implementation of SourceControlProvider.
 */
export class GitHubSourceControlProvider implements SourceControlProvider {
  readonly name = "github";

  private readonly appConfig?: GitHubProviderConfig["appConfig"];
  private readonly kvCache?: KVNamespace;

  constructor(config: GitHubProviderConfig = {}) {
    this.appConfig = config.appConfig;
    this.kvCache = config.kvCache;
  }

  /**
   * Get repository information from GitHub API.
   */
  async getRepository(
    auth: SourceControlAuthContext,
    config: GetRepositoryConfig
  ): Promise<RepositoryInfo> {
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/repos/${config.owner}/${config.name}`,
      {
        headers: getGitHubApiHeaders(auth.token),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw SourceControlProviderError.fromFetchError(
        `Failed to get repository: ${response.status} ${error}`,
        new Error(error),
        response.status
      );
    }

    const data = (await response.json()) as {
      id: number;
      name: string;
      full_name: string;
      default_branch: string;
      private: boolean;
      owner: { login: string };
    };

    return {
      owner: data.owner.login,
      name: data.name,
      fullName: data.full_name,
      defaultBranch: data.default_branch,
      isPrivate: data.private,
      providerRepoId: data.id,
    };
  }

  /**
   * Create a pull request on GitHub.
   */
  async createPullRequest(
    auth: SourceControlAuthContext,
    config: CreatePullRequestConfig
  ): Promise<CreatePullRequestResult> {
    const requestBody: Record<string, unknown> = {
      title: config.title,
      body: config.body,
      head: config.sourceBranch,
      base: config.targetBranch,
    };

    // Add draft flag if requested and supported
    if (config.draft) {
      requestBody.draft = true;
    }

    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/repos/${config.repository.owner}/${config.repository.name}/pulls`,
      {
        method: "POST",
        headers: {
          ...getGitHubApiHeaders(auth.token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw SourceControlProviderError.fromFetchError(
        `Failed to create PR: ${response.status} ${error}`,
        new Error(error),
        response.status
      );
    }

    const data = (await response.json()) as {
      number: number;
      html_url: string;
      url: string;
      state: string;
      draft: boolean;
      merged: boolean;
      head: { ref: string };
      base: { ref: string };
    };

    // Map GitHub state to our state type
    // GitHub uses state: "closed" + merged: true for merged PRs
    let state: CreatePullRequestResult["state"];
    if (data.draft) {
      state = "draft";
    } else if (data.merged) {
      state = "merged";
    } else if (data.state === "open") {
      state = "open";
    } else if (data.state === "closed") {
      state = "closed";
    } else {
      state = "open"; // Default to open for unknown states
    }

    const result: CreatePullRequestResult = {
      id: data.number,
      webUrl: data.html_url,
      apiUrl: data.url,
      state,
      sourceBranch: data.head.ref,
      targetBranch: data.base.ref,
    };

    // Add labels if requested
    if (config.labels && config.labels.length > 0) {
      await this.addLabels(
        auth.token,
        config.repository.owner,
        config.repository.name,
        data.number,
        config.labels
      );
    }

    // Request reviewers if requested
    if (config.reviewers && config.reviewers.length > 0) {
      await this.requestReviewers(
        auth.token,
        config.repository.owner,
        config.repository.name,
        data.number,
        config.reviewers
      );
    }

    return result;
  }

  async getPullRequestChecks(
    config: GetPullRequestChecksConfig
  ): Promise<PullRequestChecks | null> {
    let appLookupError: unknown = null;

    if (this.appConfig) {
      try {
        const token = await getCachedInstallationToken(
          this.appConfig,
          this.kvCache ? { REPOS_CACHE: this.kvCache } : undefined
        );

        return await this.fetchPullRequestChecks(config, token);
      } catch (error) {
        appLookupError = error;
      }
    }

    try {
      // Public repositories can still be queried without app auth. This keeps
      // check indicators visible when app credentials are missing or permission-scoped.
      return await this.fetchPullRequestChecks(config);
    } catch (error) {
      const upstreamError = appLookupError ?? error;

      throw SourceControlProviderError.fromFetchError(
        `Failed to get pull request checks: ${upstreamError instanceof Error ? upstreamError.message : String(upstreamError)}`,
        upstreamError,
        extractHttpStatus(upstreamError)
      );
    }
  }

  private async fetchPullRequestChecks(
    config: GetPullRequestChecksConfig,
    token?: string
  ): Promise<PullRequestChecks | null> {
    const pullRequestResponse = await fetchWithTimeout(
      `${GITHUB_API_BASE}/repos/${config.owner}/${config.name}/pulls/${config.pullRequestNumber}`,
      {
        headers: getGitHubApiHeaders(token),
      }
    );

    if (!pullRequestResponse.ok) {
      const error = await pullRequestResponse.text();
      throw SourceControlProviderError.fromFetchError(
        `Failed to get PR details: ${pullRequestResponse.status} ${error}`,
        new Error(error),
        pullRequestResponse.status
      );
    }

    const pullRequest = (await pullRequestResponse.json()) as {
      head?: { sha?: string };
    };
    const headSha = pullRequest.head?.sha;
    if (!headSha) {
      return null;
    }

    const [statusResponse, checkRunsResponse] = await Promise.all([
      fetchWithTimeout(`${GITHUB_API_BASE}/repos/${config.owner}/${config.name}/commits/${headSha}/status`, {
        headers: getGitHubApiHeaders(token),
      }),
      fetchWithTimeout(
        `${GITHUB_API_BASE}/repos/${config.owner}/${config.name}/commits/${headSha}/check-runs?per_page=100`,
        {
          headers: getGitHubApiHeaders(token),
        }
      ),
    ]);

    if (!statusResponse.ok) {
      const error = await statusResponse.text();
      throw SourceControlProviderError.fromFetchError(
        `Failed to get commit status: ${statusResponse.status} ${error}`,
        new Error(error),
        statusResponse.status
      );
    }

    if (!checkRunsResponse.ok) {
      const error = await checkRunsResponse.text();
      throw SourceControlProviderError.fromFetchError(
        `Failed to get check runs: ${checkRunsResponse.status} ${error}`,
        new Error(error),
        checkRunsResponse.status
      );
    }

    const combinedStatus = (await statusResponse.json()) as {
      state?: string;
      statuses?: unknown[];
      total_count?: number;
    };
    const checkRuns = (await checkRunsResponse.json()) as {
      total_count?: number;
      check_runs?: Array<{
        status?: string;
        conclusion?: string | null;
      }>;
    };

    let successfulCount = 0;
    let failedCount = 0;
    let pendingCount = 0;

    const combinedState = combinedStatus.state;
    const statusContextsCount =
      typeof combinedStatus.total_count === "number"
        ? combinedStatus.total_count
        : Array.isArray(combinedStatus.statuses)
          ? combinedStatus.statuses.length
          : 0;

    if (combinedState === "failure" || combinedState === "error") {
      failedCount += Math.max(statusContextsCount, 1);
    } else if (combinedState === "pending") {
      pendingCount += Math.max(statusContextsCount, 1);
    } else if (combinedState === "success") {
      successfulCount += statusContextsCount;
    }

    for (const checkRun of checkRuns.check_runs ?? []) {
      if (checkRun.status !== "completed") {
        pendingCount += 1;
        continue;
      }

      if (isFailedConclusion(checkRun.conclusion ?? null)) {
        failedCount += 1;
        continue;
      }

      if (isSuccessfulConclusion(checkRun.conclusion ?? null)) {
        successfulCount += 1;
        continue;
      }

      pendingCount += 1;
    }

    const totalCount = successfulCount + failedCount + pendingCount;
    if (totalCount === 0) {
      return null;
    }

    return {
      state: failedCount > 0 ? "failure" : pendingCount > 0 ? "pending" : "success",
      totalCount,
      successfulCount,
      failedCount,
      pendingCount,
    };
  }

  /**
   * Check whether a repository is accessible to the GitHub App installation.
   */
  async checkRepositoryAccess(config: GetRepositoryConfig): Promise<RepositoryAccessResult | null> {
    if (!this.appConfig) {
      throw new SourceControlProviderError(
        "GitHub App not configured - cannot check repository access",
        "permanent"
      );
    }

    try {
      const repo = await getInstallationRepository(
        this.appConfig,
        config.owner,
        config.name,
        this.kvCache ? { REPOS_CACHE: this.kvCache } : undefined
      );
      if (!repo) {
        return null;
      }
      return {
        repoId: repo.id,
        repoOwner: config.owner.toLowerCase(),
        repoName: config.name.toLowerCase(),
        defaultBranch: repo.defaultBranch,
      };
    } catch (error) {
      throw SourceControlProviderError.fromFetchError(
        `Failed to check repository access: ${error instanceof Error ? error.message : String(error)}`,
        error,
        extractHttpStatus(error)
      );
    }
  }

  /**
   * List all repositories accessible to the GitHub App installation.
   */
  async listRepositories(): Promise<InstallationRepository[]> {
    if (!this.appConfig) {
      throw new SourceControlProviderError(
        "GitHub App not configured - cannot list repositories",
        "permanent"
      );
    }

    try {
      const result = await listInstallationRepositories(
        this.appConfig,
        this.kvCache ? { REPOS_CACHE: this.kvCache } : undefined
      );
      return result.repos;
    } catch (error) {
      throw SourceControlProviderError.fromFetchError(
        `Failed to list repositories: ${error instanceof Error ? error.message : String(error)}`,
        error,
        extractHttpStatus(error)
      );
    }
  }

  /**
   * List branches for a repository.
   */
  async listBranches(config: GetRepositoryConfig): Promise<{ name: string }[]> {
    if (!this.appConfig) {
      throw new SourceControlProviderError(
        "GitHub App not configured - cannot list branches",
        "permanent"
      );
    }

    try {
      return await listRepositoryBranches(
        this.appConfig,
        config.owner,
        config.name,
        this.kvCache ? { REPOS_CACHE: this.kvCache } : undefined
      );
    } catch (error) {
      throw SourceControlProviderError.fromFetchError(
        `Failed to list branches: ${error instanceof Error ? error.message : String(error)}`,
        error,
        extractHttpStatus(error)
      );
    }
  }

  /**
   * Generate authentication for git push operations using GitHub App.
   */
  async generatePushAuth(): Promise<GitPushAuthContext> {
    if (!this.appConfig) {
      throw new SourceControlProviderError(
        "GitHub App not configured - cannot generate push auth",
        "permanent"
      );
    }

    try {
      const token = await getCachedInstallationToken(this.appConfig);
      return {
        authType: "app",
        token,
      };
    } catch (error) {
      throw SourceControlProviderError.fromFetchError(
        `Failed to generate GitHub App token: ${error instanceof Error ? error.message : String(error)}`,
        error
      );
    }
  }

  buildManualPullRequestUrl(config: BuildManualPullRequestUrlConfig): string {
    const encodedOwner = encodeURIComponent(config.owner);
    const encodedName = encodeURIComponent(config.name);
    const encodedBase = encodeURIComponent(config.targetBranch);
    const encodedHead = encodeURIComponent(config.sourceBranch);
    return `https://github.com/${encodedOwner}/${encodedName}/pull/new/${encodedBase}...${encodedHead}`;
  }

  buildGitPushSpec(config: BuildGitPushSpecConfig): GitPushSpec {
    const force = config.force ?? false;
    const remoteUrl = `https://x-access-token:${config.auth.token}@github.com/${config.owner}/${config.name}.git`;
    const redactedRemoteUrl = `https://x-access-token:<redacted>@github.com/${config.owner}/${config.name}.git`;

    return {
      remoteUrl,
      redactedRemoteUrl,
      refspec: `${config.sourceRef}:refs/heads/${config.targetBranch}`,
      targetBranch: config.targetBranch,
      force,
    };
  }

  /**
   * Add labels to a pull request.
   * This is a best-effort operation - failures are logged but don't fail the PR creation.
   */
  private async addLabels(
    accessToken: string,
    owner: string,
    repo: string,
    prNumber: number,
    labels: string[]
  ): Promise<void> {
    try {
      const response = await fetchWithTimeout(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/issues/${prNumber}/labels`,
        {
          method: "POST",
          headers: {
            ...getGitHubApiHeaders(accessToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ labels }),
        }
      );

      if (!response.ok) {
        // Log but don't throw - labels are best-effort
        console.warn(`Failed to add labels to PR #${prNumber}: ${response.status}`);
      }
    } catch (error) {
      console.warn(`Failed to add labels to PR #${prNumber}:`, error);
    }
  }

  /**
   * Request reviewers for a pull request.
   * This is a best-effort operation - failures are logged but don't fail the PR creation.
   */
  private async requestReviewers(
    accessToken: string,
    owner: string,
    repo: string,
    prNumber: number,
    reviewers: string[]
  ): Promise<void> {
    try {
      const response = await fetchWithTimeout(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls/${prNumber}/requested_reviewers`,
        {
          method: "POST",
          headers: {
            ...getGitHubApiHeaders(accessToken),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ reviewers }),
        }
      );

      if (!response.ok) {
        // Log but don't throw - reviewers are best-effort
        console.warn(`Failed to request reviewers for PR #${prNumber}: ${response.status}`);
      }
    } catch (error) {
      console.warn(`Failed to request reviewers for PR #${prNumber}:`, error);
    }
  }
}

/**
 * Create a GitHub source control provider.
 *
 * @param config - Provider configuration (optional)
 * @returns GitHub source control provider instance
 */
export function createGitHubProvider(config: GitHubProviderConfig = {}): SourceControlProvider {
  return new GitHubSourceControlProvider(config);
}
