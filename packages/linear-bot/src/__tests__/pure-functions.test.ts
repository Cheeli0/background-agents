import { describe, expect, it } from "vitest";
import {
  extractModelFromLabels,
  resolveSessionModelSettings,
  resolveStaticRepo,
} from "../model-resolution";
import { isValidPayload, verifyCallbackSignature } from "../callbacks";
import type { CompletionCallback } from "../types";

// ─── extractModelFromLabels ──────────────────────────────────────────────────

describe("extractModelFromLabels", () => {
  it("returns model for a valid label", () => {
    expect(extractModelFromLabels([{ name: "model:opus" }])).toBe("anthropic/claude-opus-4-5");
  });

  it("returns model for case-insensitive label", () => {
    expect(extractModelFromLabels([{ name: "Model:Sonnet" }])).toBe("anthropic/claude-sonnet-4-5");
  });

  it("returns GPT 5.4 for model:gpt-5.4 label", () => {
    expect(extractModelFromLabels([{ name: "model:gpt-5.4" }])).toBe("openai/gpt-5.4");
  });

  it("returns GLM 5.1 for model:glm-5.1 label", () => {
    expect(extractModelFromLabels([{ name: "model:glm-5.1" }])).toBe("zai-coding-plan/glm-5.1");
  });

  it("returns GLM 5 for model:glm-5 label", () => {
    expect(extractModelFromLabels([{ name: "model:glm-5" }])).toBe("zai-coding-plan/glm-5");
  });

  it("returns GLM 4.7 for model:glm-4.7 label", () => {
    expect(extractModelFromLabels([{ name: "model:glm-4.7" }])).toBe("zai-coding-plan/glm-4.7");
  });

  it("returns Kimi K2.5 Turbo for model:kimi-k2p5-turbo label", () => {
    expect(extractModelFromLabels([{ name: "model:kimi-k2p5-turbo" }])).toBe(
      "fireworks-ai/kimi-k2p5-turbo"
    );
  });

  it("returns MiniMax M2.7 for model:minimax-m2.7 label", () => {
    expect(extractModelFromLabels([{ name: "model:minimax-m2.7" }])).toBe(
      "minimax-coding-plan/MiniMax-M2.7"
    );
  });

  it("returns OpenCode Go-only models from model labels", () => {
    expect(extractModelFromLabels([{ name: "model:kimi-k2.6" }])).toBe("opencode-go/kimi-k2.6");
    expect(extractModelFromLabels([{ name: "model:qwen3.6-plus" }])).toBe(
      "opencode-go/qwen3.6-plus"
    );
    expect(extractModelFromLabels([{ name: "model:mimo-v2-pro" }])).toBe("opencode-go/mimo-v2-pro");
    expect(extractModelFromLabels([{ name: "model:mimo-v2-omni" }])).toBe(
      "opencode-go/mimo-v2-omni"
    );
  });

  it("resolves provider-only labels using the matching base model when available", () => {
    expect(
      extractModelFromLabels([{ name: "provider:github-copilot" }], "anthropic/claude-sonnet-4-6")
    ).toBe("github-copilot/claude-sonnet-4-6");
  });

  it("falls back to the provider default when only a provider label is present", () => {
    expect(extractModelFromLabels([{ name: "provider:openai" }], "anthropic/claude-opus-4-6")).toBe(
      "openai/gpt-5.4"
    );
  });

  it("uses Fireworks AI default when only provider:fireworks-ai is present", () => {
    expect(
      extractModelFromLabels([{ name: "provider:fireworks-ai" }], "anthropic/claude-opus-4-6")
    ).toBe("fireworks-ai/kimi-k2p5-turbo");
  });

  it("uses GLM 5.1 when only provider:zai is present", () => {
    expect(extractModelFromLabels([{ name: "provider:zai" }], "anthropic/claude-opus-4-6")).toBe(
      "zai-coding-plan/glm-5.1"
    );
  });

  it("accepts provider:z.ai as a Z.AI alias", () => {
    expect(extractModelFromLabels([{ name: "provider:z.ai" }, { name: "model:glm-5.1" }])).toBe(
      "zai-coding-plan/glm-5.1"
    );
  });

  it("uses MiniMax M2.7 when only provider:minimax is present", () => {
    expect(
      extractModelFromLabels([{ name: "provider:minimax" }], "anthropic/claude-opus-4-6")
    ).toBe("minimax-coding-plan/MiniMax-M2.7");
  });

  it("uses GLM 5.1 when only provider:opencode-go is present", () => {
    expect(
      extractModelFromLabels([{ name: "provider:opencode-go" }], "anthropic/claude-opus-4-6")
    ).toBe("opencode-go/glm-5.1");
  });

  it("uses GLM 5.1 when only provider:ollama-cloud is present", () => {
    expect(
      extractModelFromLabels([{ name: "provider:ollama-cloud" }], "anthropic/claude-opus-4-6")
    ).toBe("ollama-cloud/glm-5.1");
  });

  it("accepts provider:opencode go as an OpenCode Go alias", () => {
    expect(extractModelFromLabels([{ name: "provider:opencode go" }])).toBe("opencode-go/glm-5.1");
  });

  it("accepts provider:ollama cloud as an Ollama Cloud alias", () => {
    expect(extractModelFromLabels([{ name: "provider:ollama cloud" }])).toBe(
      "ollama-cloud/glm-5.1"
    );
  });

  it("combines provider and model labels when both are present", () => {
    expect(
      extractModelFromLabels([{ name: "provider:github-copilot" }, { name: "model:gpt-5.4" }])
    ).toBe("github-copilot/gpt-5.4");
  });

  it("combines OpenCode Go provider labels with shared model names", () => {
    expect(
      extractModelFromLabels([{ name: "provider:opencode-go" }, { name: "model:glm-5.1" }])
    ).toBe("opencode-go/glm-5.1");
    expect(
      extractModelFromLabels([{ name: "provider:opencode-go" }, { name: "model:kimi-k2.5" }])
    ).toBe("opencode-go/kimi-k2.5");
    expect(
      extractModelFromLabels([{ name: "provider:opencode-go" }, { name: "model:kimi-k2.6" }])
    ).toBe("opencode-go/kimi-k2.6");
    expect(
      extractModelFromLabels([{ name: "provider:opencode-go" }, { name: "model:minimax-m2.7" }])
    ).toBe("opencode-go/minimax-m2.7");
  });

  it("combines Ollama Cloud provider labels with shared model names", () => {
    expect(
      extractModelFromLabels([{ name: "provider:ollama-cloud" }, { name: "model:glm-5.1" }])
    ).toBe("ollama-cloud/glm-5.1");
    expect(
      extractModelFromLabels([{ name: "provider:ollama-cloud" }, { name: "model:kimi-k2.5" }])
    ).toBe("ollama-cloud/kimi-k2.5");
    expect(
      extractModelFromLabels([{ name: "provider:ollama-cloud" }, { name: "model:minimax-m2.7" }])
    ).toBe("ollama-cloud/minimax-m2.7");
  });

  it("returns null for unknown model label", () => {
    expect(extractModelFromLabels([{ name: "model:unknown-model" }])).toBeNull();
  });

  it("returns null when no model labels present", () => {
    expect(extractModelFromLabels([{ name: "bug" }, { name: "urgent" }])).toBeNull();
  });

  it("returns null for empty labels", () => {
    expect(extractModelFromLabels([])).toBeNull();
  });
});

