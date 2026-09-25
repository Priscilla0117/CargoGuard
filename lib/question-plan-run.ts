import {
  COPILOT_STARTERS,
  copilotAnswer,
  copilotItem,
  type CopilotAnswer,
  type Planned,
} from "./copilot";
import { comparePlanned } from "./priority";
import { senderCompany } from "./sender-insights";
import { GLOSSARY } from "./shipping-glossary";
import type { Field } from "./types";
import type { FindPlan, QuestionPlan } from "./question-plan";

/**
 * Runs a checked question plan in the browser, on the emails already loaded
 * for this workspace. Every answer comes from those emails; the AI that
 * produced the plan never sees them.
 */
const FIELD_WORDS: Record<Field, string> = {
  shipper: "shipper",
  consignee: "consignee",
  notify_party: "notify party",
  port_of_loading: "port of loading",
  port_of_discharge: "port of discharge",
  container_count: "containers",
  gross_weight_kg: "weight",
};
const PERIOD_QUESTION = {
  today: "What is due today?",
  tomorrow: "What is due tomorrow?",
  this_week: "What is due this week?",
  next_week: "What is due next week?",
  overdue: "What is overdue?",
} as const;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const base = { facts: [] as CopilotAnswer["facts"], more: 0 };

function statusMatch(entry: Planned, status: FindPlan["status"][number]) {
  const { row, plan } = entry;
  switch (status) {
    case "to_do":
      return plan.bucket === "todo";
    case "waiting":
      return plan.bucket === "waiting";
    case "done":
      return plan.bucket === "done";
    case "urgent":
      return plan.bucket === "todo" && plan.level === "urgent";
    case "differences":
      return row.result?.workflow === "discrepancy";
    case "missing_documents":
      return row.result?.workflow === "awaiting_documents";
    case "unclear":
      return row.result?.workflow === "review";
    case "not_checked":
      return !row.result;
    case "matched":
      return row.result?.workflow === "verified";
  }
}
const KIND_CATEGORY = {
  document_check: "BL_COMPARISON",
  si_request: "SI_REQUEST",
  invoice: "INVOICE_QUERY",
  general: "GENERAL",
  spam: "SPAM",
} as const;
function searchable({ row }: Planned) {
  const refs = row.email.insight?.refs;
  return [
    row.email.subject,
    row.email.from,
    row.email.insight?.sender_name ?? "",
    row.email.insight?.snippet ?? "",
    ...(refs ? Object.values(refs).flat() : []),
  ]
    .join(" ")
    .toLowerCase();
}

// Words that describe the search rather than name something in an email.
const GENERIC_WORDS = new Set(
  (
    "email emails mail mails message messages inbox latest newest recent last new " +
    "problem problems issue issues wrong error errors mistake mistakes anything " +
    "something everything any all show find list draft drafts document documents"
  ).split(" "),
);

const NO_FIND: FindPlan = {
  status: [],
  kind: [],
  words: [],
  sender: null,
  newest_first: false,
  group_by_sender: false,
  count_only: false,
};

