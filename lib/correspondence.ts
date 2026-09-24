import { HttpError } from "./http";
import { GmailError, type GmailClient } from "./gmail-client";
import {
  authorizedGmail,
  storedMessage,
  address,
  header,
  type GmailMessage,
} from "./gmail-storage";
import type { CaseResult } from "./types";

export interface CorrespondenceDraft {
  id: string;
  caseId: string;
  caseVersion: number;
  replyToMessageId: string;
  version: number;
  to: string;
  cc: string;
  subject: string;
  body: string;
  status: "ready" | "sending" | "sent" | "uncertain" | "failed";
  accountEmail: string;
  threadId: string;
  inReplyTo: string;
  references: string;
  operationId?: string;
  providerMessageId?: string;
  error?: string;
  updatedAt: string;
}
export async function correspondenceCase(
  db: D1Database,
  workspace: string,
  id: string,
) {
  const row = await db
    .prepare(
      "SELECT payload,version FROM cases WHERE workspace=? AND email_id=?",
    )
    .bind(workspace, id)
    .first<{ payload: string; version: number }>();
  if (!row) throw new HttpError("Case not found in this workspace.", 404);
  return { ...JSON.parse(row.payload), version: row.version } as CaseResult;
}
export function recipientList(value: string, required = false) {
  if (/[\r\n]/.test(value))
    throw new HttpError("Recipient headers cannot contain line breaks.");
  const entries = value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    (required && !entries.length) ||
    entries.length > 10 ||
    entries.some((s) => !address(s) || address(s) !== s.toLowerCase())
  )
    throw new HttpError(
      "Use up to ten comma-separated email addresses without display names.",
    );
  return [...new Set(entries.map((s) => s.toLowerCase()))].join(", ");
}
export function replySubject(subject: string) {
  return `Re: ${subject
    .replace(/^(?:\s*re:\s*)+/i, "")
    .replace(/[\r\n]/g, " ")
    .trim()}`.slice(0, 500);
}
export function messageIdHeader(value: string) {
  if (!/^<[^\s<>\r\n]+@[^\s<>\r\n]+>$/.test(value))
    throw new HttpError(
      "This message has no usable Message-ID. Reply directly in Gmail.",
      422,
    );
  return value;
}
export async function draftById(db: D1Database, workspace: string, id: string) {
  const row = await db
    .prepare(
      "SELECT payload,version,status,operation_id FROM correspondence_drafts WHERE workspace=? AND id=?",
    )
    .bind(workspace, id)
    .first<{
      payload: string;
      version: number;
      status: CorrespondenceDraft["status"];
      operation_id: string | null;
    }>();
  if (!row) throw new HttpError("Draft not found.", 404);
  return {
    ...JSON.parse(row.payload),
    version: row.version,
    status: row.status,
    ...(row.operation_id ? { operationId: row.operation_id } : {}),
  } as CorrespondenceDraft;
}
export async function draftList(
  db: D1Database,
  workspace: string,
  caseId?: string,
) {
  const rows = await db
    .prepare(
      `SELECT id FROM correspondence_drafts WHERE workspace=? ${caseId ? "AND case_id=?" : ""} ORDER BY updated_at DESC LIMIT 100`,
    )
    .bind(...(caseId ? [workspace, caseId] : [workspace]))
    .all<{ id: string }>();
  return Promise.all(rows.results.map((r) => draftById(db, workspace, r.id)));
}
export async function linkMessage(
  db: D1Database,
  workspace: string,
  messageId: string,
  caseId: string,
  version: number,
) {
  const message = await storedMessage(db, workspace, messageId);
  if (message.caseId && message.caseId !== caseId)
    throw new HttpError(
      "This message already belongs to another case. An owner must resolve its mapping before moving it.",
      409,
    );
  const result = await db.batch([
    db
      .prepare(
        "UPDATE gmail_messages SET case_id=? WHERE workspace=? AND id=? AND (case_id IS NULL OR case_id=?) AND EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?)",
      )
      .bind(caseId, workspace, messageId, caseId, workspace, caseId, version),
    db
      .prepare(
        "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,'MESSAGE_LINKED','Workspace reviewer',?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        workspace,
        caseId,
        JSON.stringify({ messageId, providerId: message.providerId }),
        new Date().toISOString(),
      ),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError(
      "Case or message changed. Refresh before linking.",
      409,
    );
  return { ...message, caseId };
}
export async function saveReplyDraft(
  db: D1Database,
  workspace: string,
  input: {
    caseId: string;
    version: number;
    replyToMessageId: string;
    to: string;
    cc: string;
    body: string;
    draftId?: string;
    draftVersion?: number;
  },
) {
  const current = await correspondenceCase(db, workspace, input.caseId),
    message = await storedMessage(db, workspace, input.replyToMessageId);
  if (current.version !== input.version || message.caseId !== input.caseId)
    throw new HttpError(
      "Case or reply target changed. Reload and review the draft.",
      409,
    );
  if (message.direction !== "inbound")
    throw new HttpError("Choose an incoming message as the reply target.", 422);
  const previous = input.draftId
    ? await draftById(db, workspace, input.draftId)
    : null;
  if (
    previous &&
    (previous.caseId !== input.caseId ||
      previous.version !== input.draftVersion ||
      !["ready", "failed"].includes(previous.status))
  )
    throw new HttpError(
      "This draft changed or has already been dispatched. Refresh its status.",
      409,
    );
  const body = input.body.trim();
  if (!body || body.length > 20000)
    throw new HttpError("The reply must contain 1–20,000 characters.");
  const inReplyTo = messageIdHeader(message.messageId);
  const refs = [
    ...(message.references.match(/<[^\s<>]+@[^\s<>]+>/g) ?? []),
    inReplyTo,
  ];
  const draft: CorrespondenceDraft = {
    id: previous?.id ?? crypto.randomUUID(),
    caseId: input.caseId,
    caseVersion: input.version,
    replyToMessageId: message.id,
    version: (previous?.version ?? 0) + 1,
    to: recipientList(input.to, true),
    cc: recipientList(input.cc),
    subject: replySubject(message.subject),
    body,
    status: "ready",
    accountEmail: message.accountEmail,
    threadId: message.threadId,
    inReplyTo,
    references: [...new Set(refs)].slice(-15).join(" "),
    updatedAt: new Date().toISOString(),
  };
  const statement = previous
    ? db
        .prepare(
          "UPDATE correspondence_drafts SET payload=?,version=?,case_version=?,status='ready',operation_id=NULL,updated_at=? WHERE workspace=? AND id=? AND version=? AND status IN ('ready','failed') AND EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?)",
        )
        .bind(
          JSON.stringify(draft),
          draft.version,
          draft.caseVersion,
          draft.updatedAt,
          workspace,
          draft.id,
          previous.version,
          workspace,
          input.caseId,
          input.version,
        )
    : db
        .prepare(
          "INSERT INTO correspondence_drafts(id,workspace,case_id,case_version,version,status,payload,updated_at) SELECT ?,?,?,?,?,'ready',?,? WHERE EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?)",
        )
        .bind(
          draft.id,
          workspace,
          draft.caseId,
          draft.caseVersion,
          draft.version,
          JSON.stringify(draft),
          draft.updatedAt,
          workspace,
          input.caseId,
          input.version,
        );
  const result = await statement.run();
  if (result.meta.changes !== 1)
    throw new HttpError(
      "Case or draft changed. Review the current version.",
      409,
    );
  return draft;
}
export function replyMime(draft: CorrespondenceDraft, operationId: string) {
  // Encoded words must fit RFC 2047's 75-character limit. Fold at whole Unicode
  // characters; do not split a multi-byte UTF-8 code point or invent a new subject.
  const words: string[] = [];
  let current = "";
  for (const character of draft.subject) {
    if (Buffer.byteLength(current + character) > 42) {
      words.push(current);
      current = "";
    }
    current += character;
  }
  if (current) words.push(current);
  const subject = words
    .map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`)
    .join("\r\n ");
  const body =
    Buffer.from(draft.body)
      .toString("base64")
      .match(/.{1,76}/g)
      ?.join("\r\n") ?? "";
  return Buffer.from(
    [
      `From: ${recipientList(draft.accountEmail, true)}`,
      `To: ${recipientList(draft.to, true).replace(/, /g, ",\r\n ")}`,
      ...(draft.cc
        ? [`Cc: ${recipientList(draft.cc).replace(/, /g, ",\r\n ")}`]
        : []),
      `Subject: ${subject}`,
      `Message-ID: <${operationId}@cargoguard.local>`,
      `In-Reply-To: ${messageIdHeader(draft.inReplyTo)}`,
      `References: ${draft.references.split(" ").map(messageIdHeader).join("\r\n ")}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      body,
    ].join("\r\n"),
  ).toString("base64url");
}
async function finishDraft(
  db: D1Database,
  workspace: string,
  draft: CorrespondenceDraft,
) {
  const result = await db.batch([
    db
      .prepare(
        "UPDATE correspondence_drafts SET payload=?,status=?,updated_at=? WHERE workspace=? AND id=? AND operation_id=? AND status IN ('sending','uncertain')",
      )
      .bind(
        JSON.stringify(draft),
        draft.status,
        new Date().toISOString(),
        workspace,
        draft.id,
        draft.operationId!,
      ),
    db
      .prepare(
        "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,?,'Workspace reviewer',?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        workspace,
        draft.caseId,
        `EMAIL_${draft.status.toUpperCase()}`,
        JSON.stringify({
          draftId: draft.id,
          operationId: draft.operationId,
          providerMessageId: draft.providerMessageId,
        }),
        new Date().toISOString(),
      ),
  ]);
  if (result[0].meta.changes !== 1) return draftById(db, workspace, draft.id);
  return draft;
}
export async function sendReply(
  db: D1Database,
  workspace: string,
  id: string,
  version: number,
  fetcher: typeof fetch = fetch,
) {
  let draft = await draftById(db, workspace, id);
  // A repeated browser request reports its durable operation, never sends again.
  if (["sending", "sent", "uncertain"].includes(draft.status)) return draft;
  if (draft.version !== version || draft.status !== "ready")
    throw new HttpError(
      "Save and review the current draft before sending.",
      409,
    );
  const { client, connection } = await authorizedGmail(db, workspace, fetcher);
  if (connection.account_email !== draft.accountEmail)
    throw new HttpError("The connected mailbox does not own this reply.", 409);
  const operationId = crypto.randomUUID();
  const claimed = await db
    .prepare(
      "UPDATE correspondence_drafts SET status='sending',operation_id=?,updated_at=? WHERE workspace=? AND id=? AND version=? AND status='ready' AND EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?)",
    )
    .bind(
      operationId,
      new Date().toISOString(),
      workspace,
      id,
      version,
      workspace,
      draft.caseId,
      draft.caseVersion,
    )
    .run();
  if (claimed.meta.changes !== 1)
    throw new HttpError(
      "The case changed or this reply is already being sent. Refresh; do not resend.",
      409,
    );
  draft = { ...draft, status: "sending", operationId };
  try {
    const sent = await client.send(
      replyMime(draft, operationId),
      draft.threadId,
    );
    if (!sent.id) throw new Error("Missing send receipt");
    return await finishDraft(db, workspace, {
      ...draft,
      status: "sent",
      providerMessageId: sent.id,
      error: undefined,
    });
  } catch (error) {
    const rejected =
      error instanceof GmailError &&
      [400, 401, 403, 404, 413, 429].includes(error.providerStatus);
    // Network errors and 5xx may follow a committed send. Never automatically replay.
    return finishDraft(db, workspace, {
      ...draft,
      status: rejected ? "failed" : "uncertain",
      error: rejected
        ? "Gmail rejected this send. Review and save the draft before trying again."
        : "Delivery is uncertain. Check sent mail using Reconcile; this operation will not be sent again automatically.",
    });
  }
}
export async function reconcileReply(
  db: D1Database,
  workspace: string,
  id: string,
  fetcher: typeof fetch = fetch,
) {
  const draft = await draftById(db, workspace, id);
  if (!["sending", "uncertain"].includes(draft.status) || !draft.operationId)
    return draft;
  const { client, connection } = await authorizedGmail(db, workspace, fetcher);
  if (connection.account_email !== draft.accountEmail)
    throw new HttpError("Connect the original sending mailbox.", 409);
  return reconcileWithClient(db, workspace, draft, client);
}
export async function reconcileWithClient(
  db: D1Database,
  workspace: string,
  draft: CorrespondenceDraft,
  client: GmailClient,
) {
  const found = await client.list(
    `in:sent rfc822msgid:${draft.operationId}@cargoguard.local`,
  );
  for (const ref of found.messages ?? []) {
    const message = await client.message(ref.id);
    if (
      message.threadId === draft.threadId &&
      header(message.payload, "Message-ID").trim() ===
        `<${draft.operationId}@cargoguard.local>`
    )
      return finishDraft(db, workspace, {
        ...draft,
        status: "sent",
        providerMessageId: message.id,
        error: undefined,
      });
  }
  return finishDraft(db, workspace, {
    ...draft,
    status: "uncertain",
    error:
      "No matching sent receipt found yet. Gmail indexing may lag. Check the mailbox and reconcile again; automatic resend remains blocked.",
  });
}
export function replyCandidate(message: GmailMessage) {
  return {
    to: message.replyTo || message.from,
    cc: "",
    subject: replySubject(message.subject),
  };
}
