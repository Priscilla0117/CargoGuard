import {
  deriveResult,
  extract,
  fieldLabel,
  inlineLabelSplit,
  recomputeRows,
} from "./compare";
import { equivalent, resolveFields } from "./normalization";
import { evidenceHasLocation } from "./source-location";
import type {
  CaseResult,
  Field,
  FieldValue,
  ParsedDocument,
  SourceCorrection,
} from "./types";

/** A reading correction must agree with the field evidence in this exact source.
 * A typed wish is retained for review, never promoted to a document fact. */
export function sourceBoundCorrection(
  doc: ParsedDocument,
  field: Field,
  value: FieldValue,
): FieldValue {
  const fields = extract(doc);
  const original = fields[field];
  const proposed = resolveFields({
    ...fields,
    [field]: { ...original, raw: value.raw, extraction_issue: undefined },
  })[field];
  const labelEvidence = doc.lines.some((line) => {
    const label = (
      line.text.match(/^(.+?)[:：]/)?.[1] ??
      inlineLabelSplit(line.text)?.[1] ??
      line.text
    ).trim();
    return (
      evidenceHasLocation(original.evidence, line.location) &&
      (fieldLabel(label) === field ||
        (doc.label_rules &&
          doc.label_rules.source_sha256 === doc.sha256 &&
          doc.label_rules.aliases.some(
            (alias) =>
              alias.field === field && alias.label === label.toUpperCase(),
          )))
    );
  });
  const confirmedSource =
    !!doc.transcription ||
    (!!doc.recovery && doc.recovery.sha256 === doc.sha256);
  const supported =
    !doc.error &&
    !!doc.sha256 &&
    original.source === doc.name &&
    !!original.evidence &&
    (labelEvidence || confirmedSource) &&
    !original.issue &&
    equivalent(field, original.normalized, proposed.normalized);
  const issue = supported
    ? undefined
    : "This typed reading correction is not established by this field's original source evidence. Confirm the source using transcription or evidence recovery, or obtain a revised document. The original file has not changed.";
  return {
    ...value,
    source: doc.name,
    normalized: supported ? proposed.normalized : null,
    evidence: `${supported ? "Source-supported" : "Unconfirmed"} reading correction; original source: ${original.evidence}`,
    extraction_issue: issue,
    issue,
    correction: {
      source_sha256: doc.sha256 ?? "",
      state: supported ? "confirmed" : "unresolved",
    },
  };
}

/** Keep reviewed facts even when an intermediate revision has no comparison.
 * Only identical source identities survive; current field edits supersede their
 * saved snapshot, and a new transcription/recovery supersedes its own source. */
export function retainSourceCorrections(
  previous: CaseResult,
  next: CaseResult,
  options: { excludeSources?: string[]; sides?: ("si" | "bl")[] } = {},
): CaseResult {
  const snapshot = new Map<string, SourceCorrection>();
  const key = (entry: SourceCorrection) =>
    `${entry.side}:${entry.field}:${entry.source}:${entry.sha256}`;
  const unchanged = (entry: SourceCorrection) =>
    /^[a-f0-9]{64}$/.test(entry.sha256) &&
    !options.excludeSources?.includes(entry.source) &&
    (!options.sides || options.sides.includes(entry.side)) &&
    [previous, next].every((result) => {
      const sources = result.documents.filter(
        (doc) => doc.name === entry.source,
      );
      return sources.length === 1 && sources[0].sha256 === entry.sha256;
    });
  for (const entry of previous.retained_corrections ?? [])
    if (unchanged(entry)) snapshot.set(key(entry), structuredClone(entry));
  for (const row of previous.comparison)
    for (const side of ["si", "bl"] as const) {
      const value = row[side];
      if (!value.method.startsWith("Human correction")) continue;
      const doc = previous.documents.find((item) => item.name === value.source);
      if (!doc?.sha256) continue;
      const entry = {
        field: row.field,
        side,
        source: doc.name,
        sha256: doc.sha256,
        value,
      };
      if (unchanged(entry)) snapshot.set(key(entry), structuredClone(entry));
    }
  const entries = [...snapshot.values()].map((entry) => ({
    ...entry,
    value: sourceBoundCorrection(
      next.documents.find((doc) => doc.name === entry.source)!,
      entry.field,
      entry.value,
    ),
  }));
  let result: CaseResult = {
    ...next,
    retained_corrections: entries.length ? entries : undefined,
  };
  if (!entries.length) return result;
  result = { ...result, reviewed: true };
  if (!result.comparison.length) return result;
  const rows = structuredClone(result.comparison);
  for (const row of rows)
    for (const side of ["si", "bl"] as const) {
      const entry = entries.find(
        (item) =>
          item.side === side &&
          item.field === row.field &&
          item.source === row[side].source,
      );
      if (entry) row[side] = structuredClone(entry.value);
    }
  const recomputed = deriveResult(result, recomputeRows(rows));
  if (result.document_selection) {
    const excluded = result.documents.length - 2;
    recomputed.summary += ` Human-selected pair only; ${excluded} other attachment${excluded === 1 ? " is" : "s are"} retained but not verified.`;
  }
  return recomputed;
}
