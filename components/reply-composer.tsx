"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { finishBlocker } from "@/lib/follow-up";
import { requestJson, RequestError } from "@/lib/client-api";
import {
  replyOperationId,
  replyNeedsResponse,
  rememberReplyAttempt,
  readReplyAttempt,
  selectReplyOperations,
  canRetryResponseTracking,
  type ReplyOperation,
} from "@/lib/reply-operation";

/** What the employee says happens after a reply. Nothing is assumed. */
export type ReplyOutcome = "waiting" | "working" | "done";

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
function operationStore() {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ReplyComposer({
  result,
  mailbox,
  defaultName,
  onDone,
  onError,
  onReplied,
  onFollowUpRecorded,
  status,
}: {
  result: CaseResult;
  mailbox: MailboxState | null;
  defaultName: string;
  onDone: (message: string) => void;
  onError: (message: string) => void;
  /** Records that the reply went out, so the email leaves "To do". */
  onReplied?: (how: string, outcome: ReplyOutcome) => Promise<boolean>;
  onFollowUpRecorded?: () => void;
  /** Where the email is now: "todo", "waiting", "done" or "other". */
  status?: string;
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
  const [busy, setBusy] = useState<"" | "draft" | "send" | "ai" | "write">("");
  const [confirmSend, setConfirmSend] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ai, setAi] = useState<{ available: boolean; label: string } | null>(
    null,
  );
  const [aiConsent, setAiConsent] = useState(false);
  const [aiNote, setAiNote] = useState("");
  // After a reply leaves (or may have left) CargoGuard, ask what happens next.
  const [askSent, setAskSent] = useState("");
  const [sentForSure, setSentForSure] = useState(false);
  const [trackResponse, setTrackResponse] = useState(() =>
    replyNeedsResponse(suggested),
  );
  const [deliveryNote, setDeliveryNote] = useState("");
  const [unresolvedSend, setUnresolvedSend] = useState(false);
  const [pendingOperation, setPendingOperation] =
    useState<ReplyOperation | null>(null);
  const [recentOperation, setRecentOperation] = useState<ReplyOperation | null>(
    null,
  );
  const [operationsReady, setOperationsReady] = useState(false);
  const [cancelledIds, setCancelledIds] = useState<string[]>([]);
  const [recoveryNote, setRecoveryNote] = useState("");
  const [mailboxChecked, setMailboxChecked] = useState(false);
  const [recording, setRecording] = useState<ReplyOutcome | "">("");
  const lastDraft = useRef(draft.body);
  const attemptedId = useRef<string | null>(null);
  const cannotFinish = finishBlocker(result);
  // The suggestion follows what the reply says: a request waits for the
  // sender, an acknowledgement keeps the task open, a confirmation finishes.
  const recommended: ReplyOutcome =
    intent === "acknowledge"
      ? "working"
      : intent === "confirm_match" ||
          (intent === "blank" &&
            ["SI_REQUEST", "INVOICE_QUERY", "GENERAL"].includes(
              result.category,
            ))
        ? cannotFinish
          ? "waiting"
          : "done"
        : "waiting";
  async function recordReply(outcome: ReplyOutcome) {
    if (!onReplied || !askSent || busy || pendingOperation || unresolvedSend)
      return;
    setRecording(outcome);
    try {
      if (await onReplied(askSent, outcome)) {
        setAskSent("");
        setSentForSure(false);
      }
    } finally {
      setRecording("");
    }
  }

  const loadDeliveryOperations = useCallback(async () => {
    if (!mailbox?.connected) return;
    try {
      const data = await requestJson<{ operations: ReplyOperation[] }>(
        `/api/mail/reply?case_id=${encodeURIComponent(result.email.email_id)}`,
        { cache: "no-store" },
      );
      const remembered =
        attemptedId.current ??
        (await readReplyAttempt(
          { case_id: result.email.email_id, account: mailbox?.account },
          operationStore(),
        ));
      const { pending, recent } = selectReplyOperations(
        data.operations,
        remembered,
      );
      setPendingOperation(pending);
      setRecentOperation(recent);
      setUnresolvedSend(!!pending);
      if (!pending && recent && recent.operation_id === remembered)
        setDeliveryNote(
          recent.message ??
            "The previous mailbox request has a recorded result below. No new email was submitted.",
        );
      setCancelledIds(
        data.operations
          .filter((op) => op.status === "cancelled")
          .map((op) => op.operation_id),
      );
      setOperationsReady(true);
    } catch {
      setOperationsReady(false);
      setDeliveryNote(
        "Previous send requests could not be checked. Refresh the request status before submitting another email.",
      );
    }
  }, [mailbox, result.email.email_id]);

  useEffect(() => {
    if (mailbox?.connected) void loadDeliveryOperations();
  }, [loadDeliveryOperations, mailbox?.connected]);

  async function recoverDelivery(
    decision?: "confirmed_sent" | "confirmed_not_sent",
  ) {
    const operation = pendingOperation ?? recentOperation;
    if (
      !operation ||
      busy ||
      (decision && (!mailboxChecked || recoveryNote.trim().length < 10))
    )
      return;
    setBusy(operation.mode);
    resetDraftCertainty();
    try {
      const value = await requestJson<ReplyOperation>("/api/mail/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: decision ? "resolve" : "check",
          case_id: result.email.email_id,
          operation_id: operation.operation_id,
          ...(decision
            ? { decision, confirmed: true, note: recoveryNote.trim() }
            : {}),
        }),
      });
      setRecentOperation(value);
      if (value.status === "unknown" || value.status === "sending") {
        setDeliveryNote(
          value.message ??
            "This request is still unresolved. Inspect your mailbox; no replacement email has been submitted.",
        );
      } else if (value.status === "cancelled") {
        setDeliveryNote(
          "Recorded as not sent after your mailbox check. Review the message before starting a new send request.",
        );
        setAskSent("");
      } else {
        setDeliveryNote(
          value.message ??
            (value.rejected_recipients?.length
              ? (value.message ??
                "Some recipients were rejected. Review the recorded recipient results before tracking a response.")
              : value.status === "draft"
                ? "Your mailbox draft was confirmed. Review and send it from the mailbox."
                : "The send request is confirmed. No duplicate was submitted."),
        );
        if (value.follow_up_recorded) onFollowUpRecorded?.();
      }
      setRecoveryNote("");
      setMailboxChecked(false);
      await loadDeliveryOperations();
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "The request status could not be confirmed.",
      );
    } finally {
      setBusy("");
    }
  }

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
    if (busy) return;
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
    resetDraftCertainty();
    if (next.intent) {
      setIntent(next.intent);
      setTrackResponse(replyNeedsResponse(next.intent));
    }
    if (next.tone) setTone(next.tone);
    setBody(nextDraft.body);
    setSubject(nextDraft.subject);
    lastDraft.current = nextDraft.body;
    setDirty(false);
    setAiNote("");
  }
  function saveSignature(value: string) {
    resetDraftCertainty();
    setSignature(value);
    try {
      localStorage.setItem(SIGNATURE_KEY, value);
    } catch {
      // Storage can be unavailable in private windows; the value still applies.
    }
  }

  function resetDraftCertainty() {
    setSentForSure(false);
    setAskSent("");
    setConfirmSend(false);
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
    !!body.trim() &&
    !(intent === "confirm_match" && cannotFinish);

  async function deliver(mode: "draft" | "send") {
    if (!ready || !operationsReady || pendingOperation || busy) return;
    setBusy(mode);
    setDeliveryNote("");
    try {
      const payload = {
        case_id: result.email.email_id,
        case_version: result.version,
        mode,
        confirmed: true,
        intent,
        follow_up:
          mode === "send" && trackResponse && replyNeedsResponse(intent),
        to: recipients,
        cc: ccList,
        subject: subject.trim(),
        body: fullBody,
      };
      const store = operationStore();
      const operation_id = await replyOperationId(
        { account: mailbox?.account, ...payload },
        store,
        cancelledIds,
      );
      attemptedId.current = operation_id;
      await rememberReplyAttempt(
        { case_id: result.email.email_id, account: mailbox?.account },
        operation_id,
        store,
      );
      const value = await requestJson<ReplyOperation>("/api/mail/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, operation_id }),
      });
      attemptedId.current = value.operation_id;
      await rememberReplyAttempt(
        { case_id: result.email.email_id, account: mailbox?.account },
        value.operation_id,
        store,
      );
      setRecentOperation(value);
      setConfirmSend(false);
      if (value.status === "unknown" || value.status === "sending") {
        setUnresolvedSend(true);
        setAskSent("");
        setSentForSure(false);
        setDeliveryNote(
          value.message ??
            "The mailbox has not confirmed this request's outcome. Check Sent and Drafts before taking another action. Checking this request again reuses its reference and will not blindly resend it.",
        );
        await loadDeliveryOperations();
        return;
      }
      if (value.status === "cancelled") {
        setDeliveryNote(
          "This earlier request was recorded as not sent. Review the draft, then start a new request.",
        );
        await loadDeliveryOperations();
        return;
      }
      setUnresolvedSend(false);
      onDone(
        value.status === "submitted"
          ? `The mailbox accepted your reply from ${value.account}.${value.follow_up_recorded ? " Follow-up is now waiting for a response." : ""}`
          : `Draft saved in ${value.where} (${value.account}). Open your mailbox to review and send it.`,
      );
      setDeliveryNote(
        value.warning ??
          (value.rejected_recipients?.length ? value.message : undefined) ??
          (payload.follow_up && value.follow_up_recorded === false
            ? "Your reply was accepted, but follow-up could not be recorded. Use the Follow-up tab; do not send the email again."
            : value.status === "submitted"
              ? "Accepted by your mailbox. This is not proof that the recipient has read it."
              : ""),
      );
      setSentForSure(
        value.status === "submitted" && !value.rejected_recipients?.length,
      );
      setAskSent(
        value.follow_up_recorded || value.rejected_recipients?.length
          ? ""
          : value.status === "submitted"
            ? "sent from CargoGuard"
            : "saved as a draft in your mailbox",
      );
      if (value.follow_up_recorded) onFollowUpRecorded?.();
    } catch (error) {
      if (
        !(error instanceof RequestError) ||
        error.status === 0 ||
        error.status >= 500
      ) {
        setUnresolvedSend(true);
        setAskSent("");
        setSentForSure(false);
        setDeliveryNote(
          "The connection ended before the outcome was confirmed. Keep this draft unchanged and check the request again; the same reference prevents a duplicate submission.",
        );
      }
      onError(error instanceof Error ? error.message : "Delivery failed.");
      await loadDeliveryOperations();
    } finally {
      setBusy("");
    }
  }
  async function improve(mode: "polish" | "write") {
    if (!aiConsent) return;
    if (
      dirty &&
      body !== lastDraft.current &&
      !window.confirm("Replace your edited text with the AI version?")
    )
      return;
    setBusy(mode === "write" ? "write" : "ai");
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
          mode,
          intent,
        }),
      });
      setBody(value.body);
      resetDraftCertainty();
      setDirty(true);
      setAiNote(
        mode === "write"
          ? "AI prepared the wording. Automated checks protect key values, but you must review the message and its scope before sending."
          : "AI revised the wording. Review the message against the source evidence before sending.",
      );
    } catch (error) {
      setAiNote(error instanceof Error ? error.message : "AI is unavailable.");
    } finally {
      setBusy("");
    }
  }
  async function copy() {
    if (handoffBlocked) return;
    try {
      await navigator.clipboard.writeText(
        `To: ${recipients.join(", ")}${ccList.length ? `\nCc: ${ccList.join(", ")}` : ""}\nSubject: ${subject}\n\n${fullBody}`,
      );
      setCopied(true);
      setSentForSure(false);
      setTimeout(() => setCopied(false), 2000);
      setAskSent("copied into your email program");
    } catch {
      onError("Copy is blocked by the browser. Select the text and copy it.");
    }
  }
  function download() {
    if (handoffBlocked) return;
    setSentForSure(false);
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
    setAskSent("downloaded as an email file");
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
  const handoffBlocked =
    !!busy ||
    !!pendingOperation ||
    unresolvedSend ||
    (connected && !operationsReady);

  return (
    <section className="cg-composer" aria-label="Reply to this email">
      <p className="cg-composer-state">
        Replies report checks or request documents. Formal BL approval stays in
        your agreed approval process.
      </p>
      {(status === "waiting" || status === "done") && (
        <p className="cg-composer-state" role="status">
          <CheckCircle2 size={18} />
          {status === "waiting"
            ? "You already replied — this email is in “Waiting for reply”. You can still write again."
            : "This email is done. You can still send another reply."}
        </p>
      )}
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
              disabled={!!busy || (value === "confirm_match" && !!cannotFinish)}
              title={
                value === "confirm_match" && cannotFinish
                  ? cannotFinish
                  : undefined
              }
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
                  disabled={!!busy}
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
              disabled={!!busy}
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
          disabled={!!busy}
          onChange={(e) => {
            resetDraftCertainty();
            setTo(e.target.value);
          }}
          aria-label="To"
          aria-invalid={recipients.some((a) => !emailPattern.test(a))}
        />
      </div>
      <div className="cg-mail-line">
        <span>Cc</span>
        <input
          value={cc}
          disabled={!!busy}
          onChange={(e) => {
            resetDraftCertainty();
            setCc(e.target.value);
          }}
          aria-label="Cc"
          placeholder="Optional"
        />
      </div>
      <div className="cg-mail-line">
        <span>Subject</span>
        <input
          value={subject}
          disabled={!!busy}
          onChange={(e) => {
            resetDraftCertainty();
            setSubject(e.target.value);
          }}
          aria-label="Subject"
        />
      </div>
      <textarea
        className="cg-mail-body"
        aria-label="Message"
        value={body}
        disabled={!!busy}
        onChange={(e) => {
          resetDraftCertainty();
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
            disabled={!!busy}
            onChange={(e) => {
              resetDraftCertainty();
              setIncludeOriginal(e.target.checked);
            }}
          />
          Include the original email below my reply
        </label>
        {replyNeedsResponse(intent) && connected && (
          <label className="cg-check">
            <input
              type="checkbox"
              checked={trackResponse}
              disabled={!!busy}
              onChange={(e) => {
                resetDraftCertainty();
                setTrackResponse(e.target.checked);
              }}
            />
            Track the requested response after sending
          </label>
        )}
        {ai?.available && (
          <>
            <span className="cg-spacer" />
            <label className="cg-check cg-small">
              <input
                type="checkbox"
                checked={aiConsent}
                onChange={(e) => setAiConsent(e.target.checked)}
              />
              Allow {ai.label} to read this email and the draft
            </label>
            <button
              type="button"
              className="cg-btn"
              disabled={!aiConsent || !!busy || !body.trim()}
              onClick={() => void improve("write")}
              title="AI writes a full reply that answers the sender, using only facts from the email and the check"
            >
              {busy === "write" ? (
                <Loader2 size={18} className="cg-spin" />
              ) : (
                <Sparkles size={18} />
              )}
              Write reply with AI
            </button>
            <button
              type="button"
              className="cg-btn"
              disabled={!aiConsent || !!busy || !body.trim()}
              onClick={() => void improve("polish")}
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
      {deliveryNote && (
        <p
          className={`cg-composer-checks ${unresolvedSend ? "cg-delivery-warning" : ""}`}
          role="status"
        >
          {deliveryNote}
        </p>
      )}
      {connected && !operationsReady && (
        <button
          type="button"
          className="cg-btn"
          onClick={() => void loadDeliveryOperations()}
        >
          Refresh request status
        </button>
      )}
      {pendingOperation && (
        <section
          className="cg-delivery-recovery"
          aria-label="Resolve an uncertain mailbox request"
        >
          <p>
            <strong>
              Check the previous{" "}
              {pendingOperation.mode === "send" ? "send" : "draft"} request
              first.
            </strong>{" "}
            A new request is paused to prevent duplicates.
          </p>
          <p>
            <strong>Mailbox: {pendingOperation.account}</strong> · Request{" "}
            {pendingOperation.operation_id}
          </p>
          {pendingOperation.message && (
            <p role="alert">{pendingOperation.message}</p>
          )}
          {!!pendingOperation.accepted_recipients?.length && (
            <p>
              Accepted recipients:{" "}
              {pendingOperation.accepted_recipients.join(", ")}
            </p>
          )}
          {!!pendingOperation.rejected_recipients?.length && (
            <p role="alert">
              <strong>Rejected recipients:</strong>{" "}
              {pendingOperation.rejected_recipients.join(", ")}. Do not resend
              to accepted recipients.
            </p>
          )}
          <button
            type="button"
            className="cg-btn"
            disabled={!!busy}
            onClick={() => void recoverDelivery()}
          >
            Check mailbox status
          </button>
          {pendingOperation.status === "unknown" && (
            <details>
              <summary>I checked the mailbox myself</summary>
              <label className="cg-field">
                What did you check?
                <textarea
                  value={recoveryNote}
                  maxLength={1000}
                  onChange={(e) => setRecoveryNote(e.target.value)}
                  placeholder="Checked Sent and Drafts for this recipient and message…"
                />
              </label>
              <label className="cg-check">
                <input
                  type="checkbox"
                  checked={mailboxChecked}
                  onChange={(e) => setMailboxChecked(e.target.checked)}
                />
                I checked the correct mailbox, recipient and message. This
                decision is recorded in history.
              </label>
              <div className="cg-composer-actions">
                <button
                  type="button"
                  className="cg-btn"
                  disabled={
                    !!busy || !mailboxChecked || recoveryNote.trim().length < 10
                  }
                  onClick={() => void recoverDelivery("confirmed_sent")}
                >
                  Confirm it{" "}
                  {pendingOperation.mode === "draft" ? "was saved" : "was sent"}
                </button>
                <button
                  type="button"
                  className="cg-btn"
                  disabled={
                    !!busy ||
                    !mailboxChecked ||
                    recoveryNote.trim().length < 10 ||
                    !!pendingOperation.provider_id
                  }
                  title={
                    pendingOperation.provider_id
                      ? "The provider already accepted some or all recipients; this cannot be recorded as entirely unsent."
                      : undefined
                  }
                  onClick={() => void recoverDelivery("confirmed_not_sent")}
                >
                  Confirm it was not{" "}
                  {pendingOperation.mode === "draft" ? "saved" : "sent"}
                </button>
              </div>
            </details>
          )}
        </section>
      )}
      {recentOperation &&
        !["unknown", "sending"].includes(recentOperation.status) && (
          <section
            className="cg-delivery-recovery"
            aria-label="Recent mailbox result"
          >
            <p>
              <strong>
                {recentOperation.status === "submitted"
                  ? "Previous send recorded"
                  : recentOperation.status === "draft"
                    ? "Previous draft saved"
                    : "Previous request cancelled"}
              </strong>{" "}
              · {recentOperation.account}
            </p>
            <p>
              {recentOperation.message ??
                "This receipt belongs to the recorded request. Changes in the editor have not been sent."}
            </p>
            <p>
              Request {recentOperation.operation_id} ·{" "}
              {new Date(recentOperation.created_at).toLocaleString()}
              {recentOperation.case_version
                ? ` · case revision ${recentOperation.case_version}`
                : ""}
              . Current editor changes are not covered by this receipt.
            </p>
            {recentOperation.case_version !== undefined &&
              recentOperation.case_version !== result.version && (
                <p role="status">
                  This request belongs to an earlier case revision. Review
                  revision {result.version} in the Follow-up tab before
                  recording its next action.
                </p>
              )}
            {!!recentOperation.accepted_recipients?.length && (
              <p>
                Accepted recipients:{" "}
                {recentOperation.accepted_recipients.join(", ")}
              </p>
            )}
            {!!recentOperation.rejected_recipients?.length && (
              <p role="alert">
                <strong>Rejected recipients:</strong>{" "}
                {recentOperation.rejected_recipients.join(", ")}. Response
                tracking has not been started for this partial submission.
                Prepare a separate request for the rejected recipients after
                checking the mailbox; do not resend to accepted recipients.
              </p>
            )}
            {recentOperation.follow_up_recorded === true && (
              <p>Response tracking is recorded for this request.</p>
            )}
            {canRetryResponseTracking(recentOperation) && (
              <p>
                The email was accepted, but response tracking is not recorded.
                Retry tracking without sending another email, or review the
                Follow-up tab if the case changed.
              </p>
            )}
            <button
              type="button"
              className="cg-btn"
              disabled={!!busy || !!pendingOperation}
              onClick={() => void recoverDelivery()}
            >
              {canRetryResponseTracking(recentOperation)
                ? "Retry response tracking — no resend"
                : "Refresh this request’s status"}
            </button>
          </section>
        )}
      {askSent && onReplied && (
        <div className="cg-composer-sent" role="status">
          <p>
            Reply {askSent}.{" "}
            <strong>
              {sentForSure
                ? "What happens next?"
                : "Once it is sent, what happens next?"}
            </strong>
          </p>
          <div className="cg-composer-sent-options">
            {(
              [
                [
                  "waiting",
                  "Waiting for their answer",
                  "Track the request and keep any confirmed follow-up deadline",
                ],
                [
                  "working",
                  "Still working on it",
                  "Stays in To do, e.g. checking with billing",
                ],
                [
                  "done",
                  "Finished",
                  cannotFinish ??
                    "This email's check is complete; this does not approve the shipment",
                ],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                className={`cg-btn ${recommended === value ? "primary" : ""}`}
                disabled={
                  !!recording ||
                  !!busy ||
                  !!pendingOperation ||
                  unresolvedSend ||
                  (value === "done" && !!cannotFinish)
                }
                title={hint}
                onClick={() => void recordReply(value)}
              >
                {recording === value ? (
                  <Loader2 size={16} className="cg-spin" />
                ) : (
                  <CheckCircle2 size={16} />
                )}
                <span>
                  {!sentForSure ? `I sent it — ${label.toLowerCase()}` : label}
                  <small>{hint}</small>
                </span>
              </button>
            ))}
          </div>
          {!sentForSure && (
            <button
              type="button"
              className="cg-link cg-small"
              onClick={() => setAskSent("")}
            >
              I have not sent it yet
            </button>
          )}
        </div>
      )}
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
                disabled={
                  !ready || !!busy || !operationsReady || !!pendingOperation
                }
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
              disabled={
                !ready || !!busy || !operationsReady || !!pendingOperation
              }
              onClick={() => setConfirmSend(true)}
            >
              <Send size={18} /> Review &amp; send
            </button>
          ))}
        {connected && (
          <button
            type="button"
            className={`cg-btn ${canSend ? "" : "primary"}`}
            disabled={
              !ready || !!busy || !operationsReady || !!pendingOperation
            }
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
          href={ready && !handoffBlocked ? gmailUrl : undefined}
          aria-disabled={!ready || handoffBlocked}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            if (!ready || handoffBlocked) {
              event.preventDefault();
              return;
            }
            setSentForSure(false);
            setAskSent("opened in Gmail");
          }}
        >
          <ExternalLink size={18} /> Open Gmail compose
        </a>
        <button
          type="button"
          className="cg-btn"
          disabled={handoffBlocked}
          onClick={() => void copy()}
        >
          {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          className="cg-btn ghost"
          disabled={handoffBlocked}
          onClick={download}
        >
          <FileDown size={18} /> Download .eml
        </button>
        <span className="cg-spacer" />
        <button
          type="button"
          className="cg-btn ghost"
          disabled={!!busy}
          onClick={() => applyDraft({})}
          title="Write the suggested text again"
        >
          <RotateCcw size={18} /> Start over
        </button>
      </div>
      {handoffBlocked && (
        <p className="cg-composer-checks" role="status">
          Copy, email downloads and Gmail compose are paused while the mailbox
          request is being checked or its outcome is uncertain. Resolve the
          request above before preparing another copy.
        </p>
      )}
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
      <p
        className="cg-small cg-muted"
        style={{ padding: "0 18px 14px", margin: 0 }}
      >
        Gmail compose opens a draft; it cannot guarantee placement in the
        original conversation. Use a connected mailbox for a reply with the
        original message headers.
      </p>
    </section>
  );
}
