ALTER TABLE mail_connections ADD COLUMN sync_cursor TEXT;
ALTER TABLE mail_connections ADD COLUMN sync_lease TEXT;
ALTER TABLE mail_connections ADD COLUMN sync_lease_until TEXT;
ALTER TABLE mail_imports ADD COLUMN lease_token TEXT;
ALTER TABLE mail_imports ADD COLUMN lease_until TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cases_import_key
  ON cases(workspace, json_extract(payload,'$.email.import_key'))
  WHERE json_extract(payload,'$.email.import_key') IS NOT NULL;
CREATE TABLE IF NOT EXISTS mail_operations (
  workspace TEXT NOT NULL, user_id TEXT NOT NULL, id TEXT NOT NULL,
  case_id TEXT NOT NULL, case_version INTEGER NOT NULL,
  provider TEXT NOT NULL, account TEXT NOT NULL, mode TEXT NOT NULL,
  payload_hash TEXT NOT NULL, message_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('sending','draft','submitted','unknown','cancelled')),
  provider_id TEXT, receipt TEXT, follow_up INTEGER NOT NULL DEFAULT 0,
  follow_up_recorded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace,user_id,id)
);
CREATE INDEX IF NOT EXISTS idx_mail_operations_case
  ON mail_operations(workspace,user_id,case_id,status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_operations_payload
  ON mail_operations(workspace,user_id,payload_hash) WHERE status != 'cancelled';
-- At most one unconfirmed effect per case/mailbox user. A process crash must
-- never turn a repeated click into another provider submission.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_operations_unresolved
  ON mail_operations(workspace,user_id,case_id)
  WHERE status IN ('sending','unknown');
