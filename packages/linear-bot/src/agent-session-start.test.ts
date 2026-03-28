import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAgentSessionEvent } from "./webhook-handler";
import type { AgentSessionWebhook, Env } from "./types";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface PutCall {
  key: string;
  value: string;
  options?: { expirationTtl?: number };
}

function createFakeKV(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const putCalls: PutCall[] = [];

  const kv = {
    async get(key: string, type?: string) {
      const value = store.get(key) ?? null;
      if (value === null) return null;
      if (type === "json") return JSON.parse(value);
      return value;
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }) {
      store.set(key, value);
      putCalls.push({ key, value, options });
    },
    async delete(key: string) {
      store.delete(key);
    },
  };

  return { kv: kv as unknown as KVNamespace, putCalls, store };
}

function createControlPlaneFetch(params?: { failCreateSession?: boolean; failPrompt?: boolean }) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url === "https://internal/sessions") {
      if (params?.failCreateSession) {
        return new Response("create session failed", { status: 500 });
      }
      return jsonResponse({ sessionId: "sess-1" });
    }

    if (url === "https://internal/sessions/sess-1/prompt") {
      if (params?.failPrompt) {
        return new Response("prompt failed", { status: 500 });
      }
      return jsonResponse({ ok: true });
    }

    if (url === "https://internal/sessions/existing-session/events?limit=20") {
      return jsonResponse({
        events: [{ type: "token", data: { content: "recent agent summary" } }],
      });
    }

    if (url === "https://internal/sessions/existing-session/prompt") {
      return jsonResponse({ ok: true });
    }

    return new Response("Not found", { status: 404 });
  });
}

function createEnv(params?: {
  projectMapping?: Record<string, { owner: string; name: string }>;
  existingSession?: Record<string, unknown>;
  failCreateSession?: boolean;
  failPrompt?: boolean;
}) {
  const oauthToken = JSON.stringify({
    access_token: "linear-oauth-token",
    refresh_token: "linear-refresh-token",
    expires_at: Date.now() + 3_600_000,
  });

  const initialKv: Record<string, string> = {
    "oauth:token:org-1": oauthToken,
  };

  if (params?.projectMapping) {
    initialKv["config:project-repos"] = JSON.stringify(params.projectMapping);
  }

  if (params?.existingSession) {
    initialKv["issue:issue-1"] = JSON.stringify(params.existingSession);
  }

  const { kv, putCalls } = createFakeKV(initialKv);
  const controlPlaneFetch = createControlPlaneFetch({
    failCreateSession: params?.failCreateSession,
    failPrompt: params?.failPrompt,
  });
  const env = {
    LINEAR_KV: kv,
    CONTROL_PLANE: { fetch: controlPlaneFetch },
    WEB_APP_URL: "https://openinspect.example",
    DEFAULT_MODEL: "openai/gpt-5.4",
    DEPLOYMENT_NAME: "test",
    CONTROL_PLANE_URL: "https://control-plane.example",
    LINEAR_CLIENT_ID: "client-id",
    LINEAR_CLIENT_SECRET: "client-secret",
    LINEAR_WEBHOOK_SECRET: "webhook-secret",
    WORKER_URL: "https://linear-bot.example",
  } as unknown as Env;

  return { env, putCalls, controlPlaneFetch };
}

function createCreatedWebhook(): AgentSessionWebhook {
  return {
    type: "AgentSessionEvent",
    action: "created",
    organizationId: "org-1",
    appUserId: "app-user-1",
    agentSession: {
      id: "agent-session-1",
      promptContext: "Please fix this issue.",
      issue: {
        id: "issue-1",
        identifier: "ENG-1",
        title: "Fix issue",
        description: "Body",
        url: "https://linear.app/acme/issue/ENG-1/fix-issue",
        priority: 0,
        priorityLabel: "No priority",
        team: { id: "team-1", key: "ENG", name: "Engineering" },
        project: { id: "project-1", name: "Platform" },
      },
    },
  };
}

