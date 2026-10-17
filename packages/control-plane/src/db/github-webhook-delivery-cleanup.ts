/**
 * Fork-only: delete expired GitHub webhook dedupe claims.
 *
 * The github-bot claims each delivery in `github_webhook_deliveries` and only
 * overwrites a row when the same delivery id arrives again, so expired rows
 * otherwise accumulate forever. Expiry is already the claim's reclaim
 * boundary, so deleting an expired row cannot let a duplicate through.
 *
 * Each batch inspects only the oldest rows by rowid instead of searching the
 * table for `expires_at`: rows are inserted in delivery order and expire in
 * roughly that order, so the head of the table is where expired rows are.
 * That keeps the cost bounded by the batch size without an `expires_at`
 * index, which would add a write to every webhook. A row a redelivery
 * re-claimed keeps its old rowid and is skipped until it expires.
 */

import type { Logger } from "../logger";
import type { SqlDatabase } from "./sql-database";

/** Oldest rows inspected per batch. */
export const WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE = 500;
/** Batches per run; a run stops early once a batch is not entirely expired. */
export const WEBHOOK_DELIVERY_CLEANUP_MAX_BATCHES = 4;

/** Delete expired delivery claims; returns the number of rows deleted. */
export async function deleteExpiredGithubWebhookDeliveries(
  db: SqlDatabase,
  nowMs: number,
  log: Logger
): Promise<number> {
  let deleted = 0;
  for (let batch = 0; batch < WEBHOOK_DELIVERY_CLEANUP_MAX_BATCHES; batch++) {
    const result = await db
      .prepare(
        `DELETE FROM github_webhook_deliveries
         WHERE expires_at <= ?
           AND rowid IN (
             SELECT rowid FROM github_webhook_deliveries
             ORDER BY rowid
             LIMIT ?
           )`
      )
      .bind(nowMs, WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE)
      .run();
    const changes = result.meta.changes;
    deleted += changes;
    if (changes < WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE) break;
  }
  log.info("github_webhook_delivery_cleanup", {
    event: "github_webhook_delivery_cleanup",
    deleted,
  });
  return deleted;
}
