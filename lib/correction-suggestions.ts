import { extract } from "./compare";
import { comparisonDocuments } from "./document-selection";
import { equivalent, sameAsConsignee } from "./normalization";
import { sourceBoundCorrection } from "./source-corrections";
import {
  PIPELINE_VERSION,
  type CaseResult,
  type Field,
  type FieldValue,
  type ParsedDocument,
} from "./types";

export interface ReadingSuggestion {
  value: string;
  source: string;
  evidence: string;
}

export interface BlAmendmentSuggestion extends ReadingSuggestion {
  current: string;
}

/** A suggestion must refer to the same current pair as the saved comparison. */
function currentSources(result: CaseResult, field: Field) {
  if (
    result.pipeline_version !== PIPELINE_VERSION ||
    result.category !== "BL_COMPARISON" ||
    (result.classification.needs_review && !result.category_override)
  )
    return null;
  const rows = result.comparison.filter((row) => row.field === field);
  if (rows.length !== 1) return null;
  try {
    const [si, bl] = comparisonDocuments(
      result.documents,
      result.document_selection,
    );
    const row = rows[0];
    for (const [side, doc] of [
      ["si", si],
      ["bl", bl],
    ] as const) {
      if (
        !doc.sha256 ||
        doc.deferred ||
        row[side].source !== doc.name ||
        (doc.recovery && doc.recovery.sha256 !== doc.sha256) ||
        (row[side].correction &&
          row[side].correction.source_sha256 !== doc.sha256)
      )
        return null;
    }
    return { row, si, bl };
  } catch {
    // Stale selections and ambiguous sources require choosing the pair first.
    return null;
  }
}

function supportedValue(doc: ParsedDocument, field: Field, value: FieldValue) {
  if (
    !value.raw.trim() ||
    value.issue ||
    value.extraction_issue ||
    value.normalized === null ||
    value.correction?.state === "unresolved"
  )
    return null;
  const supported = sourceBoundCorrection(doc, field, value);
  return supported.correction?.state === "confirmed" &&
    equivalent(field, supported.normalized, value.normalized)
    ? supported
    : null;
}

/** Recover a different reading only from this document's own established field
 * evidence. The other document is never a candidate for a reading correction. */
export function readingSuggestion(
  result: CaseResult,
  field: Field,
  side: "si" | "bl",
): ReadingSuggestion | null {
  const sources = currentSources(result, field);
  if (!sources) return null;
  const doc = sources[side];
  const candidate = extract(doc)[field];
  if (
    candidate.raw.trim() === sources.row[side].raw.trim() ||
    !supportedValue(doc, field, candidate)
  )
    return null;
  return {
    value: candidate.raw,
    source: doc.name,
    evidence: candidate.evidence,
  };
}

/** SI values are proposed instructions to the BL issuer, never replacement
 * readings or proof that the received BL has already been corrected. */
export function blAmendmentSuggestion(
  result: CaseResult,
  field: Field,
): BlAmendmentSuggestion | null {
  const sources = currentSources(result, field);
  if (!sources || sources.row.result !== "mismatch") return null;
  const { row, si, bl } = sources;
  const literal = (value: string) =>
    value.replace(/\s+/g, " ").trim().toUpperCase();
  // Equivalent references to the consignee need that party fixed, not the
  // wording of the reference (for example "SAME AS" versus "AS PER").
  if (
    literal(row.si.raw) === literal(row.bl.raw) ||
    (field === "notify_party" &&
      sameAsConsignee(row.si.raw) &&
      sameAsConsignee(row.bl.raw))
  )
    return null;
  if (!supportedValue(si, field, row.si) || !supportedValue(bl, field, row.bl))
    return null;
  return {
    value: row.si.raw,
    current: row.bl.raw,
    source: si.name,
    evidence: row.si.evidence,
  };
}
