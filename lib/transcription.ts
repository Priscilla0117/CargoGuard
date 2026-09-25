import { extract, analyze } from "./compare";
import { retainSourceCorrections } from "./source-corrections";
import { normalizeValue } from "./normalization";
import {
  FIELDS,
  FIELD_LABELS,
  type CaseResult,
  type Field,
  type ParsedDocument,
} from "./types";
import { HttpError } from "./http";
import { requireCurrentEngine } from "./review-guard";

export interface Transcript {
  role: "SI" | "BL";
  fields: Record<Field, { value: string; page: number }>;
  actor: string;
  reason: string;
  confirmed_at: string;
}

export function canTranscribe(doc: ParsedDocument) {
  return (
    doc.format === "pdf" &&
    !!doc.sha256 &&
    (!!doc.transcription || !!doc.error?.startsWith("Image-only scan:"))
  );
}

export function transcribeDocument(
  doc: ParsedDocument,
  transcript: Transcript,
): ParsedDocument {
  if (!canTranscribe(doc))
    throw new HttpError(
      "Only readable image-only PDFs can use scan confirmation. Replace corrupted or unsupported files.",
      422,
    );
  if (!doc.page_count)
    throw new HttpError(
      "Reprocess this case to validate the scan page count before confirming it.",
      409,
    );
  if (
    doc.page_count > 5 ||
    FIELDS.some(
      (f) =>
        transcript.fields[f].page > doc.page_count! ||
        transcript.fields[f].page < 1,
    )
  )
    throw new HttpError(
      "Every source page must exist; scan confirmation supports at most five pages.",
      422,
    );
  const result: ParsedDocument = {
    ...doc,
    type: transcript.role,
    error: undefined,
    method: "Human-confirmed scan transcription",
    transcription: transcript,
    lines: FIELDS.map((field) => ({
      text: `${FIELD_LABELS[field] === "Containers" ? "Container count" : FIELD_LABELS[field]}: ${transcript.fields[field].value}`,
      location: `Page ${transcript.fields[field].page}; ${FIELD_LABELS[field]}; human-confirmed`,
    })),
  };
  // Use the same dependency-aware normalization as machine extraction and edits.
  const fields = extract(result);
  for (const field of FIELDS) {
    if (fields[field].normalized === null)
      throw new HttpError(
        `${FIELD_LABELS[field]}: ${normalizeValue(field, transcript.fields[field].value).issue ?? "Confirm a complete value from the original page."}`,
        422,
      );
  }
  return result;
}

export function applyTranscript(
  previous: CaseResult,
  name: string,
  sha256: string,
  transcript: Transcript,
): CaseResult {
  requireCurrentEngine(previous);
  const doc = previous.documents.find((d) => d.name === name);
  if (!doc || doc.sha256 !== sha256)
    throw new HttpError(
      "Source changed. Reload the case and inspect the current document.",
      409,
    );
  const documents = previous.documents.map((d) =>
    d === doc ? transcribeDocument(d, transcript) : d,
  );
  let next = analyze(
    previous.email,
    documents,
    previous.duration_ms,
    previous.category_override,
    previous.policy,
    previous.document_selection,
  );
  next = retainSourceCorrections(previous, next, { excludeSources: [name] });
  return { ...next, reviewed: true, source_replaced: previous.source_replaced };
}
