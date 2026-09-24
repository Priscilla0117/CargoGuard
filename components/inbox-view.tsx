"use client";
import { Fragment, useMemo, useState } from "react";
import {
  Archive,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  Clock,
  FileText,
  Inbox,
  ListChecks,
  Mails,
  Receipt,
  TriangleAlert,
  BellRing,
  ScanSearch,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Loader2,
  MessagesSquare,
  Paperclip,
  Search,
  Target,
  X,
} from "lucide-react";
import type { ThreadInfo } from "@/lib/mail-intel";
import {
  BUCKET_HINTS,
  BUCKET_LABELS,
  DATE_RANGE_LABELS,
  LEVEL_LABELS,
  SORT_LABELS,
  TODO_REASON_LABELS,
  comparePlanned,
  dateWindow,
  inDateWindow,
  receivedTime,
  type Bucket,
  type DateRange,
  type Plan,
  type SortOrder,
  type TodoReason,
} from "@/lib/priority";
import { categoryWords, rowStatus } from "@/lib/case-status";
import { CATEGORIES, type CaseSummary } from "@/lib/types";

const WORK_CARDS: {
  key: TodoReason;
  icon: typeof Inbox;
  hint: string;
  always?: boolean;
}[] = [
  {
    key: "differences",
    icon: TriangleAlert,
    hint: "BL does not match the SI",
    always: true,
  },
  {
    key: "missing",
    icon: Paperclip,
    hint: "Ask for the SI or BL",
    always: true,
  },
  {
    key: "unclear",
    icon: CircleHelp,
    hint: "Confirm what was not clear",
    always: true,
  },
  { key: "si_request", icon: FileText, hint: "Customer is waiting for an SI" },
  { key: "invoice", icon: Receipt, hint: "Answer the billing question" },
  { key: "follow_up", icon: BellRing, hint: "A promised follow-up is due" },
  { key: "unprocessed", icon: ScanSearch, hint: "Press “Check new emails”" },
];

export interface InboxFilters {
  bucket: Bucket | "all";
  reason: TodoReason | "all";
  search: string;
  category: string;
  range: DateRange;
  from: string;
  to: string;
  sort: SortOrder;
  grouped: boolean;
}
export const DEFAULT_FILTERS: InboxFilters = {
  bucket: "todo",
  reason: "all",
  search: "",
  category: "all",
  range: "any",
  from: "",
  to: "",
  sort: "priority",
  grouped: true,
};
export type PlannedRow = { row: CaseSummary; plan: Plan };

export function formatReceived(value: string | undefined, now = Date.now()) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  const yesterday =
    new Date(now - 86400000).toDateString() === date.toDateString();
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (sameDay) return { day: "Today", time };
  if (yesterday) return { day: "Yesterday", time };
  return {
    day: date.toLocaleDateString([], {
      day: "numeric",
      month: "short",
      ...(date.getFullYear() !== today.getFullYear()
        ? { year: "numeric" }
        : {}),
    }),
    time,
  };
}
export function deadlineText(plan: Plan, now = Date.now()) {
  if (!plan.deadline || plan.bucket === "done") return null;
  const date = new Date(
    plan.deadline.length === 10 ? `${plan.deadline}T12:00:00` : plan.deadline,
  );
  if (!Number.isFinite(date.getTime())) return null;
  const days = Math.round(
    (new Date(date.toDateString()).getTime() -
      new Date(new Date(now).toDateString()).getTime()) /
      86400000,
  );
  const label = plan.deadline_label ?? "Due";
  const when =
    days < 0
      ? `${-days} day${days === -1 ? "" : "s"} ago`
      : days === 0
        ? "today"
        : days === 1
          ? "tomorrow"
          : days < 7
            ? `in ${days} days`
            : date.toLocaleDateString([], { day: "numeric", month: "short" });
  return { text: `${label} ${when}`, late: days < 0 };
}

