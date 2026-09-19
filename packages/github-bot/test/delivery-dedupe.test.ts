import { describe, expect, it, vi } from "vitest";

import { DeliveryDedupe } from "../src/delivery-dedupe";

function createDatabase(firstResult: unknown = null) {
  const first = vi.fn(async () => firstResult);
  const run = vi.fn(async () => ({ success: true }));
  const bind = vi.fn(() => ({ first, run }));
  const prepare = vi.fn(() => ({ bind }));

  return {
    database: { prepare } as unknown as D1Database,
    prepare,
    bind,
    first,
    run,
  };
}

describe("DeliveryDedupe", () => {
  const nowMs = 1_800_000_000_000;

  it("atomically claims a new or expired delivery", async () => {
    const db = createDatabase({ delivery_id: "delivery-1" });
    const dedupe = new DeliveryDedupe(db.database, () => nowMs);

    await expect(dedupe.claim("delivery-1", "claim-1")).resolves.toBe("claimed");

    const sql = db.prepare.mock.calls[0]?.[0] as string;
    expect(sql).toContain("ON CONFLICT(delivery_id) DO UPDATE");
    expect(sql).toContain("WHERE github_webhook_deliveries.expires_at <= ?4");
    expect(sql).toContain("RETURNING delivery_id");
    expect(db.bind).toHaveBeenCalledWith("delivery-1", "claim-1", nowMs + 5 * 60_000, nowMs);
  });

  it("reports an unexpired delivery as a duplicate", async () => {
    const db = createDatabase(null);
    const dedupe = new DeliveryDedupe(db.database, () => nowMs);

    await expect(dedupe.claim("delivery-1", "claim-2")).resolves.toBe("duplicate");
  });

  it("marks only the matching claim as processed for seven days", async () => {
    const db = createDatabase();
    const dedupe = new DeliveryDedupe(db.database, () => nowMs);

    await dedupe.markProcessed("delivery-1", "claim-1");

    const sql = db.prepare.mock.calls[0]?.[0] as string;
    expect(sql).toContain("status = 'processed'");
    expect(sql).toContain("claim_token = ?3");
    expect(db.bind).toHaveBeenCalledWith(nowMs + 7 * 24 * 60 * 60_000, "delivery-1", "claim-1");
    expect(db.run).toHaveBeenCalledOnce();
  });

  it("releases only the matching failed claim", async () => {
    const db = createDatabase();
    const dedupe = new DeliveryDedupe(db.database, () => nowMs);

    await dedupe.release("delivery-1", "claim-1");

    const sql = db.prepare.mock.calls[0]?.[0] as string;
    expect(sql).toContain("DELETE FROM github_webhook_deliveries");
    expect(sql).toContain("claim_token = ?2");
    expect(db.bind).toHaveBeenCalledWith("delivery-1", "claim-1");
    expect(db.run).toHaveBeenCalledOnce();
  });
});
