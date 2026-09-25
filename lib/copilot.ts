import { extractReferences } from "./mail-intel";
import {
  comparePlanned,
  receivedTime,
  TODO_REASON_LABELS,
  type Plan,
  type TodoReason,
} from "./priority";
import { displayStatus, type StatusTone } from "./case-status";
import { orderFrom } from "./orders";
import { senderScores } from "./sender-insights";
import { byImpact } from "./field-risk";
import { FIELDS, FIELD_LABELS, type CaseSummary, type Field } from "./types";
import { GLOSSARY, glossaryAnswer } from "./shipping-glossary";

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
  /** One-click next steps offered beside "Open". */
  actions: ("reply" | "documents")[];
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
    | "quality"
    | "lookup"
    | "draft"
    | "explain"
    | "handover"
    | "help"
    | "search"
    | "none";
  title: string;
  text: string;
  items: CopilotItem[];
  more: number;
  facts: { label: string; value: string }[];
  suggestions: string[];
  /** Load one email's documents: show SI/BL values, or a reply draft. */
  fetch?: { id: string; mode: "fields" | "reply"; fields: Field[] };
  /** Ready-to-paste text (handover). */
  copy?: string;
  /** Extra advice shown under the answer. */
  tip?: string;
}

export const COPILOT_STARTERS = [
  "What should I do first today?",
  "What is due this week?",
  "Which emails am I waiting on?",
  "Show open POs",
  "Summarise my inbox",
  "Which documents do not match?",
  "Who sends drafts with mistakes?",
  "Write my end-of-day handover",
  "How do I check a draft BL?",
];

/** Starter questions in groups, with real order numbers from the inbox. */
export function copilotStarterGroups(rows: Planned[]) {
  const orderOf = (row: CaseSummary) => row.email.insight?.refs.shipment[0];
  const mismatch = rows
    .filter(
      ({ row, plan }) =>
        plan.bucket === "todo" &&
        row.result?.workflow === "discrepancy" &&
        orderOf(row),
    )
    .sort(byPriority)[0];
  const checked = rows.find(
    ({ row }) =>
      row.result?.category === "BL_COMPARISON" &&
      (row.result.workflow === "verified" ||
        row.result.workflow === "discrepancy") &&
      orderOf(row),
  );
  const lookupRef = orderOf((mismatch ?? checked)?.row ?? rows[0]?.row);
  return [
    {
      label: "Plan my day",
      items: [
        "What should I do first today?",
        "What is due this week?",
        "Which emails am I waiting on?",
      ],
    },
    {
      label: "Check documents",
      items: [
        ...(lookupRef ? [`What do the SI and BL say for ${lookupRef}?`] : []),
        ...(mismatch
          ? [`Write the correction email for ${orderOf(mismatch.row)}`]
          : []),
        "Which documents do not match?",
      ],
    },
    {
      label: "Team",
      items: [
        "Write my end-of-day handover",
        "Who sends drafts with mistakes?",
        "Show open POs",
      ],
    },
    {
      label: "Learn",
      items: [
        "How do I check a draft BL?",
        "What is a notify party?",
        "What is VGM?",
      ],
    },
  ];
}

