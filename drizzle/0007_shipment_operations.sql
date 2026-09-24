CREATE TABLE IF NOT EXISTS shipments(workspace TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(workspace,id));
CREATE TABLE IF NOT EXISTS shipment_revisions(workspace TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL,payload TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(workspace,id,version));
CREATE TRIGGER IF NOT EXISTS shipment_revision_no_update BEFORE UPDATE ON shipment_revisions BEGIN SELECT RAISE(ABORT,'Shipment history is immutable'); END;
CREATE TRIGGER IF NOT EXISTS shipment_revision_no_delete BEFORE DELETE ON shipment_revisions BEGIN SELECT RAISE(ABORT,'Shipment history is immutable'); END;
CREATE TABLE IF NOT EXISTS operational_notifications(workspace TEXT NOT NULL,id TEXT NOT NULL,shipment_id TEXT NOT NULL,shipment_version INTEGER NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL,acknowledged_at TEXT,PRIMARY KEY(workspace,id));
