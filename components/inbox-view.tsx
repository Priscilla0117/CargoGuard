"use client";
import { Fragment, useMemo, useState } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ListChecks,
  Loader2,
  MessagesSquare,
  Paperclip,
  Search,
  X,
} from "lucide-react";
import type { ThreadInfo } from "@/lib/mail-intel";
import {
  BUCKET_HINTS,
  BUCKET_LABELS,
  DATE_RANGE_LABELS,
  LEVEL_LABELS,
  SORT_LABELS,
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
import { categoryWords, displayStatus, rowStatus } from "@/lib/case-status";
import { CATEGORIES, type CaseSummary } from "@/lib/types";

/** The three kinds of work shown as colour tiles above the list. */
export type WorkGroup = "mismatch" | "review" | "reply";
export const WORK_GROUPS: Record<
  WorkGroup,
  { label: string; hint: string; reasons: TodoReason[] }
> = {
  mismatch: {
    label: "Mismatch",
    hint: "BL differs from the SI",
    reasons: ["differences"],
  },
  review: {
    label: "Needs review",
    hint: "Unclear or missing documents",
    reasons: ["unclear", "missing"],
  },
  reply: {
    label: "Reply needed",
    hint: "SI requests, invoices, follow-ups",
    reasons: ["si_request", "invoice", "follow_up"],
  },
};
export interface InboxFilters {
  bucket: Bucket | "all";
  reason: WorkGroup | "all";
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
  const base = rowStatus(row);
  const status = displayStatus(row, plan);
  const why =
    plan.bucket === "waiting"
      ? base.text
      : plan.bucket === "todo" && plan.reason === "differences"
        ? plan.reasons[0]
        : null;
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
        {why && <small>{why}</small>}
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
  checking = false,
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
  /** New emails are being read: the plan is not final yet. */
  checking?: boolean;
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
              (!!plan.reason &&
                WORK_GROUPS[filters.reason].reasons.includes(plan.reason))),
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
      {focus && !loading && !checking && (
        <section
          className={`cg-nextup ${focus.plan.level}`}
          aria-label="Suggested next email"
        >
          <div className="cg-nextup-main">
            <span className="cg-nextup-label">
              Next up
              {focus.plan.level === "urgent" && (
                <span className="cg-tag urgent">Urgent</span>
              )}
            </span>
            <strong
              className="cg-nextup-subject"
              title={focus.row.email.subject}
            >
              {focus.row.email.subject}
            </strong>
            <span className="cg-nextup-why">
              {focus.plan.reasons.slice(0, 3).join(" · ") ||
                rowStatus(focus.row).text}
            </span>
          </div>
          <div className="cg-nextup-actions">
            <button
              className="cg-btn primary"
              onClick={() =>
                onOpen(
                  focus.row.email.email_id,
                  [...todo]
                    .sort((a, b) => comparePlanned(a, b, "priority"))
                    .map((item) => item.row.email.email_id),
                )
              }
            >
              Open <ArrowRight size={18} />
            </button>
            {onPlan && (
              <button className="cg-btn" onClick={onPlan}>
                <ListChecks size={18} /> Today&apos;s plan
              </button>
            )}
          </div>
          {(urgentCount > 0 || dueSoon > 0 || late > 0) && (
            <div className="cg-nextup-stats">
              {urgentCount > 0 && (
                <span>
                  <b className="urgent">{urgentCount}</b> urgent
                </span>
              )}
              {dueSoon > 0 && (
                <span>
                  <b>{dueSoon}</b> due within 3 days
                </span>
              )}
              {late > 0 && (
                <span>
                  <b className="urgent">{late}</b> past a deadline
                </span>
              )}
            </div>
          )}
        </section>
      )}
      <section className="cg-queue" aria-label="Email lists">
        <div className="cg-qtabs" role="tablist" aria-label="Lists">
          {(["todo", "waiting", "done", "other", "all"] as const).map((key) => (
            <button
              key={key}
              role="tab"
              className="cg-qtab"
              aria-selected={filters.bucket === key}
              title={key === "all" ? "Every email" : BUCKET_HINTS[key]}
              onClick={() => {
                setFilters({ bucket: key, reason: "all" });
                setLimit(40);
              }}
            >
              {key === "all" ? "All emails" : BUCKET_LABELS[key]}
              <span className="cg-qcount">
                {loading ? "–" : bucketCounts[key].toLocaleString()}
              </span>
            </button>
          ))}
        </div>
        {filters.bucket === "todo" && (
          <div className="cg-kinds" role="group" aria-label="Show only">
            <button
              type="button"
              className="cg-kind all"
              aria-pressed={filters.reason === "all"}
              onClick={() => {
                setFilters({ reason: "all" });
                setLimit(40);
              }}
            >
              <span>
                <b>Everything to do</b>
                <small>Most urgent first</small>
              </span>
              <strong>
                {loading ? "–" : bucketCounts.todo.toLocaleString()}
              </strong>
            </button>
            {(Object.keys(WORK_GROUPS) as WorkGroup[]).map((key) => {
              const group = WORK_GROUPS[key];
              const count = group.reasons.reduce(
                (sum, reason) => sum + (reasonCounts[reason] ?? 0),
                0,
              );
              const active = filters.reason === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={`cg-kind ${key}`}
                  aria-pressed={active}
                  onClick={() => {
                    setFilters({ reason: active ? "all" : key });
                    setLimit(40);
                  }}
                >
                  <span>
                    <b>{group.label}</b>
                    <small>{count ? group.hint : "All clear"}</small>
                  </span>
                  <strong>{loading ? "–" : count.toLocaleString()}</strong>
                </button>
              );
            })}
          </div>
        )}
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
            placeholder="Search order no. (5RFR-36541), PO, sender…"
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
        <label className="cg-filter cg-f-range">
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
                type="datetime-local"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(e) => setFilters({ from: e.target.value })}
              />
            </label>
            <label className="cg-filter">
              To
              <input
                type="datetime-local"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(e) => setFilters({ to: e.target.value })}
              />
            </label>
          </>
        )}
        <label className="cg-filter cg-f-type">
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
        <label className="cg-filter cg-f-sort">
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
        <label className="cg-check cg-small cg-caption-check">
          <input
            type="checkbox"
            checked={filters.grouped}
            onChange={(e) => setFilters({ grouped: e.target.checked })}
          />
          Group conversations
        </label>
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
