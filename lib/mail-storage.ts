import { z } from "zod";
import {
  authenticatedActor,
  requireCapability,
  teamMode,
  tokenFromRequest,
  type Capability,
} from "./auth";
import { HttpError } from "./http";
import {
  DEFAULT_MAIL_SETTINGS,
  IMAP_PRESETS,
  mailConfiguration,
  mailSettingsSchema,
  openSecret,
  randomToken,
  sealSecret,
  sha256,
  type ImapPreset,
  type MailConfig,
  type MailProvider,
  type MailSettings,
} from "./mail-connector";
import {
  exchangeGoogleToken,
  MailProviderError,
  gmailProfile,
  gmailUnseen,
  gmailRaw,
  googleAuthorizeUrl,
  type Fetcher,
  type GoogleTokens,
} from "./gmail";
import { requireMutation, storage } from "./storage";

export interface MailContext {
  workspace: string;
  userId: string;
  sessionToken: string;
  actor: string;
  db: D1Database;
  config: MailConfig;
  request: Request;
  fetcher?: Fetcher;
}
interface ConnectionRow {
  provider: MailProvider;
  account: string;
  encrypted_secret: string;
  settings: string;
  version: number;
  last_sync_at: string | null;
  last_sync_note: string | null;
  updated_at: string;
  sync_cursor: string | null;
}
const now = () => new Date().toISOString();
const binding = (context: MailContext) =>
  `mail:${context.workspace}:${context.userId}`;

export async function mailRequest(
  request: Request,
  capability: Capability,
  mutate = false,
): Promise<MailContext> {
  const session = await requireCapability(request, capability);
  if (mutate) requireMutation(request);
  const configuration = await mailConfiguration();
  if (!configuration.config)
    throw new HttpError(
      "Email connection is not set up on this server. Ask an administrator to add CARGO_MAIL_TOKEN_KEY.",
      503,
    );
  const team = teamMode();
  const sessionToken = team ? tokenFromRequest(request) : session.id;
  if (!sessionToken)
    throw new HttpError("Sign in before connecting a mailbox.", 401);
  return {
    workspace: session.id,
    userId: team && session.user ? session.user.id : "demo-user",
    sessionToken,
    actor: authenticatedActor(request, "Workspace user"),
    db: storage().DB,
    config: configuration.config,
    request,
  };
}

export async function connection(context: MailContext) {
  return context.db
    .prepare(
      "SELECT provider,account,encrypted_secret,settings,version,last_sync_at,last_sync_note,updated_at,sync_cursor FROM mail_connections WHERE workspace=? AND user_id=?",
    )
    .bind(context.workspace, context.userId)
    .first<ConnectionRow>();
}
function settingsOf(row: ConnectionRow | null): MailSettings {
  if (!row) return DEFAULT_MAIL_SETTINGS;
  try {
    return mailSettingsSchema.parse({
      ...DEFAULT_MAIL_SETTINGS,
      ...JSON.parse(row.settings),
    });
  } catch {
    return DEFAULT_MAIL_SETTINGS;
  }
}

export async function mailStatus(context: MailContext) {
  const row = await connection(context);
  const imported = await context.db
    .prepare(
      "SELECT COUNT(*) AS n FROM mail_imports WHERE workspace=? AND user_id=? AND status='imported'",
    )
    .bind(context.workspace, context.userId)
    .first<number>("n");
  return {
    configured: true,
    google_available: !!context.config.google,
    imap_available: context.config.imap,
    custom_server: !!context.config.custom,
    send_enabled: context.config.allowSend,
    presets: Object.entries(IMAP_PRESETS).map(([id, value]) => ({
      id,
      label: value.label,
      help: value.help,
    })),
    connected: !!row,
    provider: row?.provider ?? null,
    account: row?.account ?? null,
    settings: settingsOf(row),
    last_sync_at: row?.last_sync_at ?? null,
    last_sync_note: row?.last_sync_note ?? null,
    imported: Number(imported ?? 0),
  };
}

