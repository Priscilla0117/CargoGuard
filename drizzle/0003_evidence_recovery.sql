-- Small, workspace-private proposals. They are suggestions, never case decisions.
CREATE TABLE recovery_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  workspace TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(workspace, cache_key)
);
CREATE INDEX idx_recovery_proposals_expiry ON recovery_proposals(expires_at);
CREATE TRIGGER recovery_proposals_no_update BEFORE UPDATE ON recovery_proposals
BEGIN SELECT RAISE(ABORT, 'Recovery proposals are immutable'); END;

-- Quota reservations survive failures, expired caches, restarts and cookie resets.
CREATE TABLE recovery_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  workspace TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  quota_day TEXT NOT NULL,
  reserved_tokens INTEGER NOT NULL CHECK(reserved_tokens>0),
  status TEXT NOT NULL CHECK(status IN ('pending','completed','failed')),
  lease_until TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_recovery_attempts_day ON recovery_attempts(quota_day,workspace);
CREATE INDEX idx_recovery_attempts_pending ON recovery_attempts(status,lease_until);
