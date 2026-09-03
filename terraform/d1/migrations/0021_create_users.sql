-- Unified user model: canonical user records and cross-provider identity linking.

CREATE TABLE IF NOT EXISTS users (
  id           TEXT    PRIMARY KEY,
  display_name TEXT,
  email        TEXT,
  avatar_url   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email
  ON users(email COLLATE NOCASE) WHERE email IS NOT NULL;

-- Keep provider open-ended so adding an auth or SCM provider does not require a migration.
CREATE TABLE IF NOT EXISTS user_identities (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  provider         TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_login   TEXT,
  provider_email   TEXT,
  created_at       INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_identities_provider
  ON user_identities(provider, provider_user_id);

CREATE INDEX IF NOT EXISTS idx_user_identities_user
  ON user_identities(user_id);

ALTER TABLE sessions ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON sessions(user_id, created_at DESC);

ALTER TABLE user_scm_tokens ADD COLUMN user_id TEXT;

ALTER TABLE automations ADD COLUMN user_id TEXT;
