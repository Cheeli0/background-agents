import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENABLED_MODELS,
  DEFAULT_MODEL,
  MODEL_CATALOG,
  MODEL_OPTIONS,
  MODEL_REASONING_CONFIG,
  VALID_MODELS,
  applyModelPreferenceChanges,
  extractProviderAndModel,
  getCodexReasoningConfig,
  getSubscriptionProviderForModel,
  getDefaultReasoningEffort,
  getReasoningConfig,
  getValidModelOrDefault,
  getValidModel,
  isValidModel,
  isValidReasoningEffort,
  normalizeModelId,
  normalizeValidModels,
  resolveEnabledModel,
  supportsReasoning,
  UnsupportedModelError,
} from "./models";

const ANTHROPIC_MODELS = [
  "anthropic/claude-haiku-4-5",
  "anthropic/claude-sonnet-5-5",
  "anthropic/claude-opus-5-5",
  "anthropic/claude-fable-5-1",
] as const;

const OPENAI_MODELS = [
  "openai/gpt-6.1-terra",
  "openai/gpt-6.2-astra",
  "openai/gpt-6.2-sol",
  "openai/gpt-6-luna",
] as const;

const XAI_MODELS = ["xai/grok-4.7", "xai/grok-build-0.1"] as const;

const ZEN_MODELS = [
  "opencode/kimi-k3",
  "opencode/minimax-m2.5",
  "opencode/glm-5.2",
  "opencode/gemini-4-carbon",
  "opencode/gemini-4-argon",
  "opencode/gemini-3.8-flash",
  "opencode/muse-spark-1.3-contributor-free",
  "opencode/big-pickle",
] as const;

const GO_MODELS = [
  "opencode-go/grok-4.6",
  "opencode-go/gpt-5.6-luna",
  "opencode-go/gemini-4-argon",
  "opencode-go/glm-5.3-flash",
  "opencode-go/glm-5.3",
  "opencode-go/glm-5.2",
  "opencode-go/kimi-k3",
  "opencode-go/kimi-k2.7-code",
  "opencode-go/longcat-2.0",
  "opencode-go/deepseek-v4.1-flash",
  "opencode-go/deepseek-v4-pro",
  "opencode-go/deepseek-v4-flash-vision-exp",
  "opencode-go/mimo-v2.5",
  "opencode-go/mimo-v2.5-pro",
  "opencode-go/minimax-m3",
  "opencode-go/minimax-m2.7",
  "opencode-go/muse-spark-1.3-contributor",
  "opencode-go/qwen3.8-max",
  "opencode-go/qwen3.8-flash",
  "opencode-go/hy4-preview",
  "opencode-go/hy3",
] as const;

const DEEPSEEK_MODELS = ["deepseek/deepseek-v4-flash", "deepseek/deepseek-v4-pro"] as const;
const KIMI_CODE_PLAN_MODELS = [
  "kimi-code-plan-global/k3.1-pro",
  "kimi-code-plan-global/k3.1-pro-highspeed",
  "kimi-code-plan-global/k3",
  "kimi-code-plan-global/k3-256k",
  "kimi-code-plan-global/kimi-for-coding",
  "kimi-code-plan-global/kimi-for-coding-highspeed",
] as const;
const ZAI_CODING_PLAN_MODELS = [
  "zai-coding-plan/glm-5.2",
  "zai-coding-plan/glm-5.3",
  "zai-coding-plan/glm-5.3-flash",
] as const;
const MINIMAX_CODING_PLAN_MODELS = ["minimax-coding-plan/MiniMax-M2.7"] as const;
const FIREWORKS_MODELS = ["fireworks-ai/kimi-k2p5-turbo"] as const;
const OLLAMA_CLOUD_MODELS = [
  "ollama-cloud/glm-5.1",
  "ollama-cloud/kimi-k2.5",
  "ollama-cloud/minimax-m2.7",
] as const;

it("keeps the OpenCode gateway wire-test efforts aligned with the catalog", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../../sandbox-runtime/tests/fixtures/opencode-gateway-efforts.json",
        import.meta.url
      ),
      "utf8"
    )
  );
  const expected = Object.fromEntries(
    MODEL_CATALOG.flatMap((group) => group.models)
      .filter(
        (model) =>
          (model.id.startsWith("opencode/") || model.id.startsWith("opencode-go/")) &&
          "reasoning" in model
      )
      .map((model) => [model.id, [...model.reasoning.efforts]])
  );
  expect(fixture).toEqual(expected);
});