function Row({
  item,
  thread,
  busy,
  now,
  onOpen,
}: {
  item: PlannedRow;
  thread?: ThreadInfo;
  busy: boolean;
  now: number;
  onOpen: () => void;
}) {
  const { row, plan } = item;
  const status = rowStatus(row);
  const received = formatReceived(row.email.received_at, now);
  const deadline = deadlineText(plan, now);
  const insight = row.email.insight;
  const ref = insight?.refs.shipment[0] ?? insight?.refs.po[0];
  return (
    <button
      type="button"
      className={`cg-row ${plan.level === "urgent" && plan.bucket === "todo" ? "is-urgent" : plan.level === "high" && plan.bucket === "todo" ? "is-high" : ""}`}
      onClick={onOpen}
      aria-label={`Open: ${row.email.subject}`}
    >
      <span
        className={`cg-dot ${plan.bucket === "todo" || plan.bucket === "other" ? plan.level : "low"}`}
        title={`${LEVEL_LABELS[plan.level]} priority`}
      />
      <span className="cg-row-main">
        <span className="cg-row-subject" title={row.email.subject}>
          {row.email.subject}
        </span>
        <span className="cg-row-meta">
          <span>{insight?.sender_name || row.email.from}</span>
          {ref && <span>· {ref}</span>}
          {row.email.attachments.length > 0 && (
            <span>
              · <Paperclip size={13} aria-hidden="true" />
              {row.email.attachments.length}
            </span>
          )}
          {thread && thread.ids.length > 1 && (
            <span className="cg-thread-badge">
              <MessagesSquare size={12} aria-hidden="true" />
              {thread.ids.length} in conversation
            </span>
          )}
        </span>
        {insight?.snippet && (
          <span className="cg-row-snippet">{insight.snippet}</span>
        )}
      </span>
      <span className="cg-row-status">
        <span className={`cg-pill ${status.tone}`}>{status.text}</span>
        {plan.bucket === "todo" && plan.reasons.length > 0 && (
          <small>{plan.reasons.slice(0, 2).join(" · ")}</small>
        )}
      </span>
      <span className="cg-row-date">
        {received ? (
          <>
            <strong>{received.day}</strong>
            <span>{received.time}</span>
          </>
        ) : (
          <span title="This sample email has no received date">No date</span>
        )}
        {deadline && (
          <span className={`cg-deadline ${deadline.late ? "late" : ""}`}>
            {deadline.text}
          </span>
        )}
      </span>
      {busy ? (
        <Loader2 size={20} className="cg-spin" aria-label="Opening" />
      ) : (
        <ChevronRight size={20} aria-hidden="true" />
      )}
    </button>
  );
}

