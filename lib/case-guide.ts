import {
  FIELDS,
  FIELD_LABELS,
  PIPELINE_VERSION,
  type CaseResult,
  type ComparisonRow,
} from "./types";
import { resolutionPlan } from "./resolution";

export const GUIDE_QUESTIONS = {
  next: "What should I do next?",
  evidence: "Which evidence needs attention?",
  readiness: "Can I hand this over?",
  route: "Why was this email routed here?",
  privacy: "What does AI see?",
} as const;
export type GuideQuestion = keyof typeof GUIDE_QUESTIONS;
export interface GuideAnswer {
  title: string;
  paragraphs: string[];
  target: "comparison" | "documents" | "email" | "history";
  rows: ComparisonRow[];
}
export function comparisonComplete(r: CaseResult): boolean {
  return (
    r.pipeline_version === PIPELINE_VERSION &&
    r.category === "BL_COMPARISON" &&
    r.workflow === "verified" &&
    r.status === "OK" &&
    !r.has_defect &&
    !r.review_reason &&
    !r.defect_fields.length &&
    (!r.classification.needs_review || !!r.category_override) &&
    r.comparison.length === FIELDS.length &&
    FIELDS.every(
      (f) =>
        r.comparison.filter(
          (row) =>
            row.field === f &&
            row.result === "match" &&
            row.si.normalized !== null &&
            row.bl.normalized !== null &&
            !row.si.issue &&
            !row.bl.issue,
        ).length === 1,
    )
  );
}

export function answerCase(
  r: CaseResult,
  question: GuideQuestion,
): GuideAnswer {
  const plan = resolutionPlan(r);
  const stale = r.pipeline_version !== PIPELINE_VERSION;
  const attention = r.comparison.filter((row) => row.result !== "match");
  const prefix = stale
    ? [
        "This result uses an older engine. Reprocess the sources before relying on its conclusions.",
      ]
    : [];
  switch (question) {
    case "next":
      return {
        title: plan.label,
        paragraphs: [
          ...prefix,
          ...plan.steps.map((s) => `${s.title}. ${s.detail}`),
        ],
        target: stale ? "documents" : plan.steps[0].target,
        rows: [],
      };
    case "evidence":
      return {
        title: attention.length
          ? `${attention.length} field findings to inspect`
          : "Inspect the source evidence",
        paragraphs: [
          ...prefix,
          r.comparison.length
            ? "Values below come from this saved comparison, not a generated answer. SI is the reference. Source links open the original extracted lines; human corrections remain identifiable in the audit trail."
            : "There is no completed field comparison. Open Documents to resolve missing, unreadable or wrong-role sources; do not interpret absent findings as a match.",
        ],
        target: "documents",
        rows: attention.length ? attention : r.comparison,
      };
    case "readiness":
      return {
        title: comparisonComplete(r)
          ? "Document comparison complete; operational approval is separate"
          : "Do not treat this case as verified",
        paragraphs: [
          ...prefix,
          comparisonComplete(r)
            ? "All seven fields match in the current saved revision. Inspect the original sources and any human changes before handoff. CargoGuard does not approve cargo release, customs clearance, payments or legal compliance."
            : "Routing, a draft amendment, a policy tolerance or an AI proposal does not clear a case. Resolve the blockers and compare the corrected documents again.",
          `This is revision ${r.version}, processed ${r.processed_at}. Reload the case to check for changes made since it was opened.`,
        ],
        target: "history",
        rows: [],
      };
    case "route":
      return {
        title: `Recorded route: ${r.category}`,
        paragraphs: [
          ...prefix,
          `Method: ${r.classification.method}. The displayed model score is not a calibrated probability of correctness.`,
          ...(r.category_override
            ? [
                "A human category override is active. Inspect the audit trail for the reason.",
              ]
            : []),
          ...r.classification.signals.map((s) => `Recorded signal: ${s}`),
          "Read the active email, including possible mixed requests. Confirm category only after inspecting it; no email has been forwarded automatically.",
        ],
        target: "email",
        rows: [],
      };
    case "privacy":
      return {
        title: "Guidance here makes no external AI request",
        paragraphs: [
          "This navigator uses fixed, tested answers and your current case facts. It is not an LLM conversation and does not send your question or email elsewhere.",
          "The separate Evidence Recovery Copilot can send selected document text to OpenAI only after its explicit consent step. It returns source-quoted proposals; seven field confirmations and a reviewer reason are required to save them. Local OCR is a separate browser workflow.",
          "API limits still apply to the recovery copilot. No feature here changes the exact verdict or bypasses human review.",
        ],
        target: "documents",
        rows: [],
      };
  }
}

