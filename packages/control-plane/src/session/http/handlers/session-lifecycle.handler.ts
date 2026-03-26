import type { Logger } from "../../../logger";
import type { ArtifactRow, ParticipantRow, SandboxRow, SessionRow } from "../../types";
import type { SandboxStatus, ServerMessage, SessionStatus, SpawnSource } from "../../../types";
import type { SessionRepository } from "../../repository";
import type { PullRequestStatus, SourceControlProvider } from "../../../source-control";
import { getValidModelOrDefault, isValidModel } from "../../../utils/models";
import { generateInternalToken } from "@open-inspect/shared";

const TERMINAL_STATUSES = new Set<SessionStatus>(["completed", "archived", "cancelled", "failed"]);

interface LinearCallbackContextLike {
  agentSessionId?: string;
  organizationId?: string;
}

interface ServiceBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface AssociatedPrResponse {
  pullRequest: {
    number: number;
    title: string;
    url: string;
    status: "open" | "merged" | "closed" | "draft";
  } | null;
}

interface InitRequest {
  sessionName: string;
  repoOwner: string;
  repoName: string;
  repoId?: number;
  defaultBranch?: string;
  branch?: string;
  title?: string;
  model?: string;
  reasoningEffort?: string;
  userId: string;
  scmLogin?: string;
  scmName?: string;
  scmEmail?: string;
  scmToken?: string | null;
  scmTokenEncrypted?: string | null;
  scmRefreshTokenEncrypted?: string | null;
  scmTokenExpiresAt?: number | null;
  scmUserId?: string | null;
  parentSessionId?: string | null;
  spawnSource?: SpawnSource;
  spawnDepth?: number;
  codeServerEnabled?: boolean;
}

export interface SessionLifecycleHandlerDeps {
  repository: Pick<
    SessionRepository,
    | "upsertSession"
    | "createSandbox"
    | "createParticipant"
    | "updateSessionTitle"
    | "getLatestLinearCallbackContext"
    | "listArtifacts"
  >;
  getDurableObjectId: () => string;
  tokenEncryptionKey?: string;
  encryptToken: (token: string, encryptionKey: string) => Promise<string>;
  validateReasoningEffort: (model: string, effort: string | undefined) => string | null;
  generateId: (bytes?: number) => string;
  now: () => number;
  scheduleWarmSandbox: () => void;
  getLog: () => Logger;
  getSession: () => SessionRow | null;
  getSandbox: () => SandboxRow | null;
  getPublicSessionId: (session: SessionRow) => string;
  getParticipantByUserId: (userId: string) => ParticipantRow | null;
  transitionSessionStatus: (status: SessionStatus) => Promise<boolean>;
  stopExecution: (options?: { suppressStatusReconcile?: boolean }) => Promise<void>;
  getSandboxSocket: () => WebSocket | null;
  sendToSandbox: (ws: WebSocket, message: string | object) => boolean;
  updateSandboxStatus: (status: SandboxStatus) => void;
  broadcast: (message: ServerMessage) => void;
  linearBot?: ServiceBinding;
  internalCallbackSecret?: string;
  sourceControlProvider?: SourceControlProvider;
}

export interface SessionLifecycleHandler {
  init: (request: Request) => Promise<Response>;
  getState: () => Response;
  getAssociatedPr: () => Promise<Response>;
  updateTitle: (request: Request) => Promise<Response>;
  archive: (request: Request) => Promise<Response>;
  unarchive: (request: Request) => Promise<Response>;
  cancel: () => Promise<Response>;
}

function parseUserIdBody(body: unknown): { userId?: string } {
  return body as { userId?: string };
}

function parseLinearCallbackContext(
  raw: string | null | undefined
): LinearCallbackContextLike | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as LinearCallbackContextLike;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

interface PullRequestArtifactMetadata {
  number?: number;
  prNumber?: number;
  state?: "open" | "merged" | "closed" | "draft";
  prState?: "open" | "merged" | "closed" | "draft";
}

function parsePullRequestArtifactMetadata(raw: string | null): PullRequestArtifactMetadata | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PullRequestArtifactMetadata;
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function mapPullRequestStatus(
  status: string | undefined
): "open" | "merged" | "closed" | "draft" | null {
  if (status === "open" || status === "merged" || status === "closed" || status === "draft") {
    return status;
  }
  return null;
}

