import { HttpError } from "./http";
import {
  GmailClient,
  GmailError,
  exchangeGmailToken,
  type GmailTokens,
  type GmailPart,
  type GmailRawMessage,
} from "./gmail-client";
import { openGmail, sealGmail } from "./gmail-config";

export interface GmailAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  providerAttachmentId?: string;
}
export interface GmailMessage {
  id: string;
  providerId: string;
  threadId: string;
  caseId: string | null;
  from: string;
  replyTo: string;
  subject: string;
  receivedAt: string | null;
  body: string;
  attachments: GmailAttachment[];
  direction: "inbound" | "outbound";
  messageId: string;
  references: string;
  accountEmail: string;
}
export interface GmailConnection {
  workspace: string;
  account_email: string;
  credentials: string;
  history_id: string | null;
  page_token: string | null;
  sync_mode: string;
  sync_until: string | null;
}
export function header(part: GmailPart | undefined, name: string) {
  return (
    part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}
export function decodeHeader(value: string) {
  return value
    .replace(
      /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
      (_m, charset: string, encoding: string, encoded: string) => {
        try {
          const bytes =
            encoding.toLowerCase() === "b"
              ? Buffer.from(encoded, "base64")
              : Buffer.from(
                  encoded
                    .replace(/_/g, " ")
                    .replace(/=([a-f0-9]{2})/gi, (_s, h: string) =>
                      String.fromCharCode(parseInt(h, 16)),
                    ),
                  "latin1",
                );
          return new TextDecoder(charset).decode(bytes);
        } catch {
          return "[undecodable header]";
        }
      },
    )
    .replace(/[\r\n]/g, " ")
    .slice(0, 1000);
}
export function address(value: string) {
  const cleaned = value.replace(/[\r\n]/g, " ").trim();
  const result = cleaned.match(/<([^<>]+)>/)?.[1] ?? cleaned;
  return /^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(result)
    ? result.toLowerCase()
    : "";
}
export function parts(root: GmailPart | undefined): GmailPart[] {
  return root ? [root, ...(root.parts ?? []).flatMap(parts)] : [];
}
export function parseGmailMessage(
  raw: GmailRawMessage,
  accountEmail: string,
  id = crypto.randomUUID(),
): GmailMessage {
  const tree = parts(raw.payload),
    attachments = tree
      .filter((p) => !!p.filename)
      .slice(0, 100)
      .map((p, index) => ({
        id: p.partId ?? `part-${index}`,
        name: decodeHeader(p.filename!),
        mimeType: p.mimeType ?? "application/octet-stream",
        size: p.body?.size ?? 0,
        ...(p.body?.attachmentId
          ? { providerAttachmentId: p.body.attachmentId }
          : {}),
      }));
  const plain = tree
    .filter((p) => !p.filename && p.mimeType === "text/plain" && p.body?.data)
    .map((p) => Buffer.from(p.body!.data!, "base64url").toString("utf8"))
    .join("\n");
  const html = tree
    .filter((p) => !p.filename && p.mimeType === "text/html" && p.body?.data)
    .map((p) => Buffer.from(p.body!.data!, "base64url").toString("utf8"))
    .join("\n");
  const body =
    plain ||
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  const timestamp = Number(raw.internalDate);
  return {
    id,
    providerId: raw.id,
    threadId: raw.threadId,
    caseId: null,
    accountEmail,
    from: address(header(raw.payload, "From")),
    replyTo:
      address(header(raw.payload, "Reply-To")) ||
      address(header(raw.payload, "From")),
    subject: decodeHeader(header(raw.payload, "Subject")).slice(0, 500),
    receivedAt:
      Number.isFinite(timestamp) &&
      timestamp >= 0 &&
      timestamp <= 8640000000000000
        ? new Date(timestamp).toISOString()
        : null,
    body: body.slice(0, 20000),
    attachments,
    direction: raw.labelIds?.includes("SENT") ? "outbound" : "inbound",
    messageId: header(raw.payload, "Message-ID").trim().slice(0, 500),
    references: header(raw.payload, "References").trim().slice(0, 4000),
  };
}
export async function gmailConnection(db: D1Database, workspace: string) {
  return db
    .prepare("SELECT * FROM gmail_connections WHERE workspace=?")
    .bind(workspace)
    .first<GmailConnection>();
}
export async function authorizedGmail(
  db: D1Database,
  workspace: string,
  fetcher: typeof fetch = fetch,
) {
  const connection = await gmailConnection(db, workspace);
  if (!connection) throw new HttpError("Connect Gmail first.", 409);
  let tokens = openGmail<GmailTokens>(connection.credentials, workspace);
  if (tokens.expires_at < Date.now() + 60000) {
    if (!tokens.refresh_token)
      throw new HttpError("Reconnect Gmail to renew mailbox access.", 401);
    const next = await exchangeGmailToken(
      { grant_type: "refresh_token", refresh_token: tokens.refresh_token },
      fetcher,
    );
    tokens = {
      ...next,
      refresh_token: next.refresh_token ?? tokens.refresh_token,
    };
    const saved = await db
      .prepare(
        "UPDATE gmail_connections SET credentials=? WHERE workspace=? AND account_email=?",
      )
      .bind(sealGmail(tokens, workspace), workspace, connection.account_email)
      .run();
    if (saved.meta.changes !== 1)
      throw new HttpError(
        "Gmail was disconnected. Reconnect before continuing.",
        409,
      );
  }
  return { client: new GmailClient(tokens.access_token, fetcher), connection };
}
export async function storedMessage(
  db: D1Database,
  workspace: string,
  id: string,
) {
  const row = await db
    .prepare(
      "SELECT payload,case_id FROM gmail_messages WHERE workspace=? AND id=?",
    )
    .bind(workspace, id)
    .first<{ payload: string; case_id: string | null }>();
  if (!row) throw new HttpError("Message not found in this workspace.", 404);
  return { ...JSON.parse(row.payload), caseId: row.case_id } as GmailMessage;
}
export async function messageList(
  db: D1Database,
  workspace: string,
  caseId?: string,
) {
  const rows = await db
    .prepare(
      `SELECT payload,case_id FROM gmail_messages WHERE workspace=? ${caseId ? "AND case_id=?" : ""} ORDER BY received_at DESC LIMIT 200`,
    )
    .bind(...(caseId ? [workspace, caseId] : [workspace]))
    .all<{ payload: string; case_id: string | null }>();
  return rows.results.map(
    (row) =>
      ({ ...JSON.parse(row.payload), caseId: row.case_id }) as GmailMessage,
  );
}
export async function storeGmailMessage(
  db: D1Database,
  workspace: string,
  message: GmailMessage,
) {
  const links = await db
    .prepare(
      "SELECT DISTINCT case_id FROM gmail_messages WHERE workspace=? AND account_email=? AND thread_id=? AND case_id IS NOT NULL",
    )
    .bind(workspace, message.accountEmail, message.threadId)
    .all<{ case_id: string }>();
  const linked = links.results.length === 1 ? links.results[0].case_id : null;
  const result = await db
    .prepare(
      "INSERT INTO gmail_messages(id,workspace,account_email,provider_id,thread_id,case_id,payload,received_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(workspace,account_email,provider_id) DO NOTHING",
    )
    .bind(
      message.id,
      workspace,
      message.accountEmail,
      message.providerId,
      message.threadId,
      linked,
      JSON.stringify(message),
      message.receivedAt ?? "",
    )
    .run();
  return result.meta.changes === 1;
}
export async function syncGmail(
  db: D1Database,
  workspace: string,
  fetcher: typeof fetch = fetch,
) {
  const { client, connection } = await authorizedGmail(db, workspace, fetcher);
  const now = new Date().toISOString();
  let lease = new Date(Date.now() + 120000).toISOString();
  const labelId = process.env.CARGO_GMAIL_LABEL_ID || "INBOX";
  const locked = await db
    .prepare(
      "UPDATE gmail_connections SET sync_until=? WHERE workspace=? AND (sync_until IS NULL OR sync_until<?)",
    )
    .bind(lease, workspace, now)
    .run();
  if (locked.meta.changes !== 1)
    throw new HttpError(
      "Gmail sync is already running. Wait before trying again.",
      409,
    );
  try {
    let history = connection.history_id,
      pageToken = connection.page_token,
      mode = connection.sync_mode;
    if (mode === "initial" && !history) {
      history = (await client.profile()).historyId;
      await db
        .prepare(
          "UPDATE gmail_connections SET history_id=? WHERE workspace=? AND sync_until=?",
        )
        .bind(history, workspace, lease)
        .run();
    }
    let ids: string[] = [],
      next: string | undefined,
      latest = history,
      recoveryMore = false;
    if (mode === "history" && history) {
      try {
        const page = await client.history(history, pageToken ?? undefined);
        ids = [
          ...new Set(
            (page.history ?? []).flatMap((h) =>
              (h.messagesAdded ?? []).map((m) => m.message.id),
            ),
          ),
        ];
        next = page.nextPageToken;
        latest = page.historyId;
      } catch (error) {
        if (!(error instanceof GmailError) || error.providerStatus !== 404)
          throw error;
        mode = "initial";
        pageToken = null;
        history = (await client.profile()).historyId;
        latest = history;
      }
    }
    if (mode === "initial") {
      const page = await client.list(
        "newer_than:30d",
        pageToken ?? undefined,
        labelId,
      );
      ids = (page.messages ?? []).map((m) => m.id);
      next = page.nextPageToken;
    }
    if (mode === "recovery") {
      // Keyset cursors survive restarts without depending on a live list position.
      // Keep the pre-scan history ID: replies arriving during recovery are then
      // picked up by incremental history, even if they sort before this cursor.
      const cursor = (pageToken ? JSON.parse(pageToken) : {}) as {
        afterThread?: string;
        threadId?: string;
        afterMessage?: string;
      };
      const threads = await db
        .prepare(
          "SELECT DISTINCT thread_id FROM gmail_messages WHERE workspace=? AND account_email=? AND case_id IS NOT NULL AND thread_id>? ORDER BY thread_id LIMIT 2",
        )
        .bind(workspace, connection.account_email, cursor.afterThread ?? "")
        .all<{ thread_id: string }>();
      const threadId = cursor.threadId ?? threads.results[0]?.thread_id;
      if (threadId) {
        let threadIds: string[] = [];
        try {
          const thread = await client.thread(threadId);
          threadIds = [...new Set((thread.messages ?? []).map((m) => m.id))]
            .sort()
            .filter((id) => !cursor.afterMessage || id > cursor.afterMessage);
        } catch (error) {
          if (!(error instanceof GmailError) || error.providerStatus !== 404)
            throw error;
        }
        // At most twenty messages per call, including in unusually long threads.
        ids = threadIds.slice(0, 20);
        if (threadIds.length > ids.length) {
          next = JSON.stringify({
            afterThread: cursor.afterThread,
            threadId,
            afterMessage: ids[ids.length - 1],
          });
          recoveryMore = true;
        } else {
          recoveryMore = threads.results.some((t) => t.thread_id > threadId);
          if (recoveryMore) next = JSON.stringify({ afterThread: threadId });
        }
      }
    }
    let imported = 0;
    // A history page can contain many changes: bound it rather than dropping IDs.
    if (ids.length > 200)
      throw new HttpError(
        "This Gmail history page is too large. Disconnect and reconnect for a bounded recent-inbox resync.",
        413,
      );
    for (let i = 0; i < ids.length; i += 4) {
      const renewed = new Date(Date.now() + 120000).toISOString();
      const heartbeat = await db
        .prepare(
          "UPDATE gmail_connections SET sync_until=? WHERE workspace=? AND sync_until=?",
        )
        .bind(renewed, workspace, lease)
        .run();
      if (heartbeat.meta.changes !== 1)
        throw new HttpError(
          "Mailbox connection changed during synchronization. Retry from the saved cursor.",
          409,
        );
      lease = renewed;
      const group = await Promise.all(
        ids.slice(i, i + 4).map(async (id) => {
          const existing = await db
            .prepare(
              "SELECT id FROM gmail_messages WHERE workspace=? AND account_email=? AND provider_id=?",
            )
            .bind(workspace, connection.account_email, id)
            .first();
          if (existing) return false;
          try {
            const raw = await client.message(id);
            const known = await db
              .prepare(
                "SELECT id FROM gmail_messages WHERE workspace=? AND account_email=? AND thread_id=? AND case_id IS NOT NULL LIMIT 1",
              )
              .bind(workspace, connection.account_email, raw.threadId)
              .first();
            // New unrelated messages follow the configured label. Replies on a known case
            // thread remain visible even when archived or sent from the connected mailbox.
            if (!raw.labelIds?.includes(labelId) && !known) return false;
            return await storeGmailMessage(
              db,
              workspace,
              parseGmailMessage(raw, connection.account_email),
            );
          } catch (error) {
            if (error instanceof GmailError && error.providerStatus === 404)
              return false;
            throw error;
          }
        }),
      );
      imported += group.filter(Boolean).length;
    }
    const recoverThreads = mode === "initial" && !next;
    const more =
      recoverThreads || (mode === "recovery" ? recoveryMore : !!next);
    const saved = await db
      .prepare(
        "UPDATE gmail_connections SET history_id=?,page_token=?,sync_mode=? WHERE workspace=? AND sync_until=?",
      )
      .bind(
        next ? history : latest,
        next ?? null,
        recoverThreads ? "recovery" : more ? mode : "history",
        workspace,
        lease,
      )
      .run();
    if (saved.meta.changes !== 1)
      throw new HttpError(
        "Mailbox connection changed during synchronization. Retry from the saved cursor.",
        409,
      );
    return { imported, more };
  } finally {
    await db
      .prepare(
        "UPDATE gmail_connections SET sync_until=NULL WHERE workspace=? AND sync_until=?",
      )
      .bind(workspace, lease)
      .run()
      .catch(() => {});
  }
}
export async function gmailAttachment(
  db: D1Database,
  workspace: string,
  messageId: string,
  attachmentId: string,
  fetcher: typeof fetch = fetch,
) {
  const message = await storedMessage(db, workspace, messageId),
    attachment = message.attachments.find((a) => a.id === attachmentId);
  if (!attachment) throw new HttpError("Attachment not found.", 404);
  if (attachment.size > 5 * 1024 * 1024)
    throw new HttpError("Each attachment must be 5 MB or smaller.", 413);
  const { client, connection } = await authorizedGmail(db, workspace, fetcher);
  if (connection.account_email !== message.accountEmail)
    throw new HttpError("Reconnect the message's original mailbox.", 409);
  const data = attachment.providerAttachmentId
    ? (
        await client.attachment(
          message.providerId,
          attachment.providerAttachmentId,
        )
      ).data
    : parts((await client.message(message.providerId)).payload).find(
        (p) => p.partId === attachment.id,
      )?.body?.data;
  if (!data)
    throw new HttpError("Gmail no longer contains this attachment.", 404);
  const bytes = new Uint8Array(Buffer.from(data, "base64url"));
  if (bytes.byteLength > 5 * 1024 * 1024)
    throw new HttpError("Each attachment must be 5 MB or smaller.", 413);
  return { attachment, bytes };
}
