import { deriveResult, recomputeRows } from "./compare";
import type { CaseResult, ParsedDocument, SourceCorrection } from "./types";

function exactSource(
  documents: ParsedDocument[],
  name: string,
  sha256?: string,
) {
  const matches = documents.filter((doc) => doc.name === name);
  const doc = matches[0];
  return matches.length === 1 &&
    doc.sha256 &&
    (!sha256 || doc.sha256 === sha256)
    ? doc
    : undefined;
}

/** Preserve only current, uniquely identified sources; current corrections beat snapshots.
 * A newly confirmed transcription/recovery can supersede corrections for its own source.
 */
export function preserveSourceCorrections(
  previous: CaseResult,
  next: CaseResult,
  supersededSources: string[] = [],
): CaseResult {
  const saved = new Map<string, SourceCorrection>();
  const remember = (correction: SourceCorrection) => {
    if (
      supersededSources.includes(correction.name) ||
      correction.value.source !== correction.name ||
      !correction.value.method.startsWith("Human correction") ||
      !exactSource(previous.documents, correction.name, correction.sha256) ||
      !exactSource(next.documents, correction.name, correction.sha256)
    )
      return;
    saved.set(
      JSON.stringify([
        correction.field,
        correction.side,
        correction.name,
        correction.sha256,
      ]),
      structuredClone(correction),
    );
  };
  for (const correction of previous.retained_corrections ?? [])
    remember(correction);
  for (const row of previous.comparison)
    for (const side of ["si", "bl"] as const) {
      const value = row[side];
      const doc = exactSource(previous.documents, value.source);
      if (doc)
        remember({
          field: row.field,
          side,
          name: doc.name,
          sha256: doc.sha256!,
          value,
        });
    }
  const retained = [...saved.values()];
  const result = { ...next };
  delete result.retained_corrections;
  if (!retained.length) return result;
  result.retained_corrections = retained;
  result.reviewed = true;
  if (!result.comparison.length) return result;
  let applied = false;
  const rows = structuredClone(result.comparison);
  for (const row of rows)
    for (const side of ["si", "bl"] as const) {
      const doc = exactSource(result.documents, row[side].source);
      if (!doc || doc.type !== side.toUpperCase()) continue;
      const correction = saved.get(
        JSON.stringify([row.field, side, doc.name, doc.sha256]),
      );
      if (correction) {
        row[side] = structuredClone(correction.value);
        applied = true;
      }
    }
  if (!applied) return result;
  const updated = deriveResult(result, recomputeRows(rows));
  if (updated.document_selection) {
    const excluded = updated.documents.length - 2;
    updated.summary += ` Human-selected pair only; ${excluded} other attachment${excluded === 1 ? " is" : "s are"} retained but not verified.`;
  }
  return updated;
}
