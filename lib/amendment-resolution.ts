import { completionBlocker } from "./follow-up";
import { checkDocumentIntegrity } from "./integrity-checks";
import { recomputeRows } from "./normalization";
import {
  amendmentIncorporationCurrent,
  amendmentOriginalSupported,
  amendmentReconciliationBlocker,
  approvedComparison,
  revisedSiRequestBlocker,
  shipmentPair,
  shipmentStatus,
  type Shipment,
  type ShipmentAmendment,
} from "./shipments";
import {
  FIELDS,
  FIELD_LABELS,
  PIPELINE_VERSION,
  type CaseResult,
  type Field,
} from "./types";

export interface AmendmentResolutionRow {
  amendment_id: string;
  field: Field;
  expected_value: string;
  si_value: string;
  bl_value: string;
  state: "proposed" | "incorporated" | "reconcile" | "blocked" | "aligned";
  reason: string | null;
  can_reconcile: boolean;
  source_case: string;
  source_version: number;
  quote: string;
  incorporation?: ShipmentAmendment["incorporation"];
}

/** A live explanation, not a second authorization path. The server validates every mutation. */
export function amendmentResolution(shipment: Shipment, cases: CaseResult[]) {
  const comparison = cases.find(
    (c) =>
      c.email.email_id === shipment.comparison_case_id &&
      shipment.case_ids.includes(c.email.email_id),
  );
  const pair = comparison ? shipmentPair(comparison) : null;
  const completeRows =
    !!comparison &&
    comparison.comparison.length === FIELDS.length &&
    FIELDS.every(
      (f) => comparison.comparison.filter((r) => r.field === f).length === 1,
    );
  const strictRows = completeRows ? recomputeRows(comparison!.comparison) : [];
  const overlay = completeRows
    ? approvedComparison(shipment, comparison!, cases)
    : null;
  const active = shipment.amendments.filter((a) =>
    ["approved", "proposed"].includes(a.status),
  );
  const rows: AmendmentResolutionRow[] = active.map((a) => {
    const raw = comparison?.comparison.find((r) => r.field === a.field);
    const row: AmendmentResolutionRow = {
      amendment_id: a.id,
      field: a.field,
      expected_value: a.value,
      si_value: raw?.si.raw ?? "",
      bl_value: raw?.bl.raw ?? "",
      state: "blocked",
      reason: "Select a linked SI / BL comparison to inspect this instruction.",
      can_reconcile: false,
      source_case: a.source_case,
      source_version: a.source_version,
      quote: a.quote,
      incorporation: a.incorporation,
    };
    if (a.status === "proposed") {
      row.state = "proposed";
      row.reason =
        "A reviewer must approve or reject this email instruction first.";
    } else if (comparison && completeRows) {
      if (amendmentIncorporationCurrent(shipment, a, comparison, cases)) {
        row.state = "incorporated";
        row.reason =
          "A reviewer verified this instruction in the current revised SI.";
      } else {
        // Confirm actual document evidence, never merely a manually corrected display.
        const aligned = amendmentOriginalSupported(
          shipment,
          a,
          comparison,
          cases,
        );
        if (aligned) {
          row.state = "aligned";
          row.reason =
            "The original SI already supports this value under the comparison rules.";
        } else {
          row.reason = amendmentReconciliationBlocker(
            shipment,
            a,
            comparison,
            cases,
          );
          row.can_reconcile = row.reason === null;
          row.state = row.can_reconcile ? "reconcile" : "blocked";
        }
      }
    }
    return row;
  });
  const issues = strictRows
    .filter((r) => r.result !== "match")
    .map((r) => ({
      field: r.field,
      message:
        FIELD_LABELS[r.field] +
        (r.result === "uncertain"
          ? " needs source confirmation."
          : " differs between the selected SI and BL."),
    }));
  const blockers: string[] = rows
    .filter((r) => r.state === "blocked" || r.state === "proposed")
    .flatMap((r) => (r.reason ? [r.reason] : []));
  if (!comparison)
    blockers.push("Select the current linked SI / BL comparison.");
  else {
    const blocker = completionBlocker(comparison);
    if (blocker) blockers.push(blocker);
    if (overlay?.blocked) blockers.push(overlay.blocked);
    if (overlay?.rows.some((r) => r.result !== "match"))
      blockers.push(
        "The latest BL does not yet agree with every effective approved instruction.",
      );
    const integrity = checkDocumentIntegrity(comparison);
    for (const finding of integrity.findings.filter(
      (f) => f.status === "blocking",
    ))
      blockers.push(finding.title);
    if (integrity.findings.some((f) => f.status === "review"))
      blockers.push(
        "Inspect and acknowledge the independent advisory findings before sign-off.",
      );
  }
  const openTasks = shipment.tasks.filter((t) => t.state !== "done").length;
  if (openTasks)
    blockers.push(
      openTasks +
        " shipment task" +
        (openTasks === 1 ? " is" : "s are") +
        " still open.",
    );
  for (const id of shipment.case_ids) {
    const source = cases.find((c) => c.email.email_id === id);
    if (!source)
      blockers.push(
        "Linked case " + id + " is unavailable; refresh its evidence.",
      );
    else if (source.pipeline_version !== PIPELINE_VERSION)
      blockers.push("Recheck linked case " + id + " with the current engine.");
    else if (
      id !== comparison?.email.email_id &&
      source.classification.needs_review &&
      !source.category_override
    )
      blockers.push("Confirm the category of linked case " + id + ".");
  }
  let state:
    | "awaiting_selection"
    | "awaiting_decisions"
    | "awaiting_revised_si"
    | "ready_to_reconcile"
    | "needs_correction"
    | "needs_review"
    | "ready_for_signoff"
    | "completed";
  let headline: string;
  let next_action: string;
  if (!comparison) {
    state = "awaiting_selection";
    headline = "Choose the current document pair";
    next_action =
      "Link the latest SI and draft BL case, then select it as the shipment comparison.";
  } else if (rows.some((r) => r.state === "proposed")) {
    state = "awaiting_decisions";
    headline = "An instruction needs a decision";
    next_action =
      "Review the quoted email evidence and approve or reject each proposal.";
  } else if (rows.some((r) => r.can_reconcile)) {
    state = "ready_to_reconcile";
    headline = "The revised SI supports an approved change";
    next_action =
      "Inspect the replacement SI and record which instruction it incorporates. Any other BL discrepancies still need correction.";
  } else if (rows.some((r) => r.state === "blocked")) {
    const original = active.some(
      (a) => a.status === "approved" && a.si_sha256 === pair?.si?.sha256,
    );
    state = original ? "awaiting_revised_si" : "needs_review";
    headline = original
      ? "The instruction has not reached a revised SI"
      : "Instruction evidence needs attention";
    next_action = original
      ? "Draft a revised-SI request. When the issuer supplies it, upload it with the latest BL, link the case and select that comparison."
      : "Inspect the reason under each instruction. Recheck the revised SI or confirm a new instruction from current evidence.";
  } else if (issues.length) {
    state = "needs_correction";
    headline = rows.length
      ? "Instruction handled; the BL still needs attention"
      : "The latest BL needs correction";
    next_action =
      "Resolve the remaining field differences below. Incorporating an instruction does not complete the document check.";
  } else if (blockers.length) {
    state = "needs_review";
    headline = "Resolve the remaining sign-off checks";
    next_action =
      "Review the listed evidence, advisory findings and outstanding tasks before completing this shipment check.";
  } else if (shipmentStatus(shipment, cases) === "completed") {
    state = "completed";
    headline = "Document check completed for these revisions";
    next_action =
      "Later source revisions reopen the check. The decision brief records the evidence used for this sign-off.";
  } else {
    state = "ready_for_signoff";
    headline = "The document evidence is ready for sign-off";
    next_action =
      "A reviewer can inspect the current sources and complete the shipment document check.";
  }
  const requestBlocker = comparison
    ? revisedSiRequestBlocker(shipment, comparison, cases)
    : "Select a current SI / BL comparison first.";
  return {
    comparison_case_id: comparison?.email.email_id ?? null,
    comparison_version: comparison?.version ?? null,
    si_name: pair?.si?.name ?? null,
    bl_name: pair?.bl?.name ?? null,
    state,
    headline,
    next_action,
    rows,
    issues,
    blockers: [...new Set(blockers)],
    matched_fields: strictRows.filter((r) => r.result === "match").length,
    open_tasks: openTasks,
    can_request_revised_si: requestBlocker === null,
    request_blocker: requestBlocker,
  };
}

