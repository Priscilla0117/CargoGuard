import { extractReferences } from "./mail-intel";
import {
  comparePlanned,
  receivedTime,
  TODO_REASON_LABELS,
  type Plan,
  type TodoReason,
} from "./priority";
import { rowStatus, type StatusTone } from "./case-status";
import { FIELD_LABELS, type CaseSummary, type Field } from "./types";

/**
 * Ask CargoGuard — workspace planning copilot.
 *
 * Every answer is computed from the saved inbox (status, priority reasons,
 * deadlines found in the emails, references and conversations). It never
 * invents a shipment fact: each statement is backed by the listed emails,
 * which the employee can open with one click.
 */
export type Planned = { row: CaseSummary; plan: Plan };
export interface CopilotItem {
  id: string;
  subject: string;
  status: string;
  tone: StatusTone;
  why: string;
  deadline: string | null;
  /** The reasons already say when it is due; show the date only on hover. */
  deadline_in_why: boolean;
  level: Plan["level"];
}
export interface CopilotAnswer {
  intent:
    | "plan"
    | "due"
    | "reference"
    | "po"
    | "waiting"
    | "reason"
    | "summary"
    | "sender"
    | "help"
    | "search"
    | "none";
  title: string;
  text: string;
  items: CopilotItem[];
  more: number;
  facts: { label: string; value: string }[];
  suggestions: string[];
}

export const COPILOT_STARTERS = [
  "What should I do first today?",
  "What is due this week?",
  "Which emails am I waiting on?",
  "Show open POs",
  "Summarise my inbox",
  "Which documents do not match?",
];

