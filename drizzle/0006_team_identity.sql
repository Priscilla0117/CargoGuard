CREATE TABLE team_installation (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  workspace TEXT NOT NULL UNIQUE,
  bootstrap_user TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE team_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE team_memberships (
  workspace TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES team_users(id),
  role TEXT NOT NULL CHECK(role IN ('operator','reviewer','admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(workspace,user_id)
);
CREATE TABLE team_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES team_users(id),
  workspace TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX team_sessions_user ON team_sessions(user_id,workspace);
CREATE TABLE team_login_limits (
  key TEXT PRIMARY KEY,
  window INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE TABLE team_events (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX team_events_workspace ON team_events(workspace,created_at);
CREATE TRIGGER team_events_no_update BEFORE UPDATE ON team_events BEGIN SELECT RAISE(ABORT, 'Team audit history is immutable'); END;
CREATE TRIGGER team_events_no_delete BEFORE DELETE ON team_events BEGIN SELECT RAISE(ABORT, 'Team audit history is immutable'); END;
