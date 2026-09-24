/**
 * Complete structural mirror of authoritative SQL migrations 0000-0011.
 *
 * IMPORTANT: drizzle/meta currently records only 0000. Do not apply db:generate
 * output to an existing database until metadata is reconciled with ALL
 * hand-authored migrations; generated diffs can recreate existing tables.
 * Drizzle cannot represent the immutable-history / no-delete / no-update SQL
 * triggers. Preserve those triggers explicitly whenever rebuilding a table.
 * Named checks below mirror the semantics of unnamed migration checks.
 * Table-level primary keys retain SQLite's existing nullability metadata;
 * do not silently introduce NOT NULL constraints on historical TEXT keys.
 */
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  blob,
  primaryKey,
  index,
  uniqueIndex,
  unique,
  check,
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
  (t) => [primaryKey({ columns: [t.workspace, t.emailId] })],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").notNull(),
    workspace: text("workspace").notNull(),
    emailId: text("email_id").notNull(),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    detail: text("detail").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    index("idx_events_workspace_email").on(t.workspace, t.emailId),
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
    id: text("id"),
    workspace: text("workspace").notNull(),
    rules: text("rules").notNull(),
    expectedVersion: integer("expected_version").notNull(),
    caseVersionSum: integer("case_version_sum").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    index("idx_policy_previews_expiry").on(t.expiresAt),
  ],
);

export const attachmentBlobs = sqliteTable(
  "attachment_blobs",
  {
    objectKey: text("object_key").notNull(),
    bytes: blob("bytes", { mode: "buffer" }).notNull(),
    size: integer("size").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.objectKey] }),
    check("attachment_blobs_check_1", sql.raw("size>=0 AND size<=5242880")),
  ],
);

export const recoveryProposals = sqliteTable(
  "recovery_proposals",
  {
    id: text("id").notNull(),
    workspace: text("workspace").notNull(),
    cacheKey: text("cache_key").notNull(),
    payload: text("payload").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    index("idx_recovery_proposals_expiry").on(t.expiresAt),
    unique().on(t.workspace, t.cacheKey),
  ],
);

export const recoveryAttempts = sqliteTable(
  "recovery_attempts",
  {
    id: text("id").notNull(),
    workspace: text("workspace").notNull(),
    cacheKey: text("cache_key").notNull(),
    quotaDay: text("quota_day").notNull(),
    reservedTokens: integer("reserved_tokens").notNull(),
    status: text("status").notNull(),
    leaseUntil: text("lease_until").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    index("idx_recovery_attempts_pending").on(t.status, t.leaseUntil),
    index("idx_recovery_attempts_day").on(t.quotaDay, t.workspace),
    check("recovery_attempts_check_1", sql.raw("reserved_tokens>0")),
    check(
      "recovery_attempts_check_2",
      sql.raw("status IN ('pending','completed','failed')"),
    ),
  ],
);

export const assistantReplies = sqliteTable(
  "assistant_replies",
  {
    id: text("id").notNull(),
    workspace: text("workspace").notNull(),
    cacheKey: text("cache_key").notNull(),
    payload: text("payload").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    index("idx_assistant_expiry").on(t.expiresAt),
    unique().on(t.workspace, t.cacheKey),
  ],
);

export const caseFollowUps = sqliteTable(
  "case_follow_ups",
  {
    workspace: text("workspace").notNull(),
    emailId: text("email_id").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspace, t.emailId] }),
    check("case_follow_ups_check_1", sql.raw("version > 0")),
  ],
);

export const followUpRevisions = sqliteTable(
  "follow_up_revisions",
  {
    workspace: text("workspace").notNull(),
    emailId: text("email_id").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.emailId, t.version] })],
);

export const teamInstallation = sqliteTable(
  "team_installation",
  {
    singleton: integer("singleton"),
    workspace: text("workspace").notNull(),
    bootstrapUser: text("bootstrap_user").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.singleton] }),
    unique().on(t.workspace),
    check("team_installation_check_1", sql.raw("singleton=1")),
  ],
);

export const teamUsers = sqliteTable(
  "team_users",
  {
    id: text("id"),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.id] }), unique().on(t.email)],
);

export const teamMemberships = sqliteTable(
  "team_memberships",
  {
    workspace: text("workspace").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => teamUsers.id),
    role: text("role").notNull(),
    active: integer("active").notNull().default(1),
    version: integer("version").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.workspace, t.userId] }),
    check(
      "team_memberships_check_1",
      sql.raw("role IN ('operator','reviewer','admin')"),
    ),
    check("team_memberships_check_2", sql.raw("active IN (0,1)")),
  ],
);

export const teamSessions = sqliteTable(
  "team_sessions",
  {
    tokenHash: text("token_hash"),
    userId: text("user_id")
      .notNull()
      .references(() => teamUsers.id),
    workspace: text("workspace").notNull(),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tokenHash] }),
    index("team_sessions_user").on(t.userId, t.workspace),
  ],
);

export const teamLoginLimits = sqliteTable(
  "team_login_limits",
  {
    key: text("key"),
    window: integer("window").notNull(),
    attempts: integer("attempts").notNull(),
  },
  (t) => [primaryKey({ columns: [t.key] })],
);

