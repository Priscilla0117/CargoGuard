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
import { pdfCoverageIssue, unresolvedPdfPages } from "./pdf-coverage";

export interface Transcript {
  role: "SI" | "BL";
  fields: Record<Field, { value: string; page: number }>;
  actor: string;
  reason: string;
  confirmed_at: string;
  /** Original pages explicitly inspected, including every unread/image page. */
  reviewed_pages?: number[];
  source_sha256?: string;
}

export function canTranscribe(doc: ParsedDocument) {
  return (
    doc.format === "pdf" &&
    !!doc.sha256 &&
    doc.type !== "OTHER" &&
    (!!doc.transcription ||
      !!doc.error?.startsWith("Image-only scan:") ||
      (!!doc.pdf_coverage && !!doc.error?.startsWith("Unread PDF content:")))
  );
}

export function transcribeDocument(
  doc: ParsedDocument,
  transcript: Transcript,
): ParsedDocument {
  if (doc.type === "OTHER")
    throw new HttpError(
      "This source is a recognized invoice or other non-comparison document. Scan confirmation cannot turn it into an SI or draft BL. Upload the actual shipping documents.",
      422,
    );
  if (!canTranscribe(doc))
    throw new HttpError(
      "Only readable PDFs with pages requiring visual review can use scan confirmation. Replace corrupted or unsupported files.",
      422,
    );
  if (!doc.page_count)
    throw new HttpError(
      "Reprocess this case to validate the scan page count before confirming it.",
      409,
    );
  if (["SI", "BL"].includes(doc.type) && doc.type !== transcript.role)
    throw new HttpError(
      "The selected role conflicts with the original document heading. Review or replace the source.",
      422,
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
  if (transcript.source_sha256 && transcript.source_sha256 !== doc.sha256)
    throw new HttpError(
      "The confirmed pages belong to a different source. Review the current original.",
      409,
    );
  const reviewed = transcript.reviewed_pages;
  if (
    !reviewed ||
    new Set(reviewed).size !== reviewed.length ||
    reviewed.some(
      (page) => !Number.isInteger(page) || page < 1 || page > doc.page_count!,
    ) ||
    unresolvedPdfPages(doc).some((page) => !reviewed.includes(page))
  )
    throw new HttpError(
      "Inspect and confirm every flagged original page before saving the authoritative values.",
      422,
    );
  const result: ParsedDocument = {
    ...doc,
    type: transcript.role,
    error: undefined,
    method: "Human-confirmed scan transcription",
    transcription: {
      ...transcript,
      source_sha256: doc.sha256,
      reviewed_pages: [...reviewed],
    },
    // Keep all original readable evidence, including superseded values. extract()
    // reads the separately audited authoritative transcript without deleting it.
    lines: doc.lines,
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
  const coverageIssue = pdfCoverageIssue(result);
  if (coverageIssue) throw new HttpError(coverageIssue, 422);
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
