import { describe, expect, it } from "vitest";
import type { ValidModel } from "@open-inspect/shared/models";
import {
  normalizeModelSelection,
  resolveInlinePromptOptions,
  sessionLaunchPlanSchema,
} from "./inline-flags";

describe("resolveInlinePromptOptions", () => {
  const defaults = { model: "anthropic/claude-sonnet-5-5", reasoningEffort: "high" };
  const enabledModels = [
    "anthropic/claude-sonnet-5-5",
    "openai/gpt-6.2-sol",
  ] satisfies ValidModel[];
  const sessionDefaults = {
    model: "anthropic/claude-sonnet-5-5",
    reasoningEffort: "high",
  };

  it("resolves combined overrides against the inline model", () => {
    expect(
      resolveInlinePromptOptions(
        { model: "openai/gpt-6.2-sol", reasoningEffort: "xhigh" },
        defaults,
        enabledModels
      )
    ).toEqual({
      ok: true,
      turnPlan: {
        sessionDefaults,
        promptOverrides: { model: "openai/gpt-6.2-sol", reasoningEffort: "xhigh" },
        effective: { model: "openai/gpt-6.2-sol", reasoningEffort: "xhigh" },
      },
    });
  });

  it("normalizes bare model ids and preserves a compatible default effort", () => {
    expect(resolveInlinePromptOptions({ model: "gpt-6.2-sol" }, defaults, enabledModels)).toEqual({
      ok: true,
      turnPlan: {
        sessionDefaults,
        promptOverrides: { model: "openai/gpt-6.2-sol", reasoningEffort: "high" },
        effective: { model: "openai/gpt-6.2-sol", reasoningEffort: "high" },
      },
    });
  });

  it("keeps a disabled session model when applying a reasoning override", () => {
    expect(
      resolveInlinePromptOptions(
        { reasoningEffort: "high" },
        { model: "openai/gpt-6.2-sol", reasoningEffort: "xhigh" },
        ["anthropic/claude-sonnet-5-5"]
      )
    ).toEqual({
      ok: true,
      turnPlan: {
        sessionDefaults: { model: "openai/gpt-6.2-sol", reasoningEffort: "xhigh" },
        promptOverrides: { reasoningEffort: "high" },
        effective: { model: "openai/gpt-6.2-sol", reasoningEffort: "high" },
      },
    });
  });

  it("rejects disabled models and incompatible reasoning", () => {
    expect(
      resolveInlinePromptOptions({ model: "openai/gpt-6.2-astra" }, defaults, enabledModels)
    ).toEqual({ ok: false, error: 'Model "openai/gpt-6.2-astra" is not enabled.' });
    expect(resolveInlinePromptOptions({ reasoningEffort: "max" }, defaults, enabledModels)).toEqual(
      {
        ok: true,
        turnPlan: {
          sessionDefaults,
          promptOverrides: { reasoningEffort: "max" },
          effective: { model: "anthropic/claude-sonnet-5-5", reasoningEffort: "max" },
        },
      }
    );
    expect(
      resolveInlinePromptOptions(
        { model: "openai/gpt-6.2-sol", reasoningEffort: "none" },
        defaults,
        enabledModels
      )
    ).toEqual({
      ok: false,
      error:
        'Reasoning effort "none" is not valid for "openai/gpt-6.2-sol". Supported values: low, medium, high, xhigh, max.',
    });
  });

  it("escapes Slack control tokens in validation errors", () => {
    expect(resolveInlinePromptOptions({ model: "<!channel>" }, defaults, enabledModels)).toEqual({
      ok: false,
      error: 'Unknown model "&lt;!channel&gt;".',
    });
    expect(
      resolveInlinePromptOptions({ reasoningEffort: "<@U123>" }, defaults, enabledModels)
    ).toEqual({
      ok: false,
      error:
        'Reasoning effort "&lt;@U123&gt;" is not valid for "anthropic/claude-sonnet-5-5". Supported values: low, medium, high, xhigh, max.',
    });
  });
});

describe("normalizeModelSelection", () => {
  it("parses valid stored reasoning efforts and falls back for malformed values", () => {
    expect(
      normalizeModelSelection({ model: "anthropic/claude-sonnet-5-5", reasoningEffort: "high" })
    ).toEqual({ model: "anthropic/claude-sonnet-5-5", reasoningEffort: "high" });
    expect(
      normalizeModelSelection({ model: "anthropic/claude-sonnet-5-5", reasoningEffort: "ultra" })
    ).toEqual({ model: "anthropic/claude-sonnet-5-5", reasoningEffort: "high" });
  });
});

describe("sessionLaunchPlanSchema", () => {
  it("drops an opening-prompt override saved before overrides were removed", () => {
    expect(
      sessionLaunchPlanSchema.parse({
        sessionDefaults: { model: "anthropic/claude-sonnet-5-5", reasoningEffort: "high" },
        promptOverrides: { model: "openai/gpt-6.2-sol" },
      })
    ).toEqual({
      sessionDefaults: { model: "anthropic/claude-sonnet-5-5", reasoningEffort: "high" },
    });
  });
});
