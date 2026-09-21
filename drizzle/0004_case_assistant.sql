-- Advisory chat is separate from case results, revisions and audit decisions.
CREATE TABLE assistant_replies (
  id TEXT PRIMARY KEY NOT NULL,
  workspace TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE(workspace,cache_key)
);
CREATE INDEX idx_assistant_expiry ON assistant_replies(expires_at);
CREATE TRIGGER assistant_replies_no_update BEFORE UPDATE ON assistant_replies
BEGIN SELECT RAISE(ABORT, 'Assistant replies are immutable'); END;