// ─── resolveStaticRepo ──────────────────────────────────────────────────────

describe("resolveStaticRepo", () => {
  const mapping = {
    "team-1": [
      { owner: "org", name: "frontend", label: "frontend" },
      { owner: "org", name: "backend", label: "backend" },
      { owner: "org", name: "default-repo" },
    ],
  };

  it("matches by label", () => {
    const result = resolveStaticRepo(mapping, "team-1", ["Frontend"]);
    expect(result).toEqual({ owner: "org", name: "frontend", label: "frontend" });
  });

  it("falls back to entry without label", () => {
    const result = resolveStaticRepo(mapping, "team-1", ["unrelated"]);
    expect(result).toEqual({ owner: "org", name: "default-repo" });
  });

  it("returns null for empty mapping", () => {
    expect(resolveStaticRepo({}, "team-1")).toBeNull();
  });

  it("returns null for unknown team", () => {
    expect(resolveStaticRepo(mapping, "team-unknown")).toBeNull();
  });
});

describe("resolveSessionModelSettings", () => {
  it("uses integration model when overrides are disabled", () => {
    const result = resolveSessionModelSettings({
      envDefaultModel: "anthropic/claude-haiku-4-5",
      configModel: "anthropic/claude-sonnet-4-6",
      configReasoningEffort: "high",
      allowUserPreferenceOverride: false,
      allowLabelModelOverride: false,
      userModel: "openai/gpt-5.3-codex",
      labelModel: "anthropic/claude-opus-4-6",
    });

    expect(result.model).toBe("anthropic/claude-sonnet-4-6");
    expect(result.reasoningEffort).toBe("high");
  });

  it("applies user preference when enabled", () => {
    const result = resolveSessionModelSettings({
      envDefaultModel: "anthropic/claude-haiku-4-5",
      configModel: "anthropic/claude-sonnet-4-6",
      configReasoningEffort: null,
      allowUserPreferenceOverride: true,
      allowLabelModelOverride: false,
      userModel: "openai/gpt-5.3-codex",
      userReasoningEffort: "xhigh",
    });

    expect(result.model).toBe("openai/gpt-5.3-codex");
    expect(result.reasoningEffort).toBe("xhigh");
  });

  it("does not let config effort override user effort when user model wins", () => {
    const result = resolveSessionModelSettings({
      envDefaultModel: "anthropic/claude-haiku-4-5",
      configModel: "anthropic/claude-sonnet-4-6",
      configReasoningEffort: "low",
      allowUserPreferenceOverride: true,
      allowLabelModelOverride: false,
      userModel: "openai/gpt-5.3-codex",
      userReasoningEffort: "xhigh",
    });

    expect(result.model).toBe("openai/gpt-5.3-codex");
    expect(result.reasoningEffort).toBe("xhigh");
  });

  it("applies label override over user preference when enabled", () => {
    const result = resolveSessionModelSettings({
      envDefaultModel: "anthropic/claude-haiku-4-5",
      configModel: null,
      configReasoningEffort: null,
      allowUserPreferenceOverride: true,
      allowLabelModelOverride: true,
      userModel: "openai/gpt-5.3-codex",
      labelModel: "anthropic/claude-opus-4-6",
      userReasoningEffort: "xhigh",
    });

    expect(result.model).toBe("anthropic/claude-opus-4-6");
    expect(result.reasoningEffort).toBe("high");
  });

  it("falls back to model default reasoning effort when invalid", () => {
    const result = resolveSessionModelSettings({
      envDefaultModel: "anthropic/claude-haiku-4-5",
      configModel: "anthropic/claude-opus-4-6",
      configReasoningEffort: "xhigh",
      allowUserPreferenceOverride: true,
      allowLabelModelOverride: false,
      userReasoningEffort: "xhigh",
    });

    expect(result.model).toBe("anthropic/claude-opus-4-6");
    expect(result.reasoningEffort).toBe("high");
  });

  it("uses config reasoning effort when config model is selected", () => {
    const result = resolveSessionModelSettings({
      envDefaultModel: "anthropic/claude-haiku-4-5",
      configModel: "anthropic/claude-opus-4-6",
      configReasoningEffort: "max",
      allowUserPreferenceOverride: false,
      allowLabelModelOverride: false,
      userReasoningEffort: "low",
    });

    expect(result.model).toBe("anthropic/claude-opus-4-6");
    expect(result.reasoningEffort).toBe("max");
  });
});