function findAnswer(plan: QuestionPlan, rows: Planned[]): CopilotAnswer {
  const find = plan.find ?? NO_FIND;
  const words = find.words
    .map((w) => w.toLowerCase())
    .filter((w) => !GENERIC_WORDS.has(w));
  const sender = find.sender?.toLowerCase() ?? null;
  const named = (entry: Planned) =>
    words.every((word) => searchable(entry).includes(word)) &&
    (!sender ||
      `${entry.row.email.from} ${entry.row.email.insight?.sender_name ?? ""}`
        .toLowerCase()
        .includes(sender));
  const matches = rows.filter((entry) => {
    const { row } = entry;
    const category = row.result
      ? (row.result.category_override ?? row.result.category)
      : null;
    return (
      named(entry) &&
      (!find.status.length || find.status.some((s) => statusMatch(entry, s))) &&
      (!find.kind.length ||
        (category !== null &&
          find.kind.some((kind) => KIND_CATEGORY[kind] === category))) &&
      (!plan.fields.length ||
        (row.result?.defect_fields ?? []).some((f) => plan.fields.includes(f)))
    );
  });
  const ordered = [...matches].sort((a, b) =>
    comparePlanned(a, b, find.newest_first ? "newest" : "priority"),
  );
  // Filters that need a saved check cannot see emails that are not checked.
  const needsCheck =
    find.kind.length > 0 ||
    plan.fields.length > 0 ||
    find.status.some((s) =>
      ["differences", "missing_documents", "unclear", "matched"].includes(s),
    );
  const unchecked =
    needsCheck && !find.status.includes("not_checked")
      ? rows.filter((entry) => !entry.row.result && named(entry)).length
      : 0;
  const note = unchecked
    ? ` ${plural(unchecked, "email")} ${unchecked === 1 ? "is" : "are"} not checked yet, so ${unchecked === 1 ? "it is" : "they are"} not included.`
    : "";
  if (!ordered.length)
    return {
      ...base,
      intent: "search",
      title: "No email matches",
      text: `Nothing in your saved emails matches that search.${note}`,
      items: [],
      suggestions: ["Summarise my inbox", "What should I do first today?"],
    };
  let facts: CopilotAnswer["facts"] = [];
  if (find.group_by_sender) {
    const groups = new Map<string, number>();
    for (const { row } of ordered) {
      const company = senderCompany(row.email.from);
      groups.set(company, (groups.get(company) ?? 0) + 1);
    }
    facts = [...groups.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([company, n]) => ({ label: company, value: plural(n, "email") }));
  }
  const limit = find.count_only ? 5 : 8;
  return {
    ...base,
    intent: "search",
    title: find.count_only
      ? `${plural(ordered.length, "email")} found`
      : find.group_by_sender && facts.length
        ? `${facts[0].label} has the most (${facts[0].value})`
        : `${plural(ordered.length, "email")} found`,
    text: `${find.group_by_sender && facts.length ? "Counted per sender company. " : ""}${find.newest_first ? "Newest first." : "Most urgent first."}${note}`,
    items: ordered.slice(0, limit).map(copilotItem),
    more: Math.max(0, ordered.length - limit),
    facts,
    suggestions: ["What should I do first today?", "Summarise my inbox"],
  };
}

function explainAnswer(termId: string): CopilotAnswer {
  const entry = GLOSSARY.find((g) => g.id === termId)!;
  return {
    ...base,
    intent: "explain",
    title: entry.title,
    text: entry.text,
    ...(entry.tip ? { tip: entry.tip } : {}),
    items: [],
    suggestions:
      entry.id === "check-bl"
        ? ["What is a notify party?", "What is VGM?"]
        : ["How do I check a draft BL?", "What is VGM?"].filter(
            (text) => !(entry.id === "vgm" && text === "What is VGM?"),
          ),
  };
}

/** The same answer the instant copilot gives to a clear, canonical question. */
export function answerPlan(
  plan: QuestionPlan,
  rows: Planned[],
  now = Date.now(),
): CopilotAnswer {
  const ask = (question: string) => copilotAnswer(question, rows, now);
  switch (plan.action) {
    case "plan_day":
      return ask("What should I do first today?");
    case "due":
      return ask(PERIOD_QUESTION[plan.period ?? "this_week"]);
    case "waiting":
      return ask("Which emails am I waiting on?");
    case "summary":
      return ask("Summarise my inbox");
    case "handover":
      return ask("Write my end-of-day handover");
    case "open_pos":
      return ask("Show open POs");
    case "sender_quality":
      return ask("Who sends drafts with mistakes?");
    case "explain_term":
      return explainAnswer(plan.term!);
    case "reference":
    case "document_values":
    case "correction_email": {
      const ref = plan.reference!;
      const answer =
        plan.action === "reference"
          ? ask(`Tell me about ${ref}`)
          : plan.action === "correction_email"
            ? ask(`Write the correction email for ${ref}`)
            : ask(
                plan.fields.length
                  ? `What do the SI and BL say about the ${plan.fields.map((f) => FIELD_WORDS[f]).join(" and ")} for ${ref}?`
                  : `What do the SI and BL say for ${ref}?`,
              );
      // Not an order, PO, invoice, booking or container number: search for it.
      if (["reference", "lookup", "draft"].includes(answer.intent))
        return answer;
      return findAnswer(
        {
          ...plan,
          action: "find",
          fields: [],
          find: { ...NO_FIND, words: [ref] },
        },
        rows,
      );
    }
    case "find":
      if (!rows.length)
        return {
          ...base,
          intent: "none",
          title: "Your inbox is empty",
          text: "Import emails or connect Gmail first. Then I can search them.",
          items: [],
          suggestions: [],
        };
      return findAnswer(plan, rows);
    case "unsupported":
      return {
        ...base,
        intent: "none",
        title: "That is not something I can answer",
        text: "I answer from your saved emails and documents: what to do first, what is due, orders and POs, what the SI and BL say, correction emails, handovers and shipping terms. I never approve, release or send anything.",
        items: [],
        suggestions: COPILOT_STARTERS.slice(0, 4),
      };
  }
}
