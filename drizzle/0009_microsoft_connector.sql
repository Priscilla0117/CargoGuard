CREATE TABLE IF NOT EXISTS microsoft_connections (
  workspace TEXT NOT NULL, user_id TEXT NOT NULL, version INTEGER NOT NULL,
  graph_user_id TEXT NOT NULL, account_label TEXT NOT NULL, encrypted_tokens TEXT NOT NULL,
  updated_at TEXT NOT NULL, PRIMARY KEY(workspace,user_id)
);
CREATE TABLE IF NOT EXISTS microsoft_oauth_states (
  state_hash TEXT PRIMARY KEY, workspace TEXT NOT NULL, user_id TEXT NOT NULL,
  session_hash TEXT NOT NULL, encrypted_verifier TEXT NOT NULL, expires_at TEXT NOT NULL, used_at TEXT
);
CREATE TABLE IF NOT EXISTS microsoft_dispatches (
  workspace TEXT NOT NULL, id TEXT NOT NULL, user_id TEXT NOT NULL,
  dedupe_key TEXT NOT NULL, shipment_id TEXT NOT NULL, shipment_version INTEGER NOT NULL,
  task_id TEXT NOT NULL, case_id TEXT NOT NULL, case_version INTEGER NOT NULL,
  task_updated_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('creating','draft','sending','submitted','unknown','failed')),
  graph_id TEXT, payload TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace,id), UNIQUE(workspace,user_id,dedupe_key)
);
CREATE TABLE IF NOT EXISTS microsoft_imports (
  workspace TEXT NOT NULL, user_id TEXT NOT NULL, message_key TEXT NOT NULL,
  status TEXT NOT NULL, case_id TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY(workspace,user_id,message_key)
);
CREATE TABLE IF NOT EXISTS microsoft_audit (
  id TEXT PRIMARY KEY, workspace TEXT NOT NULL, user_id TEXT NOT NULL,
  action TEXT NOT NULL, operation_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS microsoft_audit_no_update BEFORE UPDATE ON microsoft_audit BEGIN SELECT RAISE(ABORT,'Microsoft audit history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS microsoft_audit_no_delete BEFORE DELETE ON microsoft_audit BEGIN SELECT RAISE(ABORT,'Microsoft audit history is immutable'); END;
