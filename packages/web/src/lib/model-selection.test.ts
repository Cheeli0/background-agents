import { describe, expect, it } from "vitest";
import { getReasoningConfig } from "@open-inspect/shared/models";
import { resolveModelPreference } from "./model-selection";
import { resolveHarnessModelSelection } from "./session-harness";

const MODEL = "openai/gpt-6.2-sol";

describe("harness-aware reasoning preference", () => {
  it("replaces an effort the harness cannot run with that model's default", () => {
    const model = "anthropic/claude-haiku-4-5";
    expect(getReasoningConfig(model)?.efforts).not.toContain("xhigh");
    expect(
      resolveModelPreference({ model, reasoningEffort: "xhigh" }, undefined, "claude")
        .reasoningEffort
    ).toBe(getReasoningConfig(model)?.default);
  });

  it("carries the Codex selection through the composer's model selection", () => {
    const selection = resolveHarnessModelSelection({
      harness: "codex",
      preference: { model: MODEL, reasoningEffort: "max" },
      enabledModels: [MODEL],
      enabledModelOptions: [],
      loading: false,
    });
    expect(selection.availability).toEqual({ status: "available" });
    expect(selection).toMatchObject({ model: MODEL, reasoningEffort: "max" });
  });
});