function createLinearFetch(params: {
  currentStateType: string;
  includeStateUpdateFailure?: boolean;
  labels?: Array<{ id: string; name: string }>;
}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };

    if (body.query.includes("mutation AgentSessionUpdate")) {
      return jsonResponse({ data: { agentSessionUpdate: { success: true } } });
    }

    if (body.query.includes("mutation AgentActivityCreate")) {
      return jsonResponse({ data: { agentActivityCreate: { success: true } } });
    }

    if (body.query.includes("query IssueDetails")) {
      return jsonResponse({
        data: {
          issue: {
            id: "issue-1",
            identifier: "ENG-1",
            title: "Fix issue",
            description: "Body",
            url: "https://linear.app/acme/issue/ENG-1/fix-issue",
            priority: 0,
            priorityLabel: "No priority",
            labels: { nodes: params.labels ?? [] },
            project: { id: "project-1", name: "Platform" },
            assignee: null,
            state: {
              id: `state-${params.currentStateType}`,
              name: params.currentStateType,
              type: params.currentStateType,
            },
            team: { id: "team-1", key: "ENG", name: "Engineering" },
            comments: { nodes: [] },
          },
        },
      });
    }

    if (body.query.includes("query TeamStartedStates")) {
      return jsonResponse({
        data: {
          team: {
            states: {
              nodes: [{ id: "state-started", name: "In Progress", type: "started", position: 10 }],
            },
          },
        },
      });
    }

    if (body.query.includes("mutation MoveIssueToStarted")) {
      if (params.includeStateUpdateFailure) {
        return jsonResponse({ errors: [{ message: "Mutation failed" }] });
      }

      return jsonResponse({ data: { issueUpdate: { success: true } } });
    }

    throw new Error(`Unexpected Linear GraphQL operation: ${body.query}`);
  });
}

