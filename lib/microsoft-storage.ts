import { z } from "zod";
import { HttpError } from "./http";
import type { TeamIdentity } from "./auth";
import type { Shipment, ShipmentTask } from "./shipments";
import {
  decryptMicrosoftSecret,
  encryptMicrosoftSecret,
  exchangeMicrosoftToken,
  graphMessagePath,
  microsoftGraph,
  microsoftHash,
  microsoftRandom,
  microsoftRecipient,
  microsoftScopes,
  MicrosoftProviderError,
  type MicrosoftConfig,
  type MicrosoftFetch,
  type MicrosoftTokens,
} from "./microsoft";

export interface MicrosoftContext {
  workspace: string;
  user: TeamIdentity;
  sessionToken: string;
  db: D1Database;
  config: MicrosoftConfig;
  fetcher?: MicrosoftFetch;
}
type Connection = {
  version: number;
  graph_user_id: string;
  account_label: string;
  encrypted_tokens: string;
  updated_at: string;
};
export type DispatchStatus =
  | "creating"
  | "draft"
  | "sending"
  | "submitted"
  | "unknown"
  | "failed";
export interface MicrosoftDispatch {
  id: string;
  shipment_id: string;
  shipment_version: number;
  task_id: string;
  case_id: string;
  case_version: number;
  task_updated_at: string;
  status: DispatchStatus;
  graph_id: string | null;
  payload: string;
  version: number;
  created_at: string;
  updated_at: string;
}
export interface DraftContents {
  recipient: string;
  subject: string;
  body: string;
}
const now = () => new Date().toISOString();
const binding = (context: MicrosoftContext) =>
  `${context.workspace}:${context.user.id}`;
