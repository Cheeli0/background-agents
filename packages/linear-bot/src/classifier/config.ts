import { generateInternalToken } from "../utils/internal";
import type { Env } from "../types";

export interface ClassifierRuntimeConfig {
  preferredModel: string;
  githubCopilotAccessToken: string | null;
}

const DEFAULT_CONFIG: ClassifierRuntimeConfig = {
  preferredModel: "anthropic/claude-haiku-4-5",
  githubCopilotAccessToken: null,
};

let cachedConfig: { value: ClassifierRuntimeConfig; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60 * 1000;

export async function getClassifierRuntimeConfig(
  env: Env,
  traceId?: string
): Promise<ClassifierRuntimeConfig> {
  if (cachedConfig && Date.now() < cachedConfig.expiresAt) {
    return cachedConfig.value;
  }

  if (!env.INTERNAL_CALLBACK_SECRET) {
    return DEFAULT_CONFIG;
  }

  try {
    const token = await generateInternalToken(env.INTERNAL_CALLBACK_SECRET);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (traceId) {
      headers["x-trace-id"] = traceId;
    }

    const response = await env.CONTROL_PLANE.fetch("https://internal/classifier-config", {
      headers,
    });
    if (!response.ok) {
      return DEFAULT_CONFIG;
    }

    const data = (await response.json()) as Partial<ClassifierRuntimeConfig>;
    const value: ClassifierRuntimeConfig = {
      preferredModel:
        typeof data.preferredModel === "string" && data.preferredModel.length > 0
          ? data.preferredModel
          : DEFAULT_CONFIG.preferredModel,
      githubCopilotAccessToken:
        typeof data.githubCopilotAccessToken === "string" &&
        data.githubCopilotAccessToken.length > 0
          ? data.githubCopilotAccessToken
          : null,
    };

    cachedConfig = {
      value,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    return value;
  } catch {
    return DEFAULT_CONFIG;
  }
}
