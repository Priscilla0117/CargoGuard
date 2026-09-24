CREATE TABLE IF NOT EXISTS microsoft_notification_outbox (
  workspace TEXT NOT NULL, id TEXT NOT NULL, notification_id TEXT NOT NULL,
  recipient TEXT NOT NULL, user_id TEXT NOT NULL, shipment_id TEXT NOT NULL,
  shipment_version INTEGER NOT NULL, source_case TEXT NOT NULL, source_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('creating','draft','sending','submitted','unknown','failed','cancelled')),
  graph_id TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace,id), UNIQUE(workspace,notification_id,recipient)
);
