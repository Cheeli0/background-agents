import { extractProviderAndModel } from "@open-inspect/shared";
import { GlobalSecretsStore } from "./db/global-secrets";
import { RepoSecretsStore } from "./db/repo-secrets";
import { mergeSecrets } from "./db/secrets-validation";
import type { Env } from "./types";

export const OPENCODE_AUTH_JSON_SECRET = "OPENCODE_AUTH_JSON";

interface RepoSecretContext {
  repoId?: number | null;
  repoOwner: string;
  repoName: string;
}

export function isGitHubCopilotModel(model: string): boolean {
  return extractProviderAndModel(model).provider === "github-copilot";
}

export async function validateModelCredentialsForRepo(
  env: Pick<Env, "DB" | "REPO_SECRETS_ENCRYPTION_KEY">,
  model: string,
  repo: RepoSecretContext
): Promise<string | null> {
  if (!isGitHubCopilotModel(model)) {
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

  const authJson = mergeSecrets(globalSecrets, repoSecrets).merged[OPENCODE_AUTH_JSON_SECRET];
  if (!authJson?.trim()) {
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

  const copilotAuth = (parsed as Record<string, unknown>)["github-copilot"];
  if (!copilotAuth || typeof copilotAuth !== "object" || Array.isArray(copilotAuth)) {
    return (
      "OPENCODE_AUTH_JSON does not contain GitHub Copilot credentials. " +
      "Authenticate OpenCode with GitHub Copilot and store that provider entry."
    );
  }

  return null;
}
