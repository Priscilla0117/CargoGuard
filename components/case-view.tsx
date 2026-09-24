"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  FileText,
  Hash,
  History,
  Inbox,
  Loader2,
  Mail,
  MessageSquareText,
  MessagesSquare,
  MoreHorizontal,
  Paperclip,
  Printer,
  RefreshCw,
  Replace,
  ShieldAlert,
  Tag,
  Upload,
  User,
} from "lucide-react";
import {
  emailInsight,
  latestMessagePart,
  quotedHistory,
  type ThreadInfo,
} from "@/lib/mail-intel";
import type { Plan } from "@/lib/priority";
import { caseStatus, categoryWords, rowStatus } from "@/lib/case-status";
import { canTranscribe } from "@/lib/transcription";
import { checkDocumentIntegrity } from "@/lib/integrity-checks";
import type { FollowUp } from "@/lib/follow-up";
import {
  FIELD_LABELS,
  type AuditEvent,
  type CaseResult,
  type CaseSummary,
  type Field,
  type ParsedDocument,
} from "@/lib/types";
import { CompareTable, type FieldEdit } from "./compare-table";
import { ReplyComposer, type MailboxState } from "./reply-composer";
import { DocumentPairSelector } from "./document-pair-selector";
import { ScanAssist } from "./scan-assist";
import { EvidenceRecovery } from "./evidence-recovery";
import { IntegrityChecks } from "./integrity-checks";
import { ResolutionDesk } from "./resolution-desk";
import { FollowUpDesk } from "./follow-up-desk";
import { DecisionHistory } from "./decision-history";
import { formatReceived } from "./inbox-view";

export type CaseTab =
  | "compare"
  | "reply"
  | "conversation"
  | "documents"
  | "followup"
  | "history";
export const CASE_TABS: { id: CaseTab; label: string }[] = [
  { id: "compare", label: "Check details" },
  { id: "reply", label: "Reply" },
  { id: "conversation", label: "Email & conversation" },
  { id: "documents", label: "Documents" },
  { id: "followup", label: "Follow-up" },
  { id: "history", label: "History" },
];
/** Old deep links (assistant, citations) keep working. */
export function tabFor(target: string): CaseTab {
  if (target === "resolution") return "reply";
  if (target === "email") return "conversation";
  if (target === "comparison") return "compare";
  if (target === "integrity") return "compare";
  return (CASE_TABS.find((tab) => tab.id === target)?.id ??
    "compare") as CaseTab;
}