// ─── isValidPayload ─────────────────────────────────────────────────────────

describe("isValidPayload", () => {
  const validPayload: CompletionCallback = {
    sessionId: "sess-1",
    messageId: "msg-1",
    success: true,
    timestamp: Date.now(),
    signature: "abc123",
    context: {
      source: "linear",
      issueId: "issue-1",
      issueIdentifier: "ENG-123",
      issueUrl: "https://linear.app/issue/ENG-123",
      repoFullName: "org/repo",
      model: "claude-sonnet-4-5",
    },
  };

  it("accepts a complete payload", () => {
    expect(isValidPayload(validPayload)).toBe(true);
  });

  it("rejects null", () => {
    expect(isValidPayload(null)).toBe(false);
  });

  it("rejects missing sessionId", () => {
    const { sessionId: _sessionId, ...rest } = validPayload;
    expect(isValidPayload(rest)).toBe(false);
  });

  it("rejects missing context.issueId", () => {
    const bad = { ...validPayload, context: { ...validPayload.context, issueId: undefined } };
    expect(isValidPayload(bad)).toBe(false);
  });

  it("rejects missing signature", () => {
    const { signature: _signature, ...rest } = validPayload;
    expect(isValidPayload(rest)).toBe(false);
  });
});

// ─── verifyCallbackSignature ────────────────────────────────────────────────

describe("verifyCallbackSignature", () => {
  const secret = "test-secret-key";

  async function signPayload(data: Record<string, unknown>): Promise<string> {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(JSON.stringify(data)));
    return Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  it("returns true for valid signature", async () => {
    const data = {
      sessionId: "sess-1",
      messageId: "msg-1",
      success: true,
      timestamp: 1234567890,
      context: {
        source: "linear" as const,
        issueId: "issue-1",
        issueIdentifier: "ENG-1",
        issueUrl: "https://linear.app/issue/ENG-1",
        repoFullName: "org/repo",
        model: "claude-sonnet-4-5",
      },
    };
    const signature = await signPayload(data);
    const payload = { ...data, signature } as CompletionCallback;
    expect(await verifyCallbackSignature(payload, secret)).toBe(true);
  });

  it("returns false for invalid signature", async () => {
    const payload: CompletionCallback = {
      sessionId: "sess-1",
      messageId: "msg-1",
      success: true,
      timestamp: 1234567890,
      signature: "invalid-hex-signature",
      context: {
        source: "linear",
        issueId: "issue-1",
        issueIdentifier: "ENG-1",
        issueUrl: "https://linear.app/issue/ENG-1",
        repoFullName: "org/repo",
        model: "claude-sonnet-4-5",
      },
    };
    expect(await verifyCallbackSignature(payload, secret)).toBe(false);
  });
});
