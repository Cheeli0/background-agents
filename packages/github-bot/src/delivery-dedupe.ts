const PROCESSING_TTL_MS = 5 * 60_000;
const PROCESSED_TTL_MS = 7 * 24 * 60 * 60_000;

export type DeliveryClaimResult = "claimed" | "duplicate";

export class DeliveryDedupe {
  constructor(
    private readonly database: D1Database,
    private readonly now: () => number = Date.now
  ) {}

  async claim(deliveryId: string, claimToken: string): Promise<DeliveryClaimResult> {
    const now = this.now();
    const claimed = await this.database
      .prepare(
        `INSERT INTO github_webhook_deliveries (
           delivery_id,
           claim_token,
           status,
           expires_at
         ) VALUES (?1, ?2, 'processing', ?3)
         ON CONFLICT(delivery_id) DO UPDATE SET
           claim_token = excluded.claim_token,
           status = excluded.status,
           expires_at = excluded.expires_at
         WHERE github_webhook_deliveries.expires_at <= ?4
         RETURNING delivery_id`
      )
      .bind(deliveryId, claimToken, now + PROCESSING_TTL_MS, now)
      .first<{ delivery_id: string }>();

    return claimed === null ? "duplicate" : "claimed";
  }

  async markProcessed(deliveryId: string, claimToken: string): Promise<void> {
    await this.database
      .prepare(
        `UPDATE github_webhook_deliveries
         SET status = 'processed', expires_at = ?1
         WHERE delivery_id = ?2 AND claim_token = ?3`
      )
      .bind(this.now() + PROCESSED_TTL_MS, deliveryId, claimToken)
      .run();
  }

  async release(deliveryId: string, claimToken: string): Promise<void> {
    await this.database
      .prepare(
        `DELETE FROM github_webhook_deliveries
         WHERE delivery_id = ?1 AND claim_token = ?2`
      )
      .bind(deliveryId, claimToken)
      .run();
  }
}
