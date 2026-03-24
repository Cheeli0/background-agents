/**
 * Repository classifier for the Slack bot.
 *
 * Uses an LLM to classify which repository a Slack message refers to,
 * based on message content, thread context, and channel information.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Env, RepoConfig, ThreadContext, ClassificationResult } from "../types";
import {
  extractProviderAndModel,
  isSupportedClassifierModel,
  normalizeModelId,
  type ConfidenceLevel,
} from "@open-inspect/shared";
import { getAvailableRepos, buildRepoDescriptions, getReposByChannel } from "./repos";
import { createLogger } from "../logger";
import { getClassifierRuntimeConfig } from "./config";

const log = createLogger("classifier");
const CLASSIFY_REPO_TOOL_NAME = "classify_repository";
const CONFIDENCE_LEVELS: ClassificationResult["confidence"][] = ["high", "medium", "low"];
const CLASSIFIER_DEBUG_VERSION = "2026-03-24-gpt5-request-shape-debug-1";

const CLASSIFY_REPO_TOOL: Anthropic.Messages.Tool = {
  name: CLASSIFY_REPO_TOOL_NAME,
  description:
    "Classify which repository a Slack message refers to. Use repoId as null when uncertain.",
  input_schema: {
    type: "object",
    properties: {
      repoId: {
        type: ["string", "null"],
        description: "Repository ID/fullName if confident enough to choose one, otherwise null.",
      },
      confidence: {
        type: "string",
        enum: CONFIDENCE_LEVELS,
      },
      reasoning: {
        type: "string",
        description: "Brief explanation of classification decision.",
      },
      alternatives: {
        type: "array",
        items: { type: "string" },
        description: "Alternative repository IDs/fullNames when confidence is not high.",
      },
    },
    required: ["repoId", "confidence", "reasoning", "alternatives"],
    additionalProperties: false,
  },
};

/**
 * Build the classification prompt for the LLM.
 */
