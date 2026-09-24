import { parseDocument } from "./parsers";
import { analyze } from "./compare";
import { getCase, getPolicy, saveCase, storage } from "./storage";
import { gmailAttachment, storedMessage } from "./gmail-storage";
import { linkMessage } from "./correspondence";
import { HttpError } from "./http";
import { attachmentPlan, deferredDocument } from "./processing";
import { createHash } from "node:crypto";

/** Imports an actual mailbox message; the stable case ID is not a Gmail message/thread ID. */
export async function importGmailMessage(
  workspace: string,
  messageId: string,
  fetcher: typeof fetch = fetch,
  services = { storage, getCase, getPolicy, saveCase },
) {
  const { DB, BUCKET } = services.storage(),
    message = await storedMessage(DB, workspace, messageId);
  const id = message.caseId ?? `upload_gmail_${message.id}`;
  const existing = await services.getCase(workspace, id);
  if (existing) {
    if (!message.caseId)
      await linkMessage(DB, workspace, message.id, id, existing.version);
    return existing;
  }
  if (!message.from)
    throw new HttpError(
      "The message has no supported sender address; review it in Gmail.",
      422,
    );
  if (
    message.attachments.length > 10 ||
    message.attachments.reduce((n, a) => n + a.size, 0) > 20 * 1024 * 1024
  )
    throw new HttpError(
      "Import supports at most ten attachments and 20 MB combined.",
      413,
    );
  if (message.attachments.some((a) => !/\.(txt|pdf|docx|xlsx)$/i.test(a.name)))
    throw new HttpError(
      "This email contains unsupported attachments. Save the required TXT/PDF/DOCX/XLSX sources and use manual intake.",
      422,
    );
  const email = {
    email_id: id,
    from: message.from,
    subject: message.subject || "(No subject)",
    body: message.body || "(No readable email body)",
    attachments: [] as string[],
    ...(message.receivedAt ? { received_at: message.receivedAt } : {}),
    imported_at: new Date().toISOString(),
  };
  const plan = attachmentPlan(email);
  const keys: string[] = [],
    documents = [],
    paths: string[] = [];
  let attempted = false;
  try {
    for (const attachment of message.attachments) {
      const { bytes } = await gmailAttachment(
        DB,
        workspace,
        message.id,
        attachment.id,
        fetcher,
      );
      const name = `${crypto.randomUUID()}_${attachment.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120)}`;
      const key = `${workspace}/${id}/${name}`;
      const doc = plan.parse
        ? await parseDocument(name, bytes)
        : {
            ...deferredDocument(name),
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
      documents.push({ ...doc, size_bytes: bytes.byteLength });
      await BUCKET.put(key, bytes);
      keys.push(key);
      paths.push(`uploads/${name}`);
    }
    email.attachments = paths;
    const result = analyze(
      email,
      documents,
      0,
      undefined,
      await services.getPolicy(workspace),
      undefined,
      plan.classification,
    );
    // Correspondence chronology stays attached to the actual message; it never changes the strict verdict.
    attempted = true;
    const saved = await services.saveCase(
      workspace,
      result,
      0,
      "UPLOADED",
      "Gmail import",
      JSON.stringify({
        messageId: message.id,
        providerId: message.providerId,
        threadId: message.threadId,
        receivedAt: message.receivedAt,
      }),
    );
    await linkMessage(DB, workspace, message.id, id, saved.version);
    return saved;
  } catch (error) {
    if (!attempted) await BUCKET.delete(keys).catch(() => {});
    // After an uncertain commit, retain originals. A repeated import reuses the stable case ID.
    const winner = attempted
      ? await services.getCase(workspace, id).catch(() => null)
      : null;
    if (winner) {
      await linkMessage(DB, workspace, message.id, id, winner.version);
      return winner;
    }
    throw error;
  }
}
