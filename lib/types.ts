import { emailInsight } from "./mail-intel";
export const CATEGORIES = [
  "BL_COMPARISON",
  "SI_REQUEST",
  "INVOICE_QUERY",
  "GENERAL",
  "SPAM",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const FIELDS = [
  "shipper",
  "consignee",
  "notify_party",
  "port_of_loading",
  "port_of_discharge",
  "container_count",
  "gross_weight_kg",
] as const;
export type Field = (typeof FIELDS)[number];
export const FIELD_LABELS: Record<Field, string> = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify_party: "Notify party",
  port_of_loading: "Port of loading",
  port_of_discharge: "Port of discharge",
  container_count: "Containers",
  gross_weight_kg: "Gross weight (kg)",
};
export type ReviewReason =
  | "wrong_doc_type"
  | "missing_attachment"
  | "unreadable"
  | "missing_value"
  | "uncertain_category";
export type Outcome = "OK" | "MISMATCH" | "NEEDS_REVIEW";
export type EmailSource =
  | "sample"
  | "upload"
  | "eml"
  | "gmail"
  | "imap"
  | "outlook";
export interface Email {
  email_id: string;
  from: string;
  subject: string;
  body: string;
  attachments: string[];
  /** When the mailbox received the message (ISO 8601). Absent for samples without a date. */
  received_at?: string;
  message_id?: string;
  in_reply_to?: string;
  references?: string[];
  to?: string[];
  cc?: string[];
  source?: EmailSource;
  /** Provider thread id (for example Gmail threadId); used only for grouping. */
  thread_hint?: string;
}
export interface SourceLine {
  text: string;
  location: string;
}
export interface ParsedDocument {
  name: string;
  type: "SI" | "BL" | "OTHER" | "UNKNOWN";
  format: string;
  lines: SourceLine[];
  error?: string;
  method: string;
  sha256?: string;
  page_count?: number;
  transcription?: import("./transcription").Transcript;
  recovery?: import("./recovery-schema").ConfirmedRecovery;
  label_rules?: {
    source_sha256: string;
    template_signature: string;
    aliases: { id: string; version: number; label: string; field: Field }[];
  };
}
export interface FieldValue {
  raw: string;
  normalized: string | number | null;
  evidence: string;
  source: string;
  method: string;
  issue?: string;
  extraction_issue?: string;
}
export type Extracted = Record<Field, FieldValue>;
export interface ComparisonRow {
  field: Field;
  si: FieldValue;
  bl: FieldValue;
  result: "match" | "mismatch" | "uncertain";
}
export interface Classification {
  category: Category;
  confidence: number;
  method: string;
  signals: string[];
  scores: Record<string, number>;
  needs_review?: boolean;
  review_note?: string;
}
export interface DocumentSelection {
  si: { name: string; sha256: string };
  bl: { name: string; sha256: string };
  actor: string;
  reason: string;
  selected_at: string;
}
export interface CaseResult {
  email: Email;
  category: Category;
  classification: Classification;
  status: Outcome;
  workflow:
    | "verified"
    | "discrepancy"
    | "review"
    | "awaiting_documents"
    | "routed";
  review_reason: ReviewReason | null;
  has_defect: boolean;
  defect_fields: Field[];
  summary: string;
  documents: ParsedDocument[];
  comparison: ComparisonRow[];
  duration_ms: number;
  processed_at: string;
  version: number;
  reviewed?: boolean;
  source_replaced?: boolean;
  document_selection?: DocumentSelection;
  category_override?: Category;
  pipeline_version?: string;
  policy?: import("./policy").PolicySnapshot;
  policy_assessment?: ReturnType<typeof import("./policy").assessPolicy>;
}
export type EmailSummary = Pick<
  Email,
  | "email_id"
  | "from"
  | "subject"
  | "attachments"
  | "received_at"
  | "message_id"
  | "in_reply_to"
  | "references"
  | "source"
  | "thread_hint"
> & { insight?: import("./mail-intel").EmailInsight };
export interface CaseSummary {
  email: EmailSummary;
  result: Omit<CaseResult, "email" | "documents" | "comparison"> | null;
}
export interface AuditEvent {
  id: string;
  email_id: string;
  action: string;
  actor: string;
  detail: string;
  created_at: string;
}
export const PIPELINE_VERSION = "3.3.1";
export function emailSummaryOf(email: Email): CaseSummary["email"] {
  const { email_id, from, subject, attachments } = email;
  const summary: EmailSummary = { email_id, from, subject, attachments };
  for (const key of [
    "received_at",
    "message_id",
    "in_reply_to",
    "references",
    "source",
    "thread_hint",
  ] as const)
    if (email[key] !== undefined)
      (summary as Record<string, unknown>)[key] = email[key];
  summary.insight = emailInsight(email);
  return summary;
}
export function summaryOf(result: CaseResult): CaseSummary {
  const { email, documents, comparison, ...rest } = result;
  void documents;
  void comparison;
  return { email: emailSummaryOf(email), result: rest };
}
