import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODEL,
  normalizeModelId,
  isValidModel,
  extractProviderAndModel,
  getValidModelOrDefault,
  supportsReasoning,
  getDefaultReasoningEffort,
  isValidReasoningEffort,
  getReasoningConfig,
} from "./models";

describe("model utilities", () => {
  describe("DEFAULT_MODEL", () => {
    it("is a valid model", () => {
      expect(isValidModel(DEFAULT_MODEL)).toBe(true);
    });
  });

  describe("isValidModel", () => {
    it("returns true for valid models", () => {
      expect(isValidModel("anthropic/claude-haiku-4-5")).toBe(true);
      expect(isValidModel("anthropic/claude-sonnet-4-5")).toBe(true);
      expect(isValidModel("anthropic/claude-opus-4-5")).toBe(true);
      expect(isValidModel("anthropic/claude-opus-4-6")).toBe(true);
    });

    it("accepts bare Claude model names via normalization", () => {
      expect(isValidModel("claude-haiku-4-5")).toBe(true);
      expect(isValidModel("claude-sonnet-4-5")).toBe(true);
      expect(isValidModel("claude-opus-4-5")).toBe(true);
      expect(isValidModel("claude-opus-4-6")).toBe(true);
    });

    it("returns true for OpenAI models", () => {
      expect(isValidModel("openai/gpt-5.2")).toBe(true);
      expect(isValidModel("openai/gpt-5.4")).toBe(true);
      expect(isValidModel("openai/gpt-5.5")).toBe(true);
      expect(isValidModel("openai/gpt-5.2-codex")).toBe(true);
      expect(isValidModel("openai/gpt-5.3-codex")).toBe(true);
      expect(isValidModel("openai/gpt-5.3-codex-spark")).toBe(true);
    });

    it("returns true for GitHub Copilot-backed models", () => {
      expect(isValidModel("github-copilot/gpt-4.1")).toBe(true);
      expect(isValidModel("github-copilot/gpt-5.1")).toBe(true);
      expect(isValidModel("github-copilot/gpt-5-mini")).toBe(true);
      expect(isValidModel("github-copilot/claude-sonnet-4")).toBe(true);
    });

    it("returns true for Z.AI Coding Plan-backed models", () => {
      expect(isValidModel("zai-coding-plan/glm-5.1")).toBe(true);
      expect(isValidModel("zai-coding-plan/glm-5")).toBe(true);
      expect(isValidModel("zai-coding-plan/glm-5-turbo")).toBe(true);
      expect(isValidModel("zai-coding-plan/glm-4.7")).toBe(true);
      expect(isValidModel("zai-coding-plan/glm-4.5-air")).toBe(true);
    });

    it("returns true for Fireworks AI-backed models", () => {
      expect(isValidModel("fireworks-ai/kimi-k2p5-turbo")).toBe(true);
    });

    it("returns true for OpenCode Zen models", () => {
      expect(isValidModel("opencode/kimi-k2.5")).toBe(true);
      expect(isValidModel("opencode/minimax-m2.5")).toBe(true);
      expect(isValidModel("opencode/glm-5")).toBe(true);
    });

    it("returns true for OpenCode Go models", () => {
      expect(isValidModel("opencode-go/glm-5.1")).toBe(true);
      expect(isValidModel("opencode-go/kimi-k2.5")).toBe(true);
      expect(isValidModel("opencode-go/kimi-k2.6")).toBe(true);
      expect(isValidModel("opencode-go/qwen3.6-plus")).toBe(true);
      expect(isValidModel("opencode-go/minimax-m2.7")).toBe(true);
      expect(isValidModel("opencode-go/mimo-v2-pro")).toBe(true);
      expect(isValidModel("opencode-go/mimo-v2-omni")).toBe(true);
    });

    it("returns true for Ollama Cloud models", () => {
      expect(isValidModel("ollama-cloud/glm-5.1")).toBe(true);
      expect(isValidModel("ollama-cloud/kimi-k2.5")).toBe(true);
      expect(isValidModel("ollama-cloud/minimax-m2.7")).toBe(true);
    });

    it("returns true for MiniMax Coding Plan-backed models", () => {
      expect(isValidModel("minimax-coding-plan/MiniMax-M2.7")).toBe(true);
    });

    it("accepts bare GPT model names via normalization", () => {
      expect(isValidModel("gpt-5.4")).toBe(true);
      expect(isValidModel("gpt-5.5")).toBe(true);
      expect(isValidModel("gpt-5.2")).toBe(true);
      expect(isValidModel("gpt-5.2-codex")).toBe(true);
      expect(isValidModel("gpt-5.3-codex")).toBe(true);
      expect(isValidModel("gpt-5.3-codex-spark")).toBe(true);
    });

    it("returns false for invalid models", () => {
      expect(isValidModel("gpt-4")).toBe(false);
      expect(isValidModel("claude-3-opus")).toBe(false);
      expect(isValidModel("haiku")).toBe(false);
      expect(isValidModel("")).toBe(false);
      expect(isValidModel("invalid")).toBe(false);
    });

    it("is case-sensitive", () => {
      expect(isValidModel("Claude-Haiku-4-5")).toBe(false);
      expect(isValidModel("CLAUDE-HAIKU-4-5")).toBe(false);
    });

    it("handles legacy model names", () => {
      // Old model names should not be valid
      expect(isValidModel("claude-3-haiku")).toBe(false);
      expect(isValidModel("claude-3-5-sonnet")).toBe(false);
    });
  });

  describe("extractProviderAndModel", () => {
    it("extracts provider and model from slash-separated format", () => {
      const result = extractProviderAndModel("anthropic/claude-3-opus");

      expect(result).toEqual({
        provider: "anthropic",
        model: "claude-3-opus",
      });
    });

    it("handles multiple slashes (joins remaining parts)", () => {
      const result = extractProviderAndModel("provider/model/version");

      expect(result).toEqual({
        provider: "provider",
        model: "model/version",
      });
    });

    it("defaults to anthropic for models without slash", () => {
      const result = extractProviderAndModel("claude-haiku-4-5");

      expect(result).toEqual({
        provider: "anthropic",
        model: "claude-haiku-4-5",
      });
    });

    it("extracts openai provider from OpenAI models", () => {
      expect(extractProviderAndModel("openai/gpt-5.2")).toEqual({
        provider: "openai",
        model: "gpt-5.2",
      });

      expect(extractProviderAndModel("openai/gpt-5.4")).toEqual({
        provider: "openai",
        model: "gpt-5.4",
      });

      expect(extractProviderAndModel("openai/gpt-5.5")).toEqual({
        provider: "openai",
        model: "gpt-5.5",
      });

      expect(extractProviderAndModel("openai/gpt-5.2-codex")).toEqual({
        provider: "openai",
        model: "gpt-5.2-codex",
      });

      expect(extractProviderAndModel("openai/gpt-5.3-codex")).toEqual({
        provider: "openai",
        model: "gpt-5.3-codex",
      });

      expect(extractProviderAndModel("openai/gpt-5.3-codex-spark")).toEqual({
        provider: "openai",
        model: "gpt-5.3-codex-spark",
      });
    });

    it("extracts GitHub Copilot provider from Copilot-backed models", () => {
      expect(extractProviderAndModel("github-copilot/gpt-5.1")).toEqual({
        provider: "github-copilot",
        model: "gpt-5.1",
      });

      expect(extractProviderAndModel("github-copilot/claude-sonnet-4")).toEqual({
        provider: "github-copilot",
        model: "claude-sonnet-4",
      });
    });

    it("extracts Z.AI Coding Plan provider from GLM models", () => {
      expect(extractProviderAndModel("zai-coding-plan/glm-5.1")).toEqual({
        provider: "zai-coding-plan",
        model: "glm-5.1",
      });

      expect(extractProviderAndModel("zai-coding-plan/glm-5")).toEqual({
        provider: "zai-coding-plan",
        model: "glm-5",
      });

      expect(extractProviderAndModel("zai-coding-plan/glm-4.7")).toEqual({
        provider: "zai-coding-plan",
        model: "glm-4.7",
      });
    });

    it("extracts Fireworks AI provider from Kimi models", () => {
      expect(extractProviderAndModel("fireworks-ai/kimi-k2p5-turbo")).toEqual({
        provider: "fireworks-ai",
        model: "kimi-k2p5-turbo",
      });
    });

    it("extracts OpenCode Go provider from Go models", () => {
      expect(extractProviderAndModel("opencode-go/glm-5.1")).toEqual({
        provider: "opencode-go",
        model: "glm-5.1",
      });

      expect(extractProviderAndModel("opencode-go/mimo-v2-omni")).toEqual({
        provider: "opencode-go",
        model: "mimo-v2-omni",
      });
    });

    it("extracts Ollama Cloud provider from Ollama-backed models", () => {
      expect(extractProviderAndModel("ollama-cloud/glm-5.1")).toEqual({
        provider: "ollama-cloud",
        model: "glm-5.1",
      });

      expect(extractProviderAndModel("ollama-cloud/minimax-m2.7")).toEqual({
        provider: "ollama-cloud",
        model: "minimax-m2.7",
      });
    });

    it("handles all valid model formats", () => {
      expect(extractProviderAndModel("anthropic/claude-haiku-4-5")).toEqual({
        provider: "anthropic",
        model: "claude-haiku-4-5",
      });

      expect(extractProviderAndModel("anthropic/claude-sonnet-4-5")).toEqual({
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      });

      expect(extractProviderAndModel("anthropic/claude-opus-4-5")).toEqual({
        provider: "anthropic",
        model: "claude-opus-4-5",
      });

      expect(extractProviderAndModel("anthropic/claude-opus-4-6")).toEqual({
        provider: "anthropic",
        model: "claude-opus-4-6",
      });
    });

    it("normalizes bare Claude models before extraction", () => {
      expect(extractProviderAndModel("claude-haiku-4-5")).toEqual({
        provider: "anthropic",
        model: "claude-haiku-4-5",
      });

      expect(extractProviderAndModel("claude-sonnet-4-5")).toEqual({
        provider: "anthropic",
        model: "claude-sonnet-4-5",
      });

      expect(extractProviderAndModel("claude-opus-4-5")).toEqual({
        provider: "anthropic",
        model: "claude-opus-4-5",
      });

      expect(extractProviderAndModel("claude-opus-4-6")).toEqual({
        provider: "anthropic",
        model: "claude-opus-4-6",
      });
    });

    it("handles edge cases", () => {
      // Empty string
      expect(extractProviderAndModel("")).toEqual({
        provider: "anthropic",
        model: "",
      });

      // Single slash at start
      expect(extractProviderAndModel("/model")).toEqual({
        provider: "",
        model: "model",
      });

      // Slash at end
      expect(extractProviderAndModel("provider/")).toEqual({
        provider: "provider",
        model: "",
      });
    });
  });

  describe("getValidModelOrDefault", () => {
    it("returns the model if valid", () => {
      expect(getValidModelOrDefault("anthropic/claude-haiku-4-5")).toBe(
        "anthropic/claude-haiku-4-5"
      );
      expect(getValidModelOrDefault("anthropic/claude-sonnet-4-5")).toBe(
        "anthropic/claude-sonnet-4-5"
      );
      expect(getValidModelOrDefault("anthropic/claude-opus-4-5")).toBe("anthropic/claude-opus-4-5");
      expect(getValidModelOrDefault("anthropic/claude-opus-4-6")).toBe("anthropic/claude-opus-4-6");
    });

    it("normalizes bare Claude model names to prefixed format", () => {
      expect(getValidModelOrDefault("claude-haiku-4-5")).toBe("anthropic/claude-haiku-4-5");
      expect(getValidModelOrDefault("claude-sonnet-4-5")).toBe("anthropic/claude-sonnet-4-5");
      expect(getValidModelOrDefault("claude-opus-4-5")).toBe("anthropic/claude-opus-4-5");
      expect(getValidModelOrDefault("claude-opus-4-6")).toBe("anthropic/claude-opus-4-6");
    });

    it("normalizes bare GPT model names to prefixed format", () => {
      expect(getValidModelOrDefault("gpt-5.4")).toBe("openai/gpt-5.4");
      expect(getValidModelOrDefault("gpt-5.5")).toBe("openai/gpt-5.5");
      expect(getValidModelOrDefault("gpt-5.2")).toBe("openai/gpt-5.2");
      expect(getValidModelOrDefault("gpt-5.2-codex")).toBe("openai/gpt-5.2-codex");
    });

    it("returns default for invalid model", () => {
      expect(getValidModelOrDefault("invalid-model")).toBe(DEFAULT_MODEL);
      expect(getValidModelOrDefault("gpt-4")).toBe(DEFAULT_MODEL);
    });

    it("returns default for undefined", () => {
      expect(getValidModelOrDefault(undefined)).toBe(DEFAULT_MODEL);
    });

    it("returns default for null", () => {
      expect(getValidModelOrDefault(null)).toBe(DEFAULT_MODEL);
    });

    it("returns default for empty string", () => {
      expect(getValidModelOrDefault("")).toBe(DEFAULT_MODEL);
    });
  });

  describe("supportsReasoning", () => {
    it("returns true for Claude models with reasoning config", () => {
      expect(supportsReasoning("anthropic/claude-haiku-4-5")).toBe(true);
      expect(supportsReasoning("anthropic/claude-sonnet-4-5")).toBe(true);
      expect(supportsReasoning("anthropic/claude-opus-4-5")).toBe(true);
      expect(supportsReasoning("anthropic/claude-opus-4-6")).toBe(true);
    });

    it("supports bare Claude model names via normalization", () => {
      expect(supportsReasoning("claude-haiku-4-5")).toBe(true);
      expect(supportsReasoning("claude-sonnet-4-5")).toBe(true);
      expect(supportsReasoning("claude-opus-4-5")).toBe(true);
      expect(supportsReasoning("claude-opus-4-6")).toBe(true);
    });

    it("returns true for OpenAI models with reasoning config", () => {
      expect(supportsReasoning("openai/gpt-5.2")).toBe(true);
      expect(supportsReasoning("openai/gpt-5.4")).toBe(true);
      expect(supportsReasoning("openai/gpt-5.5")).toBe(true);
      expect(supportsReasoning("openai/gpt-5.2-codex")).toBe(true);
      expect(supportsReasoning("openai/gpt-5.3-codex")).toBe(true);
      expect(supportsReasoning("openai/gpt-5.3-codex-spark")).toBe(true);
    });

    it("returns true for Copilot GPT models with reasoning config", () => {
      expect(supportsReasoning("github-copilot/gpt-5.1")).toBe(true);
      expect(supportsReasoning("github-copilot/gpt-5.1-codex")).toBe(true);
      expect(supportsReasoning("github-copilot/gpt-5.2")).toBe(true);
      expect(supportsReasoning("github-copilot/gpt-5.2-codex")).toBe(true);
      expect(supportsReasoning("github-copilot/gpt-5.3-codex")).toBe(true);
      expect(supportsReasoning("github-copilot/gpt-5.4")).toBe(true);
    });

    it("returns true for OpenCode Zen models with reasoning config", () => {
      expect(supportsReasoning("opencode/kimi-k2.5")).toBe(true);
      expect(supportsReasoning("opencode/minimax-m2.5")).toBe(true);
      expect(supportsReasoning("opencode/glm-5")).toBe(true);
    });

    it("returns true for OpenCode Go models with reasoning config", () => {
      expect(supportsReasoning("opencode-go/glm-5.1")).toBe(true);
      expect(supportsReasoning("opencode-go/kimi-k2.5")).toBe(true);
      expect(supportsReasoning("opencode-go/kimi-k2.6")).toBe(true);
      expect(supportsReasoning("opencode-go/qwen3.6-plus")).toBe(true);
      expect(supportsReasoning("opencode-go/minimax-m2.7")).toBe(true);
      expect(supportsReasoning("opencode-go/mimo-v2-pro")).toBe(true);
      expect(supportsReasoning("opencode-go/mimo-v2-omni")).toBe(true);
    });

    it("returns true for Ollama Cloud models with reasoning config", () => {
      expect(supportsReasoning("ollama-cloud/glm-5.1")).toBe(true);
      expect(supportsReasoning("ollama-cloud/kimi-k2.5")).toBe(true);
      expect(supportsReasoning("ollama-cloud/minimax-m2.7")).toBe(true);
    });

    it("returns true for MiniMax Coding Plan models with reasoning config", () => {
      expect(supportsReasoning("minimax-coding-plan/MiniMax-M2.7")).toBe(true);
    });

    it("returns false for invalid models", () => {
      expect(supportsReasoning("gpt-4")).toBe(false);
      expect(supportsReasoning("invalid")).toBe(false);
      expect(supportsReasoning("")).toBe(false);
    });
  });

  describe("getDefaultReasoningEffort", () => {
    it("returns expected defaults for Claude models", () => {
      expect(getDefaultReasoningEffort("anthropic/claude-haiku-4-5")).toBe("max");
      expect(getDefaultReasoningEffort("anthropic/claude-sonnet-4-5")).toBe("max");
      expect(getDefaultReasoningEffort("anthropic/claude-opus-4-5")).toBe("max");
      expect(getDefaultReasoningEffort("anthropic/claude-opus-4-6")).toBe("high");
    });

    it("returns expected defaults for bare Claude model names via normalization", () => {
      expect(getDefaultReasoningEffort("claude-haiku-4-5")).toBe("max");
      expect(getDefaultReasoningEffort("claude-sonnet-4-5")).toBe("max");
      expect(getDefaultReasoningEffort("claude-opus-4-5")).toBe("max");
      expect(getDefaultReasoningEffort("claude-opus-4-6")).toBe("high");
    });

    it("returns high for OpenAI codex models", () => {
      expect(getDefaultReasoningEffort("openai/gpt-5.2-codex")).toBe("high");
      expect(getDefaultReasoningEffort("openai/gpt-5.3-codex")).toBe("high");
      expect(getDefaultReasoningEffort("openai/gpt-5.3-codex-spark")).toBe("high");
    });

    it("returns undefined for GPT 5.2, GPT 5.4, and GPT 5.5", () => {
      expect(getDefaultReasoningEffort("openai/gpt-5.2")).toBeUndefined();
      expect(getDefaultReasoningEffort("openai/gpt-5.4")).toBeUndefined();
      expect(getDefaultReasoningEffort("openai/gpt-5.5")).toBeUndefined();
    });

    it("returns undefined for invalid models", () => {
      expect(getDefaultReasoningEffort("gpt-4")).toBeUndefined();
      expect(getDefaultReasoningEffort("invalid")).toBeUndefined();
    });

    it("returns high for OpenCode Zen models", () => {
      expect(getDefaultReasoningEffort("opencode/kimi-k2.5")).toBe("high");
      expect(getDefaultReasoningEffort("opencode/minimax-m2.5")).toBe("high");
      expect(getDefaultReasoningEffort("opencode/glm-5")).toBe("high");
    });

    it("returns high for OpenCode Go models", () => {
      expect(getDefaultReasoningEffort("opencode-go/glm-5.1")).toBe("high");
      expect(getDefaultReasoningEffort("opencode-go/kimi-k2.5")).toBe("high");
      expect(getDefaultReasoningEffort("opencode-go/kimi-k2.6")).toBe("high");
      expect(getDefaultReasoningEffort("opencode-go/qwen3.6-plus")).toBe("high");
      expect(getDefaultReasoningEffort("opencode-go/minimax-m2.7")).toBe("high");
      expect(getDefaultReasoningEffort("opencode-go/mimo-v2-pro")).toBe("high");
      expect(getDefaultReasoningEffort("opencode-go/mimo-v2-omni")).toBe("high");
    });

    it("returns high for Ollama Cloud models", () => {
      expect(getDefaultReasoningEffort("ollama-cloud/glm-5.1")).toBe("high");
      expect(getDefaultReasoningEffort("ollama-cloud/kimi-k2.5")).toBe("high");
      expect(getDefaultReasoningEffort("ollama-cloud/minimax-m2.7")).toBe("high");
    });

    it("returns high for MiniMax Coding Plan models", () => {
      expect(getDefaultReasoningEffort("minimax-coding-plan/MiniMax-M2.7")).toBe("high");
    });
  });

  describe("getReasoningConfig", () => {
    it("returns config for Claude models", () => {
      const config = getReasoningConfig("anthropic/claude-sonnet-4-5");
      expect(config).toEqual({
        efforts: ["high", "max"],
        default: "max",
      });

      const opus46Config = getReasoningConfig("anthropic/claude-opus-4-6");
      expect(opus46Config).toEqual({
        efforts: ["low", "medium", "high", "max"],
        default: "high",
      });
    });

    it("returns config for bare Claude model names via normalization", () => {
      const config = getReasoningConfig("claude-sonnet-4-5");
      expect(config).toEqual({
        efforts: ["high", "max"],
        default: "max",
      });
    });

    it("returns config for OpenAI codex models", () => {
      const config = getReasoningConfig("openai/gpt-5.2-codex");
      expect(config).toEqual({
        efforts: ["low", "medium", "high", "xhigh"],
        default: "high",
      });
    });

    it("returns config for Copilot GPT models", () => {
      expect(getReasoningConfig("github-copilot/gpt-5.4")).toEqual({
        efforts: ["none", "low", "medium", "high", "xhigh"],
        default: undefined,
      });

      expect(getReasoningConfig("github-copilot/gpt-5.3-codex")).toEqual({
        efforts: ["low", "medium", "high", "xhigh"],
        default: "high",
      });
    });

    it("returns config for GPT 5.2 with none effort", () => {
      const config = getReasoningConfig("openai/gpt-5.2");
      expect(config).toEqual({
        efforts: ["none", "low", "medium", "high", "xhigh"],
        default: undefined,
      });
    });

    it("returns config for GPT 5.4 with none effort", () => {
      const config = getReasoningConfig("openai/gpt-5.4");
      expect(config).toEqual({
        efforts: ["none", "low", "medium", "high", "xhigh"],
        default: undefined,
      });
    });

    it("returns config for MiniMax Coding Plan models", () => {
      const config = getReasoningConfig("minimax-coding-plan/MiniMax-M2.7");
      expect(config).toEqual({
        efforts: ["low", "medium", "high", "xhigh"],
        default: "high",
      });
    });

    it("returns config for OpenCode Go models", () => {
      const config = getReasoningConfig("opencode-go/qwen3.6-plus");
      expect(config).toEqual({
        efforts: ["low", "medium", "high", "xhigh"],
        default: "high",
      });
    });

    it("returns config for Ollama Cloud models", () => {
      const config = getReasoningConfig("ollama-cloud/glm-5.1");
      expect(config).toEqual({
        efforts: ["low", "medium", "high", "xhigh"],
        default: "high",
      });
    });

    it("returns config for GPT 5.5 with none effort", () => {
      const config = getReasoningConfig("openai/gpt-5.5");
      expect(config).toEqual({
        efforts: ["none", "low", "medium", "high", "xhigh"],
        default: undefined,
      });
    });

    it("returns undefined for invalid models", () => {
      expect(getReasoningConfig("invalid")).toBeUndefined();
    });
  });

  describe("isValidReasoningEffort", () => {
    it("returns true for valid effort on Claude models", () => {
      expect(isValidReasoningEffort("anthropic/claude-sonnet-4-5", "high")).toBe(true);
      expect(isValidReasoningEffort("anthropic/claude-sonnet-4-5", "max")).toBe(true);
    });

    it("returns false for invalid effort on Claude models", () => {
      expect(isValidReasoningEffort("anthropic/claude-sonnet-4-5", "low")).toBe(false);
      expect(isValidReasoningEffort("anthropic/claude-sonnet-4-5", "medium")).toBe(false);
      expect(isValidReasoningEffort("anthropic/claude-sonnet-4-5", "xhigh")).toBe(false);
      expect(isValidReasoningEffort("anthropic/claude-sonnet-4-5", "none")).toBe(false);
    });

    it("supports adaptive effort levels for Opus 4.6", () => {
      expect(isValidReasoningEffort("anthropic/claude-opus-4-6", "low")).toBe(true);
      expect(isValidReasoningEffort("anthropic/claude-opus-4-6", "medium")).toBe(true);
      expect(isValidReasoningEffort("anthropic/claude-opus-4-6", "high")).toBe(true);
      expect(isValidReasoningEffort("anthropic/claude-opus-4-6", "max")).toBe(true);
      expect(isValidReasoningEffort("anthropic/claude-opus-4-6", "xhigh")).toBe(false);
    });

    it("accepts bare Claude model names via normalization", () => {
      expect(isValidReasoningEffort("claude-sonnet-4-5", "high")).toBe(true);
      expect(isValidReasoningEffort("claude-sonnet-4-5", "max")).toBe(true);
      expect(isValidReasoningEffort("claude-sonnet-4-5", "low")).toBe(false);
    });

    it("returns true for valid effort on OpenAI codex models", () => {
      expect(isValidReasoningEffort("openai/gpt-5.2-codex", "low")).toBe(true);
      expect(isValidReasoningEffort("openai/gpt-5.2-codex", "medium")).toBe(true);
      expect(isValidReasoningEffort("openai/gpt-5.2-codex", "high")).toBe(true);
      expect(isValidReasoningEffort("openai/gpt-5.2-codex", "xhigh")).toBe(true);
    });

    it("returns true for valid effort on Copilot GPT models", () => {
      expect(isValidReasoningEffort("github-copilot/gpt-5.4", "none")).toBe(true);
      expect(isValidReasoningEffort("github-copilot/gpt-5.4", "xhigh")).toBe(true);
      expect(isValidReasoningEffort("github-copilot/gpt-5.3-codex", "low")).toBe(true);
      expect(isValidReasoningEffort("github-copilot/gpt-5.3-codex", "xhigh")).toBe(true);
      expect(isValidReasoningEffort("github-copilot/gpt-5.3-codex", "none")).toBe(false);
    });

    it("returns false for max on OpenAI models (Anthropic-only)", () => {
      expect(isValidReasoningEffort("openai/gpt-5.2-codex", "max")).toBe(false);
      expect(isValidReasoningEffort("openai/gpt-5.3-codex", "max")).toBe(false);
      expect(isValidReasoningEffort("openai/gpt-5.3-codex-spark", "max")).toBe(false);
      expect(isValidReasoningEffort("openai/gpt-5.2", "max")).toBe(false);
      expect(isValidReasoningEffort("openai/gpt-5.4", "max")).toBe(false);
      expect(isValidReasoningEffort("openai/gpt-5.5", "max")).toBe(false);
    });

    it("returns true for none on GPT 5.x baseline models", () => {
      expect(isValidReasoningEffort("openai/gpt-5.2", "none")).toBe(true);
      expect(isValidReasoningEffort("openai/gpt-5.4", "none")).toBe(true);
      expect(isValidReasoningEffort("openai/gpt-5.5", "none")).toBe(true);
      expect(isValidReasoningEffort("openai/gpt-5.2-codex", "none")).toBe(false);
    });

    it("returns true for MiniMax Coding Plan effort levels", () => {
      expect(isValidReasoningEffort("minimax-coding-plan/MiniMax-M2.7", "low")).toBe(true);
      expect(isValidReasoningEffort("minimax-coding-plan/MiniMax-M2.7", "medium")).toBe(true);
      expect(isValidReasoningEffort("minimax-coding-plan/MiniMax-M2.7", "high")).toBe(true);
      expect(isValidReasoningEffort("minimax-coding-plan/MiniMax-M2.7", "xhigh")).toBe(true);
      expect(isValidReasoningEffort("minimax-coding-plan/MiniMax-M2.7", "max")).toBe(false);
    });

    it("returns true for OpenCode Go effort levels", () => {
      expect(isValidReasoningEffort("opencode-go/mimo-v2-omni", "low")).toBe(true);
      expect(isValidReasoningEffort("opencode-go/mimo-v2-omni", "medium")).toBe(true);
      expect(isValidReasoningEffort("opencode-go/mimo-v2-omni", "high")).toBe(true);
      expect(isValidReasoningEffort("opencode-go/mimo-v2-omni", "xhigh")).toBe(true);
      expect(isValidReasoningEffort("opencode-go/mimo-v2-omni", "max")).toBe(false);
    });

    it("returns true for Ollama Cloud effort levels", () => {
      expect(isValidReasoningEffort("ollama-cloud/minimax-m2.7", "low")).toBe(true);
      expect(isValidReasoningEffort("ollama-cloud/minimax-m2.7", "medium")).toBe(true);
      expect(isValidReasoningEffort("ollama-cloud/minimax-m2.7", "high")).toBe(true);
      expect(isValidReasoningEffort("ollama-cloud/minimax-m2.7", "xhigh")).toBe(true);
      expect(isValidReasoningEffort("ollama-cloud/minimax-m2.7", "max")).toBe(false);
    });

    it("returns false for invalid models", () => {
      expect(isValidReasoningEffort("gpt-4", "high")).toBe(false);
      expect(isValidReasoningEffort("invalid", "max")).toBe(false);
    });

    it("returns false for empty effort", () => {
      expect(isValidReasoningEffort("anthropic/claude-sonnet-4-5", "")).toBe(false);
    });
  });

  describe("normalizeModelId", () => {
    it("adds anthropic/ prefix to bare Claude models", () => {
      expect(normalizeModelId("claude-haiku-4-5")).toBe("anthropic/claude-haiku-4-5");
      expect(normalizeModelId("claude-sonnet-4-5")).toBe("anthropic/claude-sonnet-4-5");
      expect(normalizeModelId("claude-opus-4-5")).toBe("anthropic/claude-opus-4-5");
      expect(normalizeModelId("claude-opus-4-6")).toBe("anthropic/claude-opus-4-6");
    });

    it("passes through already-prefixed models unchanged", () => {
      expect(normalizeModelId("anthropic/claude-haiku-4-5")).toBe("anthropic/claude-haiku-4-5");
      expect(normalizeModelId("anthropic/claude-sonnet-4-5")).toBe("anthropic/claude-sonnet-4-5");
      expect(normalizeModelId("anthropic/claude-opus-4-5")).toBe("anthropic/claude-opus-4-5");
      expect(normalizeModelId("anthropic/claude-opus-4-6")).toBe("anthropic/claude-opus-4-6");
    });

    it("passes through OpenAI models unchanged", () => {
      expect(normalizeModelId("openai/gpt-5.2")).toBe("openai/gpt-5.2");
      expect(normalizeModelId("openai/gpt-5.4")).toBe("openai/gpt-5.4");
      expect(normalizeModelId("openai/gpt-5.5")).toBe("openai/gpt-5.5");
      expect(normalizeModelId("openai/gpt-5.2-codex")).toBe("openai/gpt-5.2-codex");
      expect(normalizeModelId("openai/gpt-5.3-codex")).toBe("openai/gpt-5.3-codex");
      expect(normalizeModelId("openai/gpt-5.3-codex-spark")).toBe("openai/gpt-5.3-codex-spark");
    });

    it("adds openai/ prefix to bare GPT models", () => {
      expect(normalizeModelId("gpt-5.4")).toBe("openai/gpt-5.4");
      expect(normalizeModelId("gpt-5.5")).toBe("openai/gpt-5.5");
      expect(normalizeModelId("gpt-5.2")).toBe("openai/gpt-5.2");
      expect(normalizeModelId("gpt-5.2-codex")).toBe("openai/gpt-5.2-codex");
    });

    it("passes through unknown models without prefix", () => {
      expect(normalizeModelId("invalid")).toBe("invalid");
      expect(normalizeModelId("")).toBe("");
    });
  });
});