const changes = (result: D1Result) => result.meta.changes === 1;
function audit(context: MicrosoftContext, action: string, operation: string) {
  return context.db
    .prepare(
      "INSERT INTO microsoft_audit(id,workspace,user_id,action,operation_id,created_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(
      crypto.randomUUID(),
      context.workspace,
      context.user.id,
      action,
      operation,
      now(),
    );
}
export async function connectionStatus(
  context: Pick<MicrosoftContext, "db" | "workspace" | "user">,
) {
  const row = await context.db
    .prepare(
      "SELECT account_label,updated_at FROM microsoft_connections WHERE workspace=? AND user_id=?",
    )
    .bind(context.workspace, context.user.id)
    .first<{ account_label: string; updated_at: string }>();
  return row
    ? {
        connected: true,
        account: row.account_label,
        updated_at: row.updated_at,
      }
    : { connected: false, account: null, updated_at: null };
}
export async function startMicrosoftConnect(context: MicrosoftContext) {
  const state = microsoftRandom(),
    verifier = microsoftRandom(),
    expires = new Date(Date.now() + 10 * 60000).toISOString();
  await context.db.batch([
    context.db
      .prepare(
        "DELETE FROM microsoft_oauth_states WHERE expires_at<? OR (workspace=? AND user_id=?)",
      )
      .bind(now(), context.workspace, context.user.id),
    context.db
      .prepare(
        "INSERT INTO microsoft_oauth_states(state_hash,workspace,user_id,session_hash,encrypted_verifier,expires_at) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        await microsoftHash(state),
        context.workspace,
        context.user.id,
        await microsoftHash(context.sessionToken),
        await encryptMicrosoftSecret(
          context.config,
          verifier,
          binding(context),
        ),
        expires,
      ),
    audit(context, "CONNECT_STARTED", "oauth"),
  ]);
  const url = new URL(
    `https://login.microsoftonline.com/${context.config.tenant}/oauth2/v2.0/authorize`,
  );
  url.search = new URLSearchParams({
    client_id: context.config.client,
    response_type: "code",
    redirect_uri: context.config.redirect,
    response_mode: "query",
    scope: microsoftScopes(context.config),
    state,
    code_challenge: await microsoftHash(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { authorize_url: url.href, expires_at: expires };
}
export async function finishMicrosoftConnect(
  context: MicrosoftContext,
  state: string,
  code: string,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !code || code.length > 10000)
    throw new HttpError("Invalid Microsoft connection response.", 400);
  const hash = await microsoftHash(state),
    sessionHash = await microsoftHash(context.sessionToken),
    at = now();
  const row = await context.db
    .prepare(
      "SELECT encrypted_verifier FROM microsoft_oauth_states WHERE state_hash=? AND workspace=? AND user_id=? AND session_hash=? AND expires_at>? AND used_at IS NULL",
    )
    .bind(hash, context.workspace, context.user.id, sessionHash, at)
    .first<{ encrypted_verifier: string }>();
  if (!row)
    throw new HttpError(
      "Connection request expired, was already used or belongs to another session. Start again.",
      409,
    );
  const used = await context.db
    .prepare(
      "UPDATE microsoft_oauth_states SET used_at=? WHERE state_hash=? AND workspace=? AND user_id=? AND session_hash=? AND expires_at>? AND used_at IS NULL",
    )
    .bind(at, hash, context.workspace, context.user.id, sessionHash, at)
    .run();
  if (!changes(used))
    throw new HttpError(
      "Connection request was already used. Start again.",
      409,
    );
  const tokens = await exchangeMicrosoftToken(
    context.config,
    {
      code,
      verifier: await decryptMicrosoftSecret(
        context.config,
        row.encrypted_verifier,
        binding(context),
      ),
    },
    context.fetcher,
  );
  const account = z
    .object({
      id: z.string().min(1).max(1000),
      mail: z.string().max(254).nullable().optional(),
      userPrincipalName: z.string().max(254).optional(),
    })
    .safeParse(
      await microsoftGraph(
        tokens.access_token,
        "/me?$select=id,mail,userPrincipalName",
        {},
        context.fetcher,
      ),
    );
  if (!account.success) throw new MicrosoftProviderError(false);
  const label =
    account.data.mail ??
    account.data.userPrincipalName ??
    "Connected Microsoft account";
  await context.db.batch([
    context.db
      .prepare(
        "INSERT INTO microsoft_connections(workspace,user_id,version,graph_user_id,account_label,encrypted_tokens,updated_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(workspace,user_id) DO UPDATE SET version=microsoft_connections.version+1,graph_user_id=excluded.graph_user_id,account_label=excluded.account_label,encrypted_tokens=excluded.encrypted_tokens,updated_at=excluded.updated_at",
      )
      .bind(
        context.workspace,
        context.user.id,
        account.data.id,
        label,
        await encryptMicrosoftSecret(
          context.config,
          JSON.stringify(tokens),
          binding(context),
        ),
        at,
      ),
    audit(context, "CONNECTED", "oauth"),
  ]);
  return connectionStatus(context);
}
export async function disconnectMicrosoft(context: MicrosoftContext) {
  await context.db.batch([
    context.db
      .prepare(
        "DELETE FROM microsoft_connections WHERE workspace=? AND user_id=?",
      )
      .bind(context.workspace, context.user.id),
    context.db
      .prepare(
        "DELETE FROM microsoft_oauth_states WHERE workspace=? AND user_id=?",
      )
      .bind(context.workspace, context.user.id),
    audit(context, "DISCONNECTED", "connection"),
  ]);
}
export async function microsoftAccessToken(context: MicrosoftContext) {
  const connection = await context.db
    .prepare(
      "SELECT version,encrypted_tokens,graph_user_id,account_label,updated_at FROM microsoft_connections WHERE workspace=? AND user_id=?",
    )
    .bind(context.workspace, context.user.id)
    .first<Connection>();
  if (!connection)
    throw new HttpError("Connect your Microsoft account first.", 409);
  let token: MicrosoftTokens;
  try {
    token = JSON.parse(
      await decryptMicrosoftSecret(
        context.config,
        connection.encrypted_tokens,
        binding(context),
      ),
    );
  } catch {
    throw new HttpError(
      "Microsoft connection credentials cannot be read. Reconnect the account.",
      409,
    );
  }
  if (
    !token.access_token ||
    !token.refresh_token ||
    !Number.isFinite(token.expires_at)
  )
    throw new HttpError("Reconnect the Microsoft account.", 409);
  if (token.expires_at > Date.now() + 60000) return token.access_token;
  token = await exchangeMicrosoftToken(
    context.config,
    { refresh: token.refresh_token },
    context.fetcher,
  );
  const saved = await context.db
    .prepare(
      "UPDATE microsoft_connections SET encrypted_tokens=?,version=version+1,updated_at=? WHERE workspace=? AND user_id=? AND version=?",
    )
    .bind(
      await encryptMicrosoftSecret(
        context.config,
        JSON.stringify(token),
        binding(context),
      ),
      now(),
      context.workspace,
      context.user.id,
      connection.version,
    )
    .run();
  if (!changes(saved))
    throw new HttpError(
      "Microsoft connection changed while refreshing. Retry the read or reconnect.",
      409,
    );
  return token.access_token;
}
export async function listMicrosoftDispatches(
  context: MicrosoftContext,
  shipmentId?: string,
) {
  const rows = await context.db
    .prepare(
      `SELECT id,shipment_id,shipment_version,task_id,case_id,case_version,task_updated_at,status,graph_id,payload,version,created_at,updated_at FROM microsoft_dispatches WHERE workspace=? AND user_id=?${shipmentId ? " AND shipment_id=?" : ""} ORDER BY created_at DESC LIMIT 50`,
    )
    .bind(
      context.workspace,
      context.user.id,
      ...(shipmentId ? [shipmentId] : []),
    )
    .all<MicrosoftDispatch>();
  return rows.results;
}
async function sourceTask(
  context: MicrosoftContext,
  input: {
    shipment_id: string;
    shipment_version: number;
    task_id: string;
    case_version: number;
  },
) {
  const row = await context.db
    .prepare("SELECT version,payload FROM shipments WHERE workspace=? AND id=?")
    .bind(context.workspace, input.shipment_id)
    .first<{ version: number; payload: string }>();
  if (!row || row.version !== input.shipment_version)
    throw new HttpError(
      "Shipment changed. Reload and review the current draft.",
      409,
    );
  const shipment = JSON.parse(row.payload) as Shipment,
    task = shipment.tasks.find((candidate) => candidate.id === input.task_id);
  if (
    !task ||
    task.state === "done" ||
    !shipment.case_ids.includes(task.case_id) ||
    shipment.state === "completed"
  )
    throw new HttpError("This task is no longer open for correspondence.", 409);
  const current = await context.db
    .prepare("SELECT version FROM cases WHERE workspace=? AND email_id=?")
    .bind(context.workspace, task.case_id)
    .first<{ version: number }>();
  if (!current || current.version !== input.case_version)
    throw new HttpError(
      "Source case changed. Review the latest evidence before correspondence.",
      409,
    );
  return { shipment, task };
}
export const createMicrosoftDraftInput = z
  .object({
    shipment_id: z.string().min(1).max(80),
    shipment_version: z.number().int().positive().safe(),
    task_id: z.string().min(1).max(80),
    case_version: z.number().int().positive().safe(),
    recipient: microsoftRecipient,
    reviewed: z.literal(true),
  })
  .strict();
function contents(task: ShipmentTask, recipient: string): DraftContents {
  return { recipient, subject: task.title.slice(0, 500), body: task.body };
}
const extendedId =
  "String {b8bff9af-fd19-4cad-8655-68bd96c54f2a} Name CargoGuardOperation";
async function updateDispatch(
  context: MicrosoftContext,
  id: string,
  expectedStatus: DispatchStatus,
  status: DispatchStatus,
  graphId?: string,
) {
  await context.db.batch([
    context.db
      .prepare(
        "UPDATE microsoft_dispatches SET status=?,graph_id=COALESCE(?,graph_id),version=version+1,updated_at=? WHERE workspace=? AND user_id=? AND id=? AND status=?",
      )
      .bind(
        status,
        graphId ?? null,
        now(),
        context.workspace,
        context.user.id,
        id,
        expectedStatus,
      ),
    context.db
      .prepare(
        "INSERT INTO microsoft_audit(id,workspace,user_id,action,operation_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        context.workspace,
        context.user.id,
        `DRAFT_${status.toUpperCase()}`,
        id,
        now(),
      ),
  ]);
}
async function readDispatch(context: MicrosoftContext, id: string) {
  return context.db
    .prepare(
      "SELECT id,shipment_id,shipment_version,task_id,case_id,case_version,task_updated_at,status,graph_id,payload,version,created_at,updated_at FROM microsoft_dispatches WHERE workspace=? AND user_id=? AND id=?",
    )
    .bind(context.workspace, context.user.id, id)
    .first<MicrosoftDispatch>();
}
export async function createMicrosoftDraft(
  context: MicrosoftContext,
  raw: z.infer<typeof createMicrosoftDraftInput>,
) {
  const input = createMicrosoftDraftInput.parse(raw),
    { task } = await sourceTask(context, input);
  const draft = contents(task, input.recipient),
    payload = JSON.stringify(draft);
  const key = await microsoftHash(
    JSON.stringify([
      input.shipment_id,
      input.shipment_version,
      input.task_id,
      task.updated_at,
      input.case_version,
      payload,
    ]),
  );
  const prior = await context.db
    .prepare(
      "SELECT id FROM microsoft_dispatches WHERE workspace=? AND user_id=? AND dedupe_key=?",
    )
    .bind(context.workspace, context.user.id, key)
    .first<{ id: string }>();
  if (prior)
    return { dispatch: await readDispatch(context, prior.id), duplicate: true };
  // Acquire credentials before reserving an outbound operation. No provider call
  // is retried after the durable creating state exists.
  const token = await microsoftAccessToken(context),
    id = crypto.randomUUID(),
    at = now();
  const saved = await context.db.batch([
    context.db
      .prepare(
        "INSERT INTO microsoft_dispatches(workspace,id,user_id,dedupe_key,shipment_id,shipment_version,task_id,case_id,case_version,task_updated_at,status,payload,version,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,'creating',?,1,?,? WHERE EXISTS(SELECT 1 FROM shipments WHERE workspace=? AND id=? AND version=?) AND EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?) ON CONFLICT(workspace,user_id,dedupe_key) DO NOTHING",
      )
      .bind(
        context.workspace,
        id,
        context.user.id,
        key,
        input.shipment_id,
        input.shipment_version,
        input.task_id,
        task.case_id,
        input.case_version,
        task.updated_at,
        payload,
        at,
        at,
        context.workspace,
        input.shipment_id,
        input.shipment_version,
        context.workspace,
        task.case_id,
        input.case_version,
      ),
    context.db
      .prepare(
        "INSERT INTO microsoft_audit(id,workspace,user_id,action,operation_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        context.workspace,
        context.user.id,
        "DRAFT_CREATE_RESERVED",
        id,
        at,
      ),
  ]);
  if (!changes(saved[0]))
    throw new HttpError(
      "Draft or source changed concurrently. Reload correspondence before retrying.",
      409,
    );
  try {
    const created = z
      .object({ id: z.string().min(1).max(1000) })
      .safeParse(
        await microsoftGraph(
          token,
          "/me/messages",
          {
            method: "POST",
            body: {
              subject: draft.subject,
              body: { contentType: "Text", content: draft.body },
              toRecipients: [{ emailAddress: { address: draft.recipient } }],
              singleValueExtendedProperties: [{ id: extendedId, value: id }],
            },
          },
          context.fetcher,
        ),
      );
    if (!created.success) throw new MicrosoftProviderError(true);
    await updateDispatch(context, id, "creating", "draft", created.data.id);
  } catch (error) {
    await updateDispatch(
      context,
      id,
      "creating",
      error instanceof MicrosoftProviderError && !error.uncertain
        ? "failed"
        : "unknown",
    ).catch(() => undefined);
    throw error instanceof HttpError ? error : new MicrosoftProviderError(true);
  }
  return { dispatch: await readDispatch(context, id), duplicate: false };
}
export const sendMicrosoftDraftInput = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive().safe(),
    confirmed: z.literal(true),
  })
  .strict();