export const teamEvents = sqliteTable(
  "team_events",
  {
    id: text("id"),
    workspace: text("workspace").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetId: text("target_id").notNull(),
    detail: text("detail").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id] }),
    index("team_events_workspace").on(t.workspace, t.createdAt),
  ],
);

export const shipments = sqliteTable(
  "shipments",
  {
    workspace: text("workspace").notNull(),
    id: text("id").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.id] })],
);

export const shipmentRevisions = sqliteTable(
  "shipment_revisions",
  {
    workspace: text("workspace").notNull(),
    id: text("id").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.id, t.version] })],
);

export const operationalNotifications = sqliteTable(
  "operational_notifications",
  {
    workspace: text("workspace").notNull(),
    id: text("id").notNull(),
    shipmentId: text("shipment_id").notNull(),
    shipmentVersion: integer("shipment_version").notNull(),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
    acknowledgedAt: text("acknowledged_at"),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.id] })],
);

export const labelRules = sqliteTable(
  "label_rules",
  {
    workspace: text("workspace").notNull(),
    id: text("id").notNull(),
    version: integer("version").notNull(),
    state: text("state").notNull(),
    templateSignature: text("template_signature").notNull(),
    label: text("label").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspace, t.id] }),
    uniqueIndex("label_rules_active_scope")
      .on(t.workspace, t.templateSignature, t.label)
      .where(sql.raw("state='active'")),
    check("label_rules_check_1", sql.raw("version > 0")),
    check(
      "label_rules_check_2",
      sql.raw("state IN ('proposed','active','disabled')"),
    ),
  ],
);

export const labelRuleRevisions = sqliteTable(
  "label_rule_revisions",
  {
    workspace: text("workspace").notNull(),
    id: text("id").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.id, t.version] })],
);

export const microsoftConnections = sqliteTable(
  "microsoft_connections",
  {
    workspace: text("workspace").notNull(),
    userId: text("user_id").notNull(),
    version: integer("version").notNull(),
    graphUserId: text("graph_user_id").notNull(),
    accountLabel: text("account_label").notNull(),
    encryptedTokens: text("encrypted_tokens").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.userId] })],
);

export const microsoftOauthStates = sqliteTable(
  "microsoft_oauth_states",
  {
    stateHash: text("state_hash"),
    workspace: text("workspace").notNull(),
    userId: text("user_id").notNull(),
    sessionHash: text("session_hash").notNull(),
    encryptedVerifier: text("encrypted_verifier").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
  },
  (t) => [primaryKey({ columns: [t.stateHash] })],
);

export const microsoftDispatches = sqliteTable(
  "microsoft_dispatches",
  {
    workspace: text("workspace").notNull(),
    id: text("id").notNull(),
    userId: text("user_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    shipmentId: text("shipment_id").notNull(),
    shipmentVersion: integer("shipment_version").notNull(),
    taskId: text("task_id").notNull(),
    caseId: text("case_id").notNull(),
    caseVersion: integer("case_version").notNull(),
    taskUpdatedAt: text("task_updated_at").notNull(),
    status: text("status").notNull(),
    graphId: text("graph_id"),
    payload: text("payload").notNull(),
    version: integer("version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspace, t.id] }),
    unique().on(t.workspace, t.userId, t.dedupeKey),
    check(
      "microsoft_dispatches_check_1",
      sql.raw(
        "status IN ('creating','draft','sending','submitted','unknown','failed')",
      ),
    ),
  ],
);

export const microsoftImports = sqliteTable(
  "microsoft_imports",
  {
    workspace: text("workspace").notNull(),
    userId: text("user_id").notNull(),
    messageKey: text("message_key").notNull(),
    status: text("status").notNull(),
    caseId: text("case_id"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.userId, t.messageKey] })],
);

export const microsoftAudit = sqliteTable(
  "microsoft_audit",
  {
    id: text("id"),
    workspace: text("workspace").notNull(),
    userId: text("user_id").notNull(),
    action: text("action").notNull(),
    operationId: text("operation_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.id] })],
);

export const siTemplates = sqliteTable(
  "si_templates",
  {
    workspace: text("workspace").notNull(),
    id: text("id").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.id] })],
);

export const siTemplateRevisions = sqliteTable(
  "si_template_revisions",
  {
    workspace: text("workspace").notNull(),
    id: text("id").notNull(),
    version: integer("version").notNull(),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspace, t.id, t.version] })],
);

export const microsoftNotificationOutbox = sqliteTable(
  "microsoft_notification_outbox",
  {
    workspace: text("workspace").notNull(),
    id: text("id").notNull(),
    notificationId: text("notification_id").notNull(),
    recipient: text("recipient").notNull(),
    userId: text("user_id").notNull(),
    shipmentId: text("shipment_id").notNull(),
    shipmentVersion: integer("shipment_version").notNull(),
    sourceCase: text("source_case").notNull(),
    sourceVersion: integer("source_version").notNull(),
    status: text("status").notNull(),
    graphId: text("graph_id"),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workspace, t.id] }),
    unique().on(t.workspace, t.notificationId, t.recipient),
    check(
      "microsoft_notification_outbox_check_1",
      sql.raw(
        "status IN ('creating','draft','sending','submitted','unknown','failed','cancelled')",
      ),
    ),
  ],
);
