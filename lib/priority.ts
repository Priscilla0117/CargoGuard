import { effectiveFollowUp, followUpOverdue, type FollowUp } from "./follow-up";
import { laneFor, type Lane } from "./operations";
import type { CaseSummary } from "./types";

/**
 * Plain-language work planning. Scores are transparent sums of the reasons
 * shown to the employee; they are workload ordering, not a commercial
 * risk prediction or a cargo-release decision.
 */
export type Bucket = "todo" | "waiting" | "done" | "other";
export type Level = "urgent" | "high" | "normal" | "low";
export type TodoReason =
  | "differences"
  | "unclear"
  | "missing"
  | "si_request"
  | "invoice"
  | "unprocessed"
  | "follow_up";

export const BUCKET_LABELS: Record<Bucket, string> = {
  todo: "To do",
  waiting: "Waiting for reply",
  done: "Done",
  other: "FYI & spam",
};
export const BUCKET_HINTS: Record<Bucket, string> = {
  todo: "Emails that need something from you",
  waiting: "You asked someone; nothing to do until they answer",
  done: "Documents match — no action needed",
  other: "General updates and spam — no reply needed",
};
export const TODO_REASON_LABELS: Record<TodoReason, string> = {
  differences: "Fix differences",
  unclear: "Check unclear info",
  missing: "Missing documents",
  si_request: "Send SI",
  invoice: "Invoice question",
  unprocessed: "Not checked yet",
  follow_up: "Follow-up due",
};
export const LEVEL_LABELS: Record<Level, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

const laneReason: Partial<Record<Lane, TodoReason>> = {
  amend: "differences",
  recover: "unclear",
  request: "missing",
  refresh: "unprocessed",
};

export interface Plan {
  bucket: Bucket;
  reason: TodoReason | null;
  level: Level;
  score: number;
  reasons: string[];
  /** Earliest relevant deadline (YYYY-MM-DD or ISO), for display and sorting. */
  deadline: string | null;
  deadline_label: string | null;
}

const DAY = 86400000;
function daysUntil(date: string, now: number) {
  const target =
    date.length === 10 ? Date.parse(`${date}T23:59:59Z`) : Date.parse(date);
  return Number.isFinite(target) ? Math.floor((target - now) / DAY) : null;
}
export function receivedTime(row: CaseSummary) {
  const value = row.email.received_at ? Date.parse(row.email.received_at) : NaN;
  return Number.isFinite(value) ? value : null;
}

export function planFor(
  row: CaseSummary,
  followup: FollowUp | undefined,
  now = Date.now(),
): Plan {
  const lane = laneFor(row);
  const state = followup ? effectiveFollowUp(followup, row) : null;
  const overdue = !!followup && followUpOverdue(followup, row, now);
  const category = row.result?.category;
  const reasons: string[] = [];
  let score = 0;

  let bucket: Bucket;
  let reason: TodoReason | null = null;
  if (overdue || state === "reopened" || state === "open") {
    bucket = "todo";
    reason = laneReason[lane] ?? "follow_up";
  } else if (state === "waiting") bucket = "waiting";
  else if (lane === "handoff" || state === "completed") bucket = "done";
  else if (lane === "routed" && category === "SI_REQUEST") {
    bucket = "todo";
    reason = "si_request";
  } else if (lane === "routed" && category === "INVOICE_QUERY") {
    bucket = "todo";
    reason = "invoice";
  } else if (lane === "routed") bucket = "other";
  else {
    bucket = "todo";
    reason = laneReason[lane] ?? "unclear";
  }

  if (bucket === "todo") {
    const base: Record<TodoReason, [number, string]> = {
      differences: [40, "Documents do not match"],
      missing: [35, "Documents are missing"],
      si_request: [30, "Customer asks for an SI"],
      invoice: [22, "Invoice question to answer"],
      unclear: [30, "Some information is unclear"],
      unprocessed: [20, "Not checked yet"],
      follow_up: [30, "Follow-up is open"],
    };
    const [points, text] = base[reason!];
    score += points;
    reasons.push(text);
  } else if (bucket === "other") score += category === "SPAM" ? -50 : 5;

  let deadline: string | null = null;
  let deadlineLabel: string | null = null;
  if (followup?.due_at && state !== "completed") {
    const days = daysUntil(followup.due_at, now);
    deadline = followup.due_at;
    deadlineLabel = "Follow-up due";
    if (overdue) {
      score += 40;
      reasons.push("Follow-up is overdue");
    } else if (days !== null && days <= 1) {
      score += 25;
      reasons.push("Follow-up due within a day");
    }
  }
  const active =
    bucket === "todo" || (bucket === "other" && category !== "SPAM");
  if (active) {
    const received = receivedTime(row);
    // Deadlines far in the past are history, not a reason to rush now.
    const upcoming = (row.email.insight?.dates ?? [])
      .filter((d) => d.kind !== "Mentioned" && d.kind !== "ETA")
      .map((d) => ({ ...d, days: daysUntil(d.date, now) }))
      .filter((d) => d.days !== null && d.days >= -3 && d.days <= 30)
      .sort((a, b) => a.date.localeCompare(b.date));
    const next = upcoming[0];
    if (next) {
      if (!deadline || next.date < deadline.slice(0, 10)) {
        deadline = next.date;
        deadlineLabel = next.kind;
      }
      const days = next.days!;
      if (days < 0) {
        score += 35;
        reasons.push(`${next.kind} date has passed`);
      } else if (days <= 1) {
        score += 35;
        reasons.push(`${next.kind} ${days === 0 ? "today" : "tomorrow"}`);
      } else if (days <= 3) {
        score += 20;
        reasons.push(`${next.kind} in ${days} days`);
      } else if (days <= 7) {
        score += 10;
        reasons.push(`${next.kind} this week`);
      }
    }
    const terms = row.email.insight?.urgent_terms ?? [];
    const pressing = terms.filter((term) =>
      [
        "urgent",
        "ASAP",
        "immediately",
        "final reminder",
        "overdue",
        "today",
        "risk of rollover",
        "demurrage / detention",
        "on hold",
      ].includes(term),
    );
    if (pressing.length) {
      score += Math.min(25, 12 + pressing.length * 5);
      reasons.push(`Sender says: ${pressing.slice(0, 2).join(", ")}`);
    } else if (terms.includes("cut-off") || terms.includes("deadline")) {
      score += 8;
      reasons.push("Mentions a cut-off or deadline");
    }
    if (received !== null && bucket === "todo") {
      const age = Math.floor((now - received) / DAY);
      if (age >= 5) {
        score += 15;
        reasons.push(`Waiting ${age} days`);
      } else if (age >= 2) {
        score += 8;
        reasons.push(`Waiting ${age} days`);
      }
    }
  }
  if (state === "reopened") {
    score += 15;
    reasons.push("Reopened after a change");
  }

  const level: Level =
    bucket !== "todo" && bucket !== "other"
      ? "low"
      : score >= 75
        ? "urgent"
        : score >= 50
          ? "high"
          : score >= 20
            ? "normal"
            : "low";
  return {
    bucket,
    reason,
    level,
    score,
    reasons,
    deadline,
    deadline_label: deadlineLabel,
  };
}

