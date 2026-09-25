CREATE TABLE IF NOT EXISTS mail_connections (
  workspace TEXT NOT NULL, user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('gmail','imap')),
  account TEXT NOT NULL, encrypted_secret TEXT NOT NULL, settings TEXT NOT NULL,
  version INTEGER NOT NULL, last_sync_at TEXT, last_sync_note TEXT, updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace,user_id)
);
CREATE TABLE IF NOT EXISTS mail_oauth_states (
  state_hash TEXT PRIMARY KEY, workspace TEXT NOT NULL, user_id TEXT NOT NULL,
  session_hash TEXT NOT NULL, encrypted_verifier TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mail_oauth_states_expiry ON mail_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS mail_imports (
  workspace TEXT NOT NULL, user_id TEXT NOT NULL, message_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('importing','imported','skipped','failed')),
  case_id TEXT, note TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY(workspace,user_id,message_key)
);
