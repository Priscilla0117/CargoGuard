import { z } from "zod";
import {
  FIELDS,
  PIPELINE_VERSION,
  type CaseResult,
  type CaseSummary,
} from "./types";
import { recomputeRows } from "./normalization";
import { selectedDocuments } from "./document-selection";

export interface FollowUp {
  email_id: string;
  version: number;
  case_version: number;
  owner: string;
  shipment_reference: string;
  due_at: string | null;
  state: "open" | "waiting" | "completed";
  note: string;
  actor: string;
  updated_at: string;
  created_at: string;
  completed_at: string | null;
}
const singleLine = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !/[\r\n\x00-\x1f]/.test(v), "Use a single line of text.");
export const followUpInput = z
  .object({
    id: z.string().min(1).max(80),
    case_version: z.number().int().positive().safe(),
    version: z.number().int().nonnegative().safe(),
    owner: singleLine(80).refine(
      (v) => v.length >= 2,
      "Enter the person responsible.",
    ),
    shipment_reference: singleLine(120),
    due_at: z
      .string()
      .datetime({ offset: true })
      .refine(
        (v) => Number.isFinite(Date.parse(v)),
        "Enter a valid deadline and UTC offset.",
      )
      .nullable(),
    state: z.enum(["open", "waiting", "completed"]),
    note: z.string().trim().min(5).max(2000),
    actor: singleLine(80).refine(
      (v) => v.length >= 2,
      "Enter who is recording this update.",
    ),
  })
  .strict();
export type FollowUpInput = z.infer<typeof followUpInput>;

/** Completion is a reviewed document check. It never authorizes cargo release. */
export function completionBlocker(result: CaseResult): string | null {
  if (result.pipeline_version !== PIPELINE_VERSION)
    return "Recheck this case with the current engine before completing the follow-up.";
  if (result.category !== "BL_COMPARISON")
    return "Only a completed SI / draft BL comparison can close a document follow-up.";
  if (result.classification.needs_review && !result.category_override)
    return "Confirm the uncertain email category before completing the follow-up.";
  if (
    result.workflow !== "verified" ||
    result.status !== "OK" ||
    result.review_reason ||
    result.has_defect ||
    result.defect_fields.length
  )
    return "Resolve every discrepancy and review blocker before completing the follow-up.";
  if (
    result.comparison.length !== FIELDS.length ||
    new Set(result.comparison.map((r) => r.field)).size !== FIELDS.length ||
    FIELDS.some((field) => !result.comparison.some((r) => r.field === field))
  )
    return "All seven fields need a complete comparison before completing the follow-up.";
  let pair;
  try {
    pair = result.document_selection
      ? selectedDocuments(result.documents, result.document_selection)
      : result.documents;
  } catch {
    return "Recheck the selected source documents before completing the follow-up.";
  }
  const si = pair.filter((doc) => doc.type === "SI");
  const bl = pair.filter((doc) => doc.type === "BL");
  if (
    pair.length !== 2 ||
    si.length !== 1 ||
    bl.length !== 1 ||
    pair.some((doc) => doc.error || !/^[a-f0-9]{64}$/.test(doc.sha256 ?? "")) ||
    result.comparison.some(
      (r) => r.si.source !== si[0].name || r.bl.source !== bl[0].name,
    )
  )
    return "The comparison must refer to the current readable SI and draft BL with recorded source fingerprints.";
  // Recompute from values using the same normalizer as the engine: a display
  // label or policy tolerance cannot turn missing/unequal evidence into a match.
  if (
    result.comparison.some(
      (r) =>
        r.result !== "match" ||
        !r.si.source ||
        !r.bl.source ||
        !r.si.evidence ||
        !r.bl.evidence,
    ) ||
    recomputeRows(result.comparison).some((r) => r.result !== "match")
  )
    return "All seven source-backed fields must match before completing the follow-up.";
  return null;
}

export function effectiveFollowUp(
  f: FollowUp,
  current: CaseSummary | CaseResult | null,
): FollowUp["state"] | "reopened" {
  const result = current && ("result" in current ? current.result : current);
  if (
    f.state !== "open" &&
    (!result ||
      f.case_version !== result.version ||
      result.pipeline_version !== PIPELINE_VERSION)
  )
    return "reopened";
  return f.state;
}

export function followUpOverdue(
  f: FollowUp,
  current: CaseSummary | CaseResult | null,
  now = Date.now(),
) {
  return (
    effectiveFollowUp(f, current) !== "completed" &&
    !!f.due_at &&
    Date.parse(f.due_at) < now
  );
}

export function followUpBrief(
  followups: FollowUp[],
  cases: CaseSummary[],
  now: string,
) {
  const byId = new Map(cases.map((row) => [row.email.email_id, row]));
  const rows = followups
    .map((f) => ({ f, row: byId.get(f.email_id) ?? null }))
    .sort(
      (a, b) =>
        (a.f.due_at ? Date.parse(a.f.due_at) : Infinity) -
          (b.f.due_at ? Date.parse(b.f.due_at) : Infinity) ||
        a.f.email_id.localeCompare(b.f.email_id),
    );
  return [
    "CARGOGUARD - FOLLOW-UP HANDOVER",
    `Snapshot: ${now}. Deadlines below are recorded by staff; all timestamps include UTC offsets.`,
    "Scope: this browser workspace. Names are self-declared, not authenticated team assignments.",
    "A completed follow-up covers the stated document revision only; it is not cargo-release approval.",
    "Awaiting reply is a staff record, not proof of sending. Nothing is sent by this export.",
    "",
    ...rows.flatMap(({ f, row }) => [
      `Case: ${f.email_id}; shipment reference: ${f.shipment_reference || "Not provided"}`,
      `Owner: ${f.owner}; state: ${effectiveFollowUp(f, row)}${followUpOverdue(f, row, Date.parse(now)) ? " (OVERDUE)" : ""}`,
      `Due: ${f.due_at ?? "Not provided"}; recorded case revision: ${f.case_version}; latest: ${row?.result?.version ?? "unavailable"}`,
      `Comparison: ${row?.result?.workflow ?? "unavailable"}; ${row?.result?.summary ?? "Reopen the case to inspect evidence."}`,
      `Note: ${f.note}`,
      `Recorded by: ${f.actor} at ${f.updated_at}; follow-up version ${f.version}`,
      "",
    ]),
    "Refresh before relying on this handover. Later replies and revisions are not included.",
  ].join("\n");
}
