"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FileDown,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  INTENT_LABELS,
  TONE_LABELS,
  draftReply,
  gmailComposeUrl,
  quoteOriginal,
  suggestedIntent,
  type ReplyIntent,
  type ReplyTone,
} from "@/lib/reply";
import type { CaseResult } from "@/lib/types";
import { requestJson } from "@/lib/client-api";

export interface MailboxState {
  connected: boolean;
  provider: "gmail" | "imap" | null;
  account: string | null;
  send_enabled: boolean;
}
const SIGNATURE_KEY = "cg-signature";
function readSignature() {
  try {
    return localStorage.getItem(SIGNATURE_KEY) ?? "";
  } catch {
    return "";
  }
}
function splitList(value: string) {
  return value
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ReplyComposer({
  result,
  mailbox,
  defaultName,
  onDone,
  onError,
}: {
  result: CaseResult;
  mailbox: MailboxState | null;
  defaultName: string;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const suggested = suggestedIntent(result);
  const [intent, setIntent] = useState<ReplyIntent>(suggested);
  const [tone, setTone] = useState<ReplyTone>("formal");
  const [signature, setSignature] = useState(
    () => readSignature() || defaultName,
  );
  const [includeOriginal, setIncludeOriginal] = useState(true);
  const draft = useMemo(
    () => draftReply(result, { intent, tone, signature }),
    [result, intent, tone, signature],
  );
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc.join(", "));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"" | "draft" | "send" | "ai">("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ai, setAi] = useState<{ available: boolean; label: string } | null>(
    null,
  );
  const [aiConsent, setAiConsent] = useState(false);
  const [aiNote, setAiNote] = useState("");
  const lastDraft = useRef(draft.body);

  useEffect(() => {
    let active = true;
    requestJson<{ available: boolean; label: string }>("/api/reply", {
      cache: "no-store",
    })
      .then((value) => {
        if (active)
          setAi({ available: !!value.available, label: value.label || "AI" });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  function applyDraft(next: { intent?: ReplyIntent; tone?: ReplyTone }) {
    if (
      dirty &&
      body !== lastDraft.current &&
      !window.confirm("Replace your edited text with a new draft?")
    )
      return;
    const nextDraft = draftReply(result, {
      intent: next.intent ?? intent,
      tone: next.tone ?? tone,
      signature,
    });
    if (next.intent) setIntent(next.intent);
    if (next.tone) setTone(next.tone);
    setBody(nextDraft.body);
    setSubject(nextDraft.subject);
    lastDraft.current = nextDraft.body;
    setDirty(false);
    setAiNote("");
  }
  function saveSignature(value: string) {
    setSignature(value);
    try {
      localStorage.setItem(SIGNATURE_KEY, value);
    } catch {
      // Storage can be unavailable in private windows; the value still applies.
    }
  }

  const fullBody = includeOriginal
    ? `${body}\n\n${quoteOriginal(result)}`
    : body;
  const recipients = splitList(to);
  const ccList = splitList(cc);
  const invalid = [...recipients, ...ccList].filter(
    (address) => !emailPattern.test(address),
  );
  const ready =
    recipients.length > 0 &&
    !invalid.length &&
    !!subject.trim() &&
    !!body.trim();

  async function deliver(mode: "draft" | "send") {
    if (!ready) return;
    setBusy(mode);
    try {
      const value = await requestJson<{ account: string; where: string }>(
        "/api/mail/reply",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            case_id: result.email.email_id,
            mode,
            confirmed: true,
            to: recipients,
            cc: ccList,
            subject: subject.trim(),
            body: fullBody,
          }),
        },
      );
      onDone(
        mode === "send"
          ? `Reply sent from ${value.account}.`
          : `Draft saved in ${value.where} (${value.account}). Open your mailbox to review and send it.`,
      );
      setConfirmSend(false);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Delivery failed.");
    } finally {
      setBusy("");
    }
  }
  async function improve() {
    if (!aiConsent) return;
    setBusy("ai");
    setAiNote("");
    try {
      const value = await requestJson<{ body: string }>("/api/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: result.email.email_id,
          version: result.version,
          tone,
          body,
          consent: true,
        }),
      });
      setBody(value.body);
      setDirty(true);
      setAiNote(
        "Wording improved by AI. Every value from the checked documents was kept — read it once before sending.",
      );
    } catch (error) {
      setAiNote(error instanceof Error ? error.message : "AI is unavailable.");
    } finally {
      setBusy("");
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        `To: ${recipients.join(", ")}${ccList.length ? `\nCc: ${ccList.join(", ")}` : ""}\nSubject: ${subject}\n\n${fullBody}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError("Copy is blocked by the browser. Select the text and copy it.");
    }
  }
  function download() {
    const lines = [
      `To: ${recipients.join(", ")}`,
      ...(ccList.length ? [`Cc: ${ccList.join(", ")}`] : []),
      `Subject: ${subject}`,
      ...(result.email.message_id
        ? [`In-Reply-To: <${result.email.message_id}>`]
        : []),
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "X-Unsent: 1",
      "",
      fullBody,
    ];
    const url = URL.createObjectURL(
      new Blob([lines.join("\r\n")], { type: "message/rfc822" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `reply-${result.email.email_id}.eml`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Very long links are rejected by Gmail; leave the quote out if needed.
  const composeWith = (text: string) =>
    gmailComposeUrl({
      to: recipients.join(","),
      cc: ccList,
      subject,
      body: text,
    });
  const gmailUrl =
    composeWith(fullBody).length <= 7000
      ? composeWith(fullBody)
      : composeWith(body);
  const connected = !!mailbox?.connected;
  const canSend = connected && !!mailbox?.send_enabled;
  const mailboxName = mailbox?.provider === "gmail" ? "Gmail" : "mailbox";

  return (
    <section className="cg-composer" aria-label="Reply to this email">
      <div className="cg-composer-options">
        <label className="cg-opt-title" id="reply-type">
          1. What do you want to say?
        </label>
        <div className="cg-chips" role="group" aria-labelledby="reply-type">
          {(Object.keys(INTENT_LABELS) as ReplyIntent[]).map((value) => (
            <button
              key={value}
              type="button"
              className="cg-chip"
              aria-pressed={intent === value}
              onClick={() => applyDraft({ intent: value })}
            >
              {INTENT_LABELS[value]}
              {value === suggested && <b>· suggested</b>}
            </button>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 16,
            alignItems: "end",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <span className="cg-opt-title">2. Tone</span>
            <div className="cg-segment" role="group" aria-label="Tone">
              {(Object.keys(TONE_LABELS) as ReplyTone[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={tone === value}
                  onClick={() => applyDraft({ tone: value })}
                >
                  {TONE_LABELS[value]}
                </button>
              ))}
            </div>
          </div>
          <label className="cg-field" style={{ flex: "1 1 220px" }}>
            Your signature
            <input
              value={signature}
              maxLength={200}
              placeholder="Your name, team"
              onChange={(e) => saveSignature(e.target.value)}
              onBlur={() => !dirty && applyDraft({})}
            />
          </label>
        </div>
      </div>
      <div className="cg-mail-line">
        <span>To</span>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To"
          aria-invalid={recipients.some((a) => !emailPattern.test(a))}
        />
      </div>
      <div className="cg-mail-line">
        <span>Cc</span>
        <input
          value={cc}
          onChange={(e) => setCc(e.target.value)}
          aria-label="Cc"
          placeholder="Optional"
        />
      </div>
      <div className="cg-mail-line">
        <span>Subject</span>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          aria-label="Subject"
        />
      </div>
      <textarea
        className="cg-mail-body"
        aria-label="Message"
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setDirty(true);
        }}
      />
      {(draft.checks.length > 0 || invalid.length > 0 || aiNote) && (
        <div className="cg-composer-checks" role="status">
          {invalid.length > 0 && (
            <p style={{ margin: 0, color: "var(--cg-red)", fontWeight: 600 }}>
              <TriangleAlert size={15} /> Check these addresses:{" "}
              {invalid.join(", ")}
            </p>
          )}
          {aiNote && <p style={{ margin: 0 }}>{aiNote}</p>}
          {draft.checks.length > 0 && (
            <>
              <strong>Before sending, confirm:</strong>
              <ul>
                {draft.checks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <div className="cg-composer-actions">
        <label className="cg-check">
          <input
            type="checkbox"
            checked={includeOriginal}
            onChange={(e) => setIncludeOriginal(e.target.checked)}
          />
          Include the original email below my reply
        </label>
        {ai?.available && (
          <>
            <span className="cg-spacer" />
            <label className="cg-check cg-small">
              <input
                type="checkbox"
                checked={aiConsent}
                onChange={(e) => setAiConsent(e.target.checked)}
              />
              Allow {ai.label} to read this draft
            </label>
            <button
              type="button"
              className="cg-btn"
              disabled={!aiConsent || !!busy || !body.trim()}
              onClick={() => void improve()}
            >
              {busy === "ai" ? (
                <Loader2 size={18} className="cg-spin" />
              ) : (
                <Sparkles size={18} />
              )}
              Improve wording
            </button>
          </>
        )}
      </div>
      <div className="cg-composer-actions">
        {canSend &&
          (confirmSend ? (
            <>
              <strong>
                Send to {recipients.join(", ")} from {mailbox?.account}?
              </strong>
              <button
                type="button"
                className="cg-btn primary"
                disabled={!ready || !!busy}
                onClick={() => void deliver("send")}
              >
                {busy === "send" ? (
                  <Loader2 size={18} className="cg-spin" />
                ) : (
                  <Send size={18} />
                )}
                Yes, send now
              </button>
              <button
                type="button"
                className="cg-btn"
                disabled={!!busy}
                onClick={() => setConfirmSend(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="cg-btn primary"
              disabled={!ready || !!busy}
              onClick={() => setConfirmSend(true)}
            >
              <Send size={18} /> Send
            </button>
          ))}
        {connected && (
          <button
            type="button"
            className={`cg-btn ${canSend ? "" : "primary"}`}
            disabled={!ready || !!busy}
            onClick={() => void deliver("draft")}
          >
            {busy === "draft" ? (
              <Loader2 size={18} className="cg-spin" />
            ) : (
              <FileDown size={18} />
            )}
            Save to {mailboxName} drafts
          </button>
        )}
        <a
          className={`cg-btn ${connected ? "" : "primary"}`}
          href={ready ? gmailUrl : undefined}
          aria-disabled={!ready}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={18} /> Open in Gmail
        </a>
        <button type="button" className="cg-btn" onClick={() => void copy()}>
          {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" className="cg-btn ghost" onClick={download}>
          <FileDown size={18} /> Download .eml
        </button>
        <span className="cg-spacer" />
        <button
          type="button"
          className="cg-btn ghost"
          onClick={() => applyDraft({})}
          title="Write the suggested text again"
        >
          <RotateCcw size={18} /> Start over
        </button>
      </div>
      {!connected && (
        <p
          className="cg-small cg-muted"
          style={{ padding: "0 18px 14px", margin: 0 }}
        >
          Tip: connect Gmail under{" "}
          <a className="cg-link" href="/mail">
            Email accounts
          </a>{" "}
          to save replies straight into your Gmail drafts or send them from
          here.
        </p>
      )}
    </section>
  );
}
