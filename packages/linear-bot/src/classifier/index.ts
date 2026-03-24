/**
 * Repository classifier for the Linear bot.
 * Uses raw Anthropic API (no SDK) to classify which repo an issue belongs to.
 */

import type { Env, RepoConfig, ClassificationResult } from "../types";
import {
  extractProviderAndModel,
  isSupportedClassifierModel,
  normalizeModelId,
  type ConfidenceLevel,
} from "@open-inspect/shared";
import { getAvailableRepos, buildRepoDescriptions } from "./repos";
import { createLogger } from "../logger";
import { getClassifierRuntimeConfig } from "./config";

const log = createLogger("classifier");

const CLASSIFY_REPO_TOOL_NAME = "classify_repository";
const GITHUB_MODELS_API_VERSION = "2026-03-10";
const CLASSIFIER_DEBUG_VERSION = "2026-03-24-gpt5-request-shape-debug-2";
const COPILOT_MODEL_MAP: Record<string, string> = {
  "gpt-5-mini": "openai/gpt-5-mini",
};

interface ClassifyToolInput {
  repoId: string | null;
  confidence: ConfidenceLevel;
  reasoning: string;
  alternatives: string[];
}

interface AnthropicContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  text?: string;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
}

interface GitHubModelsResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export function buildGitHubModelsTokenLimit(
  model: string,
  tokenLimit: number
): {
  max_tokens?: number;
  max_completion_tokens?: number;
} {
  if (model.startsWith("openai/gpt-5")) {
    return { max_completion_tokens: tokenLimit };
  }

  return { max_tokens: tokenLimit };
}

export function buildGitHubModelsTemperature(model: string): { temperature?: number } {
  if (model.startsWith("openai/gpt-5")) {
    return {};
  }

  return { temperature: 0 };
}

/**
 * Build classification prompt from Linear issue context.
 */
async function buildClassificationPrompt(
  env: Env,
  issueTitle: string,
  issueDescription: string | null | undefined,
  labels: string[],
  projectName: string | null | undefined,
  traceId?: string
): Promise<string> {
  const repoDescriptions = await buildRepoDescriptions(env, traceId);

  let contextSection = "";
  if (labels.length > 0) contextSection += `\n**Labels**: ${labels.join(", ")}`;
  if (projectName) contextSection += `\n**Project**: ${projectName}`;

  return `You are a repository classifier for a coding agent. Your job is to determine which code repository a Linear issue belongs to.

## Available Repositories
${repoDescriptions}

## Issue
**Title**: ${issueTitle}
${issueDescription ? `**Description**: ${issueDescription}` : ""}
${contextSection}

## Your Task

Analyze the issue to determine which repository it belongs to.

Consider:
1. Explicit mentions of repository names or aliases
2. Technical keywords that match repository technologies
3. File paths or code patterns mentioned
4. Project name associations
5. Label associations

Return your decision by calling the ${CLASSIFY_REPO_TOOL_NAME} tool.`;
}

/**
 * Call Anthropic API directly (no SDK — Workers can't use CJS imports).
 */
async function callAnthropic(apiKey: string, prompt: string): Promise<ClassifyToolInput> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 500,
      temperature: 0,
      tools: [
        {
          name: CLASSIFY_REPO_TOOL_NAME,
          description: "Classify which repository an issue belongs to.",
          input_schema: {
            type: "object" as const,
            properties: {
              repoId: {
                type: ["string", "null"],
                description: "Repository ID (owner/name) if confident, otherwise null.",
              },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
              },
              reasoning: {
                type: "string",
                description: "Brief explanation.",
              },
              alternatives: {
                type: "array",
                items: { type: "string" },
                description: "Alternative repo IDs when not confident.",
              },
            },
            required: ["repoId", "confidence", "reasoning", "alternatives"],
          },
        },
      ],
      tool_choice: { type: "tool", name: CLASSIFY_REPO_TOOL_NAME },
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  const toolBlock = data.content.find(
    (b) => b.type === "tool_use" && b.name === CLASSIFY_REPO_TOOL_NAME
  );

  if (!toolBlock) throw new Error("No tool_use block in Anthropic response");

  const input = toolBlock.input as Record<string, unknown>;
  return {
    repoId: input.repoId === null ? null : typeof input.repoId === "string" ? input.repoId : null,
    confidence: (input.confidence as ConfidenceLevel) || "low",
    reasoning: String(input.reasoning || ""),
    alternatives: Array.isArray(input.alternatives)
      ? input.alternatives.filter((a): a is string => typeof a === "string")
      : [],
  };
}