function parsePullRequestNumberFromUrl(url: string | null): number | null {
  if (!url) return null;
  const match = url.match(/\/pull\/(\d+)(?:\/|$)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function selectLatestPullRequestArtifact(artifacts: ArtifactRow[]): ArtifactRow | null {
  const pullRequestArtifacts = artifacts.filter((artifact) => artifact.type === "pr");
  if (pullRequestArtifacts.length === 0) {
    return null;
  }

  return pullRequestArtifacts.reduce((latest, artifact) =>
    artifact.created_at > latest.created_at ? artifact : latest
  );
}

async function resolveArtifactPullRequest(
  deps: SessionLifecycleHandlerDeps,
  session: SessionRow | null
): Promise<AssociatedPrResponse["pullRequest"]> {
  const artifact = selectLatestPullRequestArtifact(deps.repository.listArtifacts());
  if (!artifact) {
    return null;
  }

  const metadata = parsePullRequestArtifactMetadata(artifact.metadata);
  const artifactNumber =
    metadata?.prNumber ?? metadata?.number ?? parsePullRequestNumberFromUrl(artifact.url);
  if (typeof artifactNumber !== "number") {
    return null;
  }

  const artifactStatus = mapPullRequestStatus(metadata?.prState ?? metadata?.state) ?? "open";
  const fallback: AssociatedPrResponse["pullRequest"] = {
    number: artifactNumber,
    title: `PR #${artifactNumber}`,
    url: artifact.url ?? "",
    status: artifactStatus,
  };

  if (!session || !deps.sourceControlProvider?.getPullRequestStatus) {
    return fallback.url ? fallback : null;
  }

  try {
    const live = await deps.sourceControlProvider.getPullRequestStatus({
      owner: session.repo_owner,
      name: session.repo_name,
      pullRequestNumber: artifactNumber,
    });
    if (!live) {
      return fallback.url ? fallback : null;
    }

    return {
      number: live.number,
      title: live.title,
      url: live.url,
      status: live.status,
    } satisfies PullRequestStatus;
  } catch (error) {
    deps.getLog().warn("Failed to resolve artifact pull request status", {
      repo_owner: session.repo_owner,
      repo_name: session.repo_name,
      pull_request_number: artifactNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback.url ? fallback : null;
  }
}

export function createSessionLifecycleHandler(
  deps: SessionLifecycleHandlerDeps
): SessionLifecycleHandler {
  return {
    async init(request: Request): Promise<Response> {
      const body = (await request.json()) as InitRequest;

      const sessionId = deps.getDurableObjectId();
      const sessionName = body.sessionName;
      const now = deps.now();

      let encryptedToken = body.scmTokenEncrypted ?? null;
      if (body.scmToken && deps.tokenEncryptionKey) {
        try {
          encryptedToken = await deps.encryptToken(body.scmToken, deps.tokenEncryptionKey);
          deps.getLog().debug("Encrypted SCM token for storage");
        } catch (error) {
          deps.getLog().error("Failed to encrypt SCM token", {
            error: error instanceof Error ? error : String(error),
          });
        }
      }

      const model = getValidModelOrDefault(body.model);
      if (body.model && !isValidModel(body.model)) {
        deps.getLog().warn("Invalid model name, using default", {
          requested_model: body.model,
          default_model: model,
        });
      }

      const reasoningEffort = deps.validateReasoningEffort(model, body.reasoningEffort);
      const baseBranch = body.branch || body.defaultBranch || "main";

      deps.repository.upsertSession({
        id: sessionId,
        sessionName,
        title: body.title ?? null,
        repoOwner: body.repoOwner,
        repoName: body.repoName,
        repoId: body.repoId ?? null,
        baseBranch,
        model,
        reasoningEffort,
        status: "created",
        parentSessionId: body.parentSessionId ?? null,
        spawnSource: body.spawnSource ?? "user",
        spawnDepth: body.spawnDepth ?? 0,
        codeServerEnabled: body.codeServerEnabled ?? false,
        createdAt: now,
        updatedAt: now,
      });

      const sandboxId = deps.generateId();
      deps.repository.createSandbox({
        id: sandboxId,
        status: "pending",
        gitSyncStatus: "pending",
        createdAt: 0,
      });

      const participantId = deps.generateId();
      deps.repository.createParticipant({
        id: participantId,
        userId: body.userId,
        scmUserId: body.scmUserId ?? null,
        scmLogin: body.scmLogin ?? null,
        scmName: body.scmName ?? null,
        scmEmail: body.scmEmail ?? null,
        scmAccessTokenEncrypted: encryptedToken,
        scmRefreshTokenEncrypted: body.scmRefreshTokenEncrypted ?? null,
        scmTokenExpiresAt: body.scmTokenExpiresAt ?? null,
        role: "owner",
        joinedAt: now,
      });

      deps.getLog().info("Triggering sandbox spawn for new session");
      deps.scheduleWarmSandbox();

      return Response.json({ sessionId, status: "created" });
    },

    getState(): Response {
      const session = deps.getSession();
      if (!session) {
        return new Response("Session not found", { status: 404 });
      }

      const sandbox = deps.getSandbox();

      return Response.json({
        id: deps.getPublicSessionId(session),
        title: session.title,
        repoOwner: session.repo_owner,
        repoName: session.repo_name,
        baseBranch: session.base_branch,
        branchName: session.branch_name,
        baseSha: session.base_sha,
        currentSha: session.current_sha,
        opencodeSessionId: session.opencode_session_id,
        status: session.status,
        model: session.model,
        reasoningEffort: session.reasoning_effort ?? undefined,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
        sandbox: sandbox
          ? {
              id: sandbox.id,
              modalSandboxId: sandbox.modal_sandbox_id,
              status: sandbox.status,
              gitSyncStatus: sandbox.git_sync_status,
              lastHeartbeat: sandbox.last_heartbeat,
            }
          : null,
      });
    },

    async getAssociatedPr(): Promise<Response> {
      const session = deps.getSession();
      const artifactPullRequest = await resolveArtifactPullRequest(deps, session);
      const callbackContext = parseLinearCallbackContext(
        deps.repository.getLatestLinearCallbackContext()?.callback_context
      );

      if (!callbackContext?.agentSessionId || !callbackContext.organizationId) {
        return Response.json({ pullRequest: artifactPullRequest } satisfies AssociatedPrResponse);
      }

      if (!deps.linearBot || !deps.internalCallbackSecret) {
        return Response.json({ pullRequest: artifactPullRequest } satisfies AssociatedPrResponse);
      }

      let linearResponse: Response;

      try {
        const token = await generateInternalToken(deps.internalCallbackSecret);
        linearResponse = await deps.linearBot.fetch(
          `https://internal/internal/agent-sessions/${callbackContext.agentSessionId}/pull-requests?organizationId=${encodeURIComponent(callbackContext.organizationId)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
      } catch (error) {
        deps.getLog().warn("Failed to fetch associated Linear pull requests", {
          agent_session_id: callbackContext.agentSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        return Response.json({ pullRequest: artifactPullRequest } satisfies AssociatedPrResponse);
      }

      if (!linearResponse.ok) {
        deps.getLog().warn("Failed to fetch associated Linear pull requests", {
          agent_session_id: callbackContext.agentSessionId,
          status: linearResponse.status,
        });
        return Response.json({ pullRequest: artifactPullRequest } satisfies AssociatedPrResponse);
      }

      const body = (await linearResponse.json()) as {
        pullRequests?: Array<AssociatedPrResponse["pullRequest"]>;
      };
      const pullRequest = Array.isArray(body.pullRequests) ? (body.pullRequests[0] ?? null) : null;

      return Response.json({ pullRequest: pullRequest ?? artifactPullRequest } satisfies AssociatedPrResponse);
    },

    async updateTitle(request: Request): Promise<Response> {
      const session = deps.getSession();
      if (!session) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }

      let body: { userId?: string; title?: string };
      try {
        body = (await request.json()) as { userId?: string; title?: string };
      } catch {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }

      if (!body.userId) {
        return Response.json({ error: "userId is required" }, { status: 400 });
      }

      if (typeof body.title !== "string" || body.title.trim().length === 0) {
        return Response.json({ error: "title must be a non-empty string" }, { status: 400 });
      }

      if (body.title.length > 200) {
        return Response.json({ error: "title must be 200 characters or fewer" }, { status: 400 });
      }

      const participant = deps.getParticipantByUserId(body.userId);
      if (!participant) {
        return Response.json(
          { error: "Not authorized to update the session title" },
          { status: 403 }
        );
      }

      deps.repository.updateSessionTitle(session.id, body.title, deps.now());

      deps.broadcast({
        type: "session_title",
        title: body.title,
      });

      return Response.json({ title: body.title });
    },

    async archive(request: Request): Promise<Response> {
      const session = deps.getSession();
      if (!session) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }

      let body: { userId?: string };
      try {
        body = parseUserIdBody(await request.json());
      } catch {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }

      if (!body.userId) {
        return Response.json({ error: "userId is required" }, { status: 400 });
      }

      const participant = deps.getParticipantByUserId(body.userId);
      if (!participant) {
        return Response.json({ error: "Not authorized to archive this session" }, { status: 403 });
      }

      await deps.transitionSessionStatus("archived");

      return Response.json({ status: "archived" });
    },

    async unarchive(request: Request): Promise<Response> {
      const session = deps.getSession();
      if (!session) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }

      let body: { userId?: string };
      try {
        body = parseUserIdBody(await request.json());
      } catch {
        return Response.json({ error: "Invalid request body" }, { status: 400 });
      }

      if (!body.userId) {
        return Response.json({ error: "userId is required" }, { status: 400 });
      }

      const participant = deps.getParticipantByUserId(body.userId);
      if (!participant) {
        return Response.json(
          { error: "Not authorized to unarchive this session" },
          { status: 403 }
        );
      }

      await deps.transitionSessionStatus("active");

      return Response.json({ status: "active" });
    },

    async cancel(): Promise<Response> {
      const session = deps.getSession();
      if (!session) {
        return Response.json({ error: "Session not found" }, { status: 404 });
      }

      if (TERMINAL_STATUSES.has(session.status)) {
        return Response.json({ error: `Session already ${session.status}` }, { status: 409 });
      }

      await deps.stopExecution({ suppressStatusReconcile: true });
      await deps.transitionSessionStatus("cancelled");

      const sandbox = deps.getSandbox();
      if (sandbox && sandbox.status !== "stopped" && sandbox.status !== "failed") {
        const sandboxWs = deps.getSandboxSocket();
        if (sandboxWs) {
          deps.sendToSandbox(sandboxWs, { type: "shutdown" });
        }
        deps.updateSandboxStatus("stopped");
      }

      return Response.json({ status: "cancelled" });
    },
  };
}
