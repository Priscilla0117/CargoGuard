CREATE TABLE IF NOT EXISTS case_scheduling (
 workspace TEXT NOT NULL,
 case_id TEXT NOT NULL,
 version INTEGER NOT NULL,
 due_at TEXT,
 follow_up_at TEXT,
 priority TEXT NOT NULL CHECK(priority IN ('normal','high','urgent')),
 updated_at TEXT NOT NULL,
 PRIMARY KEY(workspace, case_id)
);