async function buildClassificationPrompt(
  env: Env,
  message: string,
  context?: ThreadContext,
  traceId?: string
): Promise<string> {
  const repoDescriptions = await buildRepoDescriptions(env, traceId);

  let contextSection = "";

  if (context) {
    contextSection = `
## Context

**Channel**: ${context.channelName ? `#${context.channelName}` : context.channelId}
${context.channelDescription ? `**Channel Description**: ${context.channelDescription}` : ""}
${context.threadTs ? `**In Thread**: Yes` : "**In Thread**: No"}
${
  context.previousMessages?.length
    ? `**Previous Messages in Thread**:
${context.previousMessages.map((m) => `- ${m}`).join("\n")}`
    : ""
}`;
  }

  return `You are a repository classifier for a coding agent. Your job is to determine which code repository a Slack message is referring to.

## Available Repositories
${repoDescriptions}

${contextSection}

## User's Message
${message}

## Your Task

Analyze the message and context to determine which repository the user is referring to.

Consider:
1. Explicit mentions of repository names or aliases
2. Technical keywords that match repository technologies
3. File paths or code patterns mentioned
4. Channel associations (some channels are associated with specific repos)
5. Context from previous messages in the thread

## Response Format

Return your decision by calling the ${CLASSIFY_REPO_TOOL_NAME} tool with:
- repoId: "owner/name" or null if unclear
- confidence: "high" | "medium" | "low"
- reasoning: brief explanation
- alternatives: other possible repos when confidence is not high`;
}

/**
 * Parse the LLM response into a structured result.
 */
interface LLMResponse {
  repoId: string | null;
  confidence: ConfidenceLevel;
  reasoning: string;
  alternatives: string[];
}

interface GitHubModelsResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

const COPILOT_MODEL_MAP: Record<string, string> = {
  "gpt-5-mini": "openai/gpt-5-mini",
};

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

function normalizeModelResponse(raw: unknown): LLMResponse {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("LLM response was not an object");
  }

  const input = raw as Record<string, unknown>;
  const rawRepoId = input.repoId;
  const repoId =
    rawRepoId === null
      ? null
      : typeof rawRepoId === "string" && rawRepoId.trim().length > 0
        ? rawRepoId.trim()
        : null;

  const rawConfidence = typeof input.confidence === "string" ? input.confidence.trim() : "";
  const confidence = rawConfidence.toLowerCase();
  if (!CONFIDENCE_LEVELS.includes(confidence as ClassificationResult["confidence"])) {
    throw new Error(`Invalid confidence value: ${rawConfidence || String(input.confidence)}`);
  }

  if (typeof input.reasoning !== "string" || input.reasoning.trim().length === 0) {
    throw new Error("Missing reasoning in LLM response");
  }

  if (!Array.isArray(input.alternatives)) {
    throw new Error("Alternatives must be an array");
  }

  const alternatives = input.alternatives
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (alternatives.length !== input.alternatives.length) {
    throw new Error("Invalid alternatives in LLM response");
  }

  return {
    repoId,
    confidence: confidence as ClassificationResult["confidence"],
    reasoning: input.reasoning.trim(),
    alternatives: [...new Set(alternatives)],
  };
}

function extractStructuredResponse(response: Anthropic.Messages.Message): LLMResponse {
  const toolUseBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === "tool_use" && block.name === CLASSIFY_REPO_TOOL_NAME
  );

  if (!toolUseBlock) {
    throw new Error("No structured tool_use classification in LLM response");
  }

  return normalizeModelResponse(toolUseBlock.input);
}

function resolveClassifierModel(envModel: string | undefined, preferredModel: string): string {
  const normalizedEnvModel = envModel?.trim() ? normalizeModelId(envModel.trim()) : "";
  const isLegacyDefault =
    normalizedEnvModel === "" ||
    normalizedEnvModel === "claude-haiku-4-5" ||
    normalizedEnvModel === "anthropic/claude-haiku-4-5";

  const candidate = isLegacyDefault ? preferredModel : normalizedEnvModel;
  return isSupportedClassifierModel(candidate) ? candidate : "anthropic/claude-haiku-4-5";
}

function createAnthropicClient(apiKey: string | undefined): Anthropic {
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }

  return new Anthropic({ apiKey });
}

async function classifyWithGitHubModels(
  model: string,
  accessToken: string | null,
  prompt: string,
  traceId?: string
): Promise<LLMResponse> {
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
      "X-GitHub-Api-Version": "2026-03-10",
    },
    body: JSON.stringify({
      model: mappedModel,
      ...temperature,
      ...tokenLimit,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "repo_classification",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              repoId: {
                type: ["string", "null"],
              },
              confidence: {
                type: "string",
                enum: CONFIDENCE_LEVELS,
              },
              reasoning: {
                type: "string",
              },
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
    const body = await response.text();
    log.error("classifier.github_models.response_error", {
      trace_id: traceId,
      debug_version: CLASSIFIER_DEBUG_VERSION,
      source_model: model,
      mapped_model: mappedModel,
      token_limit_param: tokenLimitParam,
      temperature_value: temperatureValue,
      http_status: response.status,
      response_body: body,
    });
    throw new Error(`GitHub Models API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as GitHubModelsResponse;
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("GitHub Models response did not contain structured content");
  }

  return normalizeModelResponse(JSON.parse(content));
}

/**
 * Repository classifier class.
 */