const DAY = 86400000;
/** "2026-09-25" -> "Fri 25 Sep" (easier to read than ISO dates). */
export function friendlyDate(value: string) {
  const time = Date.parse(value.length === 10 ? `${value}T12:00:00` : value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
function item({ row, plan }: Planned): CopilotItem {
  const status = rowStatus(row);
  const dateInReasons = plan.reasons.some((reason) =>
    /due|cut-off|etd|eta|payment|deadline|overdue|follow-up/i.test(reason),
  );
  return {
    id: row.email.email_id,
    subject: row.email.subject,
    status: status.text,
    tone: status.tone,
    why: plan.reasons.slice(0, 3).join(" · "),
    deadline:
      plan.deadline && plan.bucket !== "done"
        ? `${plan.deadline_label ?? "Due"} ${friendlyDate(plan.deadline.slice(0, 10))}`
        : null,
    deadline_in_why: dateInReasons,
    level: plan.level,
  };
}
function list(rows: Planned[], limit = 6) {
  return {
    items: rows.slice(0, limit).map(item),
    more: Math.max(0, rows.length - limit),
  };
}
const byPriority = (a: Planned, b: Planned) => comparePlanned(a, b, "priority");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
function dayWindow(now: number, from: number, to: number) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return {
    start: start.getTime() + from * DAY,
    end: start.getTime() + (to + 1) * DAY,
  };
}
function deadlineTime(plan: Plan) {
  if (!plan.deadline) return null;
  const value = Date.parse(
    plan.deadline.length === 10 ? `${plan.deadline}T12:00:00` : plan.deadline,
  );
  return Number.isFinite(value) ? value : null;
}

const REF_SHAPES: [RegExp, string][] = [
  [/\b\d[A-Z]{3}-\d{5}\b/i, "Order"],
  [
    /\bP\.?\s?O\.?(?:\s*(?:no\.?|number|#))?[\s_:#-]*(\d{2}[_-]\d{3,5}|\d{4,10})\b/i,
    "PO",
  ],
  [/\b525\d{7}\b/, "Invoice"],
  [
    /\b(?:invoice|inv)(?:\s*(?:no\.?|number|#))?[\s_:#-]*([A-Z]{0,3}\d{6,12})\b/i,
    "Invoice",
  ],
  [/\b[A-Z]{3}[UJZ]\d{7}\b/i, "Container"],
  [
    /\b(?:SIJ|SINF|SIN|MEDU|OOLU|YMJA|EGLV|MCLSIN|COSU|HLCU|MAEU|CMDU|ONEY)(?=[A-Z]*\d{5})[A-Z0-9]{5,14}\b/i,
    "Booking",
  ],
];
const refKey = (value: string) => value.toUpperCase().replace(/[\s_-]/g, "");
function referenceIn(question: string) {
  for (const [pattern, label] of REF_SHAPES) {
    const match = question.match(pattern);
    if (match) {
      const value = (match[1] ?? match[0]).toUpperCase().replace(/\s+/g, "");
      return {
        label,
        value: label === "PO" ? value.replace(/-/g, "_") : value,
      };
    }
  }
  return null;
}
function refsOf(row: CaseSummary) {
  return row.email.insight?.refs ?? extractReferences(row.email.subject, "");
}
function matchesReference(row: CaseSummary, value: string) {
  const wanted = refKey(value);
  return (
    Object.values(refsOf(row))
      .flat()
      .some((ref) => refKey(ref) === wanted) ||
    refKey(row.email.subject).includes(wanted)
  );
}

const REASON_WORDS: [RegExp, TodoReason][] = [
  [
    /\b(mismatch|differen|do not match|don't match|wrong|discrepan)/,
    "differences",
  ],
  [/\b(missing|no attachment|not attached|documents? needed)/, "missing"],
  [/\b(unclear|unreadable|check|confirm|scan)/, "unclear"],
  [/\b(si request|send si|shipping instruction|prepare si)/, "si_request"],
  [/\b(invoice|billing|charges?|payment)/, "invoice"],
];

export function copilotAnswer(
  question: string,
  rows: Planned[],
  now = Date.now(),
): CopilotAnswer {
  const q = question
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/g, "");
  const open = rows
    .filter(({ plan }) => plan.bucket === "todo")
    .sort(byPriority);
  const waiting = rows.filter(({ plan }) => plan.bucket === "waiting");
  const base = { facts: [] as CopilotAnswer["facts"], more: 0 };

  if (!rows.length)
    return {
      ...base,
      intent: "none",
      title: "Your inbox is empty",
      text: "Import emails or connect Gmail first. Then I can plan your day, find orders and POs, and tell you what is due.",
      items: [],
      suggestions: [],
    };

  if (/^(help|hi|hello|what can you do|how (?:can|do) (?:you|i)).*/.test(q))
    return {
      ...base,
      intent: "help",
      title: "I help you plan and find things",
      text: "Ask me in your own words. For example: what to do first, what is due today or this week, everything about an order number such as 5RFR-36541, a PO or invoice number, which customers you are waiting on, or which documents do not match. I only use the emails in CargoGuard and show you the emails behind every answer.",
      items: [],
      suggestions: COPILOT_STARTERS.slice(0, 4),
    };

  // 1. A specific order, PO, invoice, booking or container number.
  const ref = referenceIn(question);
  if (ref) {
    const related = rows
      .filter(({ row }) => matchesReference(row, ref.value))
      .sort((a, b) => (receivedTime(a.row) ?? 0) - (receivedTime(b.row) ?? 0));
    if (!related.length)
      return {
        ...base,
        intent: "reference",
        title: `${ref.label} ${ref.value}`,
        text: `I could not find ${ref.label.toLowerCase()} ${ref.value} in any email in CargoGuard. Check the number, or import the email that mentions it.`,
        items: [],
        suggestions: ["Show open POs", "What should I do first today?"],
      };
    const todo = related
      .filter(({ plan }) => plan.bucket === "todo")
      .sort(byPriority);
    const latest = related[related.length - 1];
    const deadlines = related
      .flatMap(({ row }) => row.email.insight?.dates ?? [])
      .filter((d) => d.kind !== "Mentioned")
      .sort((a, b) => a.date.localeCompare(b.date));
    const upcoming = deadlines.find(
      (d) => Date.parse(`${d.date}T23:59:59`) >= now,
    );
    const differences = new Set(
      related.flatMap(({ row }) =>
        row.result?.workflow === "discrepancy" ? row.result.defect_fields : [],
      ),
    );
    const parts = [
      `${plural(related.length, "email")} mention ${ref.label.toLowerCase()} ${ref.value}.`,
      todo.length
        ? `${plural(todo.length, "email")} still need${todo.length === 1 ? "s" : ""} you — start with “${todo[0].row.email.subject}”.`
        : "Nothing is waiting for you on it.",
      `Latest: ${rowStatus(latest.row).text.toLowerCase()} (“${latest.row.email.subject}”).`,
    ];
    if (upcoming)
      parts.push(
        `Next date mentioned: ${upcoming.kind.toLowerCase()} ${friendlyDate(upcoming.date)}.`,
      );
    return {
      ...base,
      intent: "reference",
      title: `${ref.label} ${ref.value}`,
      text: parts.join(" "),
      ...list(
        [...todo, ...related.filter((r) => !todo.includes(r)).reverse()],
        8,
      ),
      facts: [
        { label: "Emails", value: String(related.length) },
        { label: "Still to do", value: String(todo.length) },
        ...(differences.size
          ? [
              {
                label: "Differences seen",
                value: [...differences]
                  .map((f) => FIELD_LABELS[f as Field])
                  .join(", "),
              },
            ]
          : []),
        ...(upcoming
          ? [{ label: upcoming.kind, value: friendlyDate(upcoming.date) }]
          : []),
      ],
      suggestions: ["What should I do first today?", "What is due this week?"],
    };
  }

  // 2. Purchase orders.
  if (/\b(po|pos|purchase orders?)\b/.test(q)) {
    const withPo = rows.filter(({ row }) => refsOf(row).po.length);
    const openPo = withPo
      .filter(({ plan }) => plan.bucket === "todo" || plan.bucket === "waiting")
      .sort(byPriority);
    const pos = [...new Set(openPo.flatMap(({ row }) => refsOf(row).po))];
    return {
      ...base,
      intent: "po",
      title: pos.length ? `${plural(pos.length, "open PO")}` : "No open POs",
      text: pos.length
        ? `These emails mention a PO and still need action or a reply: ${pos
            .slice(0, 8)
            .map((p) => `PO ${p}`)
            .join(", ")}${pos.length > 8 ? "…" : ""}. The most urgent is first.`
        : withPo.length
          ? `${plural(withPo.length, "email")} mention a PO, and all of them are done.`
          : "No email in CargoGuard mentions a PO number yet.",
      ...list(openPo, 8),
      suggestions: pos
        .slice(0, 2)
        .map((p) => `Show PO ${p}`)
        .concat("What is due this week?"),
    };
  }

  // 3. Plan the day ("what first", "plan my day", "prioritise").
  if (
    /\b(first|start with|plan|prioriti[sz]e|priority|focus|what should i do|what to do|what do i do)\b/.test(
      q,
    ) &&
    !REASON_WORDS.some(([pattern]) => pattern.test(q))
  ) {
    const top = open.slice(0, 5);
    const urgent = open.filter(({ plan }) => plan.level === "urgent").length;
    return {
      ...base,
      intent: "plan",
      title: top.length
        ? "Your plan: start with these"
        : "Nothing to do right now",
      text: top.length
        ? `${urgent ? `${plural(urgent, "email")} ${urgent === 1 ? "is" : "are"} urgent. ` : ""}Work from the top: each one says why it is on the list. After the top 5, ${Math.max(0, open.length - 5)} more are waiting in the inbox.`
        : "Everything is done or waiting for a reply.",
      items: top.map(item),
      more: Math.max(0, open.length - top.length),
      facts: [],
      suggestions: ["What is due this week?", "Which emails am I waiting on?"],
    };
  }

  // 4. Deadlines and dates.
  const dueWords =
    /\b(due|deadline|cut[\s-]?off|etd|overdue|late|urgent|today|tomorrow|this week|next week)\b/;
  if (dueWords.test(q)) {
    const range = /\boverdue|late|passed\b/.test(q)
      ? { from: -60, to: -1, label: "past a deadline" }
      : /\btoday\b/.test(q)
        ? { from: 0, to: 0, label: "due today" }
        : /\btomorrow\b/.test(q)
          ? { from: 1, to: 1, label: "due tomorrow" }
          : /\bnext week\b/.test(q)
            ? { from: 7, to: 13, label: "due next week" }
            : {
                from: -3,
                to: 6,
                label: "due within the next 7 days (or just missed)",
              };
    const window = dayWindow(now, range.from, range.to);
    const due = rows
      .filter(({ plan }) => plan.bucket === "todo" || plan.bucket === "other")
      .filter(({ plan }) => {
        const t = deadlineTime(plan);
        return t !== null && t >= window.start && t < window.end;
      })
      .sort(
        (a, b) => (deadlineTime(a.plan) ?? 0) - (deadlineTime(b.plan) ?? 0),
      );
    const urgent = /\burgent\b/.test(q)
      ? open.filter(({ plan }) => plan.level === "urgent")
      : [];
    const chosen = urgent.length ? urgent : due;
    return {
      ...base,
      intent: "due",
      title: urgent.length
        ? `${plural(urgent.length, "urgent email")}`
        : chosen.length
          ? `${plural(chosen.length, "email")} ${range.label}`
          : `Nothing ${range.label}`,
      text: chosen.length
        ? "Dates come from the emails themselves (cut-off, ETD, payment, “by …”) and from follow-ups you set. Earliest first."
        : "No cut-off, ETD, payment or follow-up date falls in that period. Emails without a written date are not included.",
      ...list(chosen, 8),
      suggestions: [
        "What should I do first today?",
        "Which emails am I waiting on?",
      ],
    };
  }

  // 5. Waiting on others.
  if (
    /\b(waiting|no reply|not replied|chase|reminder|follow[\s-]?up)\b/.test(q)
  ) {
    const overdue = open.filter(
      ({ plan }) =>
        plan.reason === "follow_up" ||
        plan.reasons.includes("Follow-up is overdue"),
    );
    const all = [...overdue, ...waiting];
    return {
      ...base,
      intent: "waiting",
      title: all.length
        ? `${plural(waiting.length, "email")} waiting for a reply`
        : "You are not waiting on anyone",
      text: all.length
        ? `${overdue.length ? `${plural(overdue.length, "follow-up")} ${overdue.length === 1 ? "is" : "are"} overdue — chase ${overdue.length === 1 ? "it" : "those"} first. ` : ""}Emails marked “waiting” leave your to-do list until the other side answers or the follow-up date passes.`
        : "When you ask someone for a corrected BL or missing documents, set the follow-up to “Awaiting reply” and it will appear here.",
      ...list(all, 8),
      suggestions: ["What should I do first today?", "Summarise my inbox"],
    };
  }

  // 6. A kind of work.
  const reason = REASON_WORDS.find(([pattern]) => pattern.test(q))?.[1];
  if (reason) {
    const matching = open.filter(({ plan }) => plan.reason === reason);
    const fields = new Map<string, number>();
    if (reason === "differences")
      for (const { row } of matching)
        for (const field of row.result?.defect_fields ?? [])
          fields.set(
            FIELD_LABELS[field],
            (fields.get(FIELD_LABELS[field]) ?? 0) + 1,
          );
    const top = [...fields.entries()].sort((a, b) => b[1] - a[1]);
    return {
      ...base,
      intent: "reason",
      title: `${TODO_REASON_LABELS[reason]}: ${matching.length}`,
      text: matching.length
        ? reason === "differences"
          ? `Most often wrong: ${top
              .slice(0, 3)
              .map(([f, n]) => `${f} (${n})`)
              .join(
                ", ",
              )}. Open one and press “Write correction email” — the reply lists the exact SI and BL values.`
          : "Most urgent first. Open one to see the next step."
        : "None right now.",
      ...list(matching, 8),
      suggestions: ["What should I do first today?", "What is due this week?"],
    };
  }

  // 7. Overview.
  if (
    /\b(summary|summari[sz]e|overview|how many|status|inbox|today|report)\b/.test(
      q,
    )
  ) {
    const count = (fn: (p: Planned) => boolean) => rows.filter(fn).length;
    const reasons = (Object.keys(TODO_REASON_LABELS) as TodoReason[])
      .map(
        (key) =>
          [key, open.filter(({ plan }) => plan.reason === key).length] as const,
      )
      .filter(([, n]) => n > 0);
    const urgent = open.filter(({ plan }) => plan.level === "urgent").length;
    return {
      ...base,
      intent: "summary",
      title: `${plural(open.length, "email")} to do`,
      text: `${urgent ? `${urgent} ${urgent === 1 ? "is" : "are"} urgent. ` : ""}${reasons.map(([key, n]) => `${TODO_REASON_LABELS[key]}: ${n}`).join(" · ")}.`,
      ...list(open, 5),
      facts: [
        { label: "To do", value: String(open.length) },
        { label: "Urgent", value: String(urgent) },
        { label: "Waiting for reply", value: String(waiting.length) },
        {
          label: "Done",
          value: String(count(({ plan }) => plan.bucket === "done")),
        },
        {
          label: "FYI & spam",
          value: String(count(({ plan }) => plan.bucket === "other")),
        },
      ],
      suggestions: [
        "What should I do first today?",
        "Which documents do not match?",
      ],
    };
  }

  // 8. A sender or company name.
  const words = q
    .split(/[^a-z0-9]+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !/^(from|email|emails|show|with|about|find|which|what|where|customer|carrier|sender)$/.test(
          w,
        ),
    );
  const bySender = rows.filter(({ row }) => {
    const hay =
      `${row.email.from} ${row.email.insight?.sender_name ?? ""}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  });
  if (/\b(from|sender|customer|carrier)\b/.test(q) && bySender.length) {
    const sorted = [...bySender].sort(byPriority);
    return {
      ...base,
      intent: "sender",
      title: `${plural(bySender.length, "email")} from “${words.join(" ")}”`,
      text: `${sorted.filter(({ plan }) => plan.bucket === "todo").length} still to do. Most urgent first.`,
      ...list(sorted, 8),
      suggestions: ["What should I do first today?"],
    };
  }

  // 9. Plain search.
  const found = words.length
    ? rows
        .filter(({ row }) => {
          const hay =
            `${row.email.subject} ${row.email.from} ${row.email.insight?.snippet ?? ""} ${row.email.insight?.sender_name ?? ""}`.toLowerCase();
          return words.every((w) => hay.includes(w));
        })
        .sort(byPriority)
    : [];
  if (found.length)
    return {
      ...base,
      intent: "search",
      title: `${plural(found.length, "email")} match “${words.join(" ")}”`,
      text: "Most urgent first.",
      ...list(found, 8),
      suggestions: ["What should I do first today?"],
    };
  return {
    ...base,
    intent: "none",
    title: "I am not sure what you mean",
    text: "Try one of these, or type an order number (like 5RFR-36541), a PO, an invoice number or a customer name.",
    items: [],
    suggestions: COPILOT_STARTERS.slice(0, 4),
  };
}
