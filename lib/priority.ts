import { effectiveFollowUp, followUpOverdue, type FollowUp } from "./follow-up";
import { laneFor, type Lane } from "./operations";
import { FIELD_RISK, byImpact, impactPhrase } from "./field-risk";
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
  | "follow_up"
  | "extra_check";

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
  extra_check: "Extra check",
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

export interface PlanFactor {
  label: string;
  points: number;
}
export interface Plan {
  bucket: Bucket;
  reason: TodoReason | null;
  level: Level;
  score: number;
  reasons: string[];
  /** Every scored factor, for "Why this priority?". */
  factors: PlanFactor[];
  /** Earliest relevant deadline (YYYY-MM-DD or ISO), for display and sorting. */
  deadline: string | null;
  deadline_label: string | null;
  /** Set when the email left "To do" or "Waiting" because of the conversation. */
  note: string | null;
}

/** What the rest of the conversation says about this email. */
export interface PlanContext {
  /** Emails in the same conversation, including this one. */
  conversation_size?: number;
  /** Someone wrote in this conversation after we started waiting. */
  replied_after_waiting?: boolean;
  /** A later draft in this conversation was checked and every detail matches. */
  superseded_by_match?: boolean;
  /** An SI request whose order already has a later draft BL. */
  si_answered?: boolean;
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

/** Words that show real pressure. "ASAP" alone is routine in shipping mail. */
const STRONG_TERMS = [
  "urgent",
  "immediately",
  "final reminder",
  "overdue",
  "risk of rollover",
  "demurrage / detention",
  "on hold",
];

/**
 * Priority = business impact of the problem + time pressure + how hard the
 * sender is chasing + how long it has waited. Every point is shown to the
 * employee as a reason; nothing is hidden in a model.
 */
export function planFor(
  row: CaseSummary,
  followup: FollowUp | undefined,
  now = Date.now(),
  context: PlanContext = {},
): Plan {
  const lane = laneFor(row);
  const state = followup ? effectiveFollowUp(followup, row) : null;
  const overdue = !!followup && followUpOverdue(followup, row, now);
  const category = row.result?.category;
  const factors: PlanFactor[] = [];
  const add = (points: number, label: string) =>
    factors.push({ points, label });
  let note: string | null = null;

  let bucket: Bucket;
  let reason: TodoReason | null = null;
  const replied = state === "waiting" && !!context.replied_after_waiting;
  if (overdue || state === "reopened" || state === "open" || replied) {
    bucket = "todo";
    reason = laneReason[lane] ?? "follow_up";
  } else if (state === "waiting") bucket = "waiting";
  else if (state === "completed") bucket = "done";
  else if (lane === "handoff" && row.result?.integrity_attention) {
    // All seven details match, but an independent safety finding is open.
    bucket = "todo";
    reason = "extra_check";
  } else if (lane === "handoff") bucket = "done";
  else if (
    context.superseded_by_match &&
    (lane === "amend" || lane === "request")
  ) {
    bucket = "done";
    note = "A newer draft in this conversation was checked and matches the SI.";
  } else if (
    context.si_answered &&
    lane === "routed" &&
    category === "SI_REQUEST"
  ) {
    bucket = "done";
    note =
      "A draft BL for this order has arrived — drafts are made from the SI, so this request was answered.";
  } else if (lane === "routed" && category === "SI_REQUEST") {
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

  // 1. Impact: what goes wrong if nobody acts.
  if (bucket === "todo") {
    if (reason === "differences") {
      const fields = row.result?.defect_fields ?? [];
      const ordered = byImpact(fields);
      const worst = ordered[0] ? FIELD_RISK[ordered[0]].weight : 25;
      add(20 + worst, impactPhrase(fields) || "Documents do not match");
      if (ordered.length > 1)
        add(4 * (ordered.length - 1), `${ordered.length} details to correct`);
    } else {
      const base: Record<TodoReason, [number, string]> = {
        differences: [45, "Documents do not match"],
        missing: [35, "Documents are missing — nothing can be checked"],
        si_request: [30, "Customer is waiting for an SI"],
        invoice: [22, "Invoice question to answer"],
        unclear: [30, "Some information is unclear"],
        unprocessed: [15, "Not checked yet"],
        follow_up: [30, "Follow-up is open"],
        extra_check: [28, "A container number or weight looks wrong"],
      };
      const [points, text] = base[reason!];
      add(points, text);
    }
    if (replied) add(20, "Sender replied — read the answer");
  }

  let deadline: string | null = null;
  let deadlineLabel: string | null = null;
  if (followup?.due_at && state !== "completed") {
    const days = daysUntil(followup.due_at, now);
    deadline = followup.due_at;
    deadlineLabel = state === "waiting" ? "Chase" : "Follow-up due";
    if (overdue) {
      add(
        40,
        state === "waiting"
          ? "No answer yet — time to chase"
          : "Follow-up is overdue",
      );
    } else if (days !== null && days <= 1 && bucket === "todo") {
      add(25, "Follow-up due within a day");
    }
  }
  // Unchecked email may be spam: its "urgent" wording is not trusted yet.
  const trusted = !!row.result && category !== "SPAM";
  const active = trusted && (bucket === "todo" || bucket === "other");
  if (active) {
    // 2. Time pressure: real dates written in the email.
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
      if (days < 0) add(35, `${next.kind} date has passed`);
      else if (days <= 1)
        add(35, `${next.kind} ${days === 0 ? "today" : "tomorrow"}`);
      else if (days <= 3) add(20, `${next.kind} in ${days} days`);
      else if (days <= 7) add(10, `${next.kind} this week`);
    }
    // 3. Pressure from the sender, strongest words only.
    const terms = row.email.insight?.urgent_terms ?? [];
    const pressing = terms.filter((term) => STRONG_TERMS.includes(term));
    if (pressing.length)
      add(
        Math.min(25, 12 + pressing.length * 5),
        `Sender says: ${pressing.slice(0, 2).join(", ")}`,
      );
    else if (terms.includes("reminder")) add(10, "Sender sent a reminder");
    else if (terms.includes("cut-off") || terms.includes("deadline"))
      add(8, "Mentions a cut-off or deadline");
    else if (terms.includes("ASAP")) add(4, "Asked for a quick answer");
    const size = context.conversation_size ?? 1;
    if (bucket === "todo" && size >= 3)
      add(Math.min(15, 3 * size), `${size} emails about this order`);
    // 4. Waiting time.
    if (received !== null && bucket === "todo") {
      const age = Math.floor((now - received) / DAY);
      if (age >= 5) add(15, `Waiting ${age} days`);
      else if (age >= 2) add(8, `Waiting ${age} days`);
    }
  }
  if (state === "reopened") add(15, "Reopened after a change");

  const score =
    factors.reduce((sum, factor) => sum + factor.points, 0) +
    (bucket === "other" ? (category === "SPAM" ? -50 : 5) : 0);
  const level: Level =
    bucket !== "todo" && bucket !== "other"
      ? "low"
      : !trusted && bucket === "other"
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
    reasons: factors.map((factor) => factor.label),
    factors,
    deadline,
    deadline_label: deadlineLabel,
    note,
  };
}

