CREATE TABLE label_rules (
  workspace TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  state TEXT NOT NULL CHECK(state IN ('proposed','active','disabled')),
  template_signature TEXT NOT NULL,
  label TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(workspace,id)
);
CREATE UNIQUE INDEX label_rules_active_scope ON label_rules(workspace,template_signature,label) WHERE state='active';
CREATE TABLE label_rule_revisions (
  workspace TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY(workspace,id,version)
);
CREATE TRIGGER label_rule_history_no_update BEFORE UPDATE ON label_rule_revisions BEGIN SELECT RAISE(ABORT,'Label rule history is immutable'); END;
CREATE TRIGGER label_rule_history_no_delete BEFORE DELETE ON label_rule_revisions BEGIN SELECT RAISE(ABORT,'Label rule history is immutable'); END;
CREATE TRIGGER label_rules_no_delete BEFORE DELETE ON label_rules BEGIN SELECT RAISE(ABORT,'Disable a rule instead of deleting its history'); END;