/** Evidence snapshot for handover; no dispatch or operational release is implied. */
export function amendmentResolutionBrief(
  shipment: Shipment,
  cases: CaseResult[],
  at: string,
) {
  const model = amendmentResolution(shipment, cases);
  const result = cases.find(
    (c) => c.email.email_id === model.comparison_case_id,
  );
  const pair = result ? shipmentPair(result) : null;
  return [
    "CARGOGUARD — AMENDMENT DECISION BRIEF",
    "Snapshot: " + at,
    "Shipment: " +
      shipment.title +
      " (" +
      shipment.id +
      "), revision " +
      shipment.version,
    "References: " + (shipment.references.join(", ") || "Not recorded"),
    "Status: " + model.headline,
    "Next action: " + model.next_action,
    "Selected comparison: " +
      (model.comparison_case_id ?? "None") +
      ", revision " +
      (model.comparison_version ?? "None"),
    "SI: " +
      (pair?.si?.name ?? "None") +
      "; SHA-256: " +
      (pair?.si?.sha256 ?? "Unavailable"),
    "BL: " +
      (pair?.bl?.name ?? "None") +
      "; SHA-256: " +
      (pair?.bl?.sha256 ?? "Unavailable"),
    "Strict SI / BL fields matching: " +
      model.matched_fields +
      " / " +
      FIELDS.length,
    "",
    ...model.rows.flatMap((r) => [
      FIELD_LABELS[r.field] + " — " + r.state,
      "Instruction: " + r.expected_value,
      "Evidence: " + r.source_case + " v" + r.source_version + ": " + r.quote,
      "Current SI: " + (r.si_value || "Not extracted"),
      "Current BL: " + (r.bl_value || "Not extracted"),
      "Explanation: " +
        (r.reason ??
          "Eligible for a reviewer to record incorporation into the revised SI."),
      ...(r.incorporation
        ? [
            "Recorded incorporation: " +
              r.incorporation.actor +
              " at " +
              r.incorporation.at +
              "; " +
              r.incorporation.case_id +
              " v" +
              r.incorporation.case_version +
              "; SI SHA-256 " +
              r.incorporation.si_sha256,
            "Reviewer reason: " + r.incorporation.reason,
            "Proof is current: " +
              (r.state === "incorporated"
                ? "Yes"
                : "No — recheck before relying on it"),
          ]
        : []),
      "",
    ]),
    "Remaining field issues:",
    ...(model.issues.length
      ? model.issues.map((i) => "- " + i.message)
      : ["None identified in the available complete comparison."]),
    "Sign-off checks:",
    ...(model.blockers.length
      ? model.blockers.map((b) => "- " + b)
        : ["No current blockers found for the selected revisions."]),
    "",
    "This snapshot may become stale. Refresh CargoGuard before acting. This is a document-verification record, not cargo-release authorization. No message has been sent by this export.",
  ].join("\n");
}