it.each([
  "../../../docs/AVAILABLE_MODELS.md",
  "../../../packages/docs/content/docs/models/choosing-a-model.mdx",
])("keeps the model inventory in %s aligned with the catalog", (file) => {
  const rows = readFileSync(new URL(file, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => /^\| `[^`]+`/.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
    );
  const models = MODEL_CATALOG.flatMap((group) => group.models);

  expect(rows.map(([id]) => id).sort()).toEqual(models.map(({ id }) => `\`${id}\``).sort());
  for (const model of models) {
    const row = rows.find(([id]) => id === `\`${model.id}\``);
    expect(row?.[1]).toBe(model.name);
    if (file.endsWith("AVAILABLE_MODELS.md")) {
      expect(row?.[2]).toBe(model.description);
    }
    if ("reasoning" in model) {
      expect(row?.at(-2)).toBe(model.reasoning.efforts.join(", "));
      expect(row?.at(-1)).toBe(model.reasoning.default ?? "Not set");
    } else {
      expect(row?.at(-1)).toBe("N/A");
    }
  }
});

it("keeps the Codex effort table in choosing-a-model.mdx aligned with the catalog", () => {
  const lines = readFileSync(
    new URL("../../../packages/docs/content/docs/models/choosing-a-model.mdx", import.meta.url),
    "utf8"
  ).split("\n");
  const header = lines.findIndex(
    (line) => line.startsWith("| Display name") && line.includes("Codex efforts")
  );
  const body = lines.slice(header + 2);
  const end = body.findIndex((line) => !line.startsWith("|"));
  const rows = body.slice(0, end === -1 ? undefined : end).map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim())
  );
  const openAiModels = MODEL_CATALOG.flatMap((group) => group.models).filter(({ id }) =>
    id.startsWith("openai/")
  );

  expect(header).toBeGreaterThan(-1);
  expect(rows.map(([name]) => name)).toEqual(openAiModels.map(({ name }) => name));
  for (const model of openAiModels) {
    const row = rows.find(([name]) => name === model.name);
    const codex = getCodexReasoningConfig(model.id);
    expect(row?.[1]).toBe(codex ? codex.efforts.join(", ") : "Not on Codex");
    expect(row?.[2]).toBe(codex ? (codex.default ?? "Not set") : "N/A");
  }
});

