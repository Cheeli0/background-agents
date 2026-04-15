import { beforeEach, describe, expect, it, vi } from "vitest";
import app from "./index";
import { handleAgentSessionEvent } from "./webhook-handler";
import { verifyLinearWebhook } from "./utils/linear-client";
import type { AgentSessionWebhook, Env } from "./types";

vi.mock("./utils/linear-client", () => ({
  buildOAuthAuthorizeUrl: vi.fn(() => "https://linear.example/oauth"),
  exchangeCodeForToken: vi.fn(),
  fetchAgentSessionPullRequests: vi.fn(),
  getLinearClient: vi.fn(),
  verifyLinearWebhook: vi.fn(async () => true),
}));

vi.mock("./webhook-handler", () => ({
  escapeHtml: (value: string) => value,
  handleAgentSessionEvent: vi.fn(async () => undefined),
}));

function createFakeKV(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));

  const kv = {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };

  return kv as unknown as KVNamespace;
}

function createEnv(): Env {
  return {
    LINEAR_KV: createFakeKV(),
    CONTROL_PLANE: { fetch: vi.fn() },
    WEB_APP_URL: "https://openinspect.example",
    DEFAULT_MODEL: "openai/gpt-5.4",
    DEPLOYMENT_NAME: "test",
    CONTROL_PLANE_URL: "https://control-plane.example",
    LINEAR_CLIENT_ID: "client-id",
    LINEAR_CLIENT_SECRET: "client-secret",
    LINEAR_WEBHOOK_SECRET: "webhook-secret",
    WORKER_URL: "https://linear-bot.example",
  } as unknown as Env;
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function createAgentSessionPayload(overrides: Partial<AgentSessionWebhook> = {}): AgentSessionWebhook {
  return {
    type: "AgentSessionEvent",
    action: "created",
    organizationId: "org-1",
    webhookId: "webhook-subscription-1",
    agentSession: {
      id: "agent-session-1",
      issue: {
        id: "issue-1",
        identifier: "ENG-1",
        title: "Fix issue",
        description: "Body",
        url: "https://linear.app/acme/issue/ENG-1/fix-issue",
        priority: 0,
        priorityLabel: "No priority",
        team: { id: "team-1", key: "ENG", name: "Engineering" },
      },
    },
    ...overrides,
  };
}

async function postWebhook(params: {
  env: Env;
  payload: AgentSessionWebhook;
  deliveryId?: string;
}) {
  const headers = new Headers({
    "content-type": "application/json",
    "linear-signature": "test-signature",
  });

  if (params.deliveryId) {
    headers.set("linear-delivery", params.deliveryId);
  }

  return app.fetch(
    new Request("https://linear-bot.example/webhook", {
      method: "POST",
      headers,
      body: JSON.stringify(params.payload),
    }),
    params.env,
    createExecutionContext()
  );
}

describe("POST /webhook AgentSessionEvent deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyLinearWebhook).mockResolvedValue(true);
  });

  it("deduplicates by Linear delivery header, not payload webhookId", async () => {
    const env = createEnv();
    const payload = createAgentSessionPayload({ webhookId: "same-webhook-id" });

    const first = await postWebhook({ env, payload, deliveryId: "delivery-1" });
    const second = await postWebhook({ env, payload, deliveryId: "delivery-2" });

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true });
    expect(handleAgentSessionEvent).toHaveBeenCalledTimes(2);
  });

  it("skips repeated deliveries with the same Linear delivery header", async () => {
    const env = createEnv();
    const payload = createAgentSessionPayload();

    const first = await postWebhook({ env, payload, deliveryId: "delivery-1" });
    const second = await postWebhook({ env, payload, deliveryId: "delivery-1" });

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({
      ok: true,
      skipped: true,
      reason: "duplicate",
    });
    expect(handleAgentSessionEvent).toHaveBeenCalledTimes(1);
  });

  it("rejects AgentSessionEvent payloads without Linear delivery headers", async () => {
    const env = createEnv();
    const response = await postWebhook({
      env,
      payload: createAgentSessionPayload(),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid payload" });
    expect(handleAgentSessionEvent).not.toHaveBeenCalled();
  });
});
