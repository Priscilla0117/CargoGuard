"use client";
import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  Hash,
  Paperclip,
  Reply,
  ShieldAlert,
} from "lucide-react";
import { emailInsight, latestMessagePart } from "@/lib/mail-intel";
import { categoryWords } from "@/lib/case-status";
import { splitSignature } from "@/lib/email-format";
import type { CaseResult, ParsedDocument } from "@/lib/types";

function initials(name: string) {
  const parts = name
    .replace(/[^A-Za-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}
function address(from: string) {
  return from.match(/<([^>]+)>/)?.[1] ?? from.trim();
}
function when(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString([], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
function docLabel(doc: ParsedDocument) {
  return doc.type === "SI"
    ? "Shipping Instruction"
    : doc.type === "BL"
      ? "Draft BL"
      : "Other file";
}

/** The email as the employee would see it in their mail program. */
export function EmailMessage({
  result,
  onReply,
  onDocument,
}: {
  result: CaseResult;
  onReply: () => void;
  onDocument: (doc: ParsedDocument) => void;
}) {
  const [showQuoted, setShowQuoted] = useState(false);
  const email = result.email;
  const insight = emailInsight(email);
  const latest = latestMessagePart(email.body).trim() || email.body.trim();
  const { body, signature } = splitSignature(latest);
  const quoted = latest.length < email.body.trim().length;
  const name = insight.sender_name || address(email.from);
  const received = when(email.received_at);
  const refs = [
    ...insight.refs.shipment.map((v) => `Order ${v}`),
    ...insight.refs.po.slice(0, 2).map((v) => `PO ${v}`),
    ...insight.refs.booking.slice(0, 2).map((v) => `BL ${v}`),
  ].slice(0, 5);
  const files = result.documents.length
    ? result.documents.map((doc) => ({
        key: doc.name,
        name: doc.name.replace(/^[0-9a-f]{8}_\d+_/, ""),
        label: docLabel(doc),
        doc,
      }))
    : email.attachments.map((file) => ({
        key: file,
        name: file,
        label: "Not read",
        doc: null,
      }));
  const all = body.split(/\n{2,}/).filter((p) => p.trim());
  // Company "external email" banners are shown as a note, not as the message.
  const banner = all.find((p) =>
    /^\s*\[?(?:warning|caution|external(?: email)?)\]?\s*[:!-]/i.test(p),
  );
  const paragraphs = all.filter((p) => p !== banner);

  return (
    <article className="cg-mail" aria-label="Email">
      <header className="cg-mail-head">
        <h2 className="cg-mail-subject">{email.subject}</h2>
        <div className="cg-mail-tags">
          <span className="cg-mail-tag">{categoryWords(result.category)}</span>
          {refs.map((ref) => (
            <span key={ref} className="cg-mail-tag ref">
              <Hash size={12} aria-hidden="true" />
              {ref}
            </span>
          ))}
        </div>
        <div className="cg-mail-from">
          <span className="cg-mail-avatar" aria-hidden="true">
            {initials(name)}
          </span>
          <div className="cg-mail-who">
            <strong>{name}</strong>
            <span>&lt;{address(email.from)}&gt;</span>
            {!!email.to?.length && (
              <small>
                to {email.to.join(", ")}
                {email.cc?.length ? ` · cc ${email.cc.join(", ")}` : ""}
              </small>
            )}
          </div>
          <time
            className="cg-mail-date"
            dateTime={received ? email.received_at : undefined}
          >
            {received ?? "No date recorded"}
          </time>
        </div>
      </header>
      {banner && (
        <p className="cg-mail-banner">
          <ShieldAlert size={16} aria-hidden="true" />
          {banner.replace(
            /^\s*\[?(?:warning|caution|external(?: email)?)\]?\s*[:!-]\s*/i,
            "",
          )}
        </p>
      )}
      <div className="cg-mail-body">
        {paragraphs.length ? (
          paragraphs.map((text, index) => <p key={index}>{text.trim()}</p>)
        ) : (
          <p className="cg-muted">This email has no text.</p>
        )}
        {signature && <div className="cg-mail-signature">{signature}</div>}
      </div>
      {files.length > 0 && (
        <div className="cg-mail-files">
          <span className="cg-mail-files-title">
            <Paperclip size={15} aria-hidden="true" /> {files.length} attachment
            {files.length === 1 ? "" : "s"}
          </span>
          <div className="cg-mail-file-list">
            {files.map((file) => {
              const Icon = /\.(xlsx?|csv)$/i.test(file.name)
                ? FileSpreadsheet
                : FileText;
              return (
                <button
                  key={file.key}
                  type="button"
                  className="cg-mail-file"
                  disabled={!file.doc}
                  onClick={() => file.doc && onDocument(file.doc)}
                  title={file.doc ? "Open this document" : undefined}
                >
                  <Icon size={22} aria-hidden="true" />
                  <span>
                    <strong>{file.name}</strong>
                    <small>{file.label}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {quoted && (
        <div className="cg-mail-quoted">
          <button
            type="button"
            className="cg-link cg-small"
            aria-expanded={showQuoted}
            onClick={() => setShowQuoted(!showQuoted)}
          >
            {showQuoted ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            {showQuoted ? "Hide" : "Show"} the full original email (with quoted
            replies)
          </button>
          {showQuoted && <pre>{email.body.trim()}</pre>}
        </div>
      )}
      <footer className="cg-mail-actions">
        <button type="button" className="cg-btn primary" onClick={onReply}>
          <Reply size={18} /> Reply
        </button>
      </footer>
    </article>
  );
}
