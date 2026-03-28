import { extractProviderAndModel } from "@open-inspect/shared";
import { GlobalSecretsStore } from "./db/global-secrets";
import { RepoSecretsStore } from "./db/repo-secrets";
import { mergeSecrets } from "./db/secrets-validation";
import type { Env } from "./types";

export const OPENCODE_AUTH_JSON_SECRET = "OPENCODE_AUTH_JSON";
export const ZAI_API_KEY_SECRET = "ZAI_API_KEY";
export const FIREWORKS_API_KEY_SECRET = "FIREWORKS_API_KEY";
const COPILOT_ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1000;
const ZAI_PROVIDER_IDS = ["zai-coding-plan", "zai"] as const;
const FIREWORKS_PROVIDER_IDS = ["fireworks-ai", "fireworks"] as const;

interface RepoSecretContext {
  repoId?: number | null;
  repoOwner: string;
  repoName: string;
}

export function isGitHubCopilotModel(model: string): boolean {
  return extractProviderAndModel(model).provider === "github-copilot";
}

export function isZaiCodingPlanModel(model: string): boolean {
  return extractProviderAndModel(model).provider === "zai-coding-plan";
}

export function isFireworksAiModel(model: string): boolean {
  return extractProviderAndModel(model).provider === "fireworks-ai";
}

function isApiKeyEntry(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getZaiAuthEntry(authObject: Record<string, unknown>): Record<string, unknown> | null {
  for (const providerId of ZAI_PROVIDER_IDS) {
    const entry = authObject[providerId];
    if (isApiKeyEntry(entry)) {
      return entry;
    }
  }

  if (
    ("type" in authObject || "key" in authObject) &&
    !("openai" in authObject) &&
    !("anthropic" in authObject) &&
    !("github-copilot" in authObject) &&
    !("copilot" in authObject)
  ) {
    return authObject;
  }

  return null;
}

function getFireworksAuthEntry(
  authObject: Record<string, unknown>
): Record<string, unknown> | null {
  for (const providerId of FIREWORKS_PROVIDER_IDS) {
    const entry = authObject[providerId];
    if (isApiKeyEntry(entry)) {
      return entry;
    }
  }

  if (
    ("type" in authObject || "key" in authObject) &&
    !("openai" in authObject) &&
    !("anthropic" in authObject) &&
    !("github-copilot" in authObject) &&
    !("copilot" in authObject) &&
    !("zai-coding-plan" in authObject) &&
    !("zai" in authObject)
  ) {
    return authObject;
  }

  return null;
}

function hasCopilotAuthEntry(authObject: Record<string, unknown>): boolean {
  const directEntry = authObject["github-copilot"] ?? authObject["copilot"];
  if (directEntry && typeof directEntry === "object" && !Array.isArray(directEntry)) {
    return true;
  }

  // Accept a provider entry pasted directly instead of a full auth.json object.
  return (
    ("type" in authObject || "access" in authObject || "refresh" in authObject) &&
    !("openai" in authObject) &&
    !("anthropic" in authObject)
  );
}

function getCopilotAuthEntry(authObject: Record<string, unknown>): Record<string, unknown> | null {
  const directEntry = authObject["github-copilot"] ?? authObject["copilot"];
  if (directEntry && typeof directEntry === "object" && !Array.isArray(directEntry)) {
    return directEntry as Record<string, unknown>;
  }

  if (
    ("type" in authObject || "access" in authObject || "refresh" in authObject) &&
    !("openai" in authObject) &&
    !("anthropic" in authObject)
  ) {
    return authObject;
  }

  return null;
}

export function extractCopilotAccessTokenFromAuthJson(authJson: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }

  const authObject = parsed as Record<string, unknown>;
  const entry = getCopilotAuthEntry(authObject);
  if (!entry) {
    return null;
  }

  const access = entry.access;
  const expires = entry.expires;
  if (typeof access !== "string" || access.trim().length === 0) {
    return null;
  }

  if (typeof expires !== "number" || !Number.isFinite(expires)) {
    return null;
  }

  // OpenCode may persist 0 here for provider-managed OAuth sessions. Treat that
  // as "no trusted expiry provided" rather than rejecting an otherwise usable token.
  if (expires === 0) {
    return access.trim();
  }

  const normalizedExpiresAt = expires > 0 && expires < 1_000_000_000_000 ? expires * 1000 : expires;
  if (normalizedExpiresAt <= Date.now() + COPILOT_ACCESS_TOKEN_EXPIRY_BUFFER_MS) {
    return null;
  }

  return access.trim();
}

