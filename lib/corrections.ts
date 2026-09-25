import { deriveResult, recomputeRows } from "./compare";
import { normalizeValue } from "./normalization";
import { HttpError } from "./http";
import { requireCurrentEngine } from "./review-guard";
import type { CaseResult, Field } from "./types";
import {
  retainSourceCorrections,
  sourceBoundCorrection,
} from "./source-corrections";

export interface FieldCorrection {
  field: Field;
  side: "si" | "bl";
  value: string;
}

/** One implementation for the dry-run preview and the version-checked save. */
export function correctField(
  previous: CaseResult,
  edit: FieldCorrection,
  actor: string,
): CaseResult {
  requireCurrentEngine(previous);
  if (!previous.comparison.length)
    throw new HttpError(
      "This case requires readable SI and BL documents before field correction.",
      422,
    );
  const value = edit.value.trim();
  const normalized = normalizeValue(edit.field, value);
  if (value.length > 2000 || normalized.value === null)
    throw new HttpError(
      `Enter a complete, unambiguous field value within 2,000 characters. ${normalized.issue ?? ""}`.trim(),
      422,
    );
  const rows = structuredClone(previous.comparison);
  const row = rows.find((r) => r.field === edit.field);
  if (!row)
    throw new HttpError(
      "The selected field is not available for correction.",
      422,
    );
  const sources = previous.documents.filter(
    (doc) =>
      doc.name === row[edit.side].source &&
      doc.type === (edit.side === "si" ? "SI" : "BL"),
  );
  if (sources.length !== 1 || !sources[0].sha256 || sources[0].error)
    throw new HttpError(
      "The original source is unavailable or ambiguous. Recheck the documents before correcting a reading.",
      409,
    );
  row[edit.side] = sourceBoundCorrection(sources[0], edit.field, {
    ...row[edit.side],
    raw: value,
    method: `Human correction by ${actor}`,
  });
  const result = deriveResult(
    { ...previous, reviewed: true },
    recomputeRows(rows),
  );
  return retainSourceCorrections(result, result);
}

export function previewCorrection(previous: CaseResult, edit: FieldCorrection) {
  try {
    const result = correctField(previous, edit, "Preview only — not saved");
    const changes = result.comparison.map((row) => {
      const before = previous.comparison.find((r) => r.field === row.field)!;
      return {
        field: row.field,
        before: before.result,
        after: row.result,
        changed:
          before.result !== row.result ||
          before.si.normalized !== row.si.normalized ||
          before.bl.normalized !== row.bl.normalized,
      };
    });
    return { result, changes, error: null };
  } catch (e) {
    return {
      result: null,
      changes: [],
      error: e instanceof Error ? e.message : "Unable to preview this value.",
    };
  }
}
