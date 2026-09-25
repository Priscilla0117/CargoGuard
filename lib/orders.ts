import { planAll, threadsFor } from "./conversation";
import { receivedTime, type Level, type Plan } from "./priority";
import type { FollowUp } from "./follow-up";
import type { CaseSummary } from "./types";

export type StepState = "done" | "active" | "problem" | "waiting" | "none";
export interface OrderStep {
  key: "si" | "draft" | "correction" | "final";
  label: string;
  state: StepState;
  note: string;
}
export interface Order {
  ref: string;
  destination: string;
  carrier: string;
  emails: CaseSummary[];
  /** Plan per email id, for plan-aware status labels. */
  plans: Record<string, Plan>;
  steps: OrderStep[];
  /** One plain sentence: where this order stands. */
  summary: string;
  status: "todo" | "waiting" | "done";
  level: Level;
  todo: number;
  next_id: string;
  deadline: { date: string; label: string } | null;
  last_at: number | null;
  invoice_open: boolean;
}

const SHIPMENT = /\b\d[A-Z]{3}-\d{5}\b/;
const title = (value: string) =>
  value
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

/** "AFEMY - MOMBASA_KENYA - CMA(SIJ…)" → destination "Mombasa, Kenya", carrier "CMA". */
export function subjectFacts(subjects: string[]) {
  let destination = "";
  let carrier = "";
  for (const subject of subjects) {
    const clean = subject.replace(/^(?:\s*(?:re|fw|fwd)\s*[:_]\s*)+/i, "");
    if (!destination) {
      const m = clean.match(
        /\b([A-Z][A-Z .]{2,}?)_((?:SOUTH |NORTH |UNITED |NEW |SRI |SAUDI )?[A-Z]{3,}(?: [A-Z]{2,})?)\b/,
      );
      if (m && !/CONFIRM|REQUEST|DRAFT|NEEDED/.test(m[1]))
        destination = `${title(m[1])}, ${title(m[2])}`;
    }
    if (!carrier) {
      const m = clean.match(/\b([A-Z]{2,6})\([A-Z0-9]{6,}\)/);
      if (m) carrier = m[1];
    }
  }
  return { destination, carrier };
}

const LEVEL_RANK: Record<Level, number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
};

/**
 * Builds one row per order number (e.g. 5RFR-36541) from the inbox, with no
 * setup: every email about the order, where the documents stand and what to
 * do next. Emails without an order number are left in the inbox.
 */