describe("model utilities", () => {
  it("derives every public model view from the authoritative catalog", () => {
    const catalogModels = MODEL_CATALOG.flatMap((group) => group.models);

    expect(VALID_MODELS).toEqual(catalogModels.map((model) => model.id));
    expect(MODEL_OPTIONS).toEqual(
      MODEL_CATALOG.map((group) => ({
        category: group.category,
        models: group.models.map(({ id, name, description }) => ({ id, name, description })),
      }))
    );
    expect(DEFAULT_ENABLED_MODELS).toEqual(
      MODEL_CATALOG.filter((group) => group.enabledByDefault).flatMap((group) =>
        group.models.map((model) => model.id)
      )
    );

    const defaultModels = catalogModels.filter((model) => "default" in model && model.default);
    expect(defaultModels).toHaveLength(1);
    expect(DEFAULT_MODEL).toBe(defaultModels[0]?.id);

    expect(MODEL_REASONING_CONFIG).toEqual(
      Object.fromEntries(
        catalogModels.flatMap((model) =>
          "reasoning" in model
            ? [
                [
                  model.id,
                  { efforts: [...model.reasoning.efforts], default: model.reasoning.default },
                ],
              ]
            : []
        )
      )
    );
  });

  it("keeps DEFAULT_MODEL valid", () => {
    expect(isValidModel(DEFAULT_MODEL)).toBe(true);
  });

  it("validates all supported provider-prefixed models", () => {
    for (const model of [
      ...ANTHROPIC_MODELS,
      ...OPENAI_MODELS,
      ...XAI_MODELS,
      ...ZEN_MODELS,
      ...GO_MODELS,
      ...KIMI_CODE_PLAN_MODELS,
      ...ZAI_CODING_PLAN_MODELS,
      ...DEEPSEEK_MODELS,
      ...MINIMAX_CODING_PLAN_MODELS,
      ...FIREWORKS_MODELS,
      ...OLLAMA_CLOUD_MODELS,
    ]) {
      expect(isValidModel(model)).toBe(true);
    }
  });

  it("normalizes and validates bare Claude and GPT model names", () => {
    expect(normalizeModelId("claude-sonnet-5-5")).toBe("anthropic/claude-sonnet-5-5");
    expect(normalizeModelId("claude-opus-5-5")).toBe("anthropic/claude-opus-5-5");
    expect(normalizeModelId("claude-fable-5-1")).toBe("anthropic/claude-fable-5-1");
    expect(normalizeModelId("gpt-6.2-sol")).toBe("openai/gpt-6.2-sol");
    expect(isValidModel("claude-sonnet-5-5")).toBe(true);
    expect(isValidModel("claude-opus-5-5")).toBe(true);
    expect(isValidModel("claude-fable-5-1")).toBe(true);
    expect(isValidModel("gpt-6.2-sol")).toBe(true);
  });

  it("normalizes, filters, and deduplicates model lists", () => {
    expect(
      normalizeValidModels([
        "claude-sonnet-5-5",
        "anthropic/claude-sonnet-5-5",
        "claude-sonnet-4-6",
        "unknown/model",
      ])
    ).toEqual(["anthropic/claude-sonnet-5-5"]);
    expect(normalizeValidModels(["openai/gpt-5.4", "unknown/model"])).toEqual([]);
    expect(normalizeValidModels([])).toEqual([]);
  });

  it("applies model preference changes as an ordered set", () => {
    expect(
      applyModelPreferenceChanges(
        ["anthropic/claude-sonnet-5-5"],
        [
          { modelId: "openai/gpt-6.2-sol", enabled: false },
          { modelId: "anthropic/claude-haiku-4-5", enabled: true },
          { modelId: "anthropic/claude-sonnet-5-5", enabled: false },
          { modelId: "openai/gpt-6.2-sol", enabled: true },
        ]
      )
    ).toEqual(["anthropic/claude-haiku-4-5", "openai/gpt-6.2-sol"]);
  });

  it("keeps enabled no-op changes in their existing position", () => {
    expect(
      applyModelPreferenceChanges(
        ["anthropic/claude-sonnet-5-5", "openai/gpt-6.2-sol"],
        [{ modelId: "anthropic/claude-sonnet-5-5", enabled: true }]
      )
    ).toEqual(["anthropic/claude-sonnet-5-5", "openai/gpt-6.2-sol"]);
  });

  it("resolves models using the shared enabled-model fallback policy", () => {
    // Display-only: an unsupported preference shows the fallback in pickers.
    expect(
      resolveEnabledModel({
        model: "anthropic/claude-sonnet-4-6",
        fallbackModel: "anthropic/claude-haiku-4-5",
        enabledModels: DEFAULT_ENABLED_MODELS,
      })
    ).toBe("anthropic/claude-haiku-4-5");
    expect(
      resolveEnabledModel({
        model: "claude-opus-5-5",
        fallbackModel: "gpt-6.2-sol",
        enabledModels: ["anthropic/claude-opus-5-5"],
      })
    ).toBe("anthropic/claude-opus-5-5");
    expect(
      resolveEnabledModel({
        model: "anthropic/claude-opus-5-5",
        fallbackModel: "gpt-6.2-sol",
        enabledModels: ["openai/gpt-6.2-sol"],
      })
    ).toBe("openai/gpt-6.2-sol");
    expect(
      resolveEnabledModel({
        model: "anthropic/claude-opus-5-5",
        fallbackModel: "anthropic/claude-sonnet-5-5",
        enabledModels: ["openai/gpt-6-luna"],
      })
    ).toBe("openai/gpt-6-luna");
    expect(
      resolveEnabledModel({
        model: "anthropic/claude-opus-5-5",
        fallbackModel: "openai/gpt-6.2-sol",
      })
    ).toBe("anthropic/claude-opus-5-5");
    expect(
      resolveEnabledModel({
        model: "anthropic/claude-opus-5-5",
        fallbackModel: "openai/gpt-6.2-sol",
        enabledModels: [],
      })
    ).toBe("openai/gpt-6.2-sol");
  });

  it("rejects invalid, legacy, empty, and case-mismatched models", () => {
    for (const model of [
      "gpt-4",
      "gpt-5.2",
      "openai/gpt-5.2",
      "gpt-5.2-codex",
      "openai/gpt-5.2-codex",
      "gpt-5.3-codex",
      "openai/gpt-5.3-codex",
      "gpt-5.3-codex-spark",
      "openai/gpt-5.3-codex-spark",
      "openai/gpt-5.4",
      "openai/gpt-6.1-sol",
      "anthropic/claude-sonnet-4-6",
      "anthropic/claude-opus-4-8",
      "anthropic/claude-fable-5",
      "opencode-go/deepseek-v4-flash",
      "xai/grok-4.6",
      "claude-3-opus",
      "claude-3-haiku",
      "haiku",
      "",
      "invalid",
    ]) {
      expect(isValidModel(model)).toBe(false);
    }
    expect(isValidModel("Claude-Haiku-4-5")).toBe(false);
  });

  it("extracts providers and model names after normalization", () => {
    expect(extractProviderAndModel("anthropic/claude-sonnet-5-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
    expect(extractProviderAndModel("claude-opus-5-5")).toEqual({
      provider: "anthropic",
      model: "claude-opus-5-5",
    });
    expect(extractProviderAndModel("anthropic/claude-opus-5-5")).toEqual({
      provider: "anthropic",
      model: "claude-opus-5-5",
    });
    expect(extractProviderAndModel("openai/gpt-6.2-sol")).toEqual({
      provider: "openai",
      model: "gpt-6.2-sol",
    });
    expect(extractProviderAndModel("provider/model/version")).toEqual({
      provider: "provider",
      model: "model/version",
    });
    expect(extractProviderAndModel("unknown-model")).toEqual({
      provider: "anthropic",
      model: "unknown-model",
    });
  });

  it("strictly derives subscription providers from canonical catalog routes", () => {
    expect(getSubscriptionProviderForModel("openai/gpt-6.2-sol")).toBe("openai");
    expect(getSubscriptionProviderForModel("xai/grok-4.7")).toBe("xai");
    expect(getSubscriptionProviderForModel("anthropic/claude-sonnet-5-5")).toBe("anthropic");
    expect(getSubscriptionProviderForModel("deepseek/deepseek-v4-pro")).toBeNull();
  });

  it("rejects bare, malformed, and unknown billing model routes", () => {
    for (const model of [
      "openai",
      "/gpt-5.6-sol",
      "openai/",
      "openai/gpt-6.2-sol/extra",
      "OpenAI/gpt-5.6-sol",
      "openai/not-in-catalog",
      "unknown/model",
      "",
    ]) {
      expect(() => getSubscriptionProviderForModel(model)).toThrow();
    }
  });

  it("recognizes supported selections and never substitutes for retired ones", () => {
    expect(getValidModel("gpt-6.2-sol")).toBe("openai/gpt-6.2-sol");
    for (const model of [
      "openai/gpt-5.3-codex",
      "claude-sonnet-4-6",
      "invalid-model",
      "",
      null,
      undefined,
    ]) {
      expect(getValidModel(model)).toBeUndefined();
    }
  });

  it("defaults a missing model and refuses a retired or unknown one", () => {
    expect(getValidModelOrDefault("claude-sonnet-5-5")).toBe("anthropic/claude-sonnet-5-5");
    expect(getValidModelOrDefault(undefined)).toBe(DEFAULT_MODEL);
    expect(getValidModelOrDefault(null)).toBe(DEFAULT_MODEL);
    expect(getValidModelOrDefault("")).toBe(DEFAULT_MODEL);
    for (const model of ["gpt-5.3-codex", "anthropic/claude-sonnet-4-6", "invalid-model"]) {
      expect(() => getValidModelOrDefault(model)).toThrow(UnsupportedModelError);
    }
    expect(() => getValidModelOrDefault("claude-sonnet-4-6")).toThrow(
      'Model "claude-sonnet-4-6" is no longer supported. Choose a supported model.'
    );
  });

  it("reports reasoning support and default efforts", () => {
    expect(supportsReasoning("anthropic/claude-sonnet-5-5")).toBe(true);
    expect(supportsReasoning("openai/gpt-6.2-sol")).toBe(true);
    expect(supportsReasoning("zai-coding-plan/glm-5.3")).toBe(true);
    expect(supportsReasoning("opencode-go/deepseek-v4.1-flash")).toBe(true);
    expect(supportsReasoning("xai/grok-build-0.1")).toBe(false);
    expect(supportsReasoning("deepseek/deepseek-v4-flash")).toBe(false);
    expect(supportsReasoning("anthropic/claude-sonnet-4-6")).toBe(false);
    expect(supportsReasoning("invalid")).toBe(false);

    expect(getDefaultReasoningEffort("anthropic/claude-haiku-4-5")).toBe("max");
    expect(getDefaultReasoningEffort("anthropic/claude-sonnet-5-5")).toBe("high");
    expect(getDefaultReasoningEffort("anthropic/claude-opus-5-5")).toBe("high");
    expect(getDefaultReasoningEffort("anthropic/claude-fable-5-1")).toBe("high");
    expect(getDefaultReasoningEffort("openai/gpt-6.2-sol")).toBe("medium");
    expect(getDefaultReasoningEffort("openai/gpt-6-luna")).toBe("medium");
    expect(getDefaultReasoningEffort("zai-coding-plan/glm-5.3")).toBe("high");
    expect(getDefaultReasoningEffort("opencode-go/deepseek-v4.1-flash")).toBe("high");
    expect(getDefaultReasoningEffort("openai/gpt-5.3-codex")).toBeUndefined();
    expect(getDefaultReasoningEffort("xai/grok-build-0.1")).toBeUndefined();
    expect(getDefaultReasoningEffort("deepseek/deepseek-v4-pro")).toBeUndefined();
  });

  it("returns reasoning configurations for supported model families", () => {
    expect(getReasoningConfig("anthropic/claude-haiku-4-5")).toEqual({
      efforts: ["high", "max"],
      default: "max",
    });
    for (const model of [
      "anthropic/claude-sonnet-5-5",
      "anthropic/claude-opus-5-5",
      "anthropic/claude-fable-5-1",
    ]) {
      expect(getReasoningConfig(model)).toEqual({
        efforts: ["low", "medium", "high", "xhigh", "max"],
        default: "high",
      });
    }
    for (const model of ["openai/gpt-6.2-astra", "openai/gpt-6.2-sol"]) {
      expect(getReasoningConfig(model)).toEqual({
        efforts: ["low", "medium", "high", "xhigh", "max"],
        default: "medium",
      });
    }
    for (const model of ["openai/gpt-6.1-terra", "openai/gpt-6-luna"]) {
      expect(getReasoningConfig(model)).toEqual({
        efforts: ["none", "low", "medium", "high", "xhigh", "max"],
        default: "medium",
      });
    }
    expect(getCodexReasoningConfig("openai/gpt-6.2-sol")?.default).toBe("low");
    expect(getReasoningConfig("anthropic/claude-sonnet-4-6")).toBeUndefined();
  });

  it("exposes the provider-defined reasoning ladders for the new model routes", () => {
    for (const model of [
      "zai-coding-plan/glm-5.3",
      "zai-coding-plan/glm-5.3-flash",
      "opencode-go/glm-5.3-flash",
      "opencode-go/deepseek-v4.1-flash",
    ]) {
      expect(getReasoningConfig(model)).toEqual({
        efforts: ["low", "high", "max"],
        default: "high",
      });
    }
    expect(getReasoningConfig("opencode-go/muse-spark-1.3-contributor")).toEqual({
      efforts: ["low", "medium", "high", "xhigh"],
      default: "xhigh",
    });
    // The models.dev catalog lists no efforts for these, so OpenCode sends none.
    expect(getReasoningConfig("opencode/muse-spark-1.3-contributor-free")).toBeUndefined();
    expect(getReasoningConfig("opencode-go/deepseek-v4-flash-vision-exp")).toBeUndefined();
    expect(getReasoningConfig("opencode/big-pickle")).toBeUndefined();
  });

  it("validates reasoning efforts per model", () => {
    expect(isValidReasoningEffort("anthropic/claude-haiku-4-5", "max")).toBe(true);
    expect(isValidReasoningEffort("anthropic/claude-haiku-4-5", "low")).toBe(false);
    expect(isValidReasoningEffort("anthropic/claude-sonnet-5-5", "xhigh")).toBe(true);
    expect(isValidReasoningEffort("anthropic/claude-opus-5-5", "none")).toBe(false);
    expect(isValidReasoningEffort("openai/gpt-6.2-astra", "max")).toBe(true);
    expect(isValidReasoningEffort("openai/gpt-6.2-astra", "none")).toBe(false);
    expect(isValidReasoningEffort("openai/gpt-6.2-astra", "ultra")).toBe(false);
    expect(isValidReasoningEffort("openai/gpt-6-luna", "none")).toBe(true);
    expect(isValidReasoningEffort("opencode/muse-spark-1.3-contributor-free", "minimal")).toBe(
      false
    );
    expect(isValidReasoningEffort("opencode-go/deepseek-v4.1-flash", "max")).toBe(true);
    expect(isValidReasoningEffort("opencode-go/deepseek-v4.1-flash", "medium")).toBe(false);
    expect(isValidReasoningEffort("zai-coding-plan/glm-5.3", "max")).toBe(true);
    expect(isValidReasoningEffort("zai-coding-plan/glm-5.3", "medium")).toBe(false);
    expect(isValidReasoningEffort("opencode/big-pickle", "high")).toBe(false);
    expect(isValidReasoningEffort("anthropic/claude-sonnet-4-6", "high")).toBe(false);
    expect(isValidReasoningEffort("invalid", "high")).toBe(false);
  });

  it("groups display options and excludes opt-in providers from default enabled models", () => {
    expect(
      MODEL_OPTIONS.find((group) => group.category === "Anthropic")?.models.map((m) => m.id)
    ).toEqual(ANTHROPIC_MODELS);
    expect(
      MODEL_OPTIONS.find((group) => group.category === "OpenAI")?.models.map((m) => m.id)
    ).toEqual(OPENAI_MODELS);
    expect(
      MODEL_OPTIONS.find((group) => group.category === "xAI / SuperGrok")?.models.map((m) => m.id)
    ).toEqual(XAI_MODELS);
    expect(
      MODEL_OPTIONS.find((group) => group.category === "OpenCode Zen")?.models.map((m) => m.id)
    ).toEqual(ZEN_MODELS);
    expect(
      MODEL_OPTIONS.find((group) => group.category === "OpenCode Go")?.models.map((m) => m.id)
    ).toEqual(GO_MODELS);
    expect(
      MODEL_OPTIONS.find((group) => group.category === "Kimi Coding Plan")?.models.map((m) => m.id)
    ).toEqual(KIMI_CODE_PLAN_MODELS);
    expect(
      MODEL_OPTIONS.find((group) => group.category === "Z.AI Coding Plan")?.models.map((m) => m.id)
    ).toEqual(ZAI_CODING_PLAN_MODELS);
    expect(
      MODEL_OPTIONS.find((group) => group.category === "DeepSeek")?.models.map((m) => m.id)
    ).toEqual(DEEPSEEK_MODELS);
    expect(
      MODEL_OPTIONS.find((group) => group.category === "MiniMax Coding Plan")?.models.map(
        (m) => m.id
      )
    ).toEqual(MINIMAX_CODING_PLAN_MODELS);
    expect(
      MODEL_OPTIONS.find((group) => group.category === "Fireworks AI")?.models.map((m) => m.id)
    ).toEqual(FIREWORKS_MODELS);
    expect(
      MODEL_OPTIONS.find((group) => group.category === "Ollama Cloud")?.models.map((m) => m.id)
    ).toEqual(OLLAMA_CLOUD_MODELS);

    expect(DEFAULT_ENABLED_MODELS).toEqual([...ANTHROPIC_MODELS, ...OPENAI_MODELS]);
    for (const optInModel of [
      ...XAI_MODELS,
      ...ZEN_MODELS,
      ...GO_MODELS,
      ...KIMI_CODE_PLAN_MODELS,
      ...ZAI_CODING_PLAN_MODELS,
      ...DEEPSEEK_MODELS,
      ...MINIMAX_CODING_PLAN_MODELS,
      ...FIREWORKS_MODELS,
      ...OLLAMA_CLOUD_MODELS,
    ]) {
      expect(DEFAULT_ENABLED_MODELS).not.toContain(optInModel);
    }
  });
});
