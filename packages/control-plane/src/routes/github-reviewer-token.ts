/**
 * Sandbox-authenticated broker for the optional reviewer GitHub App.
 * The review POST alone uses this App, so PRs opened by the main App can be
 * approved. Other GitHub calls retain their existing credential.
 *
 * Mint on demand (with the installation-token cache), not at sandbox launch:
 * a review can outlive a token. Admission binds the sandbox to params.id and
 * no-store prevents downstream caching of the write credential.
 *
 * Admission alone would hand the token to any session's sandbox, so the handler
 * also requires a GitHub bot review session: spawned by the GitHub bot (the only
 * spawner whose prompt submits reviews) for a review request or auto-review, not
 * for a PR comment or review-thread mention, whose prompt must not approve.
 * `spawn_source` comes from the authenticated creating principal and
 * `github_review` from that principal's create request; the sandbox controls
 * neither. A review session stays open to collaborators' follow-up prompts, so
 * the token is further issued only while the session is processing the GitHub
 * bot's own prompt: a collaborator cannot steer the agent into approving under
 * the reviewer App.
 *
 * The token covers only the repository the sandbox names as the one under
 * review, and only when that repository is a member of the session within the
 * owner team's current grants. Nothing persisted records which member is under
 * review (an environment launch orders members by the environment), and
 * requesting the session's other repositories would fail wherever the
 * reviewer App is not installed on them.
 */

import { resolveAppName } from "@open-inspect/shared/app-name";
import { parseRepositoryFullName } from "@open-inspect/shared/types/repositories";
import { Hono } from "hono";
import { getCachedInstallationToken, getGitHubReviewerAppConfig } from "../auth/github-app";
import { SessionIndexStore } from "../db/session-index";
import { SessionRepositoryStore } from "../db/session-repositories";
import { createLogger } from "../logger";
import { readCachedInstallationRepositories } from "../repos/cache";
import { admit } from "../routing/admit";
import type { ControlPlaneHonoEnv } from "../routing/hono-env";
import { activePromptAuthorSchema } from "../session/active-prompt-author";
import { SessionInternalPaths } from "../session/contracts";
import type { SessionRuntimeClient } from "../session/runtime-client";
import { resolveRepositoryCredentialScope } from "../source-control/repository-scope";
import type { Env } from "../types";
import {
  error,
  json,
  NO_AUTHORIZATION,
  SCM_AGNOSTIC_SANDBOX_ROUTE,
  type SandboxRouteContext,
} from "./shared";
import { dispatchSession } from "./session-route";

const logger = createLogger("router:github-reviewer-token");

/**
 * The only permission the review POST needs. Requesting it narrows the minted
 * token below whatever the reviewer App's installation was granted.
 */
export const REVIEWER_TOKEN_PERMISSIONS = { pull_requests: "write" } as const;

export const githubReviewerTokenRoutes = new Hono<ControlPlaneHonoEnv>();

type ReviewerTokenContext = SandboxRouteContext & { sessionRuntime: SessionRuntimeClient };

/**
 * Whether the session is processing the GitHub bot's own prompt right now. The
 * source alone is caller-chosen, so the author must also be a `github:` actor:
 * only the GitHub bot's service principal may assert that namespace. A
 * collaborator's follow-up prompt (web, PAT, Slack, Linear) or an agent's never
 * qualifies, and no processing prompt at all fails closed.
 */
async function activePromptOrigin(
  ctx: ReviewerTokenContext,
  sessionId: string
): Promise<{ isGitHubBotPrompt: boolean; source: string | null }> {
  const response = await ctx.sessionRuntime.fetch(
    sessionId,
    SessionInternalPaths.activePromptAuthor
  );
  if (!response.ok) return { isGitHubBotPrompt: false, source: null };
  const parsed = activePromptAuthorSchema.safeParse(await response.json());
  if (!parsed.success) return { isGitHubBotPrompt: false, source: null };
  const { source, userId } = parsed.data;
  return {
    isGitHubBotPrompt: source === "github" && userId.startsWith("github:"),
    source: source ?? null,
  };
}

async function handleReviewerToken(
  request: Request,
  env: Env,
  params: { id: string },
  ctx: ReviewerTokenContext
): Promise<Response> {
  const reviewerAppConfig = getGitHubReviewerAppConfig(env);
  if (!reviewerAppConfig) {
    return error("No reviewer app configured", 404);
  }

  const sessions = new SessionIndexStore(ctx.db);
  const session = await sessions.get(params.id);
  const githubReview =
    session?.spawnSource === "github-bot" && (await sessions.isGitHubReview(params.id));
  if (!session || !githubReview) {
    logger.warn("review_token.session_not_eligible", {
      event: "review_token.session_not_eligible",
      session_id: params.id,
      spawn_source: session?.spawnSource ?? null,
      github_review: githubReview,
      request_id: ctx.request_id,
      trace_id: ctx.trace_id,
    });
    return error("Reviewer token is only issued to GitHub bot review sessions", 403);
  }

  const activePrompt = await activePromptOrigin(ctx, params.id);
  if (!activePrompt.isGitHubBotPrompt) {
    logger.warn("review_token.prompt_not_eligible", {
      event: "review_token.prompt_not_eligible",
      session_id: params.id,
      prompt_source: activePrompt.source,
      request_id: ctx.request_id,
      trace_id: ctx.trace_id,
    });
    return error("Reviewer token is only issued during the GitHub bot's review prompt", 403);
  }

  const requested = parseRepositoryFullName(
    new URL(request.url).searchParams.get("repository") ?? ""
  );
  if (!requested) {
    return error("repository must name the reviewed repository as owner/name", 400);
  }

  const members = await new SessionRepositoryStore(ctx.db).listRepositoryIds(params.id);
  const repositories = members.length
    ? members
    : session.repoOwner && session.repoName
      ? [{ repoOwner: session.repoOwner, repoName: session.repoName, repoId: null }]
      : [];
  const reviewed = repositories.find(
    (repository) =>
      repository.repoOwner.toLowerCase() === requested.repoOwner.toLowerCase() &&
      repository.repoName.toLowerCase() === requested.repoName.toLowerCase()
  );
  if (!reviewed) {
    logger.warn("review_token.repository_not_in_session", {
      event: "review_token.repository_not_in_session",
      session_id: params.id,
      repository: `${requested.repoOwner}/${requested.repoName}`.toLowerCase(),
      request_id: ctx.request_id,
      trace_id: ctx.trace_id,
    });
    return error("Reviewer token is only issued for a repository of this session", 403);
  }

  try {
    const scope = await resolveRepositoryCredentialScope(
      ctx.db,
      [reviewed],
      session.ownerTeamId,
      () => readCachedInstallationRepositories(env)
    );
    const token = await getCachedInstallationToken(
      reviewerAppConfig,
      { cacheStore: env.REPOS_CACHE, userAgent: resolveAppName(env) },
      { scope, permissions: REVIEWER_TOKEN_PERMISSIONS }
    );
    return json({ token });
  } catch (cause) {
    logger.error("review_token.mint_failed", {
      event: "review_token.mint_failed",
      session_id: params.id,
      request_id: ctx.request_id,
      trace_id: ctx.trace_id,
      error: cause instanceof Error ? cause : String(cause),
    });
    return error("Failed to mint reviewer token", 502);
  }
}

githubReviewerTokenRoutes.get(
  "/sessions/:id/review-token",
  admit({
    ...SCM_AGNOSTIC_SANDBOX_ROUTE,
    cacheControl: "no-store",
    authorization: NO_AUTHORIZATION,
  }),
  (c) => dispatchSession(c, handleReviewerToken)
);
