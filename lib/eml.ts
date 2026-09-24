import PostalMime, { type Address } from "postal-mime";
import { HttpError } from "./http";

/** Attachment types the document engine can read. */
export const SUPPORTED_ATTACHMENT = /\.(txt|pdf|docx|xlsx)$/i;
export const MAX_EMAIL_BYTES = 20 * 1024 * 1024;

export interface ParsedEmail {
  from: string;
  from_name: string;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  received_at?: string;
  message_id?: string;
  in_reply_to?: string;
  references: string[];
  attachments: { name: string; bytes: Uint8Array; type: string }[];
  skipped: { name: string; reason: string }[];
}

function mailboxes(value: Address[] | Address | undefined): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .flatMap((entry) => (entry.group ? entry.group : [entry]))
    .map((entry) => entry.address?.trim().toLowerCase() ?? "")
    .filter((address) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
    .slice(0, 50);
}
function messageIds(value: string | undefined) {
  return [...(value ?? "").matchAll(/<([^<>\s]{3,300})>/g)]
    .map((m) => m[1])
    .slice(-50);
}

/** Readable plain text when an email was sent as HTML only. */
export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<t[dh][^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d{1,6});/g, (_, code) => {
      const value = Number(code);
      return value > 0 && value < 0x110000 ? String.fromCodePoint(value) : "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function safeName(name: string | null, index: number, mime: string) {
  const extension =
    mime === "application/pdf"
      ? ".pdf"
      : mime === "text/plain"
        ? ".txt"
        : mime.includes("wordprocessingml")
          ? ".docx"
          : mime.includes("spreadsheetml")
            ? ".xlsx"
            : "";
  const base = (name ?? "").replace(/[\\/\r\n\0]/g, "_").trim();
  return (base || `attachment-${index + 1}${extension}`).slice(-180);
}

/** Parse an RFC 822 (.eml) message. Mail content is untrusted evidence only. */
export async function parseEml(
  raw: Uint8Array | ArrayBuffer | string,
): Promise<ParsedEmail> {
  const size = typeof raw === "string" ? raw.length : raw.byteLength;
  if (!size) throw new HttpError("The email file is empty.");
  if (size > MAX_EMAIL_BYTES)
    throw new HttpError("The email file is larger than 20 MB.", 413);
  let mail;
  try {
    mail = await PostalMime.parse(raw, {
      attachmentEncoding: "arraybuffer",
      maxNestingDepth: 20,
    });
  } catch {
    throw new HttpError(
      "This file could not be read as an email (.eml). Save the message as .eml from your mail app and try again.",
    );
  }
  const from = mailboxes(mail.from)[0] ?? mailboxes(mail.sender)[0] ?? "";
  if (!from && !mail.subject && !mail.text && !mail.html)
    throw new HttpError(
      "This file does not look like an email. Use a .eml file saved from Gmail or Outlook.",
    );
  const fromEntry = mail.from && !mail.from.group ? mail.from : undefined;
  const date = mail.date ? new Date(mail.date) : null;
  const text = ((mail.text ?? "").trim() || htmlToText(mail.html ?? ""))
    .replace(/\r\n?/g, "\n");
  const attachments: ParsedEmail["attachments"] = [];
  const skipped: ParsedEmail["skipped"] = [];
  mail.attachments.forEach((item, index) => {
    const name = safeName(item.filename, index, item.mimeType);
    const bytes =
      typeof item.content === "string"
        ? new TextEncoder().encode(item.content)
        : new Uint8Array(item.content);
    if (
      item.disposition === "inline" &&
      /^image\//i.test(item.mimeType) &&
      !SUPPORTED_ATTACHMENT.test(name)
    )
      return; // Signature logos and pasted images are not shipping documents.
    if (!SUPPORTED_ATTACHMENT.test(name))
      skipped.push({ name, reason: "Not a TXT, PDF, DOCX or XLSX file" });
    else if (!bytes.byteLength) skipped.push({ name, reason: "Empty file" });
    else if (bytes.byteLength > 5 * 1024 * 1024)
      skipped.push({ name, reason: "Larger than 5 MB" });
    else attachments.push({ name, bytes, type: item.mimeType });
  });
  return {
    from: from || "unknown-sender@unknown.invalid",
    from_name: fromEntry?.name?.trim() ?? "",
    to: mailboxes(mail.to),
    cc: mailboxes(mail.cc),
    subject:
      (mail.subject ?? "").replace(/[\r\n]+/g, " ").trim() || "(No subject)",
    body: text.slice(0, 20000) || "(Empty email body)",
    received_at:
      date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined,
    message_id: messageIds(mail.messageId)[0],
    in_reply_to: messageIds(mail.inReplyTo)[0],
    references: messageIds(mail.references),
    attachments,
    skipped,
  };
}
