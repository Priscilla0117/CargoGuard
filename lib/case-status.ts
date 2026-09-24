import { FIELD_LABELS, type CaseResult, type CaseSummary } from "./types";
import type { Plan } from "./priority";

export type StatusTone =
  | "differences"
  | "missing"
  | "unclear"
  | "done"
  | "other"
  | "unprocessed";
export type PrimaryAction =
  | "reply"
  | "compare"
  | "documents"
  | "category"
  | "followup";
export interface CaseStatus {
  tone: StatusTone;
  title: string;
  detail: string;
  action: { label: string; target: PrimaryAction } | null;
  secondary?: { label: string; target: PrimaryAction };
}

const CATEGORY_WORDS: Record<string, string> = {
  BL_COMPARISON: "Document check",
  SI_REQUEST: "Shipping Instruction request",
  INVOICE_QUERY: "Invoice question",
  GENERAL: "General email",
  SPAM: "Spam / suspicious",
};
export function categoryWords(category: string | undefined) {
  return category ? (CATEGORY_WORDS[category] ?? category) : "Not checked yet";
}

/** One short status sentence and ONE recommended action, in plain words. */
export function caseStatus(result: CaseResult, plan?: Plan): CaseStatus {
  const mismatches = result.comparison.filter(
    (row) => row.result === "mismatch",
  );
  const uncertain = result.comparison.filter(
    (row) => row.result === "uncertain",
  );
  const names = (rows: typeof mismatches) =>
    rows.map((row) => FIELD_LABELS[row.field].toLowerCase()).join(", ");
  if (result.classification.needs_review && !result.category_override)
    return {
      tone: "unclear",
      title: "Please confirm what this email is about",
      detail: `CargoGuard thinks it is a “${categoryWords(result.category)}” but is not sure. Read the email and confirm the type.`,
      action: { label: "Confirm email type", target: "category" },
      secondary: { label: "Read the email", target: "documents" },
    };
  if (mismatches.length)
    return {
      tone: "differences",
      title: `${mismatches.length} detail${mismatches.length === 1 ? " does" : "s do"} not match the SI`,
      detail: `Different: ${names(mismatches)}.${uncertain.length ? ` Also check: ${names(uncertain)}.` : ""} Ask the sender to correct the draft BL.`,
      action: { label: "Write correction email", target: "reply" },
      secondary: { label: "See the differences", target: "compare" },
    };
  if (
    result.workflow === "awaiting_documents" ||
    result.review_reason === "missing_attachment"
  )
    return {
      tone: "missing",
      title: "Documents are missing",
      detail:
        result.category === "BL_COMPARISON"
          ? "Both the Shipping Instruction and the draft BL are needed before anything can be checked."
          : `${categoryWords(result.category)} — the email mentions documents that are not attached.`,
      action: { label: "Ask for the documents", target: "reply" },
      secondary: { label: "See attachments", target: "documents" },
    };
  if (result.review_reason === "wrong_doc_type")
    return {
      tone: "unclear",
      title: "Choose which file is the SI and which is the BL",
      detail:
        "The attachments could not be matched to one SI and one draft BL automatically.",
      action: { label: "Choose documents", target: "documents" },
    };
  if (result.review_reason === "unreadable")
    return {
      tone: "unclear",
      title: "A document could not be read",
      detail:
        "Open the document to read it with text recognition, or ask the sender for a clearer copy.",
      action: { label: "Open the document", target: "documents" },
      secondary: { label: "Ask for a clear copy", target: "reply" },
    };
  if (uncertain.length || result.workflow === "review")
    return {
      tone: "unclear",
      title: uncertain.length
        ? `Please check ${uncertain.length} detail${uncertain.length === 1 ? "" : "s"}`
        : "This email needs a person to look at it",
      detail: uncertain.length
        ? `CargoGuard could not read ${names(uncertain)} with certainty. Compare with the document and correct it if needed.`
        : result.summary,
      action: uncertain.length
        ? { label: "Check the details", target: "compare" }
        : { label: "Open the documents", target: "documents" },
      secondary: { label: "Ask the sender", target: "reply" },
    };
  if (result.workflow === "verified")
    return {
      tone: "done",
      title: "No mismatch detected",
      detail:
        plan?.bucket === "todo"
          ? "The documents match, but a follow-up is still open."
          : "All 7 details match the Shipping Instruction: shipper, consignee, notify party, both ports, containers and gross weight. This is a document check only — not cargo release.",
      action: { label: "Send confirmation", target: "reply" },
      secondary:
        plan?.bucket === "todo"
          ? { label: "Update follow-up", target: "followup" }
          : undefined,
    };
  if (result.category === "SPAM")
    return {
      tone: "other",
      title: "Looks like spam or a suspicious email",
      detail: "Do not click links or open attachments. No reply is needed.",
      action: null,
    };
  if (result.category === "SI_REQUEST")
    return {
      tone: "unclear",
      title: "Customer asks for a Shipping Instruction",
      detail:
        "Prepare and send the SI. When it is done, record it in Follow-up so the email leaves your to-do list.",
      action: { label: "Reply to sender", target: "reply" },
      secondary: { label: "Mark as handled", target: "followup" },
    };
  if (result.category === "INVOICE_QUERY")
    return {
      tone: "unclear",
      title: "Invoice question to answer",
      detail:
        "Check the invoice with the billing team and reply. Record it in Follow-up when it is answered.",
      action: { label: "Reply to sender", target: "reply" },
      secondary: { label: "Mark as handled", target: "followup" },
    };
  return {
    tone: "other",
    title: categoryWords(result.category),
    detail: `${result.summary} No reply is needed unless you want to.`,
    action: { label: "Reply to sender", target: "reply" },
  };
}

/** Very short status for list rows. */
export function rowStatus(row: CaseSummary): {
  text: string;
  tone: StatusTone;
} {
  const r = row.result;
  if (!r) return { text: "Not checked yet", tone: "unprocessed" };
  if (r.classification.needs_review && !r.category_override)
    return { text: "Confirm email type", tone: "unclear" };
  if (r.workflow === "discrepancy")
    return {
      text: `${r.defect_fields.length} difference${r.defect_fields.length === 1 ? "" : "s"}`,
      tone: "differences",
    };
  if (
    r.workflow === "awaiting_documents" ||
    r.review_reason === "missing_attachment"
  )
    return { text: "Missing documents", tone: "missing" };
  if (r.workflow === "review") return { text: "Please check", tone: "unclear" };
  if (r.workflow === "verified")
    return { text: "All details match", tone: "done" };
  if (r.category === "SI_REQUEST") return { text: "Send SI", tone: "unclear" };
  if (r.category === "INVOICE_QUERY")
    return { text: "Invoice question", tone: "unclear" };
  return { text: categoryWords(r.category), tone: "other" };
}
