"use client";
import { useEffect, useRef, useState } from "react";
import {
  Mail,
  RefreshCw,
  Send,
  Paperclip,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { requestJson } from "@/lib/client-api";
import { amendmentDraft } from "@/lib/case-guide";
import { CaseAssistant } from "./case-assistant";
import type { CaseResult, CaseSummary, ParsedDocument } from "@/lib/types";
import type { GmailMessage as Message } from "@/lib/gmail-storage";
import type { CorrespondenceDraft as Draft } from "@/lib/correspondence";
type Mailbox = {
  enabled: boolean;
  connected: boolean;
  accountEmail?: string;
  reason?: string;
  messages: Message[];
  drafts: Draft[];
};
const recipient = (value: string) => value.match(/<([^>]+)>/)?.[1] ?? value;

export function CorrespondencePanel({
  cases,
  initialResult,
  onUpdated,
  onUseAttachment,
  onImported,
  onInspectCase,
}: {
  cases: CaseSummary[];
  initialResult?: CaseResult;
  onUpdated: (results: CaseResult[]) => void;
  onUseAttachment: (
    result: CaseResult,
    source: ParsedDocument | null,
    file: File,
    mode: "replace_one" | "append",
  ) => void;
  onImported?: (result: CaseResult) => void;
  onInspectCase: (id: string, tab: string) => void;
}) {
  const [caseId, setCaseId] = useState(initialResult?.email.email_id ?? "");
  const [result, setResult] = useState<CaseResult | null>(
    initialResult ?? null,
  );
  const [mailbox, setMailbox] = useState<Mailbox | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [to, setTo] = useState(""),
    [cc, setCc] = useState(""),
    [body, setBody] = useState("");
  const [confirmed, setConfirmed] = useState(false),
    [aiOpen, setAiOpen] = useState(false);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0),
    [target, setTarget] = useState("");
  const [source, setSource] = useState<{
    name: string;
    location: string;
  } | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const abort = new AbortController(),
      ticket = ++sequence.current;
    void (async () => {
      const global = await requestJson<Mailbox>("/api/gmail", {
        signal: abort.signal,
      });
      const scoped = caseId
        ? await requestJson<Mailbox>(
            `/api/gmail?caseId=${encodeURIComponent(caseId)}`,
            { signal: abort.signal },
          )
        : global;
      if (ticket !== sequence.current || abort.signal.aborted) return;
      setError("");
      setMailbox(scoped);
      setMessages([
        ...new Map(
          [
            ...scoped.messages,
            ...global.messages.filter((message) => !caseId || !message.caseId),
          ].map((message) => [message.id, message]),
        ).values(),
      ]);
      setDrafts(scoped.drafts);
      setDraft((current) => {
        const saved = scoped.drafts.find((item) => item.id === current?.id);
        return saved && ["sending", "sent", "uncertain"].includes(saved.status)
          ? saved
          : current;
      });
      if (caseId) {
        const saved = await requestJson<{ result: CaseResult }>(
          `/api/cases?id=${encodeURIComponent(caseId)}`,
          { signal: abort.signal },
        );
        if (ticket === sequence.current && !abort.signal.aborted)
          setResult(saved.result);
      }
    })().catch((failure: Error) => {
      if (!abort.signal.aborted) setError(failure.message);
    });
    return () => abort.abort();
  }, [caseId, refresh]);
  const message = messages.find((item) => item.id === selectedId);
  const dirty =
    !!draft && (draft.to !== to || draft.cc !== cc || draft.body !== body);
  const usableDraft =
    draft?.status === "ready" &&
    !dirty &&
    draft.caseVersion === result?.version;
  const lockedDraft =
    !!draft && ["sending", "sent", "uncertain"].includes(draft.status);
  async function action(name: string, data: object = {}) {
    if (busy) return;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      const response = await requestJson<{
        authorizeUrl?: string;
        draft?: Draft;
        imported?: number;
        more?: boolean;
        result?: CaseResult;
      }>("/api/gmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: name, ...data }),
      });
      if (!mounted.current) return;
      if (response.authorizeUrl) {
        window.location.assign(response.authorizeUrl);
        return;
      }
      if (response.result) {
        onUpdated([response.result]);
        setResult(response.result);
        setCaseId(response.result.email.email_id);
        setNotice(
          "Email imported as a new case. Its attachments have been processed.",
        );
        onImported?.(response.result);
      }
      if (response.draft) {
        setDraft(response.draft);
        setTo(response.draft.to);
        setCc(response.draft.cc);
        setBody(response.draft.body);
        setConfirmed(false);
        setNotice(
          response.draft.status === "sent"
            ? "Reply sent. Its delivery record is saved in this case."
            : `Draft status: ${response.draft.status}.`,
        );
      } else if (name === "sync")
        setNotice(
          `${response.imported ?? 0} message(s) synchronized.${response.more ? " Sync again to load more." : ""}`,
        );
      else if (name === "link_message")
        setNotice(
          "Message linked to this case. Source documents have not changed.",
        );
      setRefresh((value) => value + 1);
    } catch (failure) {
      if (mounted.current) {
        setError((failure as Error).message);
        setConfirmed(false);
      }
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  function selectMessage(item: Message) {
    if (!initialResult && item.caseId && item.caseId !== caseId) {
      setCaseId(item.caseId);
      setResult(null);
    }
    setSelectedId(item.id);
    setDraft(null);
    setTo(recipient(item.replyTo || item.from));
    setCc("");
    setBody("");
    setConfirmed(false);
    setAiOpen(false);
    setSource(null);
    setTarget("");
    setError("");
    setNotice("");
  }
  function editBody(value: string) {
    setBody(value);
    setConfirmed(false);
  }
  async function chooseAttachment(attachment: Message["attachments"][number]) {
    if (!message || !result || !target || busy) return;
    const append = target === "append";
    const original = append
      ? null
      : result.documents.find((item) => `replace:${item.name}` === target);
    if (!append && !original?.sha256) return;
    setBusy("attachment");
    setError("");
    try {
      const response = await fetch(
        `/api/gmail/attachment?messageId=${encodeURIComponent(message.id)}&attachmentId=${encodeURIComponent(attachment.id)}`,
      );
      if (!response.ok)
        throw new Error(
          "Could not download this attachment. Sync the mailbox and retry.",
        );
      const file = new File([await response.blob()], attachment.name, {
        type: attachment.mimeType,
      });
      if (file.size > 5 * 1024 * 1024)
        throw new Error("The attachment must be 5 MB or smaller.");
      if (mounted.current)
        onUseAttachment(
          result,
          original ?? null,
          file,
          append ? "append" : "replace_one",
        );
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message);
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  async function prepareCase() {
    if (!caseId || busy) return;
    setBusy("prepare");
    setError("");
    try {
      const saved = await requestJson<{
        results: CaseResult[];
        errors?: { error: string }[];
      }>("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process",
          ids: [caseId],
          skipSaved: true,
        }),
      });
      if (!saved.results[0])
        throw new Error(
          saved.errors?.[0]?.error ?? "Could not prepare this case.",
        );
      if (mounted.current) {
        setResult(saved.results[0]);
        onUpdated(saved.results);
        setRefresh((value) => value + 1);
      }
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message);
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  return (
    <section className="correspondence-panel" aria-label="Email correspondence">
      <header className="correspondence-heading">
        <div>
          <span className="eyebrow">CASE CORRESPONDENCE</span>
          <h3>
            <Mail size={20} /> Gmail & replies
          </h3>
        </div>
        <button
          className="text-button"
          disabled={!!busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </header>
      {!mailbox && !error && <p role="status">Loading mailbox connection…</p>}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      {mailbox && (
        <div
          className={`mailbox-connection ${mailbox.connected ? "connected" : "disconnected"}`}
        >
          <div className="mailbox-connection-copy">
            <span className="mailbox-connection-icon" aria-hidden="true">
              <Mail size={20} />
            </span>
            <div>
              <strong>
                {mailbox.connected
                  ? (mailbox.accountEmail ?? "Gmail connected")
                  : mailbox.enabled
                    ? "Connect your Gmail"
                    : "Gmail is not configured"}
              </strong>
              <p>
                {mailbox.connected
                  ? "Sync messages, then choose one to review."
                  : (mailbox.reason ??
                    "Import messages and send replies after your review.")}
              </p>
            </div>
          </div>
          <div className="case-actions mailbox-connection-actions">
            {mailbox?.enabled && !mailbox.connected && (
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() => void action("connect")}
              >
                Connect Gmail
              </button>
            )}
            {mailbox?.connected && (
              <>
                <button
                  className="button primary"
                  disabled={!!busy}
                  onClick={() => void action("sync")}
                >
                  {busy === "sync" ? "Synchronizing…" : "Sync messages"}
                </button>
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={() => void action("disconnect")}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {!initialResult && (
        <label className="correspondence-case">
          Case for this correspondence
          <select
            value={caseId}
            disabled={!!busy}
            onChange={(event) => {
              setCaseId(event.target.value);
              setResult(null);
              setSelectedId("");
              setDraft(null);
              setBody("");
              setConfirmed(false);
            }}
          >
            <option value="">Choose a case…</option>
            {cases.map((row) => (
              <option key={row.email.email_id} value={row.email.email_id}>
                {row.email.email_id} · {row.email.subject}
              </option>
            ))}
          </select>
        </label>
      )}
      {caseId && !result && (
        <button
          className="button secondary"
          disabled={!!busy}
          onClick={() => void prepareCase()}
        >
          Prepare this case
        </button>
      )}
      <section className="correspondence-inbox" aria-label="Mailbox messages">
        {(messages.length > 0 || mailbox?.connected) && (
          <div className="correspondence-section-heading">
            <h4>Messages</h4>
            <span>{messages.length} loaded</span>
          </div>
        )}
        <div className="correspondence-messages">
          {messages.length === 0 && mailbox?.connected && (
            <div className="correspondence-empty">
              <Mail size={24} aria-hidden="true" />
              <strong>Your messages will appear here</strong>
              <p>
                Sync Gmail to load messages, then select one to import or link
                to a case.
              </p>
            </div>
          )}
          {messages.map((item) => (
            <button
              key={item.id}
              className={item.id === selectedId ? "selected" : ""}
              aria-pressed={item.id === selectedId}
              disabled={!!busy}
              onClick={() => selectMessage(item)}
            >
              <span>{item.direction === "outbound" ? "Sent" : item.from}</span>
              <strong>{item.subject || "(No subject)"}</strong>
              <small>
                {item.receivedAt
                  ? new Date(item.receivedAt).toLocaleString()
                  : "Unknown received date"}{" "}
                · {item.caseId ? `Case ${item.caseId}` : "Not linked to a case"}
              </small>
            </button>
          ))}
        </div>
      </section>
      {message && (
        <article className="correspondence-message">
          <div className="correspondence-section-heading">
            <span>Selected message</span>
            <span className="correspondence-link-state">
              {message.caseId ? "Linked to case" : "Not linked"}
            </span>
          </div>
          <h4>{message.subject || "(No subject)"}</h4>
          <p>
            <b>From:</b> {message.from}
          </p>
          <pre>{message.body}</pre>
          <div className="case-actions correspondence-message-actions">
            {!message.caseId && result && (
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() =>
                  void action("link_message", {
                    messageId: message.id,
                    caseId: result.email.email_id,
                    version: result.version,
                  })
                }
              >
                Link this message to {result.email.email_id}
              </button>
            )}
            {!message.caseId && message.direction === "inbound" && (
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() =>
                  void action("import_message", { messageId: message.id })
                }
              >
                {busy === "import_message"
                  ? "Importing…"
                  : "Import as new case"}
              </button>
            )}
          </div>
          {!!message.attachments.length && (
            <div className="correspondence-attachments">
              <h4>
                <Paperclip size={16} /> Attachments
              </h4>
              {result && (
                <label>
                  Use attachment in this case
                  <select
                    value={target}
                    disabled={!!busy}
                    onChange={(event) => setTarget(event.target.value)}
                  >
                    <option value="">Choose how to use this attachment…</option>
                    <option
                      value="append"
                      disabled={result.documents.length >= 10}
                    >
                      Add as an additional attachment
                    </option>
                    {result.documents
                      .filter((item) => item.sha256)
                      .map((item) => (
                        <option key={item.name} value={`replace:${item.name}`}>
                          Replace {item.type} · {item.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {message.attachments.map((attachment) => (
                <div key={attachment.id}>
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={`/api/gmail/attachment?messageId=${encodeURIComponent(message.id)}&attachmentId=${encodeURIComponent(attachment.id)}`}
                  >
                    {attachment.name} <ExternalLink size={13} />
                  </a>
                  <button
                    className="text-button"
                    disabled={
                      !!busy ||
                      !target ||
                      !result ||
                      message.caseId !== result.email.email_id ||
                      !/\.(txt|pdf|docx|xlsx)$/i.test(attachment.name)
                    }
                    onClick={() => void chooseAttachment(attachment)}
                  >
                    {target === "append"
                      ? "Add to this case"
                      : "Use as revised source"}
                  </button>
                </div>
              ))}
              <p>
                Link the message first. Adding or replacing an attachment opens
                a review step before changing this case. Adding keeps every
                existing source; syncing never changes a comparison.
              </p>
            </div>
          )}
        </article>
      )}
      {result &&
        message?.caseId === result.email.email_id &&
        message.direction === "inbound" && (
          <section className="reply-editor">
            <div className="reply-editor-heading">
              <h3>Draft a reply</h3>
              <span className="reply-thread-note">
                <Mail size={14} aria-hidden="true" /> Original Gmail thread
              </span>
            </div>
            <p>
              The reply stays in the selected Gmail thread. Saving a draft does
              not send it.
            </p>
            <div className="case-actions">
              <button
                className="button secondary"
                disabled={!!busy || lockedDraft}
                onClick={() => {
                  const text = amendmentDraft(result);
                  if (!text.available) setError(text.reason);
                  else editBody(text.text.split("\n").slice(3).join("\n"));
                }}
              >
                Start from verified differences
              </button>
              <button
                className="button secondary"
                disabled={!!busy || lockedDraft}
                onClick={() => setAiOpen((value) => !value)}
              >
                <Sparkles size={15} />{" "}
                {aiOpen ? "Close AI drafting" : "Draft with AI"}
              </button>
            </div>
            {aiOpen && !lockedDraft && (
              <CaseAssistant
                key={`${result.email.email_id}-${result.version}-${message.id}`}
                result={result}
                initialMemory={{
                  question:
                    "Draft a polite correction request using only supported differences. Clearly flag missing or uncertain evidence. Return the email body as a draft block without invented recipients or subject.",
                  reply: null,
                  facts: [],
                  cached: false,
                }}
                onFallback={() =>
                  onInspectCase(result.email.email_id, "resolution")
                }
                onSource={(name, location) => setSource({ name, location })}
                onDraft={(text) => {
                  editBody(text);
                  setAiOpen(false);
                  setNotice(
                    "AI draft copied to the reply editor. Review and edit it before saving or sending.",
                  );
                }}
                sourceContent={
                  source ? (
                    <div className="info-box">
                      <div>
                        <strong>
                          {source.name} · {source.location}
                        </strong>
                        {result.documents
                          .find((item) => item.name === source.name)
                          ?.lines.filter((line) =>
                            source.location.includes(line.location),
                          )
                          .map((line, index) => (
                            <p key={index}>{line.text}</p>
                          ))}
                        <a
                          href={`/api/document?id=${encodeURIComponent(result.email.email_id)}&name=${encodeURIComponent(source.name)}&revision=${result.version}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open original
                        </a>
                      </div>
                    </div>
                  ) : undefined
                }
              />
            )}
            <fieldset className="reply-fields" disabled={!!busy || lockedDraft}>
              <label>
                To
                <input
                  type="email"
                  value={to}
                  onChange={(event) => {
                    setTo(event.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label>
                CC <small>(comma-separated addresses)</small>
                <input
                  value={cc}
                  onChange={(event) => {
                    setCc(event.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label className="reply-subject-field">
                Subject
                <input
                  value={
                    draft?.subject ??
                    (/^re:/i.test(message.subject)
                      ? message.subject
                      : `Re: ${message.subject}`)
                  }
                  readOnly
                />
              </label>
              <label className="reply-body-field">
                Message
                <textarea
                  rows={12}
                  value={body}
                  maxLength={20000}
                  onChange={(event) => editBody(event.target.value)}
                />
              </label>
              <button
                className={`button reply-save ${usableDraft ? "secondary" : "primary"}`}
                disabled={!body.trim() || !to.trim()}
                onClick={() =>
                  void action("save_draft", {
                    caseId: result.email.email_id,
                    version: result.version,
                    replyToMessageId: message.id,
                    to,
                    cc,
                    body,
                    ...(draft
                      ? { draftId: draft.id, draftVersion: draft.version }
                      : {}),
                  })
                }
              >
                {busy === "save_draft" ? "Saving…" : "Save reviewed draft"}
              </button>
            </fieldset>
            {draft && (
              <div
                className={`draft-status draft-${draft.status}`}
                role="status"
              >
                <strong>
                  {draft.status === "sent" ? "Sent" : `Draft: ${draft.status}`}
                </strong>
                {draft.error && <p>{draft.error}</p>}
                {dirty && <p>Save your edits before sending.</p>}
                {draft.caseVersion !== result.version && (
                  <p>
                    This draft uses an earlier case revision. Start a fresh
                    draft from the latest evidence.
                  </p>
                )}
              </div>
            )}
            {draft && usableDraft && (
              <div className="reply-send">
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={!!busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />{" "}
                  I checked the recipients, message and case evidence, and
                  authorize sending this reply.
                </label>
                <button
                  className="button primary"
                  disabled={!!busy || !confirmed || !mailbox?.connected}
                  onClick={() =>
                    void action("send", {
                      draftId: draft.id,
                      draftVersion: draft.version,
                      confirmed: true,
                    })
                  }
                >
                  <Send size={15} />
                  {busy === "send" ? "Sending…" : "Send reply through Gmail"}
                </button>
              </div>
            )}
            {draft && ["uncertain", "sending"].includes(draft.status) && (
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => void action("reconcile", { draftId: draft.id })}
              >
                Check delivery status before retrying
              </button>
            )}
            {draft && (
              <button
                className="text-button"
                disabled={
                  !!busy ||
                  draft.status === "sending" ||
                  draft.status === "uncertain"
                }
                onClick={() => {
                  setDraft(null);
                  setBody("");
                  setConfirmed(false);
                }}
              >
                Start another draft
              </button>
            )}
          </section>
        )}
      {drafts.length > 0 && (
        <details className="correspondence-drafts">
          <summary>
            Saved reply drafts & delivery history ({drafts.length})
          </summary>
          {drafts.map((saved) => (
            <button
              key={saved.id}
              disabled={!!busy}
              onClick={() => {
                const item = messages.find(
                  (entry) => entry.id === saved.replyToMessageId,
                );
                if (item) {
                  selectMessage(item);
                  setDraft(saved);
                  setTo(saved.to);
                  setCc(saved.cc);
                  setBody(saved.body);
                } else
                  setError(
                    "Sync the original message before opening this draft.",
                  );
              }}
            >
              <strong>{saved.subject}</strong>
              <span className={`reply-history-status draft-${saved.status}`}>
                {saved.status} · case revision {saved.caseVersion} · draft{" "}
                {saved.version}
              </span>
            </button>
          ))}
        </details>
      )}
    </section>
  );
}
