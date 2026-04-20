/**
 * Pure functions for resolving models and repos from configuration + labels.
 */

import type { TeamRepoMapping, StaticRepoConfig } from "./types";
import {
  extractProviderAndModel,
  isValidModel,
  normalizeModelId,
  type ValidModel,
  getDefaultReasoningEffort,
  getValidModelOrDefault,
  isValidReasoningEffort,
  VALID_MODELS,
} from "@open-inspect/shared";

/**
 * Resolve repo from static team mapping (legacy/override).
 */
export function resolveStaticRepo(
  teamMapping: TeamRepoMapping,
  teamId: string,
  issueLabels?: string[]
): StaticRepoConfig | null {
  const repoConfigs = teamMapping[teamId];
  if (!repoConfigs || repoConfigs.length === 0) return null;

  const labelSet = new Set((issueLabels || []).map((l) => l.toLowerCase()));
  return (
    repoConfigs.find((r) => r.label && labelSet.has(r.label.toLowerCase())) ||
    repoConfigs.find((r) => !r.label) ||
    null
  );
}

const MODEL_LABEL_MAP: Record<string, string> = {
  "glm-5.1": "zai-coding-plan/glm-5.1",
  haiku: "anthropic/claude-haiku-4-5",
  sonnet: "anthropic/claude-sonnet-4-5",
  opus: "anthropic/claude-opus-4-5",
  "opus-4-6": "anthropic/claude-opus-4-6",
  "gpt-5.2": "openai/gpt-5.2",
  "gpt-5.4": "openai/gpt-5.4",
  "gpt-5.2-codex": "openai/gpt-5.2-codex",
  "gpt-5.3-codex": "openai/gpt-5.3-codex",
  "glm-5": "zai-coding-plan/glm-5",
  "glm-5-turbo": "zai-coding-plan/glm-5-turbo",
  "glm-4.7": "zai-coding-plan/glm-4.7",
  "glm-4.5-air": "zai-coding-plan/glm-4.5-air",
  "minimax-m2.7": "minimax-coding-plan/MiniMax-M2.7",
  "kimi-k2p5-turbo": "fireworks-ai/kimi-k2p5-turbo",
  "kimi-k2.6": "opencode-go/kimi-k2.6",
  "qwen3.6-plus": "opencode-go/qwen3.6-plus",
  "mimo-v2-pro": "opencode-go/mimo-v2-pro",
  "mimo-v2-omni": "opencode-go/mimo-v2-omni",
};

const PROVIDER_LABEL_DEFAULT_MODEL: Record<string, ValidModel> = {
  anthropic: "anthropic/claude-sonnet-4-6",
  openai: "openai/gpt-5.4",
  "github-copilot": "github-copilot/claude-sonnet-4-6",
  "zai-coding-plan": "zai-coding-plan/glm-5.1",
  zai: "zai-coding-plan/glm-5.1",
  "minimax-coding-plan": "minimax-coding-plan/MiniMax-M2.7",
  minimax: "minimax-coding-plan/MiniMax-M2.7",
  opencode: "opencode/kimi-k2.5",
  "opencode-go": "opencode-go/glm-5.1",
  "ollama-cloud": "ollama-cloud/glm-5.1",
  "fireworks-ai": "fireworks-ai/kimi-k2p5-turbo",
};

const PROVIDER_LABEL_ALIASES: Record<string, string> = {
  "z.ai": "zai-coding-plan",
  "opencode go": "opencode-go",
  opencode_go: "opencode-go",
  "ollama cloud": "ollama-cloud",
  ollama_cloud: "ollama-cloud",
};

function extractLabelValue(labels: Array<{ name: string }>, prefix: string): string | null {
  for (const label of labels) {
    const match = label.name.match(new RegExp(`^${prefix}:(.+)$`, "i"));
    if (match) {
      return match[1].trim().toLowerCase();
    }
  }

  return null;
}

function normalizeProviderLabel(providerLabel: string | null): string | null {
  if (!providerLabel) return null;
  return PROVIDER_LABEL_ALIASES[providerLabel] ?? providerLabel;
}

function resolveProviderQualifiedModel(provider: string, model: string): string | null {
  const candidate = `${provider}/${model}`;
  if (!isValidModel(candidate)) {
    return null;
  }

  return getValidModelOrDefault(candidate);
}