export function buildOrders(
  cases: CaseSummary[],
  followups: Record<string, FollowUp | undefined>,
  now = Date.now(),
): Order[] {
  const threads = threadsFor(cases);
  const plans = planAll(cases, followups, now, threads);
  const groups = new Map<string, CaseSummary[]>();
  const refOf = (row: CaseSummary) =>
    row.email.subject.match(SHIPMENT)?.[0] ??
    (row.email.insight?.refs.shipment.length === 1
      ? row.email.insight.refs.shipment[0]
      : null);
  const byThread = new Map<string, string>();
  for (const row of cases) {
    if (row.result?.category === "SPAM") continue;
    const ref = refOf(row);
    const thread = threads.get(row.email.email_id);
    if (ref && thread) byThread.set(thread.key, ref);
  }
  for (const row of cases) {
    if (row.result?.category === "SPAM") continue;
    const thread = threads.get(row.email.email_id);
    const ref = refOf(row) ?? (thread ? byThread.get(thread.key) : undefined);
    if (!ref) continue;
    groups.set(ref, [...(groups.get(ref) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([ref, rows]) => orderFrom(ref, rows, plans))
    .sort(
      (a, b) =>
        (a.status === "todo" ? 0 : a.status === "waiting" ? 1 : 2) -
          (b.status === "todo" ? 0 : b.status === "waiting" ? 1 : 2) ||
        LEVEL_RANK[b.level] - LEVEL_RANK[a.level] ||
        (a.deadline?.date ?? "9999").localeCompare(
          b.deadline?.date ?? "9999",
        ) ||
        (b.last_at ?? 0) - (a.last_at ?? 0) ||
        a.ref.localeCompare(b.ref),
    );
}

function orderFrom(
  ref: string,
  rows: CaseSummary[],
  plans: Map<string, Plan>,
): Order {
  const time = (row: CaseSummary) => receivedTime(row) ?? 0;
  const sorted = [...rows].sort(
    (a, b) =>
      time(a) - time(b) || a.email.email_id.localeCompare(b.email.email_id),
  );
  const plan = (row: CaseSummary) => plans.get(row.email.email_id)!;
  const drafts = sorted.filter(
    (row) =>
      row.result?.category === "BL_COMPARISON" &&
      (row.result.workflow === "verified" ||
        row.result.workflow === "discrepancy"),
  );
  const latest = drafts[drafts.length - 1];
  const missing = sorted.some(
    (row) =>
      row.result?.workflow === "awaiting_documents" &&
      plan(row).bucket !== "done",
  );
  const siRequests = sorted.filter(
    (row) => row.result?.category === "SI_REQUEST",
  );
  const siOpen = siRequests.some((row) => plan(row).bucket === "todo");
  const hadMismatch = drafts.some(
    (row) => row.result!.workflow === "discrepancy",
  );
  const waiting = sorted.some((row) => plan(row).bucket === "waiting");
  const invoiceOpen = sorted.some(
    (row) =>
      row.result?.category === "INVOICE_QUERY" && plan(row).bucket === "todo",
  );

  const si: OrderStep = {
    key: "si",
    label: "Shipping Instruction",
    state:
      drafts.length || (siRequests.length && !siOpen)
        ? "done"
        : siOpen
          ? "problem"
          : "none",
    note: drafts.length
      ? "Sent"
      : siOpen
        ? "Customer is waiting for it"
        : siRequests.length
          ? "Sent"
          : "No request yet",
  };
  const draft: OrderStep = {
    key: "draft",
    label: "Draft BL check",
    state: latest
      ? latest.result!.workflow === "verified"
        ? "done"
        : "problem"
      : missing
        ? "problem"
        : "none",
    note: latest
      ? latest.result!.workflow === "verified"
        ? `Matches the SI${drafts.length > 1 ? ` (draft ${drafts.length})` : ""}`
        : `${latest.result!.defect_fields.length} difference${latest.result!.defect_fields.length === 1 ? "" : "s"}${drafts.length > 1 ? ` in draft ${drafts.length}` : ""}`
      : missing
        ? "Documents missing"
        : "Not received",
  };
  const correction: OrderStep = {
    key: "correction",
    label: "Corrections",
    state: !hadMismatch
      ? latest?.result!.workflow === "verified"
        ? "done"
        : "none"
      : latest?.result!.workflow === "verified"
        ? "done"
        : waiting
          ? "waiting"
          : "problem",
    note: !hadMismatch
      ? latest?.result!.workflow === "verified"
        ? "None needed"
        : "—"
      : latest?.result!.workflow === "verified"
        ? "Carrier corrected the BL"
        : waiting
          ? "Waiting for the corrected BL"
          : "Ask for a corrected BL",
  };
  const final: OrderStep = {
    key: "final",
    label: "BL confirmed",
    state: latest?.result!.workflow === "verified" ? "done" : "none",
    note:
      latest?.result!.workflow === "verified" ? "Ready to confirm" : "Not yet",
  };

  const open = sorted.filter((row) => plan(row).bucket === "todo");
  const best = [...open].sort((a, b) => plan(b).score - plan(a).score)[0];
  const level = open.reduce<Level>(
    (top, row) =>
      LEVEL_RANK[plan(row).level] > LEVEL_RANK[top] ? plan(row).level : top,
    "low",
  );
  const deadlines = sorted
    .map((row) => plan(row))
    .filter((p) => p.bucket !== "done" && p.deadline)
    .map((p) => ({ date: p.deadline!, label: p.deadline_label ?? "Due" }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const status: Order["status"] = open.length
    ? "todo"
    : waiting
      ? "waiting"
      : "done";
  const summary =
    siOpen && !drafts.length
      ? "Customer is waiting for the Shipping Instruction."
      : missing && !latest
        ? "The SI or the draft BL is missing — ask the sender for it."
        : latest?.result!.workflow === "discrepancy"
          ? waiting
            ? "Correction requested — waiting for the carrier's revised BL."
            : "The draft BL does not match the SI — ask for a correction."
          : latest?.result!.workflow === "verified"
            ? invoiceOpen
              ? "Draft BL matches. An invoice question is still open."
              : "Draft BL matches the SI."
            : invoiceOpen
              ? "An invoice question is open."
              : open.length
                ? "Emails to read and answer."
                : "Nothing to do.";
  const facts = subjectFacts(sorted.map((row) => row.email.subject));
  const times = sorted.map(receivedTime).filter((t): t is number => t !== null);
  return {
    ref,
    destination: facts.destination,
    carrier: facts.carrier,
    emails: sorted,
    plans: Object.fromEntries(
      sorted.map((row) => [row.email.email_id, plan(row)]),
    ),
    steps: [si, draft, correction, final],
    summary,
    status,
    level,
    todo: open.length,
    next_id: (best ?? sorted[sorted.length - 1]).email.email_id,
    deadline: deadlines[0] ?? null,
    last_at: times.length ? Math.max(...times) : null,
    invoice_open: invoiceOpen,
  };
}

export interface WeekItem {
  id: string;
  ref: string;
  label: string;
  level: Level;
}
export interface WeekDay {
  key: string;
  title: string;
  items: WeekItem[];
}

/**
 * Deadlines for the next 7 days (plus anything already late), taken from
 * the dates written in emails and from reply reminders. A calendar the
 * team does not have to fill in.
 */
export function weekAhead(orders: Order[], now = Date.now()): WeekDay[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const localKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const days: WeekDay[] = [{ key: "late", title: "Late", items: [] }];
  for (let i = 0; i < 7; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    days.push({
      key: localKey(date),
      title:
        i === 0
          ? "Today"
          : i === 1
            ? "Tomorrow"
            : date.toLocaleDateString([], {
                weekday: "short",
                day: "numeric",
                month: "short",
              }),
      items: [],
    });
  }
  const index = new Map(days.map((day) => [day.key, day]));
  const today = localKey(start);
  for (const order of orders)
    for (const row of order.emails) {
      const plan = order.plans[row.email.email_id];
      if (!plan?.deadline || plan.bucket === "done" || plan.bucket === "other")
        continue;
      const date =
        plan.deadline.length === 10
          ? plan.deadline
          : localKey(new Date(plan.deadline));
      const day = date < today ? index.get("late") : index.get(date);
      if (!day) continue;
      day.items.push({
        id: row.email.email_id,
        ref: order.ref,
        label: plan.deadline_label ?? "Due",
        level: plan.level,
      });
    }
  for (const day of days)
    day.items.sort(
      (a, b) =>
        LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.ref.localeCompare(b.ref),
    );
  return days.filter((day) => day.key !== "late" || day.items.length);
}