export class RepoClassifier {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  /**
   * Classify which repository a message refers to.
   */
  async classify(
    message: string,
    context?: ThreadContext,
    traceId?: string
  ): Promise<ClassificationResult> {
    // Fetch available repos dynamically
    const repos = await getAvailableRepos(this.env, traceId);

    // If no repos available, return immediately
    if (repos.length === 0) {
      return {
        repo: null,
        confidence: "low",
        reasoning: "No repositories are currently available.",
        needsClarification: true,
      };
    }

    // If only one repo, skip classification
    if (repos.length === 1) {
      return {
        repo: repos[0],
        confidence: "high",
        reasoning: "Only one repository is available.",
        needsClarification: false,
      };
    }

    // Check for channel-specific repos first
    if (context?.channelId) {
      const channelRepos = await getReposByChannel(this.env, context.channelId, traceId);
      if (channelRepos.length === 1) {
        return {
          repo: channelRepos[0],
          confidence: "high",
          reasoning: `Channel is associated with repository ${channelRepos[0].fullName}`,
          needsClarification: false,
        };
      }
    }

    // Use LLM for classification
    try {
      const prompt = await buildClassificationPrompt(this.env, message, context, traceId);
      const runtimeConfig = await getClassifierRuntimeConfig(this.env, traceId);
      const classifierModel = resolveClassifierModel(
        this.env.CLASSIFICATION_MODEL,
        runtimeConfig.preferredModel
      );
      const { provider, model } = extractProviderAndModel(classifierModel);

      log.info("classifier.model_selection", {
        trace_id: traceId,
        debug_version: CLASSIFIER_DEBUG_VERSION,
        configured_model: this.env.CLASSIFICATION_MODEL ?? null,
        runtime_preferred_model: runtimeConfig.preferredModel,
        resolved_classifier_model: classifierModel,
        provider,
        provider_model: model,
      });

      const llmResult =
        provider === "github-copilot"
          ? await classifyWithGitHubModels(
              model,
              runtimeConfig.githubCopilotAccessToken,
              prompt,
              traceId
            )
          : extractStructuredResponse(
              await createAnthropicClient(this.env.ANTHROPIC_API_KEY).messages.create({
                model,
                max_tokens: 500,
                temperature: 0,
                tools: [CLASSIFY_REPO_TOOL],
                tool_choice: {
                  type: "tool",
                  name: CLASSIFY_REPO_TOOL_NAME,
                  disable_parallel_tool_use: true,
                },
                messages: [
                  {
                    role: "user",
                    content: prompt,
                  },
                ],
              })
            );

      // Find the matched repo
      let matchedRepo: RepoConfig | null = null;
      if (llmResult.repoId) {
        matchedRepo =
          repos.find(
            (r) =>
              r.id.toLowerCase() === llmResult.repoId!.toLowerCase() ||
              r.fullName.toLowerCase() === llmResult.repoId!.toLowerCase()
          ) || null;
      }

      // Find alternative repos
      const alternatives: RepoConfig[] = [];
      for (const altId of llmResult.alternatives) {
        const altRepo = repos.find(
          (r) =>
            r.id.toLowerCase() === altId.toLowerCase() ||
            r.fullName.toLowerCase() === altId.toLowerCase()
        );
        if (altRepo && altRepo.id !== matchedRepo?.id) {
          alternatives.push(altRepo);
        }
      }

      return {
        repo: matchedRepo,
        confidence: llmResult.confidence,
        reasoning: llmResult.reasoning,
        alternatives: alternatives.length > 0 ? alternatives : undefined,
        needsClarification:
          !matchedRepo ||
          llmResult.confidence === "low" ||
          (llmResult.confidence === "medium" && alternatives.length > 0),
      };
    } catch (e) {
      log.error("classifier.classify", {
        trace_id: traceId,
        method: "llm",
        outcome: "error",
        error: e instanceof Error ? e : new Error(String(e)),
        channel_id: context?.channelId,
      });

      return {
        repo: null,
        confidence: "low",
        reasoning:
          "Could not classify repository from structured model output. Please select a repository.",
        alternatives: repos.slice(0, 5),
        needsClarification: true,
      };
    }
  }
}

/**
 * Create a new classifier instance.
 */
export function createClassifier(env: Env): RepoClassifier {
  return new RepoClassifier(env);
}