export function AuditDetail({ detail }: { detail: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return <p className="cg-small">{detail}</p>;
  const data = parsed as Record<string, unknown>;
  const summary = data.summary
    ? String(data.summary)
    : data.transcript && typeof data.transcript === "object"
      ? `Seven scan fields confirmed for ${String(data.document ?? "document")}.`
      : data.field
        ? `${FIELD_LABELS[data.field as Field] ?? String(data.field)} (${String(data.side ?? "").toUpperCase()}): ${String(data.before ?? "")} → ${String(data.after ?? "")}`
        : data.before !== undefined
          ? `Email type: ${categoryWords(String(data.before))} → ${categoryWords(String(data.after))}`
          : "Decision recorded.";
  return (
    <div className="cg-small">
      <p style={{ margin: 0 }}>
        {summary}
        {data.reason ? ` Reason: ${String(data.reason)}` : ""}
      </p>
      <details>
        <summary className="cg-muted">Technical details</summary>
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 13 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}

const STATUS_ICON: Record<string, ReactNode> = {
  differences: <AlertTriangle size={26} />,
  missing: <Paperclip size={26} />,
  unclear: <CircleHelp size={26} />,
  unprocessed: <CircleHelp size={26} />,
  done: <CheckCircle2 size={26} />,
  other: <Inbox size={26} />,
};

export interface CaseViewProps {
  result: CaseResult;
  events: AuditEvent[];
  cases: CaseSummary[];
  plans: Map<string, Plan>;
  thread?: ThreadInfo;
  tab: CaseTab;
  onTab: (tab: CaseTab) => void;
  document: ParsedDocument | null;
  sourceLocation: string;
  onSource: (name: string, location: string) => void;
  onDocument: (doc: ParsedDocument) => void;
  mailbox: MailboxState | null;
  reviewerName: string;
  onReviewerName: (value: string) => void;
  defaultSignature: string;
  busy: boolean;
  running: boolean;
  position: { index: number; total: number } | null;
  prevId: string | null;
  nextId: string | null;
  onOpenCase: (id: string) => void;
  onClose: () => void;
  onSaveEdit: (
    edit: FieldEdit,
    actor: string,
    reason: string,
  ) => Promise<boolean>;
  onReprocess: () => void;
  onReplace: (mode: "bl" | "all") => void;
  onConfirmCategory: () => void;
  onAsk: () => void;
  onUpdated: (
    data: { result: CaseResult; audit: AuditEvent[] },
    message: string,
  ) => void;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  error: string;
  followup: {
    value: FollowUp | undefined;
    ready: boolean;
    loading: boolean;
    error: string;
    formKey: number;
    onRefresh: () => void;
    onReloadCase: () => void;
    onReloadValues: () => void;
    onSaved: (value: FollowUp) => void;
  };
}

export function CaseView(props: CaseViewProps) {
  const { result, tab, onTab, plans, thread, cases, busy, running } = props;
  const [menu, setMenu] = useState(false);
  // "Mark as handled" pre-fills the follow-up once, for this email only.
  const [markDoneFor, setMarkDoneFor] = useState<string | null>(null);
  const markDone = markDoneFor === result.email.email_id;
  const menuRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const highlighted = useRef<HTMLDivElement | null>(null);
  const plan = plans.get(result.email.email_id);
  const status = caseStatus(result, plan);
  const received = formatReceived(result.email.received_at);
  const insight = emailInsight(result.email);
  const refs = insight.refs;
  const canEdit = result.comparison.length > 0;

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setMenu(false);
        return;
      }
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);
  useEffect(() => {
    highlighted.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [props.sourceLocation, props.document, tab]);

  function go(target: CaseTab) {
    onTab(target);
    requestAnimationFrame(() => {
      const tabs = scroller.current?.querySelector(".cg-case-tabs");
      if (tabs && scroller.current)
        scroller.current.scrollTo({
          top: (tabs as HTMLElement).offsetTop - 8,
          behavior: "smooth",
        });
    });
  }
  function act(target: string, label = "") {
    setMarkDoneFor(
      target === "followup" && /handled/i.test(label)
        ? result.email.email_id
        : null,
    );
    if (target === "category") props.onConfirmCategory();
    else if (target === "compare") go("compare");
    else go(target as CaseTab);
  }

  const threadRows = thread
    ? thread.ids
        .map((id) => cases.find((row) => row.email.email_id === id))
        .filter((row): row is CaseSummary => !!row)
        .sort(
          (a, b) =>
            (a.email.received_at ?? "").localeCompare(
              b.email.received_at ?? "",
            ) || a.email.email_id.localeCompare(b.email.email_id),
        )
    : [];

  return (
    <>
      <div className="cg-case-top">
        <button className="cg-btn ghost" onClick={props.onClose}>
          <ArrowLeft size={20} /> Back
          <span className="cg-hide-sm"> to inbox</span>
        </button>
        <span className="cg-spacer" />
        {props.position && (
          <span className="cg-small cg-muted cg-hide-sm" aria-live="polite">
            {props.position.index + 1} of {props.position.total}
          </span>
        )}
        <button
          className="cg-btn small"
          disabled={!props.prevId || busy}
          onClick={() => props.prevId && props.onOpenCase(props.prevId)}
          aria-label="Previous email"
        >
          <ArrowLeft size={16} />
          <span className="cg-hide-sm">Previous</span>
        </button>
        <button
          className="cg-btn small"
          disabled={!props.nextId || busy}
          onClick={() => props.nextId && props.onOpenCase(props.nextId)}
          aria-label="Next email"
        >
          <span className="cg-hide-sm">Next</span> <ArrowRight size={16} />
        </button>
        <div className="cg-menu" ref={menuRef}>
          <button
            className="cg-btn small"
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <MoreHorizontal size={18} />
            <span className="cg-hide-sm">More</span>
          </button>
          {menu && (
            <div className="cg-menu-list" role="menu">
              <button
                role="menuitem"
                disabled={running}
                onClick={() => {
                  setMenu(false);
                  props.onReplace("bl");
                }}
              >
                <Upload size={18} /> Upload corrected BL
              </button>
              <button
                role="menuitem"
                disabled={running}
                onClick={() => {
                  setMenu(false);
                  props.onReplace("all");
                }}
              >
                <Replace size={18} /> Replace SI and BL
              </button>
              <button
                role="menuitem"
                disabled={busy || running}
                onClick={() => {
                  setMenu(false);
                  props.onReprocess();
                }}
              >
                <RefreshCw size={18} /> Read documents again
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  props.onConfirmCategory();
                }}
              >
                <Tag size={18} /> Change email type
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  props.onAsk();
                }}
              >
                <MessageSquareText size={18} /> Ask the assistant
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  window.print();
                }}
              >
                <Printer size={18} /> Print
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="cg-case-scroll" ref={scroller}>
        {props.error && (
          <div className="cg-notice error" role="alert">
            <ShieldAlert size={20} />
            <p>{props.error}</p>
          </div>
        )}
        <header className="cg-case-head">
          <h2>{result.email.subject}</h2>
          <div className="cg-case-meta">
            <span>
              <User size={16} />
              {insight.sender_name ? `${insight.sender_name} · ` : ""}
              {result.email.from}
            </span>
            {received && (
              <span>
                <CalendarClock size={16} />
                {received.day} {received.time}
              </span>
            )}
            {refs?.shipment[0] && (
              <span>
                <Hash size={16} /> Order {refs.shipment.join(", ")}
              </span>
            )}
            {refs?.po[0] && <span>PO {refs.po.join(", ")}</span>}
            <span>
              <Paperclip size={16} /> {result.documents.length} document
              {result.documents.length === 1 ? "" : "s"}
            </span>
            {thread && (
              <button className="cg-link" onClick={() => go("conversation")}>
                <MessagesSquare size={16} /> {thread.ids.length} emails in this
                conversation
              </button>
            )}
          </div>
        </header>
        <section
          className={`cg-status-card ${status.tone}`}
          aria-label="What to do next"
        >
          <span className="cg-status-icon" aria-hidden="true">
            {STATUS_ICON[status.tone]}
          </span>
          <div>
            <h3>{status.title}</h3>
            <p>{status.detail}</p>
            {plan && plan.bucket === "todo" && plan.reasons.length > 0 && (
              <p className="cg-small" style={{ marginTop: 6 }}>
                <strong>Priority: {plan.level}</strong> —{" "}
                {plan.reasons.join(" · ")}
              </p>
            )}
          </div>
          <div className="cg-status-actions">
            {status.secondary && (
              <button
                className="cg-btn"
                onClick={() =>
                  act(status.secondary!.target, status.secondary!.label)
                }
              >
                {status.secondary.label}
              </button>
            )}
            {status.action && (
              <button
                className="cg-btn primary"
                onClick={() => act(status.action!.target)}
              >
                {status.action.label} <ArrowRight size={18} />
              </button>
            )}
          </div>
        </section>
        <div className="cg-case-tabs">
          <div className="cg-tabs" role="tablist" aria-label="Case sections">
            {CASE_TABS.map((item) => (
              <button
                key={item.id}
                role="tab"
                className="cg-tab"
                aria-selected={tab === item.id}
                onClick={() => {
                  setMarkDoneFor(null);
                  onTab(item.id);
                }}
              >
                {item.label}
                {item.id === "compare" && result.defect_fields.length > 0 && (
                  <span className="cg-count">
                    {result.defect_fields.length}
                  </span>
                )}
                {item.id === "conversation" && thread && (
                  <span className="cg-count">{thread.ids.length}</span>
                )}
                {item.id === "documents" && (
                  <span className="cg-count">{result.documents.length}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        {tab === "compare" && (
          <div className="cg-panel">
            {result.document_selection && (
              <p className="cg-notice" style={{ margin: 0 }}>
                <FileText size={18} />
                <span>
                  Only the chosen SI and BL are compared.{" "}
                  {result.documents.length - 2} other attachment
                  {result.documents.length - 2 === 1 ? " is" : "s are"} kept but
                  not checked.{" "}
                  <button
                    className="cg-link"
                    onClick={() => onTab("documents")}
                  >
                    Change the choice
                  </button>
                </span>
              </p>
            )}
            {canEdit ? (
              <CompareTable
                key={`${result.email.email_id}:${result.documents.map((doc) => doc.sha256 ?? doc.name).join(",")}`}
                result={result}
                reviewerName={props.reviewerName}
                onReviewerName={props.onReviewerName}
                canEdit={!running}
                onSave={props.onSaveEdit}
                onSource={props.onSource}
              />
            ) : (
              <div className="cg-card cg-card-pad">
                <h2>Nothing to compare yet</h2>
                <p className="cg-muted">{result.summary}</p>
                <div className="cg-page-actions" style={{ marginTop: 12 }}>
                  <button className="cg-btn" onClick={() => onTab("documents")}>
                    See the attachments
                  </button>
                  <button
                    className="cg-btn primary"
                    onClick={() => onTab("reply")}
                  >
                    Reply to sender
                  </button>
                </div>
              </div>
            )}
            {canEdit && (
              <details className="cg-details">
                <summary>
                  Extra safety checks (container numbers, weights, totals)
                </summary>
                <div>
                  <IntegrityChecks
                    assessment={checkDocumentIntegrity(result)}
                  />
                </div>
              </details>
            )}
            <details className="cg-details">
              <summary>Step-by-step guide for this case</summary>
              <div>
                <ResolutionDesk
                  result={result}
                  onNavigate={(target) => onTab(tabFor(target))}
                  onSource={props.onSource}
                />
              </div>
            </details>
          </div>
        )}
        {tab === "reply" && (
          <ReplyComposer
            key={`${result.email.email_id}-${result.version}`}
            result={result}
            mailbox={props.mailbox}
            defaultName={props.defaultSignature}
            onDone={props.onNotice}
            onError={props.onError}
          />
        )}
        {tab === "conversation" && (
          <div className="cg-panel">
            <section className="cg-card cg-card-pad">
              <h2 className="cg-section-title">
                <Mail size={18} /> This email
              </h2>
              <dl className="cg-kv" style={{ marginBottom: 14 }}>
                <dt>From</dt>
                <dd>{result.email.from}</dd>
                {!!result.email.to?.length && (
                  <>
                    <dt>To</dt>
                    <dd>{result.email.to.join(", ")}</dd>
                  </>
                )}
                {!!result.email.cc?.length && (
                  <>
                    <dt>Cc</dt>
                    <dd>{result.email.cc.join(", ")}</dd>
                  </>
                )}
                <dt>Received</dt>
                <dd>
                  {result.email.received_at
                    ? new Date(result.email.received_at).toLocaleString()
                    : "No date recorded"}
                </dd>
                <dt>Type</dt>
                <dd>{categoryWords(result.category)}</dd>
              </dl>
              <pre className="cg-email-body">
                {latestMessagePart(result.email.body).trim() ||
                  result.email.body}
              </pre>
              {latestMessagePart(result.email.body).length <
                result.email.body.length && (
                <details className="cg-details">
                  <summary>Show the full email with quoted replies</summary>
                  <div>
                    <pre className="cg-email-body">{result.email.body}</pre>
                  </div>
                </details>
              )}
            </section>
            <QuotedTimeline result={result} />
            <ConversationSummary
              result={result}
              rows={threadRows}
              plans={plans}
              onOpen={props.onOpenCase}
            />
          </div>
        )}
        {tab === "documents" && (
          <DocumentsPanel {...props} highlighted={highlighted} />
        )}
        {tab === "followup" &&
          (props.followup.ready ? (
            <FollowUpDesk
              key={`${result.email.email_id}-${result.version}-${props.followup.formKey}`}
              result={result}
              followup={props.followup.value}
              ready={props.followup.ready}
              refreshing={props.followup.loading || busy}
              error={props.followup.error}
              onRefresh={props.followup.onRefresh}
              onReloadCase={props.followup.onReloadCase}
              onReloadValues={props.followup.onReloadValues}
              onSaved={props.followup.onSaved}
              person={props.reviewerName}
              reference={refs.shipment[0] ?? refs.po[0] ?? ""}
              markDone={markDone}
            />
          ) : (
            <div className="cg-notice" role="status">
              <Loader2 size={18} className="cg-spin" />
              <p>{props.followup.error || "Loading the saved follow-up…"}</p>
              <button
                className="cg-btn small"
                onClick={props.followup.onRefresh}
              >
                Retry
              </button>
            </div>
          ))}
        {tab === "history" && (
          <div className="cg-panel">
            <DecisionHistory
              key={`${result.email.email_id}-${result.version}`}
              result={result}
            />
            <section className="cg-card cg-card-pad">
              <h2 className="cg-section-title">Activity</h2>
              {props.events.length ? (
                <ol
                  style={{
                    margin: 0,
                    paddingLeft: 20,
                    display: "grid",
                    gap: 12,
                  }}
                >
                  {props.events.map((event) => (
                    <li key={event.id}>
                      <strong>
                        {event.action
                          .replaceAll("_", " ")
                          .toLowerCase()
                          .replace(/^\w/, (c) => c.toUpperCase())}
                      </strong>
                      <AuditDetail detail={event.detail} />
                      <span className="cg-small cg-muted">
                        {event.actor} ·{" "}
                        {new Date(event.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="cg-muted">
                  No activity loaded yet. Reopen this email to refresh.
                </p>
              )}
            </section>
          </div>
        )}
      </div>
    </>
  );
}

function QuotedTimeline({ result }: { result: CaseResult }) {
  const history = quotedHistory(result.email.body);
  if (!history.length) return null;
  const received = formatReceived(result.email.received_at);
  return (
    <section className="cg-card cg-card-pad">
      <h2 className="cg-section-title">
        <History size={18} /> Earlier messages in this thread
      </h2>
      <p className="cg-muted cg-small" style={{ marginTop: 0 }}>
        Found inside this email&apos;s quoted history — newest first. Read these
        before replying so nothing already agreed is repeated.
      </p>
      <ol className="cg-history">
        <li className="current">
          <strong>
            {emailInsight(result.email).sender_name || result.email.from} (this
            email)
          </strong>
          <small>
            {received ? `${received.day} ${received.time}` : "Latest"}
          </small>
          <p>{emailInsight(result.email).snippet}</p>
        </li>
        {history.map((item, index) => (
          <li key={index}>
            <strong>{item.from}</strong>
            <small>
              {item.sent_text}
              {item.subject ? ` · ${item.subject}` : ""}
            </small>
            {item.text && <p>{item.text}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function ConversationSummary({
  result,
  rows,
  plans,
  onOpen,
}: {
  result: CaseResult;
  rows: CaseSummary[];
  plans: Map<string, Plan>;
  onOpen: (id: string) => void;
}) {
  if (rows.length < 2)
    return (
      <section className="cg-card cg-card-pad">
        <h2 className="cg-section-title">
          <MessagesSquare size={18} /> Conversation
        </h2>
        <p className="cg-muted" style={{ margin: 0 }}>
          No other emails about this shipment yet. Emails with the same order
          number (for example{" "}
          {emailInsight(result.email).refs.shipment[0] ?? "5RFR-36541"}), the
          same subject or the same reply chain are grouped here automatically.
        </p>
      </section>
    );
  const refs = new Map<string, Set<string>>();
  const dates: { kind: string; date: string; text: string; from: string }[] =
    [];
  for (const row of rows) {
    const insight = row.email.insight;
    if (!insight) continue;
    for (const [kind, values] of Object.entries(insight.refs))
      for (const value of values)
        refs.set(kind, (refs.get(kind) ?? new Set()).add(value));
    for (const date of insight.dates)
      if (date.kind !== "Mentioned")
        dates.push({ ...date, from: insight.sender_name || row.email.from });
  }
  const open = rows.filter((row) => {
    const plan = plans.get(row.email.email_id);
    return plan?.bucket === "todo";
  });
  const latest = rows[rows.length - 1];
  const labels: Record<string, string> = {
    shipment: "Order numbers",
    po: "PO numbers",
    booking: "Booking / BL numbers",
    invoice: "Invoice numbers",
    container: "Containers",
  };
  return (
    <section className="cg-card cg-card-pad">
      <h2 className="cg-section-title">
        <MessagesSquare size={18} /> Conversation · {rows.length} emails
      </h2>
      <p style={{ marginTop: 0 }}>
        {open.length
          ? `${open.length} of ${rows.length} emails still need action. `
          : "No email in this conversation needs action. "}
        Latest: <strong>{rowStatus(latest).text}</strong>
        {latest.email.received_at
          ? ` (${new Date(latest.email.received_at).toLocaleDateString()})`
          : ""}
        .
      </p>
      <div className="cg-facts" style={{ marginBottom: 16 }}>
        {[...refs.entries()].map(([kind, values]) => (
          <div className="cg-fact" key={kind}>
            <span>{labels[kind] ?? kind}</span>
            <strong>{[...values].slice(0, 6).join(", ")}</strong>
          </div>
        ))}
        {dates.slice(0, 4).map((date, index) => (
          <div className="cg-fact" key={`${date.date}-${index}`}>
            <span>
              {date.kind} · mentioned by {date.from}
            </span>
            <strong>
              {new Date(`${date.date}T12:00:00`).toLocaleDateString([], {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </strong>
          </div>
        ))}
      </div>
      <div className="cg-thread" role="list">
        {rows.map((row) => {
          const current = row.email.email_id === result.email.email_id;
          const plan = plans.get(row.email.email_id);
          const status = rowStatus(row);
          const when = formatReceived(row.email.received_at);
          return (
            <button
              key={row.email.email_id}
              role="listitem"
              className="cg-thread-item"
              aria-current={current}
              disabled={current}
              onClick={() => !current && onOpen(row.email.email_id)}
            >
              <span
                className={`cg-dot ${plan?.bucket === "todo" ? plan.level : "low"}`}
              />
              <span>
                <strong>{row.email.subject}</strong>
                <small>
                  {row.email.insight?.sender_name || row.email.from}
                  {when ? ` · ${when.day} ${when.time}` : ""}
                  {current ? " · you are here" : ""}
                </small>
                {row.email.insight?.snippet && (
                  <small>{row.email.insight.snippet}</small>
                )}
              </span>
              <span className={`cg-pill ${status.tone}`}>{status.text}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DocumentsPanel(
  props: CaseViewProps & {
    highlighted: React.RefObject<HTMLDivElement | null>;
  },
) {
  const { result } = props;
  const docs = result.documents;
  const current =
    props.document && docs.some((doc) => doc.name === props.document!.name)
      ? props.document
      : docs[0];
  return (
    <div className="cg-panel">
      <DocumentPairSelector
        key={`pair-${result.email.email_id}-${result.version}`}
        result={result}
        onSaved={(data) =>
          props.onUpdated(
            data,
            "Document choice saved. Only the chosen SI and BL are compared.",
          )
        }
      />
      {!docs.length ? (
        <div className="cg-empty">
          <Paperclip size={28} />
          <h3>No documents attached</h3>
          <p>Ask the sender for the Shipping Instruction and the draft BL.</p>
          <button
            className="cg-btn primary"
            onClick={() => props.onTab("reply")}
          >
            Ask for documents
          </button>
        </div>
      ) : (
        <>
          <div className="cg-chips" role="group" aria-label="Documents">
            {docs.map((doc) => (
              <button
                key={doc.name}
                className="cg-chip"
                aria-pressed={current?.name === doc.name}
                onClick={() => props.onDocument(doc)}
              >
                <FileText size={16} />
                {doc.type === "SI"
                  ? "SI · "
                  : doc.type === "BL"
                    ? "Draft BL · "
                    : ""}
                {doc.name.replace(/^[0-9a-f]{8}_\d+_/, "")}
                {doc.error && <AlertTriangle size={15} color="var(--cg-red)" />}
              </button>
            ))}
          </div>
          {current && (
            <section className="cg-card cg-card-pad">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <h2 className="cg-section-title" style={{ margin: 0 }}>
                  {current.type === "SI"
                    ? "Shipping Instruction"
                    : current.type === "BL"
                      ? "Draft Bill of Lading"
                      : "Other document"}{" "}
                  <span className="cg-muted cg-small">
                    · {current.format.toUpperCase()} · read by {current.method}
                  </span>
                </h2>
                <a
                  className="cg-btn small"
                  target="_blank"
                  rel="noreferrer"
                  href={`/api/document?id=${encodeURIComponent(result.email.email_id)}&name=${encodeURIComponent(current.name)}&revision=${result.version}`}
                >
                  Open original <ExternalLink size={15} />
                </a>
              </div>
              {canTranscribe(current) && (
                <ScanAssist
                  key={`${result.email.email_id}-${current.name}-${result.version}`}
                  doc={current}
                  result={result}
                  onSaved={(data) =>
                    props.onUpdated(
                      data,
                      "Scan text confirmed and saved. The check was run again.",
                    )
                  }
                />
              )}
              {current.error ? (
                <div className="cg-notice warn">
                  <AlertTriangle size={18} />
                  <p>{current.error}</p>
                  <button
                    className="cg-btn small"
                    disabled={props.busy || props.running}
                    onClick={props.onReprocess}
                  >
                    Try reading again
                  </button>
                </div>
              ) : (
                <div className="source-paper">
                  {current.lines
                    .filter((line) => line.text.trim())
                    .map((line, index) => {
                      const hit =
                        !!props.sourceLocation &&
                        props.sourceLocation.includes(line.location);
                      return (
                        <div
                          key={index}
                          className={`source-line ${hit ? "highlighted-source" : ""}`}
                          ref={hit ? props.highlighted : undefined}
                        >
                          <span>{line.location}</span>
                          <p>{line.text}</p>
                        </div>
                      );
                    })}
                </div>
              )}
              {!current.error &&
                !!current.sha256 &&
                current.lines.length > 0 &&
                current.type !== "OTHER" &&
                !current.transcription && (
                  <details className="cg-details">
                    <summary>
                      Fields not found? Get help reading this layout
                    </summary>
                    <div>
                      <EvidenceRecovery
                        key={`recovery-${result.email.email_id}-${current.name}-${result.version}`}
                        doc={current}
                        result={result}
                        onEvidence={(location) =>
                          props.onSource(current.name, location)
                        }
                        onSaved={(data) =>
                          props.onUpdated(
                            data,
                            "Recovered values confirmed. The check was run again.",
                          )
                        }
                      />
                    </div>
                  </details>
                )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