export type DateRange = "any" | "today" | "yesterday" | "7d" | "30d" | "custom";
export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  any: "Any date",
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  custom: "Choose dates…",
};

/** Local-time calendar window for a date filter; null means no filtering. */
export function dateWindow(
  range: DateRange,
  now = Date.now(),
  from = "",
  to = "",
): { start: number; end: number } | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  switch (range) {
    case "today":
      return { start, end: start + DAY };
    case "yesterday":
      return { start: start - DAY, end: start };
    case "7d":
      return { start: start - 6 * DAY, end: start + DAY };
    case "30d":
      return { start: start - 29 * DAY, end: start + DAY };
    case "custom": {
      const parse = (value: string) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : NaN;
      };
      const a = parse(from),
        b = parse(to);
      if (!Number.isFinite(a) && !Number.isFinite(b)) return null;
      return {
        start: Number.isFinite(a) ? a : -Infinity,
        end: Number.isFinite(b) ? b + DAY : Infinity,
      };
    }
    default:
      return null;
  }
}
export function inDateWindow(
  row: CaseSummary,
  window: { start: number; end: number } | null,
) {
  if (!window) return true;
  const received = receivedTime(row);
  return received !== null && received >= window.start && received < window.end;
}

export type SortOrder = "priority" | "newest" | "oldest";
export const SORT_LABELS: Record<SortOrder, string> = {
  priority: "Most urgent first",
  newest: "Newest first",
  oldest: "Oldest first",
};
export function comparePlanned(
  a: { row: CaseSummary; plan: Plan },
  b: { row: CaseSummary; plan: Plan },
  order: SortOrder,
) {
  const ra = receivedTime(a.row),
    rb = receivedTime(b.row);
  const byDate =
    ra === null && rb === null
      ? 0
      : ra === null
        ? 1
        : rb === null
          ? -1
          : order === "oldest"
            ? ra - rb
            : rb - ra;
  if (order !== "priority")
    return byDate || a.row.email.email_id.localeCompare(b.row.email.email_id);
  return (
    b.plan.score - a.plan.score ||
    (a.plan.deadline ?? "9999").localeCompare(b.plan.deadline ?? "9999") ||
    // Older waiting emails first when equally urgent.
    (ra === null && rb === null
      ? 0
      : ra === null
        ? 1
        : rb === null
          ? -1
          : ra - rb) ||
    a.row.email.email_id.localeCompare(b.row.email.email_id)
  );
}

/** Printable work plan: open emails, most urgent first, with the reasons. */
export function planText(
  rows: { row: CaseSummary; plan: Plan }[],
  createdAt: Date,
) {
  const open = rows
    .filter(({ plan }) => plan.bucket === "todo")
    .sort((a, b) => comparePlanned(a, b, "priority"));
  const waiting = rows.filter(({ plan }) => plan.bucket === "waiting");
  const line = (
    { row, plan }: { row: CaseSummary; plan: Plan },
    index: number,
  ) =>
    [
      `${index + 1}. [${LEVEL_LABELS[plan.level].toUpperCase()}] ${row.email.subject.replace(/[\r\n]+/g, " ")}`,
      `   From: ${row.email.from}${row.email.received_at ? ` · received ${new Date(row.email.received_at).toLocaleString()}` : ""}`,
      `   Why: ${plan.reasons.join("; ") || "Open item"}`,
      ...(plan.deadline
        ? [`   ${plan.deadline_label ?? "Due"}: ${plan.deadline.slice(0, 10)}`]
        : []),
    ].join("\n");
  return [
    "CARGOGUARD - TODAY'S PLAN",
    `Created ${createdAt.toLocaleString()}`,
    `${open.length} emails to do · ${waiting.length} waiting for a reply`,
    "Order: urgency words, deadlines in the email, problem type, follow-ups and age.",
    "",
    ...open.map(line),
    ...(waiting.length
      ? ["", "WAITING FOR A REPLY", ...waiting.map(line)]
      : []),
  ].join("\n");
}
