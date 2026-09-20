// SQL migrations are authoritative, including immutability triggers.
import {
  sqliteTable,
  text,
  integer,
  blob,
  primaryKey,
  index,
} from "drizzle-orm/sqlite-core";
export const cases = sqliteTable(
  "cases",
  {
    workspace: text("workspace").notNull(),
    emailId: text("email_id").notNull(),
    payload: text("payload").notNull(),
    version: integer("version").notNull().default(1),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspace, table.emailId] })],
);
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    workspace: text("workspace").notNull(),
    emailId: text("email_id").notNull(),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    detail: text("detail").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_events_workspace_email").on(table.workspace, table.emailId),
  ],
);
export const resultRevisions = sqliteTable(
  "result_revisions",
  {
    workspace: text("workspace").notNull(),
    emailId: text("email_id").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
    origin: text("origin").notNull(),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    detail: text("detail").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.emailId, t.version] })],
);
export const policies = sqliteTable(
  "policies",
  {
    workspace: text("workspace").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.version] })],
);
export const policyPreviews = sqliteTable(
  "policy_previews",
  {
    id: text("id").primaryKey(),
    workspace: text("workspace").notNull(),
    rules: text("rules").notNull(),
    expectedVersion: integer("expected_version").notNull(),
    caseVersionSum: integer("case_version_sum").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [index("idx_policy_previews_expiry").on(t.expiresAt)],
);
export const attachmentBlobs = sqliteTable("attachment_blobs", {
  objectKey: text("object_key").primaryKey(),
  bytes: blob("bytes", { mode: "buffer" }).notNull(),
  size: integer("size").notNull(),
});
