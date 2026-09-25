import {
  mailSettingsSchema,
  DEFAULT_MAIL_SETTINGS,
  type MailConfig,
} from "./mail-connector";
import {
  requireMailboxIntake,
  type MailboxAuthority,
} from "./mail-intake-auth";
import { mailWorkerEnabled } from "./mail-worker-config";
import { syncMailbox, type MailContext } from "./mail-storage";
import type { Fetcher } from "./gmail";
import { setTimeout as delay } from "node:timers/promises";

/** One durable pass; state lives in SQL, so process restarts need no browser session. */
export async function runMailWorkerPass(options: {
  db: D1Database;
  config: MailConfig;
  fetcher?: Fetcher;
  signal?: AbortSignal;
}) {
  if (!mailWorkerEnabled()) return { checked: 0, failed: 0 };
  let checked = 0,
    failed = 0,
    attempted = 0;
  let afterAttempt = "",
    afterWorkspace = "",
    afterUser = "";
  const passStartedAt = new Date().toISOString();
  // Oldest attempts go first, including when a pass takes longer than the
  // polling interval. Page past invalid settings using a stable tuple and
  // exclude timestamps refreshed during this pass, preventing repeat visits.
  while (attempted < 100 && !options.signal?.aborted) {
    const rows = await options.db
      .prepare(
        `SELECT c.workspace,c.user_id AS userId,c.account,c.provider,c.version AS connectionVersion,
      m.version AS membershipVersion,c.settings,c.last_sync_at
     FROM mail_connections c JOIN team_memberships m ON m.workspace=c.workspace AND m.user_id=c.user_id
     JOIN team_users u ON u.id=c.user_id
     WHERE m.active=1 AND json_valid(c.settings) AND json_extract(c.settings,'$.auto_sync')=1
       AND (c.last_sync_at IS NULL OR c.last_sync_at<?)
       AND (COALESCE(c.last_sync_at,'')>? OR
         (COALESCE(c.last_sync_at,'')=? AND (c.workspace>? OR (c.workspace=? AND c.user_id>?))))
     ORDER BY COALESCE(c.last_sync_at,''),c.workspace,c.user_id LIMIT 100`,
      )
      .bind(
        passStartedAt,
        afterAttempt,
        afterAttempt,
        afterWorkspace,
        afterWorkspace,
        afterUser,
      )
      .all<
        MailboxAuthority & { settings: string; last_sync_at: string | null }
      >();
    for (const row of rows.results) {
      if (options.signal?.aborted || attempted >= 100) break;
      afterAttempt = row.last_sync_at ?? "";
      afterWorkspace = row.workspace;
      afterUser = row.userId;
      const settings = mailSettingsSchema.safeParse({
        ...DEFAULT_MAIL_SETTINGS,
        ...JSON.parse(row.settings),
      });
      if (!settings.success || !settings.data.auto_sync) continue;
      if (
        row.last_sync_at &&
        Date.now() - Date.parse(row.last_sync_at) <
          settings.data.interval_minutes * 60000
      )
        continue;
      const authority: MailboxAuthority = {
        workspace: row.workspace,
        userId: row.userId,
        account: row.account,
        provider: row.provider,
        connectionVersion: row.connectionVersion,
        membershipVersion: row.membershipVersion,
      };
      try {
        const access = await requireMailboxIntake(options.db, authority);
        const context: MailContext = {
          workspace: row.workspace,
          userId: row.userId,
          actor: access.actor,
          sessionToken: "",
          request: new Request("http://mail-worker.internal/sync"),
          db: options.db,
          config: options.config,
          fetcher: options.fetcher,
          background: authority,
        };
        attempted++;
        const result = await syncMailbox(context);
        if (!result.busy) checked++;
        if (result.failed) failed++;
      } catch {
        // syncMailbox retains its safe, user-visible error. Never log provider data.
        failed++;
      }
    }
    if (rows.results.length < 100) break;
  }
  return { checked, failed };
}

export async function recordWorkerHeartbeat(
  db: D1Database,
  state: "running" | "waiting_for_setup" | "stopped",
) {
  await db
    .prepare(
      "INSERT INTO mail_worker_state(singleton,heartbeat_at,state) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET heartbeat_at=excluded.heartbeat_at,state=excluded.state",
    )
    .bind(new Date().toISOString(), state)
    .run();
}

/** Used by the supervised Node process and exercised with isolated mock providers. */
export async function runMailWorkerLoop(options: {
  db: D1Database;
  configuration: () => Promise<{ config?: MailConfig }>;
  signal: AbortSignal;
  fetcher?: Fetcher;
  pollIntervalMs?: number;
  diagnostic?: (code: string) => void;
}) {
  let state: "running" | "waiting_for_setup" = "waiting_for_setup";
  const heartbeat = setInterval(() => {
    void recordWorkerHeartbeat(options.db, state).catch(() =>
      options.diagnostic?.("MAIL_WORKER_HEARTBEAT_FAILED"),
    );
  }, 30000);
  try {
    while (!options.signal.aborted && mailWorkerEnabled()) {
      try {
        const configuration = await options.configuration();
        state = configuration.config ? "running" : "waiting_for_setup";
        await recordWorkerHeartbeat(options.db, state);
        if (configuration.config)
          await runMailWorkerPass({ ...options, config: configuration.config });
      } catch {
        options.diagnostic?.("MAIL_WORKER_PASS_FAILED");
      }
      if (!options.signal.aborted)
        await delay(options.pollIntervalMs ?? 15000, undefined, {
          signal: options.signal,
        }).catch(() => {});
    }
  } finally {
    clearInterval(heartbeat);
    await recordWorkerHeartbeat(options.db, "stopped").catch(() => {});
  }
}
