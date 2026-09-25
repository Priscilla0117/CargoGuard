import { z } from "zod";
import { HttpError } from "./http";
import { sha256 } from "./mail-connector";
import { gmailDeliver, gmailFindSent, gmailReplyThread } from "./gmail";
import { buildRawMessage } from "./mail-mime";
import {
  connection,
  googleAccess,
  imapSecret,
  type MailContext,
} from "./mail-storage";
import { recordSentFollowUp } from "./follow-up-storage";
import { replyIntentBlocker } from "./reply";
import type { CaseResult } from "./types";

export const replyInput = z
  .object({
    case_id: z.string().min(1).max(120),
    case_version: z.number().int().positive().safe(),
    operation_id: z.string().uuid(),
    mode: z.enum(["draft", "send"]),
    intent: z
      .enum([
        "request_correction",
        "confirm_match",
        "request_documents",
        "ask_clarification",
        "acknowledge",
        "blank",
      ])
      .default("blank"),
    follow_up: z.boolean().default(false),
    confirmed: z.literal(true),
    to: z.array(z.string().trim().email().max(254)).min(1).max(20),
    cc: z.array(z.string().trim().email().max(254)).max(20),
    subject: z.string().trim().min(1).max(500),
    body: z.string().min(1).max(20000),
  })
  .strict();
export const checkOperationInput = z
  .object({
    action: z.literal("check"),
    operation_id: z.string().uuid(),
    case_id: z.string().min(1).max(120),
  })
  .strict();
export const resolveOperationInput = z
  .object({
    action: z.literal("resolve"),
    operation_id: z.string().uuid(),
    case_id: z.string().min(1).max(120),
    decision: z.enum(["confirmed_sent", "confirmed_not_sent"]),
    confirmed: z.literal(true),
    note: z.string().trim().min(10).max(1000),
  })
  .strict();