export type DateRange =
  | "any"
  | "24h"
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "custom";
export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  any: "Any date",
  "24h": "Last 24 hours",
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
    case "24h":
      return { start: now - DAY, end: now + 60000 };
    case "today":
      return { start, end: start + DAY };
    case "yesterday":
      return { start: start - DAY, end: start };
    case "7d":
      return { start: start - 6 * DAY, end: start + DAY };
    case "30d":
      return { start: start - 29 * DAY, end: start + DAY };
    case "custom": {
      // "2026-09-25" (whole day) or "2026-09-25T14:30" (exact time).
      const parse = (value: string) => {
        const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
        if (!m) return { at: NaN, timed: false };
        return {
          at: new Date(
            +m[1],
            +m[2] - 1,
            +m[3],
            m[4] ? +m[4] : 0,
            m[5] ? +m[5] : 0,
          ).getTime(),
          timed: !!m[4],
        };
      };
      const a = parse(from),
        b = parse(to);
      if (!Number.isFinite(a.at) && !Number.isFinite(b.at)) return null;
      return {
        start: Number.isFinite(a.at) ? a.at : -Infinity,
        end: Number.isFinite(b.at)
          ? b.timed
            ? b.at + 60000
            : b.at + DAY
          : Infinity,
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
    "Order: impact of the problem, deadlines in the email, how hard the sender is chasing, follow-ups and age.",
    "",
    ...open.map(line),
    ...(waiting.length
      ? ["", "WAITING FOR A REPLY", ...waiting.map(line)]
      : []),
  ].join("\n");
}
