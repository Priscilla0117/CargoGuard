ALTER TABLE mail_connections ADD COLUMN last_success_at TEXT;
ALTER TABLE mail_connections ADD COLUMN last_sync_error TEXT;
CREATE TABLE IF NOT EXISTS mail_worker_state (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  heartbeat_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('running','waiting_for_setup','stopped'))
);
