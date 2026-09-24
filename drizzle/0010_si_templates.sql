CREATE TABLE si_templates (
 workspace TEXT NOT NULL,
 id TEXT NOT NULL,
 version INTEGER NOT NULL,
 payload TEXT NOT NULL,
 PRIMARY KEY(workspace,id)
);
CREATE TABLE si_template_revisions (
 workspace TEXT NOT NULL,
 id TEXT NOT NULL,
 version INTEGER NOT NULL,
 payload TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(workspace,id,version)
);
CREATE TRIGGER si_template_history_no_update BEFORE UPDATE ON si_template_revisions BEGIN SELECT RAISE(ABORT,'Template history is immutable'); END;
CREATE TRIGGER si_template_history_no_delete BEFORE DELETE ON si_template_revisions BEGIN SELECT RAISE(ABORT,'Template history is immutable'); END;
