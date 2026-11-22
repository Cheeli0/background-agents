import { z } from "zod";
import { decryptToken, encryptToken, hashToken } from "../auth/crypto";
import type { SandboxBootstrapRecord, SandboxBootstrapStore } from "../sandbox/bootstrap";
import type { SqlStorage } from "./sql-storage";

const rowSchema = z.object({
  sandbox_id: z.string().min(1),
  env: z.string().min(1),
  expires_at: z.number(),
});

const envSchema = z.record(z.string(), z.string());

export class SandboxBootstrapRepository implements SandboxBootstrapStore {
  constructor(
    private readonly sql: SqlStorage,
    private readonly encryptionKey: string
  ) {}

  async put(record: SandboxBootstrapRecord, token: string, expiresAtMs: number): Promise<void> {
    const tokenHash = await hashToken(token);
    const env = await encryptToken(JSON.stringify(record.env), this.encryptionKey);
    this.sql.exec(
      `INSERT INTO sandbox_bootstrap (singleton, sandbox_id, token_hash, env, expires_at)
       VALUES (1, ?, ?, ?, ?)
       ON CONFLICT (singleton) DO UPDATE SET
         sandbox_id = excluded.sandbox_id,
         token_hash = excluded.token_hash,
         env = excluded.env,
         expires_at = excluded.expires_at`,
      record.sandboxId,
      tokenHash,
      env,
      expiresAtMs
    );
  }

  async consume(token: string, nowMs: number): Promise<SandboxBootstrapRecord | null> {
    const tokenHash = await hashToken(token);
    // Read and delete with no await between them: the session runtime is
    // single-threaded, so a second redemption cannot interleave.
    const raw = this.sql
      .exec(
        `SELECT sandbox_id, env, expires_at FROM sandbox_bootstrap WHERE token_hash = ?`,
        tokenHash
      )
      .toArray()[0];
    if (raw === undefined) return null;
    this.sql.exec(`DELETE FROM sandbox_bootstrap WHERE token_hash = ?`, tokenHash);

    const row = rowSchema.parse(raw);
    if (nowMs >= row.expires_at) return null;
    const env = envSchema.parse(JSON.parse(await decryptToken(row.env, this.encryptionKey)));
    return { sandboxId: row.sandbox_id, env };
  }
}
