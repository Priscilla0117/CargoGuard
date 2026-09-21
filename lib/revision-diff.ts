import {
  FIELDS,
  type CaseResult,
  type ComparisonRow,
  type Field,
} from "./types";

export type ChangeKind =
  | "fixed"
  | "new_issue"
  | "unresolved"
  | "not_compared"
  | "now_checked"
  | "changed"
  | "unchanged";
export const CHANGE_LABELS: Record<ChangeKind, string> = {
  fixed: "Now matches",
  new_issue: "New issue",
  unresolved: "Still unresolved",
  not_compared: "Not compared now",
  now_checked: "Now checked",
  changed: "Values changed",
  unchanged: "Unchanged",
};
export interface FieldChange {
  field: Field;
  kind: ChangeKind;
  before?: ComparisonRow;
  after?: ComparisonRow;
  referenceChanged: boolean;
  valuesChanged: boolean;
}
function sameValue(a: ComparisonRow["si"], b: ComparisonRow["si"]) {
  return (
    a.raw === b.raw &&
    a.normalized === b.normalized &&
    a.issue === b.issue &&
    a.extraction_issue === b.extraction_issue
  );
}
function rows(result: CaseResult) {
  const map = new Map<Field, ComparisonRow>();
  for (const row of result.comparison) {
    if (!FIELDS.includes(row.field) || map.has(row.field))
      throw new Error("Revision has invalid or duplicate comparison fields.");
    map.set(row.field, row);
  }
  // A route-only decision must never appear as seven matching shipment fields.
  return result.category === "BL_COMPARISON"
    ? map
    : new Map<Field, ComparisonRow>();
}
function checked(row: ComparisonRow | undefined) {
  return (
    row?.result === "match" &&
    row.si.normalized !== null &&
    row.bl.normalized !== null &&
    !!row.si.raw.trim() &&
    !!row.bl.raw.trim() &&
    !row.si.issue &&
    !row.bl.issue &&
    !row.si.extraction_issue &&
    !row.bl.extraction_issue
  );
}

/** Compares saved decisions only. Does not rerun checks, contact AI, change a
 * case, or interpret a human edit as a correction to the original document. */
export function revisionDiff(before: CaseResult, after: CaseResult) {
  if (before.email.email_id !== after.email.email_id)
    throw new Error("Only revisions of the same case can be compared.");
  if (
    !Number.isSafeInteger(before.version) ||
    !Number.isSafeInteger(after.version) ||
    before.version < 1 ||
    after.version <= before.version
  )
    throw new Error(
      "Choose an earlier saved revision to compare with the current case.",
    );
  const previous = rows(before),
    current = rows(after);
  const pair = (r: CaseResult) =>
    JSON.stringify([
      r.document_selection?.si ?? null,
      r.document_selection?.bl ?? null,
    ]);
  const changes: FieldChange[] = FIELDS.map((field) => {
    const a = previous.get(field),
      b = current.get(field);
    const valuesChanged =
      !!a && !!b && (!sameValue(a.si, b.si) || !sameValue(a.bl, b.bl));
    const referenceChanged = !!a && !!b && !sameValue(a.si, b.si);
    let kind: ChangeKind;
    if (!b) kind = "not_compared";
    else if (!checked(b)) kind = checked(a) ? "new_issue" : "unresolved";
    else if (!a) kind = "now_checked";
    else if (!checked(a)) kind = "fixed";
    else kind = valuesChanged ? "changed" : "unchanged";
    return {
      field,
      kind,
      before: a,
      after: b,
      referenceChanged,
      valuesChanged,
    };
  });
  const counts = Object.fromEntries(
    Object.keys(CHANGE_LABELS).map((key) => [
      key,
      changes.filter((r) => r.kind === key).length,
    ]),
  ) as Record<ChangeKind, number>;
  return {
    changes,
    counts,
    referenceChanged: changes.some((r) => r.referenceChanged),
    categoryChanged: before.category !== after.category,
    engineChanged: before.pipeline_version !== after.pipeline_version,
    policyChanged: before.policy?.version !== after.policy?.version,
    documentPairChanged: pair(before) !== pair(after),
    remaining: changes.filter((r) => !checked(r.after)).length,
  };
}

export function revisionSourceUrl(result: CaseResult, name: string) {
  if (
    !Number.isSafeInteger(result.version) ||
    result.version < 1 ||
    !result.documents.some((d) => d.name === name)
  )
    return null;
  return `/api/document?id=${encodeURIComponent(result.email.email_id)}&name=${encodeURIComponent(name)}&revision=${result.version}`;
}