type MailOperation = {
  id: string;
  case_id: string;
  case_version: number;
  provider: string;
  account: string;
  mode: "draft" | "send";
  status: "sending" | "unknown" | "submitted" | "draft" | "cancelled";
  payload_hash: string;
  message_id: string;
  provider_id: string | null;
  receipt: string | null;
  follow_up: number;
  follow_up_recorded: number;
  created_at: string;
  updated_at: string;
};
const now = () => new Date().toISOString();
async function readOperation(context: MailContext, id: string) {
  return context.db
    .prepare(
      "SELECT * FROM mail_operations WHERE workspace=? AND user_id=? AND id=?",
    )
    .bind(context.workspace, context.userId, id)
    .first<MailOperation>();
}
function receiptOf(op: MailOperation): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(op.receipt ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
function recipientReceipt(op: MailOperation) {
  const parsed = z
    .object({
      rejected: z.array(z.string()).default([]),
      accepted: z.array(z.string()).default([]),
    })
    .safeParse(receiptOf(op));
  return parsed.success ? parsed.data : { rejected: [], accepted: [] };
}
function hasProviderReceipt(op: MailOperation) {
  // An RFC Message-ID is allocated locally and is not proof of acceptance.
  // SMTP can confirm acceptance without returning a separate provider ID.
  return (
    !!op.provider_id ||
    (recipientReceipt(op).accepted.length > 0 &&
      typeof receiptOf(op).response === "string")
  );
}
function view(op: MailOperation, duplicate = true) {
  const { rejected, accepted } = recipientReceipt(op);
  return {
    operation_id: op.id,
    case_id: op.case_id,
    case_version: op.case_version,
    status: op.status,
    mode: op.mode,
    account: op.account,
    provider: op.provider,
    provider_id: op.provider_id,
    message_id: op.message_id,
    created_at: op.created_at,
    duplicate,
    rejected_recipients: rejected,
    accepted_recipients: accepted,
    confirmation_source: hasProviderReceipt(op)
      ? "provider"
      : receiptOf(op).manually_confirmed === "confirmed_sent"
        ? "employee"
        : null,
    where:
      op.mode === "draft"
        ? `${op.provider === "gmail" ? "Gmail" : "Mailbox"} Drafts`
        : "mail provider",
    follow_up_recorded: op.follow_up ? !!op.follow_up_recorded : null,
    message:
      op.status === "unknown"
        ? rejected.length
          ? `The mail server rejected ${rejected.join(", ")}; other recipients may have received the message. Check the mailbox before recording a decision. CargoGuard will not resend this operation.`
          : "The mailbox outcome is uncertain. Check the original mailbox before recording a decision. CargoGuard will not resend this operation."
        : op.status === "sending"
          ? "This operation is still pending. Check its status; do not send another copy."
          : op.status === "submitted"
            ? rejected.length
              ? `Submission was recorded, but ${rejected.join(", ")} were rejected. Follow up with those recipients separately; response tracking was not started.`
              : !hasProviderReceipt(op)
                ? "An employee recorded submission after checking the mailbox. No provider acceptance receipt is available, so response tracking was not started. Record a follow-up separately after verifying the request."
                : "The message was submitted. This is not a delivery receipt."
            : op.status === "cancelled"
              ? "You recorded that no message was submitted. This operation will never send again."
              : "Draft saved in the mailbox. Review it there before sending.",
  };
}
async function trackRequest(context: MailContext, op: MailOperation) {
  if (op.status !== "submitted" || !op.follow_up || op.follow_up_recorded)
    return op;
  if (!hasProviderReceipt(op)) return op;
  if (recipientReceipt(op).rejected.length) return op;
  try {
    await recordSentFollowUp(
      context.workspace,
      {
        id: op.case_id,
        case_version: op.case_version,
        request_id: op.id,
        provider_message_id: op.provider_id || op.message_id,
        requested_at: op.updated_at,
        actor: context.actor,
        purpose: "documents_or_correction",
        note: `Reviewed request submitted from ${op.account}.`,
      },
      context.db,
    );
    await context.db
      .prepare(
        "UPDATE mail_operations SET follow_up_recorded=1 WHERE workspace=? AND user_id=? AND id=? AND status='submitted'",
      )
      .bind(context.workspace, context.userId, op.id)
      .run();
    return { ...op, follow_up_recorded: 1 };
  } catch {
    // A successful remote send must never be retried because tracking failed.
    return op;
  }
}
async function transition(
  context: MailContext,
  op: MailOperation,
  status: MailOperation["status"],
  providerId: string | null,
  receipt: unknown,
  action: string,
) {
  const at = now();
  const result = await context.db.batch([
    context.db
      .prepare(
        "UPDATE mail_operations SET status=?,provider_id=?,receipt=?,updated_at=? WHERE workspace=? AND user_id=? AND id=? AND status=?",
      )
      .bind(
        status,
        providerId,
        JSON.stringify(receipt),
        at,
        context.workspace,
        context.userId,
        op.id,
        op.status,
      ),
    context.db
      .prepare(
        "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        context.workspace,
        op.case_id,
        action,
        context.actor,
        JSON.stringify({
          summary: `${action}: ${op.account}`,
          operation_id: op.id,
          provider_id: providerId,
          message_id: op.message_id,
          receipt,
        }),
        at,
      ),
  ]);
  if (result[0].meta.changes !== 1)
    throw new HttpError(
      "Mail operation changed. Check its latest status.",
      409,
    );
  return {
    ...op,
    status,
    provider_id: providerId,
    receipt: JSON.stringify(receipt),
    updated_at: at,
  };
}

export async function listMailOperations(context: MailContext, caseId: string) {
  const rows = await context.db
    .prepare(
      "SELECT * FROM mail_operations WHERE workspace=? AND user_id=? AND case_id=? ORDER BY created_at DESC LIMIT 30",
    )
    .bind(context.workspace, context.userId, caseId)
    .all<MailOperation>();
  return { operations: rows.results.map((op) => view(op)) };
}
export async function checkMailOperation(
  context: MailContext,
  id: string,
  caseId: string,
) {
  let op = await readOperation(context, id);
  if (!op || op.case_id !== caseId)
    throw new HttpError("Mail operation not found.", 404);
  // A crashed request remains fenced forever; expiry only enables reconciliation.
  if (
    op.status === "sending" &&
    Date.parse(op.created_at) < Date.now() - 10 * 60000
  )
    op = await transition(
      context,
      op,
      "unknown",
      op.provider_id,
      { reason: "Interrupted operation; mailbox confirmation required" },
      "REPLY_OUTCOME_UNKNOWN",
    );
  if (
    op.status === "unknown" &&
    op.mode === "send" &&
    op.provider === "gmail"
  ) {
    const row = await connection(context);
    if (row?.provider === "gmail" && row.account === op.account) {
      try {
        const receipt = await gmailFindSent(
          await googleAccess(context, row),
          op.message_id,
          context.fetcher,
        );
        if (receipt)
          op = await transition(
            context,
            op,
            "submitted",
            receipt,
            { gmail_id: receipt, reconciled: true },
            "REPLY_SEND_RECONCILED",
          );
      } catch {
        /* Provider unavailability never authorizes a retry. */
      }
    }
  }
  return view(await trackRequest(context, op));
}
export async function resolveMailOperation(
  context: MailContext,
  raw: z.infer<typeof resolveOperationInput>,
) {
  const input = resolveOperationInput.parse(raw);
  const op = await readOperation(context, input.operation_id);
  if (!op || op.case_id !== input.case_id)
    throw new HttpError("Mail operation not found.", 404);
  if (op.status !== "unknown")
    throw new HttpError(
      "Only an uncertain operation can be manually reconciled. Check its status first.",
      409,
    );
  if (input.decision === "confirmed_not_sent" && hasProviderReceipt(op))
    throw new HttpError(
      "A provider acceptance receipt is already recorded. Verify the accepted recipients and record submission; do not retry the original recipients.",
      409,
    );
  const status =
    input.decision === "confirmed_not_sent"
      ? "cancelled"
      : op.mode === "draft"
        ? "draft"
        : "submitted";
  const updated = await transition(
    context,
    op,
    status,
    op.provider_id,
    {
      ...receiptOf(op),
      manually_confirmed: input.decision,
      note: input.note,
      actor: context.actor,
    },
    "REPLY_MANUALLY_RECONCILED",
  );
  return view(await trackRequest(context, updated));
}

/** Reserve locally before the provider effect. No unknown operation is resent. */
export async function deliverReply(
  context: MailContext,
  rawInput: z.infer<typeof replyInput>,
  source: CaseResult,
  transport?: Pick<
    typeof import("./imap-adapter"),
    "imapSaveDraft" | "imapServer" | "smtpSend"
  >,
) {
  const input = replyInput.parse(rawInput);
  if (context.background)
    throw new HttpError(
      "The background intake service cannot draft or send email.",
      403,
    );
  const row = await connection(context);
  if (!row) throw new HttpError("Connect Gmail or another mailbox first.", 409);
  const id = input.operation_id;
  const contents = { ...input, operation_id: undefined };
  const hash = await sha256(
    JSON.stringify({
      ...contents,
      provider: row.provider,
      account: row.account,
    }),
  );
  const prior = await context.db
    .prepare(
      "SELECT * FROM mail_operations WHERE workspace=? AND user_id=? AND (id=? OR (payload_hash=? AND status!='cancelled')) ORDER BY (id=?) DESC LIMIT 1",
    )
    .bind(context.workspace, context.userId, id, hash, id)
    .first<MailOperation>();
  if (prior) {
    if (prior.payload_hash !== hash)
      throw new HttpError(
        "This operation ID belongs to different reviewed content. Check its status before preparing another reply.",
        409,
      );
    return checkMailOperation(context, prior.id, input.case_id);
  }
  if (input.case_version !== source.version)
    throw new HttpError(
      "This case changed after the reply was prepared. Reload and review the new evidence before sending.",
      409,
    );
  const blocker = replyIntentBlocker(source, input.intent);
  if (blocker) throw new HttpError(blocker, 409);
  if (
    input.follow_up &&
    (input.mode !== "send" ||
      ![
        "request_correction",
        "request_documents",
        "ask_clarification",
      ].includes(input.intent))
  )
    throw new HttpError(
      "Only a sent request for documents or clarification can start response tracking.",
      400,
    );
  if (input.mode === "send" && !context.config.allowSend)
    throw new HttpError(
      "Sending is disabled on this server. Save a draft instead.",
      403,
    );
  const token =
    row.provider === "gmail" ? await googleAccess(context, row) : null;
  // Resolve with this mailbox's credentials before reserving a remote effect.
  // An imported thread hint may belong to another employee's mailbox.
  const replyThread =
    token && source.email.message_id
      ? await gmailReplyThread(token, source.email.message_id, context.fetcher)
      : undefined;
  const secret =
    row.provider === "imap" ? await imapSecret(context, row) : null;
  const domain =
    row.account.split("@")[1]?.replace(/[^a-z0-9.-]/gi, "") ||
    "cargoguard.local";
  const messageId = `${id}@${domain}`;
  const at = now();
  const saved = await context.db
    .prepare(
      "INSERT INTO mail_operations(workspace,user_id,id,case_id,case_version,provider,account,mode,payload_hash,message_id,status,follow_up,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,'sending',?,?,? WHERE EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?) AND EXISTS(SELECT 1 FROM mail_connections WHERE workspace=? AND user_id=? AND provider=? AND account=?) AND NOT EXISTS(SELECT 1 FROM mail_operations WHERE workspace=? AND user_id=? AND case_id=? AND status IN ('sending','unknown')) ON CONFLICT DO NOTHING",
    )
    .bind(
      context.workspace,
      context.userId,
      id,
      input.case_id,
      input.case_version,
      row.provider,
      row.account,
      input.mode,
      hash,
      messageId,
      input.follow_up ? 1 : 0,
      at,
      at,
      context.workspace,
      input.case_id,
      input.case_version,
      context.workspace,
      context.userId,
      row.provider,
      row.account,
      context.workspace,
      context.userId,
      input.case_id,
    )
    .run();
  if (saved.meta.changes !== 1) {
    const duplicate = await context.db
      .prepare(
        "SELECT * FROM mail_operations WHERE workspace=? AND user_id=? AND payload_hash=? AND status!='cancelled'",
      )
      .bind(context.workspace, context.userId, hash)
      .first<MailOperation>();
    if (duplicate)
      return checkMailOperation(context, duplicate.id, input.case_id);
    throw new HttpError(
      "The case or mailbox changed, or an earlier reply is still uncertain. Refresh the case and check pending mail operations before sending.",
      409,
    );
  }
  let op = (await readOperation(context, id))!;
  let providerId: string | null = null;
  let receipt: unknown = null;
  try {
    const { raw } = buildRawMessage(
      {
        from: row.account,
        to: input.to,
        cc: input.cc,
        subject: input.subject,
        body: input.body,
        message_id: messageId,
        in_reply_to: source.email.message_id,
        references: [
          ...(source.email.references ?? []),
          ...(source.email.message_id ? [source.email.message_id] : []),
        ],
      },
      new Date(at),
    );
    if (token) {
      providerId = await gmailDeliver(
        token,
        raw,
        input.mode,
        replyThread,
        context.fetcher,
      );
      receipt = { gmail_id: providerId };
    } else {
      const { imapSaveDraft, imapServer, smtpSend } =
        transport ?? (await import("./imap-adapter"));
      const server = imapServer(context.config, secret!.preset);
      const result =
        input.mode === "draft"
          ? await imapSaveDraft(server, secret!, raw)
          : await smtpSend(server, secret!, raw, {
              from: row.account,
              to: [...input.to, ...input.cc],
            });
      providerId = result.provider_id;
      receipt = result.receipt;
      if (
        input.mode === "send" &&
        "rejected" in result.receipt &&
        result.receipt.rejected.length
      ) {
        op = await transition(
          context,
          op,
          "unknown",
          providerId,
          receipt,
          "REPLY_PARTIAL_SUBMISSION",
        );
        return view(op, false);
      }
    }
    op = await transition(
      context,
      op,
      input.mode === "send" ? "submitted" : "draft",
      providerId,
      receipt,
      input.mode === "send" ? "REPLY_SENT" : "REPLY_DRAFT_SAVED",
    );
  } catch {
    try {
      op = await transition(
        context,
        op,
        "unknown",
        providerId,
        receipt,
        "REPLY_OUTCOME_UNKNOWN",
      );
    } catch {
      op = { ...op, status: "unknown", provider_id: providerId };
    }
  }
  return view(await trackRequest(context, op), false);
}
