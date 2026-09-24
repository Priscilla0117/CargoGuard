import {
  FIELDS,
  FIELD_LABELS,
  PIPELINE_VERSION,
  type CaseSummary,
} from "./types";

export const LANES = [
  "refresh",
  "amend",
  "recover",
  "request",
  "handoff",
  "routed",
] as const;
export type Lane = (typeof LANES)[number];
export const LANE_DETAILS: Record<
  Lane,
  { title: string; action: string; detail: string }
> = {
  refresh: {
    title: "Process / recheck",
    action: "Open to check",
    detail:
      "Unprocessed or older-engine cases. Do not rely on an outdated result.",
  },
  amend: {
    title: "Resolve differences",
    action: "Prepare amendment",
    detail:
      "Known differences in a completed comparison. Ask the issuer for a corrected draft BL.",
  },
  recover: {
    title: "Recover evidence",
    action: "Review missing or unclear details",
    detail:
      "Uncertain reading, document roles or routing. Confirm the source before deciding.",
  },
  request: {
    title: "Request documents",
    action: "Obtain SI + draft BL",
    detail:
      "Required evidence is missing. No document verification has completed.",
  },
  handoff: {
    title: "Comparison complete",
    action: "Inspect handoff",
    detail:
      "Seven-field document check passed. This is not cargo-release approval.",
  },
  routed: {
    title: "Other desks",
    action: "Inspect route",
    detail:
      "Classified only, not shipment-verified. No mailbox message has been sent.",
  },
};

/** Work queues, not predictions of commercial urgency or financial risk. */
export function laneFor(row: CaseSummary): Lane {
  const r = row.result;
  if (!r || r.pipeline_version !== PIPELINE_VERSION) return "refresh";
  if (
    (r.classification.needs_review && !r.category_override) ||
    r.review_reason === "uncertain_category"
  )
    return "recover";
  if (
    r.workflow === "awaiting_documents" ||
    r.review_reason === "missing_attachment"
  )
    return "request";
  if (r.workflow === "review" || r.status === "NEEDS_REVIEW") return "recover";
  if (r.category !== "BL_COMPARISON")
    return r.workflow === "routed" ? "routed" : "recover";
  if (
    r.workflow === "discrepancy" &&
    r.status === "MISMATCH" &&
    r.has_defect &&
    r.defect_fields.length
  )
    return "amend";
  if (
    r.workflow === "verified" &&
    r.status === "OK" &&
    !r.has_defect &&
    !r.defect_fields.length &&
    !r.review_reason
  )
    return "handoff";
  return "recover";
}

export function operationsSnapshot(cases: CaseSummary[]) {
  const lanes: Record<Lane, CaseSummary[]> = {
    refresh: [],
    amend: [],
    recover: [],
    request: [],
    handoff: [],
    routed: [],
  };
  const fieldCounts = Object.fromEntries(
    FIELDS.map((field) => [field, 0]),
  ) as Record<(typeof FIELDS)[number], number>;
  for (const row of cases) {
    const lane = laneFor(row);
    lanes[lane].push(row);
    if (lane === "amend")
      for (const field of new Set(row.result!.defect_fields))
        if (FIELDS.includes(field)) fieldCounts[field]++;
  }
  for (const lane of LANES)
    lanes[lane].sort((a, b) =>
      a.email.email_id.localeCompare(b.email.email_id),
    );
  return {
    total: cases.length,
    lanes,
    actionRequired:
      lanes.refresh.length +
      lanes.amend.length +
      lanes.recover.length +
      lanes.request.length,
    fieldCounts,
  };
}

export function shiftBrief(cases: CaseSummary[], createdAt: string): string {
  const snapshot = operationsSnapshot(cases);
  return [
    "CARGOGUARD - WORKSPACE SHIFT BRIEF",
    `Snapshot: ${createdAt}; comparison engine ${PIPELINE_VERSION}`,
    `Scope: ${snapshot.total} cases in this browser workspace; ${snapshot.actionRequired} need action.`,
    "Not an assignment, SLA, cargo-release permission or automatically sent message.",
    "Refresh the workspace before relying on this export. Later revisions are not included.",
    ...LANES.flatMap((lane) => [
      "",
      `${LANE_DETAILS[lane].title.toUpperCase()} (${snapshot.lanes[lane].length})`,
      LANE_DETAILS[lane].detail,
      ...snapshot.lanes[lane].map(
        ({ email, result }) =>
          `${email.email_id} | r${result?.version ?? 0} | ${email.subject.replace(/[\r\n]+/g, " ")} | ${result?.summary.replace(/[\r\n]+/g, " ") ?? "Not processed"}`,
      ),
    ]),
    "",
    "RECORDED DISCREPANCY PATTERNS (completed current-engine comparisons only)",
    ...FIELDS.map(
      (field) => `${FIELD_LABELS[field]}: ${snapshot.fieldCounts[field]} cases`,
    ),
    "Review cases can contain additional unresolved differences; these are not counted as completed comparisons.",
    "Counts are observed workload, not measured time or money saved.",
  ].join("\n");
}