/** Draft contents never become case facts and never trigger a send/save. */
export function amendmentDraft(r: CaseResult): {
  available: boolean;
  reason: string;
  text: string;
  differences: number;
  unresolved: number;
} {
  const supportedDifference = (row: ComparisonRow) =>
    row.result === "mismatch" &&
    !row.si.issue &&
    !row.bl.issue &&
    row.si.normalized !== null &&
    row.bl.normalized !== null &&
    !!row.si.raw.trim() &&
    !!row.bl.raw.trim();
  const differences = r.comparison.filter(supportedDifference);
  const unresolvedRows = r.comparison.filter(
    (row) =>
      row.result === "uncertain" ||
      (row.result === "mismatch" && !supportedDifference(row)),
  );
  const unresolved = unresolvedRows.length;
  const blocked =
    r.pipeline_version !== PIPELINE_VERSION
      ? "Reprocess the older-engine result first."
      : r.comparison.length !== FIELDS.length ||
          !FIELDS.every(
            (field) =>
              r.comparison.filter((row) => row.field === field).length === 1,
          )
        ? "The seven-field comparison is incomplete. Reload or reprocess the case before drafting."
        : r.category !== "BL_COMPARISON" ||
            (r.classification.needs_review && !r.category_override) ||
            [
              "uncertain_category",
              "wrong_doc_type",
              "missing_attachment",
              "unreadable",
            ].includes(r.review_reason ?? "")
          ? "Confirm the route and authoritative SI / BL sources before requesting an amendment."
          : !differences.length
            ? "No supported difference to request. Recover uncertain values first; never invent an amendment."
            : "";
  if (blocked)
    return {
      available: false,
      reason: blocked,
      text: "",
      differences: 0,
      unresolved,
    };
  return {
    available: true,
    reason: "Review the entire draft and source evidence before sharing.",
    differences: differences.length,
    unresolved,
    text: [
      "DRAFT ONLY - REVIEW BEFORE SENDING. NOTHING HAS BEEN SENT.",
      `Subject: Draft BL corrections - ${r.email.email_id} - revision ${r.version}`,
      "",
      "Hello document team,",
      "",
      "Please check the following differences against the authoritative Shipping Instruction and return a corrected draft Bill of Lading.",
      "Values below are copied from the current saved comparison. If the SI itself is wrong, obtain an authorized revised SI; do not silently change the reference.",
      ...differences.flatMap((row, i) => [
        "",
        `${i + 1}. ${FIELD_LABELS[row.field]}`,
        `SI reference: ${row.si.raw}`,
        `Current draft BL: ${row.bl.raw}`,
        `SI evidence: ${row.si.source} | ${row.si.evidence}`,
        `BL evidence: ${row.bl.source} | ${row.bl.evidence}`,
      ]),
      ...(unresolved
        ? [
            "",
            `INCOMPLETE CHECK: ${unresolved} other field(s) still need human confirmation: ${unresolvedRows
              .map((row) => FIELD_LABELS[row.field])
              .join(", ")}.`,
            "This is a partial amendment request, not a complete list of possible issues. Supply readable source evidence for these fields too.",
          ]
        : []),
      "",
      "Please return the revised source document for a fresh seven-field comparison. This request does not resolve the discrepancy or authorize cargo release.",
      "",
      `Case ${r.email.email_id} | revision ${r.version} | engine ${r.pipeline_version}`,
      `Human review recorded: ${r.reviewed ? "yes; inspect audit trail for its scope" : "no"}.`,
      "Source fingerprints:",
      ...r.documents.map(
        (doc) =>
          `${doc.type} | ${doc.name} | SHA-256 ${doc.sha256 ?? "not recorded"}`,
      ),
      "This draft represents only this revision. Reload and regenerate if the case changes.",
    ].join("\n"),
  };
}