export function InboxView({
  cases,
  plans,
  threads,
  filters,
  setFilters,
  loading,
  busyId,
  now,
  onOpen,
  onImport,
  onPlan,
  doneTools,
}: {
  cases: CaseSummary[];
  plans: Map<string, Plan>;
  threads: Map<string, ThreadInfo>;
  filters: InboxFilters;
  setFilters: (update: Partial<InboxFilters>) => void;
  loading: boolean;
  busyId: string;
  now: number;
  onOpen: (id: string, list: string[]) => void;
  onImport: () => void;
  onPlan?: () => void;
  doneTools?: React.ReactNode;
}) {
  const [limit, setLimit] = useState(40);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const planned: PlannedRow[] = useMemo(
    () =>
      cases.map((row) => ({
        row,
        plan: plans.get(row.email.email_id)!,
      })),
    [cases, plans],
  );
  const bounds = dateWindow(filters.range, now, filters.from, filters.to);
  const needle = filters.search.trim().toLowerCase();
  const base = useMemo(
    () =>
      planned.filter(
        ({ row }) =>
          (filters.category === "all" ||
            row.result?.category === filters.category) &&
          inDateWindow(row, bounds) &&
          (!needle ||
            [
              row.email.email_id,
              row.email.subject,
              row.email.from,
              row.email.insight?.sender_name,
              row.email.insight?.snippet,
              ...(row.email.insight
                ? Object.values(row.email.insight.refs).flat()
                : []),
              ...(row.result?.defect_fields ?? []),
            ]
              .join(" ")
              .toLowerCase()
              .includes(needle)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planned, filters.category, bounds?.start, bounds?.end, needle],
  );
  const bucketCounts = useMemo(() => {
    const counts: Record<Bucket | "all", number> = {
      todo: 0,
      waiting: 0,
      done: 0,
      other: 0,
      all: base.length,
    };
    for (const { plan } of base) counts[plan.bucket]++;
    return counts;
  }, [base]);
  const reasonCounts = useMemo(() => {
    const counts: Partial<Record<TodoReason, number>> = {};
    for (const { plan } of base)
      if (plan.bucket === "todo" && plan.reason)
        counts[plan.reason] = (counts[plan.reason] ?? 0) + 1;
    return counts;
  }, [base]);
  const visible = useMemo(
    () =>
      base
        .filter(
          ({ plan }) =>
            (filters.bucket === "all" || plan.bucket === filters.bucket) &&
            (filters.bucket !== "todo" ||
              filters.reason === "all" ||
              plan.reason === filters.reason),
        )
        .sort((a, b) => comparePlanned(a, b, filters.sort)),
    [base, filters.bucket, filters.reason, filters.sort],
  );
  // Conversation grouping: first (most important) email represents its thread.
  const groups = useMemo(() => {
    if (!filters.grouped)
      return visible.map((item) => ({ lead: item, rest: [] as PlannedRow[] }));
    const seen = new Map<string, { lead: PlannedRow; rest: PlannedRow[] }>();
    const result: { lead: PlannedRow; rest: PlannedRow[] }[] = [];
    for (const item of visible) {
      const thread = threads.get(item.row.email.email_id);
      if (!thread) {
        result.push({ lead: item, rest: [] });
        continue;
      }
      const group = seen.get(thread.key);
      if (group) group.rest.push(item);
      else {
        const created = { lead: item, rest: [] as PlannedRow[] };
        seen.set(thread.key, created);
        result.push(created);
      }
    }
    return result;
  }, [visible, threads, filters.grouped]);
  const order = visible.map((item) => item.row.email.email_id);
  const undated =
    bounds && planned.filter(({ row }) => receivedTime(row) === null).length;
  const todo = planned.filter(({ plan }) => plan.bucket === "todo");
  const focus = [...todo].sort((a, b) => comparePlanned(a, b, "priority"))[0];
  const urgentCount = todo.filter(({ plan }) => plan.level === "urgent").length;
  const dueSoon = todo.filter(({ plan }) => {
    const d = deadlineText(plan, now);
    return d && !d.late && /today|tomorrow|in \d days/.test(d.text);
  }).length;
  const late = todo.filter(({ plan }) => deadlineText(plan, now)?.late).length;
  const filtered =
    !!needle ||
    filters.category !== "all" ||
    filters.range !== "any" ||
    (filters.bucket === "todo" && filters.reason !== "all");

  return (
    <>
      {focus && !loading && (
        <section className="cg-focus-card" aria-label="Suggested next email">
          <span className="cg-focus-icon" aria-hidden="true">
            <Target size={26} />
          </span>
          <div style={{ minWidth: 0 }}>
            <span className="cg-focus-label">Start here — most urgent</span>
            <h2>{focus.row.email.subject}</h2>
            <p>
              {focus.plan.reasons.slice(0, 3).join(" · ") ||
                rowStatus(focus.row).text}
            </p>
            <div className="cg-plan-stats">
              {urgentCount > 0 && (
                <span className="cg-pill urgent">{urgentCount} urgent</span>
              )}
              {dueSoon > 0 && (
                <span className="cg-pill high">
                  <CalendarClock size={15} /> {dueSoon} due within 3 days
                </span>
              )}
              {late > 0 && (
                <span className="cg-pill red">{late} past a deadline</span>
              )}
            </div>
          </div>
          <div className="cg-focus-actions">
            <button
              className="cg-btn primary large"
              onClick={() =>
                onOpen(
                  focus.row.email.email_id,
                  [...todo]
                    .sort((a, b) => comparePlanned(a, b, "priority"))
                    .map((item) => item.row.email.email_id),
                )
              }
            >
              Open this email <ArrowRight size={20} />
            </button>
            {onPlan && (
              <button className="cg-btn" onClick={onPlan}>
                <ListChecks size={19} /> See today&apos;s plan
              </button>
            )}
          </div>
        </section>
      )}
      <section className="cg-board" aria-label="Your work">
        <div className="cg-board-head">
          <h2>Your work</h2>
          <span>Pick a card to see only those emails</span>
        </div>
        <div className="cg-cards" role="group" aria-label="Kinds of work">
          <button
            className="cg-card-btn total"
            aria-pressed={filters.bucket === "todo" && filters.reason === "all"}
            onClick={() => {
              setFilters({ bucket: "todo", reason: "all" });
              setLimit(40);
            }}
          >
            <span className="cg-card-top">
              <span className="cg-card-icon">
                <Inbox size={20} />
              </span>
              All to do
            </span>
            <strong>
              {loading ? "–" : bucketCounts.todo.toLocaleString()}
            </strong>
            <small>Everything that needs you</small>
          </button>
          {WORK_CARDS.filter(
            (card) => card.always || (reasonCounts[card.key] ?? 0) > 0,
          ).map((card) => {
            const Icon = card.icon;
            const count = reasonCounts[card.key] ?? 0;
            return (
              <button
                key={card.key}
                className={`cg-card-btn ${card.key}`}
                aria-pressed={
                  filters.bucket === "todo" && filters.reason === card.key
                }
                onClick={() => {
                  setFilters({
                    bucket: "todo",
                    reason:
                      filters.bucket === "todo" && filters.reason === card.key
                        ? "all"
                        : card.key,
                  });
                  setLimit(40);
                }}
              >
                <span className="cg-card-top">
                  <span className="cg-card-icon">
                    <Icon size={20} />
                  </span>
                  {TODO_REASON_LABELS[card.key]}
                </span>
                <strong>{loading ? "–" : count.toLocaleString()}</strong>
                <small>{count ? card.hint : "All clear"}</small>
              </button>
            );
          })}
        </div>
        <div className="cg-status-strip" role="group" aria-label="Other lists">
          {(["waiting", "done", "other", "all"] as const).map((key) => (
            <button
              key={key}
              className="cg-strip-btn"
              aria-pressed={filters.bucket === key}
              title={key === "all" ? "Every email" : BUCKET_HINTS[key]}
              onClick={() => {
                setFilters({ bucket: key, reason: "all" });
                setLimit(40);
              }}
            >
              {key === "waiting" ? (
                <Clock size={17} />
              ) : key === "done" ? (
                <CheckCircle2 size={17} />
              ) : key === "other" ? (
                <Archive size={17} />
              ) : (
                <Mails size={17} />
              )}
              {key === "all" ? "All emails" : BUCKET_LABELS[key]}
              <b>{loading ? "–" : bucketCounts[key].toLocaleString()}</b>
            </button>
          ))}
        </div>
      </section>
      {filters.bucket === "done" && bucketCounts.done > 0 && doneTools && (
        <div style={{ paddingTop: 14 }}>{doneTools}</div>
      )}
      <div className="cg-toolbar">
        <label className="cg-search">
          <Search size={18} aria-hidden="true" />
          <input
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            placeholder="Search subject, sender, order no. (e.g. 5RFR-36541), PO…"
            aria-label="Search emails"
          />
          {filters.search && (
            <button
              className="cg-icon-btn"
              aria-label="Clear search"
              onClick={() => setFilters({ search: "" })}
            >
              <X size={16} />
            </button>
          )}
        </label>
        <label className="cg-filter">
          Received
          <select
            className="cg-select"
            value={filters.range}
            onChange={(e) => setFilters({ range: e.target.value as DateRange })}
          >
            {(Object.keys(DATE_RANGE_LABELS) as DateRange[]).map((key) => (
              <option key={key} value={key}>
                {DATE_RANGE_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        {filters.range === "custom" && (
          <>
            <label className="cg-filter">
              From
              <input
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => setFilters({ from: e.target.value })}
              />
            </label>
            <label className="cg-filter">
              To
              <input
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => setFilters({ to: e.target.value })}
              />
            </label>
          </>
        )}
        <label className="cg-filter">
          Type
          <select
            className="cg-select"
            value={filters.category}
            onChange={(e) => setFilters({ category: e.target.value })}
          >
            <option value="all">All types</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryWords(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="cg-filter">
          Sort
          <select
            className="cg-select"
            value={filters.sort}
            onChange={(e) => setFilters({ sort: e.target.value as SortOrder })}
          >
            {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABELS[key]}
              </option>
            ))}
          </select>
        </label>
        <label className="cg-check cg-small">
          <input
            type="checkbox"
            checked={filters.grouped}
            onChange={(e) => setFilters({ grouped: e.target.checked })}
          />
          Group conversations
        </label>
      </div>
      <div className="cg-list-caption">
        <span>
          {visible.length.toLocaleString()} email
          {visible.length === 1 ? "" : "s"}
          {filters.bucket !== "all" &&
            ` in “${BUCKET_LABELS[filters.bucket as Bucket]}”`}
          {filters.sort === "priority" ? " · most urgent first" : ""}
        </span>
        {!!undated && (
          <span>
            {undated} email{undated === 1 ? " has" : "s have"} no received date
            and {undated === 1 ? "is" : "are"} hidden by the date filter
          </span>
        )}
        {filtered && (
          <button
            className="cg-link"
            onClick={() =>
              setFilters({
                search: "",
                category: "all",
                range: "any",
                from: "",
                to: "",
                reason: "all",
              })
            }
          >
            Clear filters
          </button>
        )}
      </div>
      <div className="cg-list">
        {groups.slice(0, limit).map(({ lead, rest }) => {
          const thread = threads.get(lead.row.email.email_id);
          const open = expanded.has(lead.row.email.email_id);
          return (
            <Fragment key={lead.row.email.email_id}>
              <Row
                item={lead}
                thread={thread}
                busy={busyId === lead.row.email.email_id}
                now={now}
                onOpen={() => onOpen(lead.row.email.email_id, order)}
              />
              {rest.length > 0 && (
                <button
                  className="cg-link cg-thread-toggle cg-small"
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current);
                      if (open) next.delete(lead.row.email.email_id);
                      else next.add(lead.row.email.email_id);
                      return next;
                    })
                  }
                >
                  {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                  {open ? "Hide" : "Show"} {rest.length} more email
                  {rest.length === 1 ? "" : "s"} in this conversation
                </button>
              )}
              {open && rest.length > 0 && (
                <div className="cg-thread-children">
                  {rest.map((item) => (
                    <Row
                      key={item.row.email.email_id}
                      item={item}
                      thread={thread}
                      busy={busyId === item.row.email.email_id}
                      now={now}
                      onOpen={() => onOpen(item.row.email.email_id, order)}
                    />
                  ))}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {loading && !cases.length && (
        <div className="cg-empty">
          <Loader2 size={30} className="cg-spin" />
          <h3>Loading your inbox…</h3>
        </div>
      )}
      {!loading && !groups.length && (
        <div className="cg-empty">
          <h3>
            {!cases.length
              ? "Your inbox is empty"
              : filtered
                ? "No email matches these filters"
                : filters.bucket === "todo"
                  ? "Nothing to do — well done!"
                  : `No emails in “${filters.bucket === "all" ? "All" : BUCKET_LABELS[filters.bucket]}”`}
          </h3>
          <p>
            {!cases.length
              ? "Import an email with its SI and draft BL, or connect Gmail to bring emails in automatically."
              : filtered
                ? "Try another search or clear the filters."
                : "New emails will appear here when they arrive."}
          </p>
          {!cases.length && (
            <button className="cg-btn primary" onClick={onImport}>
              Import email
            </button>
          )}
        </div>
      )}
      {groups.length > limit && (
        <div className="cg-list-foot">
          <button className="cg-btn" onClick={() => setLimit(limit + 40)}>
            Show 40 more ({groups.length - limit} left)
          </button>
        </div>
      )}
    </>
  );
}