export async function sendMicrosoftDraft(
  context: MicrosoftContext,
  raw: z.infer<typeof sendMicrosoftDraftInput>,
) {
  if (!context.config.allowSend)
    throw new HttpError(
      "Sending is disabled. Review and send the draft in Outlook.",
      403,
    );
  if (!["reviewer", "admin"].includes(context.user.role))
    throw new HttpError(
      "A reviewer or administrator must authorize sending.",
      403,
    );
  const input = sendMicrosoftDraftInput.parse(raw),
    record = await readDispatch(context, input.id);
  if (!record) throw new HttpError("Correspondence record not found.", 404);
  if (record.status === "submitted")
    return { dispatch: record, duplicate: true };
  if (
    record.status !== "draft" ||
    record.version !== input.version ||
    !record.graph_id
  )
    throw new HttpError(
      "Draft is no longer sendable. Refresh and inspect the mailbox for uncertain outcomes.",
      409,
    );
  const { task } = await sourceTask(context, record),
    approved = JSON.parse(record.payload) as DraftContents;
  if (
    task.updated_at !== record.task_updated_at ||
    JSON.stringify(contents(task, approved.recipient)) !== record.payload
  )
    throw new HttpError(
      "Task draft changed. Create and review a new correspondence draft.",
      409,
    );
  const token = await microsoftAccessToken(context);
  const remote = z
    .object({
      isDraft: z.boolean(),
      subject: z.string(),
      body: z.object({ contentType: z.string(), content: z.string() }),
      toRecipients: z.array(
        z.object({ emailAddress: z.object({ address: z.string() }) }),
      ),
      ccRecipients: z.array(z.unknown()).optional(),
      bccRecipients: z.array(z.unknown()).optional(),
      hasAttachments: z.boolean().optional(),
    })
    .safeParse(
      await microsoftGraph(
        token,
        `${graphMessagePath(record.graph_id)}?$select=isDraft,subject,body,toRecipients,ccRecipients,bccRecipients,hasAttachments`,
        {},
        context.fetcher,
      ),
    );
  const clean = (text: string) => text.replace(/\r\n/g, "\n");
  if (
    !remote.success ||
    !remote.data.isDraft ||
    remote.data.subject !== approved.subject ||
    remote.data.body.contentType.toLowerCase() !== "text" ||
    clean(remote.data.body.content) !== clean(approved.body) ||
    remote.data.toRecipients.length !== 1 ||
    remote.data.toRecipients[0].emailAddress.address.toLowerCase() !==
      approved.recipient ||
    remote.data.ccRecipients?.length ||
    remote.data.bccRecipients?.length ||
    remote.data.hasAttachments
  )
    throw new HttpError(
      "The Outlook draft changed outside CargoGuard. Review it in Outlook; this saved authorization cannot send modified content.",
      409,
    );
  // Recheck source versions in the transaction immediately before dispatch. A
  // durable sending reservation prevents concurrent and timed-out resends.
  const saved = await context.db.batch([
    context.db
      .prepare(
        "UPDATE microsoft_dispatches SET status='sending',version=version+1,updated_at=? WHERE workspace=? AND user_id=? AND id=? AND status='draft' AND version=? AND EXISTS(SELECT 1 FROM shipments WHERE workspace=? AND id=? AND version=?) AND EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?)",
      )
      .bind(
        now(),
        context.workspace,
        context.user.id,
        record.id,
        input.version,
        context.workspace,
        record.shipment_id,
        record.shipment_version,
        context.workspace,
        record.case_id,
        record.case_version,
      ),
    context.db
      .prepare(
        "INSERT INTO microsoft_audit(id,workspace,user_id,action,operation_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        context.workspace,
        context.user.id,
        "SEND_RESERVED",
        record.id,
        now(),
      ),
  ]);
  if (!changes(saved[0]))
    throw new HttpError(
      "Draft or source changed concurrently. Nothing was dispatched by this request.",
      409,
    );
  try {
    await microsoftGraph(
      token,
      `${graphMessagePath(record.graph_id)}/send`,
      { method: "POST" },
      context.fetcher,
    );
    await updateDispatch(context, record.id, "sending", "submitted");
  } catch (error) {
    await updateDispatch(context, record.id, "sending", "unknown").catch(
      () => undefined,
    );
    throw error instanceof HttpError ? error : new MicrosoftProviderError(true);
  }
  return { dispatch: await readDispatch(context, record.id), duplicate: false };
}
