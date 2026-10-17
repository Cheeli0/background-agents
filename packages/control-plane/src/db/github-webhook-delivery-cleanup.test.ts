import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger";
import { createNodeSqlDatabase } from "../node/sqlite-database";
import {
  deleteExpiredGithubWebhookDeliveries,
  WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE,
  WEBHOOK_DELIVERY_CLEANUP_MAX_BATCHES,
} from "./github-webhook-delivery-cleanup";

const MIGRATION = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../terraform/d1/migrations/0080_github_webhook_deliveries.sql"
);

const NOW = 1_000_000;

function setup() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(readFileSync(MIGRATION, "utf8"));
  const insert = raw.prepare(
    `INSERT INTO github_webhook_deliveries (delivery_id, claim_token, status, expires_at)
     VALUES (?, 'claim', 'processed', ?)`
  );
  const remaining = () =>
    (
      raw.prepare("SELECT delivery_id FROM github_webhook_deliveries ORDER BY rowid").all() as {
        delivery_id: string;
      }[]
    ).map((row) => row.delivery_id);
  const log = { info: vi.fn(), warn: vi.fn() } as unknown as Logger;
  return { db: createNodeSqlDatabase(raw), insert, remaining, log };
}

describe("deleteExpiredGithubWebhookDeliveries", () => {
  it("deletes expired claims and keeps live ones", async () => {
    const { db, insert, remaining, log } = setup();
    insert.run("expired-1", NOW - 1);
    insert.run("expired-2", NOW);
    insert.run("live", NOW + 1);

    await expect(deleteExpiredGithubWebhookDeliveries(db, NOW, log)).resolves.toBe(2);
    expect(remaining()).toEqual(["live"]);
  });

  it("drains a backlog in bounded batches", async () => {
    const { db, insert, remaining, log } = setup();
    const cap = WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE * WEBHOOK_DELIVERY_CLEANUP_MAX_BATCHES;
    for (let i = 0; i < cap + 10; i++) insert.run(`expired-${i}`, NOW - 1);

    await expect(deleteExpiredGithubWebhookDeliveries(db, NOW, log)).resolves.toBe(cap);
    expect(remaining()).toHaveLength(10);
    await expect(deleteExpiredGithubWebhookDeliveries(db, NOW, log)).resolves.toBe(10);
  });

  it("only inspects the oldest rows, so a newer expired claim waits", async () => {
    const { db, insert, remaining, log } = setup();
    for (let i = 0; i < WEBHOOK_DELIVERY_CLEANUP_BATCH_SIZE; i++) insert.run(`live-${i}`, NOW + 1);
    insert.run("expired-late", NOW - 1);

    await expect(deleteExpiredGithubWebhookDeliveries(db, NOW, log)).resolves.toBe(0);
    expect(remaining()).toContain("expired-late");
  });
});