async function saveConnection(
  context: MailContext,
  provider: MailProvider,
  account: string,
  secret: unknown,
) {
  const previous = await connection(context);
  await context.db
    .prepare(
      "INSERT INTO mail_connections(workspace,user_id,provider,account,encrypted_secret,settings,version,updated_at) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(workspace,user_id) DO UPDATE SET provider=excluded.provider,account=excluded.account,encrypted_secret=excluded.encrypted_secret,settings=excluded.settings,version=mail_connections.version+1,last_sync_note=NULL,sync_cursor=NULL,sync_lease=NULL,sync_lease_until=NULL,updated_at=excluded.updated_at",
    )
    .bind(
      context.workspace,
      context.userId,
      provider,
      account,
      await sealSecret(
        context.config,
        JSON.stringify(secret),
        binding(context),
      ),
      JSON.stringify(settingsOf(previous)),
      now(),
    )
    .run();
}

export async function startGoogleConnect(context: MailContext, hint?: string) {
  if (!context.config.google)
    throw new HttpError(
      "Google sign-in is not configured on this server. Use “Sign in with email & app password” instead, or ask an administrator to add Google OAuth credentials.",
      503,
    );
  const state = randomToken(),
    verifier = randomToken(),
    expires = new Date(Date.now() + 10 * 60000).toISOString();
  await context.db.batch([
    context.db
      .prepare(
        "DELETE FROM mail_oauth_states WHERE expires_at<? OR (workspace=? AND user_id=?)",
      )
      .bind(now(), context.workspace, context.userId),
    context.db
      .prepare(
        "INSERT INTO mail_oauth_states(state_hash,workspace,user_id,session_hash,encrypted_verifier,expires_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        await sha256(state),
        context.workspace,
        context.userId,
        await sha256(context.sessionToken),
        await sealSecret(context.config, verifier, binding(context)),
        expires,
      ),
  ]);
  return {
    authorize_url: googleAuthorizeUrl(
      context.config,
      state,
      await sha256(verifier),
      hint,
    ),
  };
}

export async function finishGoogleConnect(
  context: MailContext,
  state: string,
  code: string,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 4000)
    throw new HttpError("Invalid Google sign-in response.", 400);
  const hash = await sha256(state),
    session = await sha256(context.sessionToken),
    at = now();
  const row = await context.db
    .prepare(
      "SELECT encrypted_verifier FROM mail_oauth_states WHERE state_hash=? AND workspace=? AND user_id=? AND session_hash=? AND expires_at>? AND used_at IS NULL",
    )
    .bind(hash, context.workspace, context.userId, session, at)
    .first<{ encrypted_verifier: string }>();
  if (!row)
    throw new HttpError(
      "This sign-in link expired or was already used. Start the Gmail connection again.",
      409,
    );
  const used = await context.db
    .prepare(
      "UPDATE mail_oauth_states SET used_at=? WHERE state_hash=? AND used_at IS NULL",
    )
    .bind(at, hash)
    .run();
  if (used.meta.changes !== 1)
    throw new HttpError("This sign-in link was already used.", 409);
  const tokens = await exchangeGoogleToken(
    context.config,
    {
      code,
      verifier: await openSecret(
        context.config,
        row.encrypted_verifier,
        binding(context),
      ),
    },
    context.fetcher,
  );
  const account = await gmailProfile(tokens.access_token, context.fetcher);
  await saveConnection(context, "gmail", account, tokens);
  return mailStatus(context);
}

export const imapInput = z
  .object({
    preset: z.enum(["gmail", "outlook", "yahoo", "custom"]),
    email: z.string().trim().toLowerCase().email().max(254),
    // App passwords are often shown with spaces; they are not part of the password.
    password: z
      .string()
      .min(4)
      .max(200)
      .transform((value) => value.replace(/\s+/g, "")),
  })
  .strict();
export async function connectImap(
  context: MailContext,
  input: z.infer<typeof imapInput>,
) {
  if (!context.config.imap)
    throw new HttpError(
      "Email and app-password login is disabled on this server.",
      403,
    );
  const { imapServer, verifyImapLogin } = await import("./imap-adapter");
  const secret = {
    preset: input.preset as ImapPreset,
    email: input.email,
    password: input.password,
  };
  await verifyImapLogin(imapServer(context.config, secret.preset), secret);
  await saveConnection(context, "imap", input.email, secret);
  return mailStatus(context);
}

