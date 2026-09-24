CREATE TABLE gmail_connections (
 workspace TEXT PRIMARY KEY, account_email TEXT NOT NULL, credentials TEXT NOT NULL,
 history_id TEXT, page_token TEXT, sync_mode TEXT NOT NULL DEFAULT 'initial',
 sync_until TEXT, connected_at TEXT NOT NULL
);
CREATE TABLE gmail_oauth_states (
 state_hash TEXT PRIMARY KEY, workspace TEXT NOT NULL, nonce_hash TEXT NOT NULL,
 verifier TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE gmail_messages (
 id TEXT PRIMARY KEY, workspace TEXT NOT NULL, account_email TEXT NOT NULL,
 provider_id TEXT NOT NULL, thread_id TEXT NOT NULL, case_id TEXT,
 payload TEXT NOT NULL, received_at TEXT NOT NULL,
 UNIQUE(workspace,account_email,provider_id)
);
CREATE INDEX gmail_messages_case ON gmail_messages(workspace,case_id,received_at);
CREATE INDEX gmail_messages_thread ON gmail_messages(workspace,account_email,thread_id);
CREATE TABLE correspondence_drafts (
 id TEXT PRIMARY KEY, workspace TEXT NOT NULL, case_id TEXT NOT NULL,
 case_version INTEGER NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
 payload TEXT NOT NULL, operation_id TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX correspondence_drafts_case ON correspondence_drafts(workspace,case_id);
CREATE UNIQUE INDEX correspondence_send_operation ON correspondence_drafts(operation_id);
