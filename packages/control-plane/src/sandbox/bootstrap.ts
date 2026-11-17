export const SANDBOX_BOOTSTRAP_TOKEN_TTL_MS = 15 * 60 * 1000;

const SANDBOX_BOOTSTRAP_TOKEN_BYTES = 32;

export interface SandboxBootstrapRecord {
  sandboxId: string;
  env: Record<string, string>;
}

export interface SandboxBootstrapStore {
  /** Replaces any bootstrap stored before it. */
  put(record: SandboxBootstrapRecord, token: string, expiresAtMs: number): Promise<void>;
  /** Removes the matching record whether or not it has expired. */
  consume(token: string, nowMs: number): Promise<SandboxBootstrapRecord | null>;
}

export function generateSandboxBootstrapToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SANDBOX_BOOTSTRAP_TOKEN_BYTES));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
