import { z } from "zod";
import { GLOSSARY } from "./shipping-glossary";
import { FIELDS } from "./types";

/**
 * "Understand my question" mode of Ask CargoGuard.
 *
 * An AI model reads ONLY the employee's question (never an email, subject,
 * sender, document or count) and returns a small search plan in this fixed
 * format. The plan is checked here, then run in the browser against the
 * emails already loaded for this workspace. Anything the AI copies from the
 * question (a reference, a word, a sender) must literally appear in the
 * question, so the AI cannot add a fact of its own.
 */
export const PLAN_ACTIONS = [
  "plan_day",
  "due",
  "waiting",
  "summary",
  "handover",
  "open_pos",
  "reference",
  "document_values",
  "correction_email",
  "sender_quality",
  "explain_term",
  "find",
  "unsupported",
] as const;
export const PLAN_PERIODS = [
  "today",
  "tomorrow",
  "this_week",
  "next_week",
  "overdue",
] as const;
export const FIND_STATUSES = [
  "to_do",
  "waiting",
  "done",
  "urgent",
  "differences",
  "missing_documents",
  "unclear",
  "not_checked",
  "matched",
] as const;
export const FIND_KINDS = [
  "document_check",
  "si_request",
  "invoice",
  "general",
  "spam",
] as const;
export const GLOSSARY_IDS = GLOSSARY.map((entry) => entry.id);

const shortText = (max: number) => z.string().trim().min(1).max(max);
// Models often write null or "" for "nothing"; treat both as not given.
const blank = (value: unknown) =>
  value === null || (typeof value === "string" && !value.trim())
    ? undefined
    : value;
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(blank, schema);
const findSchema = z.object({
  status: optional(
    z.array(z.enum(FIND_STATUSES)).max(FIND_STATUSES.length).default([]),
  ),
  kind: optional(
    z.array(z.enum(FIND_KINDS)).max(FIND_KINDS.length).default([]),
  ),
  words: optional(z.array(shortText(40)).max(4).default([])),
  sender: optional(shortText(60).nullable().default(null)),
  newest_first: optional(z.boolean().default(false)),
  group_by_sender: optional(z.boolean().default(false)),
  count_only: optional(z.boolean().default(false)),
});
export const questionPlanSchema = z.object({
  action: z.enum(PLAN_ACTIONS),
  reference: optional(shortText(40).nullable().default(null)),
  fields: optional(z.array(z.enum(FIELDS)).max(FIELDS.length).default([])),
  period: optional(z.enum(PLAN_PERIODS).nullable().default(null)),
  term: optional(
    z
      .string()
      .refine((id) => GLOSSARY_IDS.includes(id))
      .nullable()
      .default(null),
  ),
  find: optional(findSchema.nullable().default(null)),
});
export type QuestionPlan = z.infer<typeof questionPlanSchema>;
export type FindPlan = z.infer<typeof findSchema>;

const compact = (value: string) =>
  value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "");
/** True when the value (ignoring case, spaces and punctuation) was typed. */
export function typedIn(value: string, question: string) {
  const key = compact(value);
  return key.length > 0 && compact(question).includes(key);
}

export class PlanRejected extends Error {}

/**
 * Parse the model's text into a checked plan. Throws PlanRejected when the
 * text is not a valid plan, or copies anything that is not in the question.
 */
export function checkedPlan(raw: string, question: string): QuestionPlan {
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  let value: unknown;
  try {
    value = JSON.parse(json ?? "");
  } catch {
    throw new PlanRejected("The AI reply was not a readable plan.");
  }
  const parsed = questionPlanSchema.safeParse(value);
  if (!parsed.success)
    throw new PlanRejected("The AI reply did not follow the plan format.");
  const plan = parsed.data;
  const needsReference = [
    "reference",
    "document_values",
    "correction_email",
  ].includes(plan.action);
  if (needsReference && !plan.reference)
    throw new PlanRejected("The AI plan is missing the reference it needs.");
  if (plan.reference && !typedIn(plan.reference, question))
    throw new PlanRejected(
      "The AI plan used a reference that is not in your question.",
    );
  if (plan.action === "explain_term" && !plan.term)
    throw new PlanRejected("The AI plan did not name a shipping term.");
  if (plan.action === "find") {
    const find = plan.find ?? findSchema.parse({});
    for (const word of [...find.words, ...(find.sender ? [find.sender] : [])])
      if (!typedIn(word, question))
        throw new PlanRejected(
          "The AI plan searched for a word that is not in your question.",
        );
    return { ...plan, find };
  }
  return plan;
}

const PERIOD_LABEL: Record<(typeof PLAN_PERIODS)[number], string> = {
  today: "due today",
  tomorrow: "due tomorrow",
  this_week: "due this week",
  next_week: "due next week",
  overdue: "overdue",
};
export const STATUS_LABEL: Record<(typeof FIND_STATUSES)[number], string> = {
  to_do: "still to do",
  waiting: "waiting for a reply",
  done: "already done",
  urgent: "marked urgent",
  differences: "where the SI and BL differ",
  missing_documents: "with documents missing",
  unclear: "that need a check",
  not_checked: "not checked yet",
  matched: "where the SI and BL match",
};
export const KIND_LABEL: Record<(typeof FIND_KINDS)[number], string> = {
  document_check: "document checks",
  si_request: "SI requests",
  invoice: "invoice questions",
  general: "general messages",
  spam: "spam",
};

/** Plain-English reading of a plan, written by the app (never by the AI). */
export function planLabel(plan: QuestionPlan): string {
  const field = (list: string[]) =>
    list.map((f) => f.replace(/_/g, " ").replace(" kg", "")).join(", ");
  switch (plan.action) {
    case "plan_day":
      return "What to do first";
    case "due":
      return `Emails ${PERIOD_LABEL[plan.period ?? "this_week"]}`;
    case "waiting":
      return "Emails waiting for a reply";
    case "summary":
      return "Inbox summary";
    case "handover":
      return "End-of-day handover";
    case "open_pos":
      return "Open POs";
    case "reference":
      return `Everything about ${plan.reference}`;
    case "document_values":
      return `SI and BL ${plan.fields.length ? field(plan.fields) : "values"} for ${plan.reference}`;
    case "correction_email":
      return `Correction email for ${plan.reference}`;
    case "sender_quality":
      return "Which senders make mistakes";
    case "explain_term":
      return `Explain: ${GLOSSARY.find((g) => g.id === plan.term)?.title ?? "a shipping term"}`;
    case "unsupported":
      return "Not something CargoGuard can answer";
    case "find": {
      const find = plan.find ?? findSchema.parse({});
      const head = [
        find.count_only ? "Count" : "Find",
        find.kind.length
          ? find.kind.map((k) => KIND_LABEL[k]).join(" or ")
          : "emails",
        find.status.map((s) => STATUS_LABEL[s]).join(" or "),
        plan.fields.length
          ? `with a ${plan.fields
              .map((f) => f.replace(/_/g, " ").replace(" kg", ""))
              .join(" or ")} difference`
          : "",
        find.sender ? `from “${find.sender}”` : "",
        find.words.length
          ? `mentioning ${find.words.map((w) => `“${w}”`).join(" and ")}`
          : "",
      ]
        .filter(Boolean)
        .join(" ");
      return [
        head,
        ...(find.group_by_sender ? ["grouped by sender company"] : []),
        ...(find.newest_first ? ["newest first"] : []),
      ].join(", ");
    }
  }
}
