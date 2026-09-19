CREATE TABLE github_webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed')),
  expires_at INTEGER NOT NULL
);