describe("handleAgentSessionEvent started-state behavior", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("moves backlog issues to the first started state before creating the coding session", async () => {
    const { env, putCalls, controlPlaneFetch } = createEnv({
      projectMapping: { "project-1": { owner: "acme", name: "platform" } },
    });
    const linearFetch = createLinearFetch({ currentStateType: "backlog" });
    globalThis.fetch = linearFetch as typeof globalThis.fetch;

    await handleAgentSessionEvent(createCreatedWebhook(), env, "trace-1");

    const issueUpdateCalls = linearFetch.mock.calls.filter(([, init]) =>
      String(init?.body).includes("mutation MoveIssueToStarted")
    );

    expect(issueUpdateCalls).toHaveLength(1);
    const promptCallOrder = controlPlaneFetch.mock.invocationCallOrder.find((_callOrder, index) => {
      return controlPlaneFetch.mock.calls[index]?.[0] === "https://internal/sessions/sess-1/prompt";
    });
    const moveCallOrder =
      linearFetch.mock.invocationCallOrder[
        linearFetch.mock.calls.findIndex(([, init]) =>
          String(init?.body).includes("mutation MoveIssueToStarted")
        )
      ];
    expect(moveCallOrder).toBeGreaterThan(promptCallOrder ?? 0);
    expect(controlPlaneFetch).toHaveBeenCalledWith(
      "https://internal/sessions",
      expect.objectContaining({ method: "POST" })
    );
    const createSessionCall = controlPlaneFetch.mock.calls.find(
      ([url]) => url === "https://internal/sessions"
    );
    expect(createSessionCall).toBeDefined();
    const createSessionInit = (
      createSessionCall as [string, RequestInit | undefined] | undefined
    )?.[1];
    expect(JSON.parse(String(createSessionInit?.body)).creationSource).toBe("linear");
    expect(controlPlaneFetch).toHaveBeenCalledWith(
      "https://internal/sessions/sess-1/prompt",
      expect.objectContaining({ method: "POST" })
    );
    expect(putCalls.some((call) => call.key === "issue:issue-1")).toBe(true);
  });

  it.each(["started", "completed", "canceled"])(
    "does not move issues already in %s state type",
    async (currentStateType) => {
      const { env } = createEnv({
        projectMapping: { "project-1": { owner: "acme", name: "platform" } },
      });
      const linearFetch = createLinearFetch({ currentStateType });
      globalThis.fetch = linearFetch as typeof globalThis.fetch;

      await handleAgentSessionEvent(createCreatedWebhook(), env, "trace-1");

      const issueUpdateCalls = linearFetch.mock.calls.filter(([, init]) =>
        String(init?.body).includes("mutation MoveIssueToStarted")
      );
      expect(issueUpdateCalls).toHaveLength(0);
    }
  );

  it("does not attempt the started-state transition for prompted follow-ups", async () => {
    const { env, controlPlaneFetch } = createEnv({
      existingSession: {
        sessionId: "existing-session",
        issueId: "issue-1",
        issueIdentifier: "ENG-1",
        repoOwner: "acme",
        repoName: "platform",
        model: "openai/gpt-5.4",
        createdAt: Date.now(),
      },
    });
    const linearFetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { query: string };

      if (body.query.includes("mutation AgentActivityCreate")) {
        return jsonResponse({ data: { agentActivityCreate: { success: true } } });
      }

      throw new Error(`Unexpected Linear GraphQL operation: ${body.query}`);
    });
    globalThis.fetch = linearFetch as typeof globalThis.fetch;

    await handleAgentSessionEvent(
      {
        type: "AgentSessionEvent",
        action: "prompted",
        organizationId: "org-1",
        appUserId: "app-user-1",
        agentSession: {
          id: "agent-session-1",
          issue: {
            id: "issue-1",
            identifier: "ENG-1",
            title: "Fix issue",
            url: "https://linear.app/acme/issue/ENG-1/fix-issue",
            priority: 0,
            priorityLabel: "No priority",
            team: { id: "team-1", key: "ENG", name: "Engineering" },
          },
        },
        agentActivity: { body: "Please also update tests." },
      },
      env,
      "trace-2"
    );

    expect(
      linearFetch.mock.calls.some(([, init]) =>
        String(init?.body).includes("mutation MoveIssueToStarted")
      )
    ).toBe(false);
    expect(controlPlaneFetch).toHaveBeenCalledWith(
      "https://internal/sessions/existing-session/prompt",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("continues creating the session when the started-state transition fails", async () => {
    const { env, controlPlaneFetch } = createEnv({
      projectMapping: { "project-1": { owner: "acme", name: "platform" } },
    });
    const linearFetch = createLinearFetch({
      currentStateType: "unstarted",
      includeStateUpdateFailure: true,
    });
    globalThis.fetch = linearFetch as typeof globalThis.fetch;

    await handleAgentSessionEvent(createCreatedWebhook(), env, "trace-3");

    const issueUpdateCalls = linearFetch.mock.calls.filter(([, init]) =>
      String(init?.body).includes("mutation MoveIssueToStarted")
    );
    expect(issueUpdateCalls).toHaveLength(1);
    expect(controlPlaneFetch).toHaveBeenCalledWith(
      "https://internal/sessions",
      expect.objectContaining({ method: "POST" })
    );
    expect(controlPlaneFetch).toHaveBeenCalledWith(
      "https://internal/sessions/sess-1/prompt",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("does not move the issue to started if prompt delivery fails", async () => {
    const { env, controlPlaneFetch } = createEnv({
      projectMapping: { "project-1": { owner: "acme", name: "platform" } },
      failPrompt: true,
    });
    const linearFetch = createLinearFetch({ currentStateType: "backlog" });
    globalThis.fetch = linearFetch as typeof globalThis.fetch;

    await handleAgentSessionEvent(createCreatedWebhook(), env, "trace-4");

    const issueUpdateCalls = linearFetch.mock.calls.filter(([, init]) =>
      String(init?.body).includes("mutation MoveIssueToStarted")
    );
    expect(issueUpdateCalls).toHaveLength(0);
    expect(controlPlaneFetch).toHaveBeenCalledWith(
      "https://internal/sessions/sess-1/prompt",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("uses provider and model labels together for session model selection", async () => {
    const { env, controlPlaneFetch } = createEnv({
      projectMapping: { "project-1": { owner: "acme", name: "platform" } },
    });
    const linearFetch = createLinearFetch({
      currentStateType: "backlog",
      labels: [
        { id: "label-1", name: "provider:github-copilot" },
        { id: "label-2", name: "model:gpt-5.4" },
      ],
    });
    globalThis.fetch = linearFetch as typeof globalThis.fetch;

    await handleAgentSessionEvent(createCreatedWebhook(), env, "trace-5");

    const createSessionCall = controlPlaneFetch.mock.calls.find(
      ([url]) => url === "https://internal/sessions"
    );
    const requestBody = JSON.parse(String(createSessionCall?.[1]?.body)) as { model: string };

    expect(requestBody.model).toBe("github-copilot/gpt-5.4");
  });

  it("uses Fireworks AI provider and model labels for session model selection", async () => {
    const { env, controlPlaneFetch } = createEnv({
      projectMapping: { "project-1": { owner: "acme", name: "platform" } },
    });
    const linearFetch = createLinearFetch({
      currentStateType: "backlog",
      labels: [
        { id: "label-1", name: "provider:fireworks-ai" },
        { id: "label-2", name: "model:kimi-k2p5-turbo" },
      ],
    });
    globalThis.fetch = linearFetch as typeof globalThis.fetch;

    await handleAgentSessionEvent(createCreatedWebhook(), env, "trace-6");

    const createSessionCall = controlPlaneFetch.mock.calls.find(
      ([url]) => url === "https://internal/sessions"
    );
    const requestBody = JSON.parse(String(createSessionCall?.[1]?.body)) as { model: string };

    expect(requestBody.model).toBe("fireworks-ai/kimi-k2p5-turbo");
  });
});