function resolveModelLabel(modelLabel: string, providerLabel: string | null): string | null {
  if (providerLabel) {
    const providerQualifiedModel = resolveProviderQualifiedModel(providerLabel, modelLabel);
    if (providerQualifiedModel) {
      return providerQualifiedModel;
    }
  }

  const mappedModel = MODEL_LABEL_MAP[modelLabel];
  if (mappedModel) {
    if (providerLabel) {
      const { model } = extractProviderAndModel(mappedModel);
      const providerQualifiedModel = resolveProviderQualifiedModel(providerLabel, model);
      if (providerQualifiedModel) {
        return providerQualifiedModel;
      }
    }

    return mappedModel;
  }

  if (providerLabel) {
    const providerQualifiedModel = resolveProviderQualifiedModel(providerLabel, modelLabel);
    if (providerQualifiedModel) {
      return providerQualifiedModel;
    }
  }

  if (isValidModel(modelLabel)) {
    const normalizedModel = getValidModelOrDefault(normalizeModelId(modelLabel));
    if (providerLabel) {
      const { model } = extractProviderAndModel(normalizedModel);
      const providerQualifiedModel = resolveProviderQualifiedModel(providerLabel, model);
      if (providerQualifiedModel) {
        return providerQualifiedModel;
      }
    }

    return normalizedModel;
  }

  const suffixMatches = VALID_MODELS.filter((candidate) => candidate.endsWith(`/${modelLabel}`));
  if (providerLabel) {
    const providerMatch = suffixMatches.find((candidate) =>
      candidate.startsWith(`${providerLabel}/`)
    );
    if (providerMatch) {
      return providerMatch;
    }
  }

  if (suffixMatches.length === 1) {
    return suffixMatches[0];
  }

  return null;
}

function resolveProviderOnlyLabel(providerLabel: string, baseModel?: string): string | null {
  if (baseModel && isValidModel(baseModel)) {
    const normalizedBaseModel = getValidModelOrDefault(baseModel);
    const { model } = extractProviderAndModel(normalizedBaseModel);
    const providerQualifiedModel = resolveProviderQualifiedModel(providerLabel, model);
    if (providerQualifiedModel) {
      return providerQualifiedModel;
    }
  }

  return PROVIDER_LABEL_DEFAULT_MODEL[providerLabel] ?? null;
}

/**
 * Extract model override from issue labels (e.g., "model:opus" → "anthropic/claude-opus-4-5").
 */
export function extractModelFromLabels(
  labels: Array<{ name: string }>,
  baseModel?: string
): string | null {
  const providerLabel = normalizeProviderLabel(extractLabelValue(labels, "provider"));
  const modelLabel = extractLabelValue(labels, "model");

  if (modelLabel) {
    return resolveModelLabel(modelLabel, providerLabel);
  }

  if (providerLabel) {
    return resolveProviderOnlyLabel(providerLabel, baseModel);
  }

  return null;
}

export interface ResolveSessionModelInput {
  envDefaultModel: string;
  configModel: string | null;
  configReasoningEffort: string | null;
  allowUserPreferenceOverride: boolean;
  allowLabelModelOverride: boolean;
  userModel?: string;
  userReasoningEffort?: string;
  labelModel?: string | null;
}

export function resolveSessionModelSettings(input: ResolveSessionModelInput): {
  model: string;
  reasoningEffort: string | undefined;
} {
  let model = input.configModel ?? input.envDefaultModel;
  let modelSource: "config" | "env" | "user" | "label" = input.configModel ? "config" : "env";

  if (input.allowUserPreferenceOverride && input.userModel) {
    model = input.userModel;
    modelSource = "user";
  }

  if (input.allowLabelModelOverride && input.labelModel) {
    model = input.labelModel;
    modelSource = "label";
  }

  const normalizedModel = getValidModelOrDefault(model);

  if (
    input.allowUserPreferenceOverride &&
    input.userReasoningEffort &&
    isValidReasoningEffort(normalizedModel, input.userReasoningEffort)
  ) {
    return { model: normalizedModel, reasoningEffort: input.userReasoningEffort };
  }

  if (
    modelSource !== "user" &&
    modelSource !== "label" &&
    input.configReasoningEffort &&
    isValidReasoningEffort(normalizedModel, input.configReasoningEffort)
  ) {
    return { model: normalizedModel, reasoningEffort: input.configReasoningEffort };
  }

  return { model: normalizedModel, reasoningEffort: getDefaultReasoningEffort(normalizedModel) };
}