export async function disconnectMail(context: MailContext) {
  const row = await connection(context);
  if (row?.provider === "gmail") {
    // Best effort: revoke Google access too. Local deletion always proceeds.
    try {
      const tokens = JSON.parse(
        await openSecret(
          context.config,
          row.encrypted_secret,
          binding(context),
        ),
      ) as GoogleTokens;
      await (context.fetcher ?? fetch)("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: tokens.refresh_token }).toString(),
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
    } catch {
      // Unreadable credentials are removed below.
    }
  }
  await context.db.batch([
    context.db
      .prepare("DELETE FROM mail_connections WHERE workspace=? AND user_id=?")
      .bind(context.workspace, context.userId),
    context.db
      .prepare("DELETE FROM mail_oauth_states WHERE workspace=? AND user_id=?")
      .bind(context.workspace, context.userId),
  ]);
}

export async function updateMailSettings(
  context: MailContext,
  settings: MailSettings,
) {
  const saved = await context.db
    .prepare(
      "UPDATE mail_connections SET settings=?,version=version+1,updated_at=?,sync_cursor=NULL WHERE workspace=? AND user_id=?",
    )
    .bind(
      JSON.stringify(mailSettingsSchema.parse(settings)),
      now(),
      context.workspace,
      context.userId,
    )
    .run();
  if (saved.meta.changes !== 1)
    throw new HttpError("Connect a mailbox before changing its settings.", 409);
  return mailStatus(context);
}

export async function googleAccess(context: MailContext, row: ConnectionRow) {
  let tokens = JSON.parse(
    await openSecret(context.config, row.encrypted_secret, binding(context)),
  ) as GoogleTokens;
  if (tokens.expires_at > Date.now() + 60000) return tokens.access_token;
  tokens = await exchangeGoogleToken(
    context.config,
    { refresh: tokens.refresh_token },
    context.fetcher,
  );
  await context.db
    .prepare(
      "UPDATE mail_connections SET encrypted_secret=?,version=version+1,updated_at=? WHERE workspace=? AND user_id=? AND version=?",
    )
    .bind(
      await sealSecret(
        context.config,
        JSON.stringify(tokens),
        binding(context),
      ),
      now(),
      context.workspace,
      context.userId,
      row.version,
    )
    .run();
  return tokens.access_token;
}
export async function imapSecret(context: MailContext, row: ConnectionRow) {
  const value = JSON.parse(
    await openSecret(context.config, row.encrypted_secret, binding(context)),
  ) as { preset: ImapPreset; email: string; password: string };
  return value;
}

/** Create a case through the normal upload pipeline so every check applies. */
async function importRaw(
  context: MailContext,
  raw: Uint8Array,
  source: "gmail" | "imap",
  importKey: string,
  thread?: string,
  receivedAt?: string,
) {
  const form = new FormData();
  form.set(
    "eml",
    new File([raw.slice().buffer], "message.eml", { type: "message/rfc822" }),
  );
  form.set("source", source);
  form.set("import_key", importKey);
  if (receivedAt) form.set("provider_received_at", receivedAt);
  if (thread && /^[A-Za-z0-9_.:=-]{1,200}$/.test(thread))
    form.set("thread_hint", `${source}:${thread}`.slice(0, 200));
  const origin =
    process.env.CARGO_PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL;
  const headers: Record<string, string> = {
    cookie: context.request.headers.get("cookie") ?? "",
  };
  headers.origin = origin
    ? new URL(origin).origin
    : new URL(context.request.url).origin;
  const { POST } = await import("@/app/api/upload/route");
  const response = await POST(
    new Request(new URL("/api/upload", context.request.url), {
      method: "POST",
      headers,
      body: form,
    }),
  );
  const value = (await response.json().catch(() => null)) as {
    result?: { email?: { email_id?: string } };
    duplicate?: boolean;
    error?: string;
  } | null;
  if (!response.ok || !value?.result?.email?.email_id)
    throw new HttpError(
      value?.error ?? "The message could not be imported.",
      response.status || 502,
    );
  return { case_id: value.result.email.email_id, duplicate: !!value.duplicate };
}

async function knownKeys(context: MailContext, keys: string[]) {
  if (!keys.length) return new Set<string>();
  const known = new Set<string>();
  // Cloudflare D1 accepts at most 100 bound parameters in one statement.
  for (let start = 0; start < keys.length; start += 90) {
    const page = keys.slice(start, start + 90);
    const rows = await context.db
      .prepare(
        `SELECT message_key FROM mail_imports WHERE workspace=? AND user_id=? AND (status IN ('imported','skipped') OR (status='importing' AND lease_until>?)) AND message_key IN (${page.map(() => "?").join(",")})`,
      )
      .bind(context.workspace, context.userId, now(), ...page)
      .all<{ message_key: string }>();
    for (const row of rows.results) known.add(row.message_key);
  }
  return known;
}
async function reserve(context: MailContext, key: string) {
  const lease = crypto.randomUUID();
  const result = await context.db
    .prepare(
      "INSERT INTO mail_imports(workspace,user_id,message_key,status,created_at,lease_token,lease_until) VALUES(?,?,?,'importing',?,?,?) ON CONFLICT(workspace,user_id,message_key) DO UPDATE SET status='importing',created_at=excluded.created_at,lease_token=excluded.lease_token,lease_until=excluded.lease_until WHERE mail_imports.status='failed' OR (mail_imports.status='importing' AND (mail_imports.lease_until IS NULL OR mail_imports.lease_until<?))",
    )
    .bind(
      context.workspace,
      context.userId,
      key,
      now(),
      lease,
      new Date(Date.now() + 600000).toISOString(),
      now(),
    )
    .run();
  return result.meta.changes === 1 ? lease : null;
}
async function settle(
  context: MailContext,
  key: string,
  lease: string,
  status: "imported" | "skipped" | "failed",
  caseId: string | null,
  note: string,
) {
  await context.db
    .prepare(
      "UPDATE mail_imports SET status=?,case_id=?,note=?,lease_token=NULL,lease_until=NULL WHERE workspace=? AND user_id=? AND message_key=? AND lease_token=?",
    )
    .bind(
      status,
      caseId,
      note.slice(0, 300),
      context.workspace,
      context.userId,
      key,
      lease,
    )
    .run();
}

export async function syncMailbox(context: MailContext) {
  const row = await connection(context);
  if (!row) throw new HttpError("Connect a mailbox first.", 409);
  const settings = settingsOf(row);
  const at = now();
  const leaseId = crypto.randomUUID();
  const scope = await sha256(
    `${row.provider}:${row.account.toLowerCase()}:${settings.mailbox}`,
  );
  const scanScope = await sha256(`${scope}:${JSON.stringify(settings)}`);
  const scopedKnown = async (keys: string[]) => {
    const seen = await knownKeys(
      context,
      keys.map((key) => `${scope}:${key}`),
    );
    return new Set(keys.filter((key) => seen.has(`${scope}:${key}`)));
  };
  const cursorSchema = z.object({
    scope: z.string(),
    gmail: z.string().optional(),
    imap: z
      .object({ beforeUid: z.number().int(), uidValidity: z.string() })
      .optional(),
  });
  let cursor: z.infer<typeof cursorSchema> | null = null;
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(row.sync_cursor ?? "null"),
    );
    if (parsed.success && parsed.data.scope === scanScope) cursor = parsed.data;
  } catch {
    /* Restart a corrupt cursor safely using import identities. */
  }
  let nextCursor: typeof cursor = cursor;
  // Fenced lease: a late worker cannot release or overwrite a newer worker.
  const lease = await context.db
    .prepare(
      "UPDATE mail_connections SET last_sync_note='Checking for new email…',last_sync_at=?,sync_lease=?,sync_lease_until=? WHERE workspace=? AND user_id=? AND account=? AND (sync_lease IS NULL OR sync_lease_until<?)",
    )
    .bind(
      at,
      leaseId,
      new Date(Date.now() + 600000).toISOString(),
      context.workspace,
      context.userId,
      row.account,
      at,
    )
    .run();
  if (lease.meta.changes !== 1)
    return {
      imported: [],
      duplicates: 0,
      failed: 0,
      busy: true,
      note: "A check is already running.",
    };
  const imported: string[] = [];
  let duplicates = 0,
    failed = 0;
  let note = "";
  let more = false;
  const renew = async () => {
    const changed = await context.db
      .prepare(
        "UPDATE mail_connections SET sync_lease_until=? WHERE workspace=? AND user_id=? AND sync_lease=?",
      )
      .bind(
        new Date(Date.now() + 600000).toISOString(),
        context.workspace,
        context.userId,
        leaseId,
      )
      .run();
    if (changed.meta.changes !== 1)
      throw new HttpError(
        "Mailbox connection changed during import. Start another check.",
        409,
      );
  };
  try {
    if (row.provider === "gmail") {
      const token = await googleAccess(context, row);
      const query =
        `in:inbox newer_than:${settings.days}d ${settings.gmail_query}`.trim();
      const scan = (page?: string) =>
        gmailUnseen(
          token,
          query,
          settings.max_per_sync,
          scopedKnown,
          context.fetcher,
          10,
          page,
        );
      let unseen;
      try {
        unseen = await scan(cursor?.gmail);
      } catch (error) {
        if (
          !(
            cursor?.gmail &&
            error instanceof MailProviderError &&
            error.providerStatus === 400
          )
        )
          throw error;
        unseen = await scan();
      }
      more = unseen.more;
      nextCursor = unseen.more
        ? { scope: scanScope, gmail: unseen.nextPageToken ?? "" }
        : null;
      for (const item of unseen.messages) {
        await renew();
        const key = `${scope}:gmail:${item.id}`;
        const reservation = await reserve(context, key);
        if (!reservation) continue;
        try {
          const message = await gmailRaw(token, item.id, context.fetcher);
          const result = await importRaw(
            context,
            message.bytes,
            "gmail",
            `mail:${await sha256(key)}`,
            message.thread,
            message.received_at,
          );
          if (result.duplicate) duplicates++;
          else imported.push(result.case_id);
          await settle(
            context,
            key,
            reservation,
            "imported",
            result.case_id,
            result.duplicate ? "Already in CargoGuard" : "Imported",
          );
        } catch (error) {
          failed++;
          await settle(
            context,
            key,
            reservation,
            "failed",
            null,
            error instanceof HttpError ? error.message : "Import failed",
          );
          if (error instanceof HttpError && error.status === 429) break;
        }
      }
    } else {
      const secret = await imapSecret(context, row);
      const { imapFetchNew, imapServer } = await import("./imap-adapter");
      const candidates = await imapFetchNew(
        imapServer(context.config, secret.preset),
        secret,
        {
          mailbox: settings.mailbox,
          days: settings.days,
          max: settings.max_per_sync,
          cursor: cursor?.imap,
        },
        scopedKnown,
      );
      more = candidates.more;
      nextCursor = candidates.cursor
        ? { scope: scanScope, imap: candidates.cursor }
        : null;
      for (const candidate of candidates) {
        await renew();
        const key = `${scope}:${candidate.key}`;
        const reservation = await reserve(context, key);
        if (!reservation) continue;
        try {
          const result = await importRaw(
            context,
            candidate.raw,
            "imap",
            `mail:${await sha256(key)}`,
            candidate.thread,
            candidate.received_at,
          );
          if (result.duplicate) duplicates++;
          else imported.push(result.case_id);
          await settle(
            context,
            key,
            reservation,
            "imported",
            result.case_id,
            result.duplicate ? "Already in CargoGuard" : "Imported",
          );
        } catch (error) {
          failed++;
          await settle(
            context,
            key,
            reservation,
            "failed",
            null,
            error instanceof HttpError ? error.message : "Import failed",
          );
          if (error instanceof HttpError && error.status === 429) break;
        }
      }
    }
    note = imported.length
      ? `${imported.length} new email${imported.length === 1 ? "" : "s"} imported`
      : more
        ? "Mailbox scan continues"
        : "No new email";
    if (failed) note += ` · ${failed} could not be imported`;
    if (more) note += " · more emails waiting — the next check continues";
    return { imported, duplicates, failed, busy: false, note, more };
  } catch (error) {
    note =
      error instanceof HttpError
        ? error.message
        : "Mailbox check failed. It will be retried.";
    throw error;
  } finally {
    await context.db
      .prepare(
        "UPDATE mail_connections SET last_sync_note=?,last_sync_at=?,sync_cursor=?,sync_lease=NULL,sync_lease_until=NULL WHERE workspace=? AND user_id=? AND sync_lease=?",
      )
      .bind(
        note.slice(0, 300) || "Mailbox check failed.",
        now(),
        nextCursor ? JSON.stringify(nextCursor) : null,
        context.workspace,
        context.userId,
        leaseId,
      )
      .run()
      .catch(() => {});
  }
}

export {
  replyInput,
  deliverReply,
  checkMailOperation,
  listMailOperations,
  resolveMailOperation,
  checkOperationInput,
  resolveOperationInput,
} from "./mail-delivery";
