import {
  DEFAULT_ENABLED_MODELS,
  SUPPORTED_CLASSIFIER_MODELS,
  type SupportedClassifierModel,
} from "@open-inspect/shared";
import { ModelPreferencesStore } from "../db/model-preferences";
import { getGlobalCopilotAccessToken } from "../model-credentials";
import { createLogger } from "../logger";
import type { Env } from "../types";
import { type Route, type RequestContext, parsePattern, json } from "./shared";

const logger = createLogger("router:classifier-config");
const DEFAULT_CLASSIFIER_MODEL: SupportedClassifierModel = "anthropic/claude-haiku-4-5";
const COPILOT_CLASSIFIER_MODEL: SupportedClassifierModel = "github-copilot/gpt-5-mini";

function resolvePreferredClassifierModel(
  enabledModels: readonly string[],
  copilotAccessToken: string | null
): SupportedClassifierModel {
  const copilotEnabled =
    enabledModels.includes(COPILOT_CLASSIFIER_MODEL) && Boolean(copilotAccessToken);
  return copilotEnabled ? COPILOT_CLASSIFIER_MODEL : DEFAULT_CLASSIFIER_MODEL;
}

async function handleGetClassifierConfig(
  _request: Request,
  env: Env,
  _match: RegExpMatchArray,
  ctx: RequestContext
): Promise<Response> {
  let enabledModels = DEFAULT_ENABLED_MODELS as readonly string[];
  if (env.DB) {
    try {
      const store = new ModelPreferencesStore(env.DB);
      enabledModels = (await store.getEnabledModels()) ?? DEFAULT_ENABLED_MODELS;
    } catch (error) {
      logger.warn("Failed to load model preferences for classifier config", {
        error: error instanceof Error ? error.message : String(error),
        request_id: ctx.request_id,
        trace_id: ctx.trace_id,
      });
    }
  }

  let copilotAccessToken: string | null = null;
  try {
    copilotAccessToken = await getGlobalCopilotAccessToken(env);
  } catch (error) {
    logger.warn("Failed to load global Copilot auth for classifier config", {
      error: error instanceof Error ? error.message : String(error),
      request_id: ctx.request_id,
      trace_id: ctx.trace_id,
    });
  }

  return json({
    preferredModel: resolvePreferredClassifierModel(enabledModels, copilotAccessToken),
    supportedModels: SUPPORTED_CLASSIFIER_MODELS,
    githubCopilotAccessToken: copilotAccessToken,
  });
}

export const classifierConfigRoutes: Route[] = [
  {
    method: "GET",
    pattern: parsePattern("/classifier-config"),
    handler: handleGetClassifierConfig,
  },
];