export async function getGlobalCopilotAccessToken(
  env: Pick<Env, "DB" | "REPO_SECRETS_ENCRYPTION_KEY">
): Promise<string | null> {
  if (!env.DB || !env.REPO_SECRETS_ENCRYPTION_KEY) {
    return null;
  }

  const globalStore = new GlobalSecretsStore(env.DB, env.REPO_SECRETS_ENCRYPTION_KEY);
  const globalSecrets = await globalStore.getDecryptedSecrets();
  const authJson = globalSecrets[OPENCODE_AUTH_JSON_SECRET];
  if (!authJson?.trim()) {
    return null;
  }

  return extractCopilotAccessTokenFromAuthJson(authJson);
}

export async function validateModelCredentialsForRepo(
  env: Pick<Env, "DB" | "REPO_SECRETS_ENCRYPTION_KEY">,
  model: string,
  repo: RepoSecretContext
): Promise<string | null> {
  const requiresCopilotCredentials = isGitHubCopilotModel(model);
  const requiresZaiCredentials = isZaiCodingPlanModel(model);
  const requiresFireworksCredentials = isFireworksAiModel(model);

  if (!requiresCopilotCredentials && !requiresZaiCredentials && !requiresFireworksCredentials) {
    return null;
  }

  if (!env.DB || !env.REPO_SECRETS_ENCRYPTION_KEY) {
    return "GitHub Copilot models require secrets storage to be configured.";
  }

  const globalStore = new GlobalSecretsStore(env.DB, env.REPO_SECRETS_ENCRYPTION_KEY);
  const globalSecrets = await globalStore.getDecryptedSecrets();

  let repoSecrets: Record<string, string> = {};
  if (repo.repoId) {
    const repoStore = new RepoSecretsStore(env.DB, env.REPO_SECRETS_ENCRYPTION_KEY);
    repoSecrets = await repoStore.getDecryptedSecrets(repo.repoId);
  }

  const mergedSecrets = mergeSecrets(globalSecrets, repoSecrets).merged;
  const authJson = mergedSecrets[OPENCODE_AUTH_JSON_SECRET];
  const zaiApiKey = mergedSecrets[ZAI_API_KEY_SECRET];
  const fireworksApiKey = mergedSecrets[FIREWORKS_API_KEY_SECRET];
  if (!authJson?.trim()) {
    if (requiresZaiCredentials) {
      if (zaiApiKey?.trim()) {
        return null;
      }

      return (
        "Z.AI credentials are not configured. " +
        `Add ${ZAI_API_KEY_SECRET} or ${OPENCODE_AUTH_JSON_SECRET} as a repo or global secret.`
      );
    }

    if (requiresFireworksCredentials) {
      if (fireworksApiKey?.trim()) {
        return null;
      }

      return (
        "Fireworks AI credentials are not configured. " +
        `Add ${FIREWORKS_API_KEY_SECRET} or ${OPENCODE_AUTH_JSON_SECRET} as a repo or global secret.`
      );
    }

    return (
      "GitHub Copilot credentials are not configured. " +
      "Add OPENCODE_AUTH_JSON as a repo or global secret."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    return "OPENCODE_AUTH_JSON must be valid JSON.";
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "OPENCODE_AUTH_JSON must be a JSON object.";
  }

  const authObject = parsed as Record<string, unknown>;
  if (requiresCopilotCredentials && !hasCopilotAuthEntry(authObject)) {
    return (
      "OPENCODE_AUTH_JSON does not contain GitHub Copilot credentials. " +
      "Store either the full auth object with a github-copilot/copilot entry " +
      "or the provider entry itself."
    );
  }

  if (requiresZaiCredentials) {
    if (zaiApiKey?.trim()) {
      return null;
    }

    const entry = getZaiAuthEntry(authObject);
    if (!entry) {
      return (
        "OPENCODE_AUTH_JSON does not contain Z.AI credentials. " +
        `Store either a zai/zai-coding-plan entry or the provider entry itself, or use ${ZAI_API_KEY_SECRET}.`
      );
    }

    if (entry.type !== "api") {
      return "Z.AI credentials in OPENCODE_AUTH_JSON must use type 'api'.";
    }

    if (typeof entry.key !== "string" || entry.key.trim().length === 0) {
      return "Z.AI credentials in OPENCODE_AUTH_JSON must include a non-empty key.";
    }
  }

  if (requiresFireworksCredentials) {
    if (fireworksApiKey?.trim()) {
      return null;
    }

    const entry = getFireworksAuthEntry(authObject);
    if (!entry) {
      return (
        "OPENCODE_AUTH_JSON does not contain Fireworks AI credentials. " +
        `Store either a fireworks/fireworks-ai entry or the provider entry itself, or use ${FIREWORKS_API_KEY_SECRET}.`
      );
    }

    if (entry.type !== "api") {
      return "Fireworks AI credentials in OPENCODE_AUTH_JSON must use type 'api'.";
    }

    if (typeof entry.key !== "string" || entry.key.trim().length === 0) {
      return "Fireworks AI credentials in OPENCODE_AUTH_JSON must include a non-empty key.";
    }
  }

  return null;
}
