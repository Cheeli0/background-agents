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
  BuildManualPullRequestUrlConfig,
  BuildGitPushSpecConfig,
  GitPushSpec,
  GitPushAuthContext,
  GetPullRequestStatusConfig,
  PullRequestStatus,
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
    Accept: "application/vnd.github.v3+json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    "User-Agent": USER_AGENT,
    ...extraHeaders,
  };
}

function toPullRequestStatus(data: {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft: boolean;
  merged: boolean;
}): PullRequestStatus {
  let status: PullRequestStatus["status"];
  if (data.draft) {
    status = "draft";
  } else if (data.merged) {
    status = "merged";
  } else if (data.state === "closed") {
    status = "closed";
  } else {
    status = "open";
  }

  return {
    number: data.number,
    title: data.title,
    url: data.html_url,
    status,
  };
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
      title: string;
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
    const status = toPullRequestStatus(data);

    const result: CreatePullRequestResult = {
      id: data.number,
      webUrl: data.html_url,
      apiUrl: data.url,
      state: status.status,
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

  async getPullRequestStatus(
    config: GetPullRequestStatusConfig
  ): Promise<PullRequestStatus | null> {
    let appLookupError: unknown = null;

    if (this.appConfig) {
      try {
        const token = await getCachedInstallationToken(
          this.appConfig,
          this.kvCache ? { REPOS_CACHE: this.kvCache } : undefined
        );
        return await this.fetchPullRequestStatus(config, token);
      } catch (error) {
        appLookupError = error;
      }
    }

    try {
      return await this.fetchPullRequestStatus(config);
    } catch (error) {
      const upstreamError = appLookupError ?? error;
      if (upstreamError instanceof SourceControlProviderError) {
        throw upstreamError;
      }

      throw SourceControlProviderError.fromFetchError(
        `Failed to get pull request status: ${upstreamError instanceof Error ? upstreamError.message : String(upstreamError)}`,
        upstreamError,
        extractHttpStatus(upstreamError)
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

  private async fetchPullRequestStatus(
    config: GetPullRequestStatusConfig,
    token?: string
  ): Promise<PullRequestStatus | null> {
    const response = await fetchWithTimeout(
      `${GITHUB_API_BASE}/repos/${config.owner}/${config.name}/pulls/${config.pullRequestNumber}`,
      {
        headers: getGitHubApiHeaders(token),
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      const error = await response.text();
      throw SourceControlProviderError.fromFetchError(
        `Failed to get pull request status: ${response.status} ${error}`,
        new Error(error),
        response.status
      );
    }

    const data = (await response.json()) as {
      number: number;
      title: string;
      html_url: string;
      state: string;
      draft: boolean;
      merged: boolean;
    };

    return toPullRequestStatus(data);
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
