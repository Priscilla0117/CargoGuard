CREATE TABLE case_follow_ups (
  workspace TEXT NOT NULL,
  email_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  payload TEXT NOT NULL,
  PRIMARY KEY (workspace, email_id)
);

CREATE TABLE follow_up_revisions (
  workspace TEXT NOT NULL,
  email_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (workspace, email_id, version)
);
CREATE TRIGGER follow_up_revisions_immutable_update BEFORE UPDATE ON follow_up_revisions
BEGIN SELECT RAISE(ABORT, 'Follow-up revisions are immutable'); END;
CREATE TRIGGER follow_up_revisions_immutable_delete BEFORE DELETE ON follow_up_revisions
BEGIN SELECT RAISE(ABORT, 'Follow-up revisions are immutable'); END;
