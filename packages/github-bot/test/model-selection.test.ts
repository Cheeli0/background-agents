import { describe, expect, it, vi } from "vitest";
import { parseInlinePromptFlags } from "@open-inspect/shared/inline-prompt-flags";
import type { ValidModel } from "@open-inspect/shared/models";
import { applyInlineModelOverrides, resolveModelSelection } from "../src/model-selection";
import type { Logger } from "../src/logger";
import type { Env } from "../src/types";

const defaults = { model: "anthropic/claude-sonnet-5-5", reasoningEffort: "low" };
const harness = "opencode";
const enabledModels = [
  "anthropic/claude-sonnet-5-5",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-6.2-sol",
  "opencode/minimax-m2.5",
] satisfies ValidModel[];

describe("applyInlineModelOverrides", () => {
  it("applies a model and reasoning override together", () => {
    expect(
      applyInlineModelOverrides(
        { model: "openai/gpt-6.2-sol", reasoningEffort: "xhigh" },
        defaults,
        enabledModels,
        harness
      )
    ).toEqual({
      ok: true,
      selection: { model: "openai/gpt-6.2-sol", reasoningEffort: "xhigh" },
    });
  });

  it("normalizes bare model ids and keeps a compatible configured effort", () => {
    expect(
      applyInlineModelOverrides({ model: "gpt-6.2-sol" }, defaults, enabledModels, harness)
    ).toEqual({
      ok: true,
      selection: { model: "openai/gpt-6.2-sol", reasoningEffort: "low" },
    });
  });

  it("drops a configured effort the override model does not support", () => {
    expect(
      applyInlineModelOverrides(
        { model: "anthropic/claude-haiku-4-5" },
        defaults,
        enabledModels,
        harness
      )
    ).toEqual({
      ok: true,
      selection: { model: "anthropic/claude-haiku-4-5", reasoningEffort: null },
    });
  });

  it("applies a reasoning-only override to the configured model", () => {
    expect(applyInlineModelOverrides({ reasoningEffort: "max" }, defaults, [], harness)).toEqual({
      ok: true,
      selection: { model: "anthropic/claude-sonnet-5-5", reasoningEffort: "max" },
    });
  });

  it("rejects unknown and disabled models", () => {
    expect(applyInlineModelOverrides({ model: "gpt-9" }, defaults, enabledModels, harness)).toEqual(
      {
        ok: false,
        message: "Unknown model `gpt-9`.",
      }
    );
    expect(
      applyInlineModelOverrides(
        { model: "anthropic/claude-sonnet-5-5" },
        defaults,
        ["openai/gpt-6.2-sol"],
        harness
      )
    ).toEqual({
      ok: false,
      message:
        "Model `anthropic/claude-sonnet-5-5` is not enabled. Enable it under Settings › Models.",
    });
  });

  it("rejects reasoning the effective model does not support", () => {
    expect(applyInlineModelOverrides({ reasoningEffort: "none" }, defaults, [], harness)).toEqual({
      ok: false,
      message:
        "Reasoning effort `none` is not valid for `anthropic/claude-sonnet-5-5`. Supported values: `low`, `medium`, `high`, `xhigh`, `max`.",
    });
    expect(
      applyInlineModelOverrides(
        { model: "opencode/minimax-m2.5", reasoningEffort: "high" },
        defaults,
        enabledModels,
        harness
      )
    ).toEqual({
      ok: false,
      message:
        "Reasoning effort `high` is not valid for `opencode/minimax-m2.5`. This model does not support reasoning controls.",
    });
  });

  it("keeps backticks in user-supplied values inside the code span", () => {
    expect(applyInlineModelOverrides({ model: "a`b" }, defaults, enabledModels, harness)).toEqual({
      ok: false,
      message: "Unknown model `` a`b ``.",
    });
  });
});

describe("resolveModelSelection compatibility", () => {
  const log: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };

  it.each(["Review this", "!reasoning:high Review this"])(
    "checks the configured canonical model without fetching enabled models (%s)",
    async (prompt) => {
      const fetch = vi.fn();
      const env = { CONTROL_PLANE: { fetch } } as unknown as Env;

      expect(
        await resolveModelSelection(
          env,
          log,
          "trace-compatibility",
          { model: "gpt-6.2-sol", harness: "claude", reasoningEffort: null },
          parseInlinePromptFlags(prompt)
        )
      ).toMatchObject({
        ok: false,
        reason: "harness_model_incompatible",
        message: expect.stringContaining(
          'Model "openai/gpt-6.2-sol" cannot run on the Claude Agent harness.'
        ),
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("allows a compatible inline override to repair incompatible defaults", async () => {
    const env = {
      SERVICE_AUTH_SECRET: "test-secret",
      CONTROL_PLANE: { fetch: vi.fn(async () => Response.json({ enabledModels })) },
    } as unknown as Env;

    expect(
      await resolveModelSelection(
        env,
        log,
        "trace-compatible-override",
        { model: "openai/gpt-6.2-sol", harness: "claude", reasoningEffort: "low" },
        parseInlinePromptFlags("!model:claude-sonnet-5-5 Review this")
      )
    ).toEqual({
      ok: true,
      overridden: true,
      selection: {
        model: "anthropic/claude-sonnet-5-5",
        harness: "claude",
        reasoningEffort: "low",
      },
    });
  });

  it("uses Codex reasoning capabilities for inline overrides", async () => {
    const env = { CONTROL_PLANE: { fetch: vi.fn() } } as unknown as Env;
    const codexDefaults = {
      model: "openai/gpt-6.2-sol",
      harness: "codex" as const,
      reasoningEffort: "low",
    };

    await expect(
      resolveModelSelection(
        env,
        log,
        "trace-codex-max",
        codexDefaults,
        parseInlinePromptFlags("!reasoning:max Review this")
      )
    ).resolves.toMatchObject({
      ok: true,
      selection: { reasoningEffort: "max" },
    });
    await expect(
      resolveModelSelection(
        env,
        log,
        "trace-codex-none",
        codexDefaults,
        parseInlinePromptFlags("!reasoning:none Review this")
      )
    ).resolves.toMatchObject({
      ok: false,
      reason: "invalid_inline_flags",
      message: expect.stringContaining(
        "Supported values: `low`, `medium`, `high`, `xhigh`, `max`."
      ),
    });
  });
});
