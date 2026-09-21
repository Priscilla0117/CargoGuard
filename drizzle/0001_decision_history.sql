CREATE TABLE result_revisions (
  workspace TEXT NOT NULL,
  email_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  origin TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace, email_id, version)
);
-- Only the actually retained legacy result is imported. Earlier states cannot
-- be reconstructed faithfully from old events and are never invented.
INSERT INTO result_revisions
SELECT workspace,email_id,version,payload,'legacy','LEGACY_SNAPSHOT','Migration',
  'Only the retained pre-upgrade state is available; automatic provenance is unverified.',updated_at FROM cases;
CREATE TRIGGER revisions_no_update BEFORE UPDATE ON result_revisions
BEGIN SELECT RAISE(ABORT, 'Decision revisions are immutable'); END;
CREATE TRIGGER revisions_no_delete BEFORE DELETE ON result_revisions
BEGIN SELECT RAISE(ABORT, 'Decision revisions are immutable'); END;
CREATE TABLE policies (
  workspace TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(workspace, version)
);
CREATE TRIGGER policies_no_update BEFORE UPDATE ON policies
BEGIN SELECT RAISE(ABORT, 'Policy versions are immutable'); END;
CREATE TRIGGER policies_no_delete BEFORE DELETE ON policies
BEGIN SELECT RAISE(ABORT, 'Policy versions are immutable'); END;
CREATE TABLE policy_previews (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL,
  rules TEXT NOT NULL,
  expected_version INTEGER NOT NULL,
  case_version_sum INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_policy_previews_expiry ON policy_previews(expires_at);
