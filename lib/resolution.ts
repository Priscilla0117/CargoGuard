import { explainMismatches } from "./mismatch-explainer";
import { FIELD_LABELS, type CaseResult } from "./types";

export interface ResolutionStep {
  title: string;
  detail: string;
  target: "documents" | "comparison" | "email" | "history";
}

/** A deterministic work instruction, never an LLM assertion or shipment approval. */
export function resolutionPlan(result: CaseResult) {
  const steps: ResolutionStep[] = [];
  const uncertain = result.comparison.filter(
    (row) => row.result === "uncertain",
  );
  const differences = result.comparison.filter(
    (row) => row.result === "mismatch",
  );
  if (
    result.classification.needs_review &&
    !result.category_override &&
    result.review_reason !== "uncertain_category"
  ) {
    steps.push({
      title: "Confirm the route as well as the source issue",
      detail:
        "The learned router is uncertain. Replacing a wrong attachment alone may not resolve this case: inspect the active email and confirm its category too.",
      target: "email",
    });
  }
  if (result.review_reason === "uncertain_category") {
    steps.push({
      title: "Confirm the current email request",
      detail:
        "Read the active message, not just its subject or quoted history. Confirm the category; mixed requests need a human decision before document checks.",
      target: "email",
    });
  } else if (
    result.workflow === "awaiting_documents" ||
    result.review_reason === "missing_attachment"
  ) {
    steps.push({
      title: "Obtain the missing shipment evidence",
      detail:
        "Request one authoritative Shipping Instruction and its corresponding draft Bill of Lading. No document verification has completed.",
      target: "documents",
    });
  } else if (result.review_reason === "unreadable") {
    steps.push({
      title: "Recover readable source evidence",
      detail:
        "Inspect each original file. Use local OCR and confirm all seven fields for supported scans; replace damaged, encrypted or unsupported sources with readable copies.",
      target: "documents",
    });
  } else if (result.review_reason === "wrong_doc_type") {
    steps.push({
      title: "Resolve document roles",
      detail:
        "Check that there is exactly one SI and one draft BL. An invoice, packing list, unknown extra file or duplicate role cannot substitute for either. Text-based evidence recovery can assist with unfamiliar layouts.",
      target: "documents",
    });
  }
  if (uncertain.length) {
    steps.push({
      title: `Confirm ${uncertain.length} uncertain field${uncertain.length === 1 ? "" : "s"} first`,
      detail: `${uncertain.map((row) => FIELD_LABELS[row.field]).join(", ")}. Inspect source evidence and units. Use evidence recovery for unfamiliar text layouts, or correct each value after reading the original. Missing values are not matches.`,
      target: "comparison",
    });
  }
  if (differences.length) {
    steps.push({
      title: `Resolve ${differences.length} observed difference${differences.length === 1 ? "" : "s"}`,
      detail: `${differences.map((row) => FIELD_LABELS[row.field]).join(", ")}. The SI is the reference. Ask the document issuer to amend the draft BL; do not edit an extracted value merely to hide a genuine discrepancy.${uncertain.length ? " These differences remain open while other fields are uncertain." : ""}`,
      target: "comparison",
    });
    steps.push({
      title: "Recheck the issuer’s corrected document",
      detail:
        "Use Replace documents with a reason, then inspect the recomputed comparison and revision history. An amendment request is not a resolved discrepancy.",
      target: "history",
    });
  }
  if (result.workflow === "verified") {
    steps.push({
      title: "Prepare the verified comparison for handoff",
      detail:
        "All seven compared fields match at this revision. Inspect the evidence and any human corrections before operational handoff. This is a document check, not permission to release cargo or make a payment.",
      target: "history",
    });
  } else if (result.workflow === "routed") {
    steps.push({
      title:
        result.category === "SPAM"
          ? "Keep the suspected spam isolated"
          : "Hand off to the appropriate desk",
      detail:
        result.category === "SPAM"
          ? "Do not open untrusted links or act on payment instructions. A human may inspect the source and correct a mistaken category."
          : "This message was routed, not shipment-verified. Confirm a misleading or mixed request before dismissing a document check.",
      target: "email",
    });
  }
  if (!steps.length) {
    steps.push({
      title: "Inspect the unresolved case",
      detail:
        "Review the email and original sources before taking any shipment action.",
      target: "documents",
    });
  }
  return {
    label:
      result.workflow === "verified"
        ? "Comparison complete"
        : result.workflow === "routed"
          ? "Routing only"
          : "Action required",
    steps,
    uncertain: uncertain.length,
    differences: differences.length,
  };
}

export function resolutionPacket(result: CaseResult): string {
  const plan = resolutionPlan(result);
  const explanations = explainMismatches(result.comparison);
  return [
    "CARGOGUARD — EVIDENCE HANDOFF / DRAFT",
    "Deterministic checklist; not an LLM response. Nothing has been sent.",
    "For authorised staff review, not cargo-release or payment approval.",
    `Case: ${result.email.email_id}`,
    `Subject: ${result.email.subject}`,
    `Revision: ${result.version}; engine: ${result.pipeline_version ?? "legacy"}`,
    `Processed: ${result.processed_at}`,
    `Category: ${result.category}; workflow: ${result.workflow}; exact verdict: ${result.status}`,
    `Human-reviewed: ${result.reviewed ? "yes" : "no"}; source replaced: ${result.source_replaced ? "yes" : "no"}`,
    `Policy: v${result.policy?.version ?? 0}; ${result.policy_assessment?.note ?? "No policy assessment recorded."}`,
    "Business tolerances do not change the exact seven-field verdict.",
    "",
    "NEXT ACTIONS",
    ...plan.steps.flatMap((step, index) => [
      `${index + 1}. ${step.title}`,
      step.detail,
      "",
    ]),
    "SOURCE FINGERPRINTS",
    ...result.documents.map(
      (doc) =>
        `${doc.name} | role ${doc.type} | SHA-256 ${doc.sha256 ?? "not recorded"}${doc.error ? ` | issue: ${doc.error}` : ""}`,
    ),
    "",
    "FIELD EVIDENCE (SI IS THE REFERENCE)",
    ...(result.comparison.length
      ? result.comparison.flatMap((row) => [
          `${FIELD_LABELS[row.field]}: ${row.result.toUpperCase()}`,
          ...(explanations[row.field]
            ? [
                `Why (${explanations[row.field]!.kind}): ${explanations[row.field]!.title}. ${explanations[row.field]!.detail}`,
              ]
            : []),
          `SI: ${row.si.raw || "[missing]"}`,
          `SI evidence: ${row.si.source}; ${row.si.evidence}; ${row.si.method}`,
          `Draft BL: ${row.bl.raw || "[missing]"}`,
          `BL evidence: ${row.bl.source}; ${row.bl.evidence}; ${row.bl.method}`,
          ...(row.si.issue ? [`SI uncertainty: ${row.si.issue}`] : []),
          ...(row.bl.issue ? [`BL uncertainty: ${row.bl.issue}`] : []),
          "",
        ])
      : ["No completed field comparison at this revision."]),
    "Only the active revision is represented. Reopen the case and audit trail to check for later changes.",
  ].join("\n");
}