const FIELD_WORDS: [RegExp, Field[]][] = [
  [/\bshipper\b/, ["shipper"]],
  [/\bconsignee\b/, ["consignee"]],
  [/\bnotify/, ["notify_party"]],
  [
    /\bport of loading\b|\bpol\b|\bloading port\b|\borigin port\b/,
    ["port_of_loading"],
  ],
  [
    /\bport of discharge\b|\bpod\b|\bdischarge port\b|\bdestination\b/,
    ["port_of_discharge"],
  ],
  [/\bports\b/, ["port_of_loading", "port_of_discharge"]],
  [/\bcontainers?\b|\bboxes\b/, ["container_count"]],
  [/\bweights?\b|\bkgs?\b|\btonnes?\b|\bmt\b/, ["gross_weight_kg"]],
];
function fieldsIn(q: string): Field[] {
  const found = new Set<Field>();
  for (const [pattern, fields] of FIELD_WORDS)
    if (pattern.test(q)) for (const field of fields) found.add(field);
  return FIELDS.filter((field) => found.has(field));
}

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
  const status = displayStatus(row, plan);
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
    actions: [
      ...(plan.bucket === "todo" &&
      !!row.result &&
      row.result.category !== "SPAM" &&
      plan.reason !== "unprocessed"
        ? (["reply"] as const)
        : []),
      ...(row.result && row.email.attachments.length
        ? (["documents"] as const)
        : []),
    ],
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

  if (
    /^(help|hi|hello|what can you do|how (?:can|do) (?:you|i)).*/.test(q) &&
    !glossaryAnswer(q)
  )
    return {
      ...base,
      intent: "help",
      title: "I help you plan and find things",
      text: "Ask me in your own words. For example: what to do first, what is due this week, everything about an order number such as 5RFR-36541, what the SI or BL says for an order, a correction email for an order, your end-of-day handover, or what a shipping term means. I only use the emails and documents in CargoGuard and show you where every answer comes from.",
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
    const fields = fieldsIn(q);
    const checked = [...related]
      .reverse()
      .find(
        ({ row }) =>
          row.result?.category === "BL_COMPARISON" &&
          ["verified", "discrepancy", "review"].includes(row.result.workflow),
      );
    // "Write the correction email for 5RFR-36541"
    if (
      /\b(draft|write|prepare|compose)\b.*\b(reply|email|mail|correction|response|answer)\b|\breply to\b|\bcorrection email\b/.test(
        q,
      )
    ) {
      const target =
        todo.find(({ row }) => !!row.result) ??
        [...related].reverse().find(({ row }) => !!row.result);
      if (!target)
        return {
          ...base,
          intent: "draft",
          title: `Reply for ${ref.label.toLowerCase()} ${ref.value}`,
          text: "The emails about it are not checked yet. Open the inbox first so CargoGuard can read them.",
          items: [],
          suggestions: ["What should I do first today?"],
        };
      return {
        ...base,
        intent: "draft",
        title: `Reply for ${ref.label.toLowerCase()} ${ref.value}`,
        text: `Written from the checked values of “${target.row.email.subject}”. Read it once, then open it in the reply editor to send, copy or save it to Gmail.`,
        items: [item(target)],
        fetch: { id: target.row.email.email_id, mode: "reply", fields: [] },
        suggestions: [
          `What do the SI and BL say for ${ref.value}?`,
          "What should I do first today?",
        ],
      };
    }
    // "What is the consignee for 5RFR-36541?" / "What does the SI say?"
    if (
      checked &&
      (fields.length > 0 ||
        /\b(si|bl|b\/l|bill of lading|shipping instruction|documents?|compare|comparison|values?|details?|says?|show me)\b/.test(
          q,
        ))
    ) {
      const chosen = fields.length ? fields : [...FIELDS];
      return {
        ...base,
        intent: "lookup",
        title: `${ref.label} ${ref.value} · ${
          fields.length
            ? chosen.map((f) => FIELD_LABELS[f].toLowerCase()).join(", ")
            : "SI vs draft BL"
        }`,
        text: `As read from the Shipping Instruction and the draft BL of “${checked.row.email.subject}”. Each value shows where in the document it was read.`,
        items: [item(checked)],
        fetch: {
          id: checked.row.email.email_id,
          mode: "fields",
          fields: chosen,
        },
        suggestions: [
          `Write the correction email for ${ref.value}`,
          `What happened with ${ref.value}?`,
        ],
      };
    }
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
      `${plural(related.length, "email")} mention${related.length === 1 ? "s" : ""} ${ref.label.toLowerCase()} ${ref.value}.`,
      todo.length
        ? `${plural(todo.length, "email")} still need${todo.length === 1 ? "s" : ""} you — start with “${todo[0].row.email.subject}”.`
        : "Nothing is waiting for you on it.",
      `Latest: ${displayStatus(latest.row, latest.plan).text.toLowerCase()} (“${latest.row.email.subject}”).`,
    ];
    // For an order number: where the documents stand and what the newest
    // draft fixed compared with the one before.
    let progress: CopilotAnswer["facts"] = [];
    if (ref.label === "Order") {
      const order = orderFrom(
        ref.value,
        related.map(({ row }) => row),
        new Map(related.map(({ row, plan }) => [row.email.email_id, plan])),
      );
      parts.splice(1, 0, order.summary);
      progress = [
        {
          label: "Progress",
          value: order.steps
            .map(
              (step) =>
                `${step.state === "done" ? "✓" : step.state === "problem" ? "✗" : step.state === "waiting" ? "…" : "○"} ${step.label}`,
            )
            .join("  "),
        },
      ];
      const drafts = related.filter(
        ({ row }) =>
          row.result?.category === "BL_COMPARISON" &&
          (row.result.workflow === "verified" ||
            row.result.workflow === "discrepancy") &&
          receivedTime(row) !== null,
      );
      if (drafts.length >= 2) {
        const [before, after] = drafts.slice(-2).map(({ row }) => row);
        const was = new Set(before.result!.defect_fields);
        const now2 = new Set(after.result!.defect_fields);
        const names = (fields: Field[]) =>
          byImpact(fields)
            .map((f) => FIELD_LABELS[f].toLowerCase())
            .join(", ");
        const fixed = [...was].filter((f) => !now2.has(f));
        const added = [...now2].filter((f) => !was.has(f));
        const still = [...now2].filter((f) => was.has(f));
        parts.push(
          `Newest draft vs the one before: ${
            [
              fixed.length ? `fixed ${names(fixed)}` : "",
              still.length ? `still wrong: ${names(still)}` : "",
              added.length ? `new problem: ${names(added)}` : "",
            ]
              .filter(Boolean)
              .join("; ") || "no change in the differences"
          }.`,
        );
      }
    }
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
        ...progress,
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

  // 1b. Shipping terms and how-to questions (fixed text, no AI).
  const term = glossaryAnswer(q);
  if (term)
    return {
      ...base,
      intent: "explain",
      title: term.title,
      text: term.text,
      tip: term.tip,
      items: [],
      suggestions: [
        ...[1, 2].map((step) => {
          const index = GLOSSARY.findIndex((entry) => entry.id === term.id);
          const next = GLOSSARY[(index + step * 3) % GLOSSARY.length];
          const short = next.title.split(" (")[0];
          return `What does ${/[A-Z]{2}/.test(short) ? short : short.toLowerCase()} mean?`;
        }),
        ...(term.id === "check-bl" ? [] : ["How do I check a draft BL?"]),
      ].filter((text, index, all) => all.indexOf(text) === index),
    };

  // 1c. End-of-day handover a colleague can read.
  if (
    /\b(handover|hand over|end of (?:the )?day|end-of-day|eod|shift (?:summary|report|brief|notes)|summary for (?:my )?(?:manager|team|colleague|boss))\b/.test(
      q,
    )
  ) {
    const urgent = open.filter(({ plan }) => plan.level === "urgent");
    const soon = rows
      .filter(({ plan }) => plan.bucket === "todo" || plan.bucket === "waiting")
      .filter(({ plan }) => {
        const t = deadlineTime(plan);
        const window = dayWindow(now, 0, 1);
        return t !== null && t < window.end;
      })
      .sort(
        (a, b) => (deadlineTime(a.plan) ?? 0) - (deadlineTime(b.plan) ?? 0),
      );
    const line = (entry: Planned) => {
      const it = item(entry);
      return `- ${it.subject}\n  ${it.status}${it.why ? ` · ${it.why}` : ""}${it.deadline && !it.deadline_in_why ? ` · ${it.deadline}` : ""}`;
    };
    const copy = [
      `CargoGuard handover — ${new Date(now).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`,
      `To do: ${open.length} (${urgent.length} urgent) · Waiting for replies: ${waiting.length}`,
      "",
      "MOST URGENT",
      ...(open.slice(0, 5).map(line).length
        ? open.slice(0, 5).map(line)
        : ["- Nothing open"]),
      "",
      "DUE TODAY OR TOMORROW",
      ...(soon.slice(0, 5).map(line).length
        ? soon.slice(0, 5).map(line)
        : ["- Nothing due"]),
      "",
      "WAITING FOR REPLIES",
      ...(waiting.slice(0, 8).map(line).length
        ? waiting.slice(0, 8).map(line)
        : ["- Nobody"]),
      "",
      "Statuses come from CargoGuard's checks; open each email before acting.",
    ].join("\n");
    return {
      ...base,
      intent: "handover",
      title: "Your end-of-day handover",
      text: `${plural(open.length, "email")} still to do (${urgent.length} urgent), ${waiting.length} ${waiting.length === 1 ? "reply" : "replies"} awaited, ${plural(soon.length, "deadline")} today or tomorrow. Copy it into an email or Teams message for the next person.`,
      copy,
      ...list(open, 5),
      suggestions: ["Which emails am I waiting on?", "What is due this week?"],
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
        plan.reasons.includes("Follow-up is overdue") ||
        plan.reasons.includes("No answer yet — time to chase"),
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
        : "After you reply to an email, choose “Waiting for their answer” and it will appear here until they write back.",
      ...list(all, 8),
      suggestions: ["What should I do first today?", "Summarise my inbox"],
    };
  }

  // 5b. Where mistakes come from (per sending company).
  if (
    /\b(who|which|what)\b.*\b(sends?|senders?|compan(y|ies)|forwarders?|carriers?|customers?)\b.*\b(mistakes?|errors?|wrong|worst|quality)\b|\b(mistakes?|errors?)\b.*\bby (sender|company|carrier)\b|\bscorecard\b/.test(
      q,
    )
  ) {
    const scores = senderScores(rows.map(({ row }) => row)).filter(
      (score) => score.with_errors > 0,
    );
    const worst = scores[0];
    const theirs = worst
      ? rows
          .filter(
            ({ row }) =>
              worst.last_ids.includes(row.email.email_id) &&
              row.result?.workflow === "discrepancy",
          )
          .sort(byPriority)
      : [];
    return {
      ...base,
      intent: "quality",
      title: worst
        ? `${worst.company} sends the most drafts with mistakes`
        : "No draft with a mistake yet",
      text: worst
        ? `${scores
            .slice(0, 4)
            .map(
              (score) =>
                `${score.company}: ${score.with_errors} of ${score.checked} drafts wrong${score.top[0] ? ` (most often ${score.top[0].label.toLowerCase()})` : ""}`,
            )
            .join(
              "; ",
            )}. Share this with them so they check before sending. Their drafts with differences are below.`
        : "Every checked draft BL matched its SI so far.",
      ...list(theirs, 6),
      facts: scores.slice(0, 4).map((score) => ({
        label: score.company,
        value: `${Math.round(score.rate * 100)}% wrong (${score.with_errors}/${score.checked})`,
      })),
      suggestions: [
        "Which documents do not match?",
        "What should I do first today?",
      ],
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