async function callGitHubModels(
  model: string,
  accessToken: string | null,
  prompt: string,
  traceId?: string
): Promise<ClassifyToolInput> {
  if (!accessToken) {
    throw new Error("GitHub Copilot classifier token is not configured");
  }

  const mappedModel = COPILOT_MODEL_MAP[model];
  if (!mappedModel) {
    throw new Error(`Unsupported GitHub Copilot classifier model: ${model}`);
  }
  const tokenLimit = buildGitHubModelsTokenLimit(mappedModel, 500);
  const tokenLimitParam = Object.keys(tokenLimit)[0] ?? "unknown";
  const temperature = buildGitHubModelsTemperature(mappedModel);
  const temperatureValue = temperature.temperature ?? null;

  log.info("classifier.github_models.request", {
    trace_id: traceId,
    debug_version: CLASSIFIER_DEBUG_VERSION,
    source_model: model,
    mapped_model: mappedModel,
    token_limit_param: tokenLimitParam,
    token_limit_value: tokenLimit.max_completion_tokens ?? tokenLimit.max_tokens ?? null,
    temperature_value: temperatureValue,
  });

  const response = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_MODELS_API_VERSION,
    },
    body: JSON.stringify({
      model: mappedModel,
      ...tokenLimit,
      ...temperature,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "repo_classification",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              repoId: { type: ["string", "null"] },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
              reasoning: { type: "string" },
              alternatives: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["repoId", "confidence", "reasoning", "alternatives"],
          },
        },
      },
      messages: [
        {
          role: "developer",
          content:
            "You are a repository classifier. Return only JSON matching the requested schema.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    log.error("classifier.github_models.response_error", {
      trace_id: traceId,
      debug_version: CLASSIFIER_DEBUG_VERSION,
      source_model: model,
      mapped_model: mappedModel,
      token_limit_param: tokenLimitParam,
      temperature_value: temperatureValue,
      http_status: response.status,
      response_body: errText,
    });
    throw new Error(`GitHub Models API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as GitHubModelsResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("GitHub Models response did not contain structured content");
  }

  const input = JSON.parse(content) as Record<string, unknown>;
  return {
    repoId: input.repoId === null ? null : typeof input.repoId === "string" ? input.repoId : null,
    confidence: (input.confidence as ConfidenceLevel) || "low",
    reasoning: String(input.reasoning || ""),
    alternatives: Array.isArray(input.alternatives)
      ? input.alternatives.filter((a): a is string => typeof a === "string")
      : [],
  };
}

function resolveClassifierModel(
  configuredModel: string | null | undefined,
  preferredModel: string
): string {
  const normalizedConfigured = configuredModel?.trim() ? normalizeModelId(configuredModel) : "";
  const candidate = normalizedConfigured === "" ? preferredModel : normalizedConfigured;
  return isSupportedClassifierModel(candidate) ? candidate : "anthropic/claude-haiku-4-5";
}

/**
 * Classify which repository a Linear issue belongs to.
 */
export async function classifyRepo(
  env: Env,
  issueTitle: string,
  issueDescription: string | null | undefined,
  labels: string[],
  projectName: string | null | undefined,
  configuredModel?: string | null,
  traceId?: string
): Promise<ClassificationResult> {
  const repos = await getAvailableRepos(env, traceId);

  if (repos.length === 0) {
    return {
      repo: null,
      confidence: "low",
      reasoning: "No repositories are currently available.",
      needsClarification: true,
    };
  }

  if (repos.length === 1) {
    return {
      repo: repos[0],
      confidence: "high",
      reasoning: "Only one repository is available.",
      needsClarification: false,
    };
  }

  try {
    const runtimeConfig = await getClassifierRuntimeConfig(env, traceId);
    const prompt = await buildClassificationPrompt(
      env,
      issueTitle,
      issueDescription,
      labels,
      projectName,
      traceId
    );
    const classifierModel = resolveClassifierModel(configuredModel, runtimeConfig.preferredModel);
    const { provider, model } = extractProviderAndModel(classifierModel);

    log.info("classifier.model_selection", {
      trace_id: traceId,
      debug_version: CLASSIFIER_DEBUG_VERSION,
      configured_model: configuredModel ?? null,
      runtime_preferred_model: runtimeConfig.preferredModel,
      resolved_classifier_model: classifierModel,
      provider,
      provider_model: model,
    });

    const result =
      provider === "github-copilot"
        ? await callGitHubModels(model, runtimeConfig.githubCopilotAccessToken, prompt, traceId)
        : await callAnthropic(env.ANTHROPIC_API_KEY || "", prompt);

    let matchedRepo: RepoConfig | null = null;
    if (result.repoId) {
      matchedRepo =
        repos.find(
          (r) =>
            r.id.toLowerCase() === result.repoId!.toLowerCase() ||
            r.fullName.toLowerCase() === result.repoId!.toLowerCase()
        ) || null;
    }

    const alternatives: RepoConfig[] = [];
    for (const altId of result.alternatives) {
      const alt = repos.find(
        (r) =>
          r.id.toLowerCase() === altId.toLowerCase() ||
          r.fullName.toLowerCase() === altId.toLowerCase()
      );
      if (alt && alt.id !== matchedRepo?.id) alternatives.push(alt);
    }

    return {
      repo: matchedRepo,
      confidence: result.confidence,
      reasoning: result.reasoning,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      needsClarification:
        !matchedRepo ||
        result.confidence === "low" ||
        (result.confidence === "medium" && alternatives.length > 0),
    };
  } catch (e) {
    log.error("classifier.classify", {
      trace_id: traceId,
      method: "llm",
      outcome: "error",
      error: e instanceof Error ? e : new Error(String(e)),
    });

    return {
      repo: null,
      confidence: "low",
      reasoning: "Could not classify repository. Please configure project→repo mapping.",
      alternatives: repos.slice(0, 5),
      needsClarification: true,
    };
  }
}
