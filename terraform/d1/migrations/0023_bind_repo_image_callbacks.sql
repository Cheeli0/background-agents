-- Fork compatibility bridge. Versions 0021 and 0022 already belong to deployed fork migrations.
CREATE INDEX IF NOT EXISTS idx_sessions_user_updated_at
  ON sessions(user_id, updated_at DESC);

ALTER TABLE repo_images ADD COLUMN provider TEXT NOT NULL DEFAULT 'modal';

CREATE INDEX IF NOT EXISTS idx_repo_images_repo_provider_status
  ON repo_images(repo_owner, repo_name, provider, status, created_at DESC);

ALTER TABLE repo_images ADD COLUMN provider_session_id TEXT;
ALTER TABLE repo_images ADD COLUMN callback_token_hash TEXT;
ALTER TABLE repo_images ADD COLUMN callback_token_expires_at INTEGER;
ALTER TABLE repo_images ADD COLUMN callback_token_used_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_repo_images_callback_build
  ON repo_images(id, provider, status, callback_token_hash, callback_token_used_at);
