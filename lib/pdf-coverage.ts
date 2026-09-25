import { FIELDS, type ParsedDocument } from "./types";

function validCoverage(doc: ParsedDocument) {
  const coverage = doc.pdf_coverage;
  return (
    !!coverage &&
    coverage.version === 1 &&
    Number.isInteger(doc.page_count) &&
    doc.page_count! > 0 &&
    doc.page_count! <= 30 &&
    Array.isArray(coverage.pages) &&
    coverage.pages.length === doc.page_count &&
    coverage.pages.every(
      (entry, index) =>
        entry &&
        entry.page === index + 1 &&
        Number.isInteger(entry.text_items) &&
        entry.text_items >= 0 &&
        typeof entry.has_images === "boolean" &&
        typeof entry.requires_review === "boolean" &&
        (!(entry.has_images || !entry.text_items) || entry.requires_review),
    )
  );
}

/** Raw pages to inspect, also returned when a saved transcription resolved them. */
export function unresolvedPdfPages(doc: ParsedDocument): number[] {
  if (doc.format !== "pdf") return [];
  if (validCoverage(doc))
    return doc
      .pdf_coverage!.pages.filter((page) => page.requires_review)
      .map((page) => page.page);
  return Array.from(
    {
      length: Number.isInteger(doc.page_count)
        ? Math.min(Math.max(doc.page_count!, 0), 30)
        : 0,
    },
    (_, index) => index + 1,
  );
}

/** A field check cannot certify PDF content that was never read or inspected. */
export function pdfCoverageIssue(doc: ParsedDocument): string | null {
  if (doc.format !== "pdf") return null;
  if (!validCoverage(doc))
    return "PDF page coverage has not been checked. Reprocess the original document or request a readable replacement.";
  const unresolved = unresolvedPdfPages(doc);
  if (!unresolved.length) return null;
  const transcript = doc.transcription;
  const reviewed = transcript?.reviewed_pages;
  if (
    transcript &&
    transcript.source_sha256 === doc.sha256 &&
    transcript.role === doc.type &&
    typeof transcript.actor === "string" &&
    transcript.actor.trim().length >= 2 &&
    typeof transcript.reason === "string" &&
    transcript.reason.trim().length >= 5 &&
    Number.isFinite(Date.parse(transcript.confirmed_at)) &&
    Array.isArray(reviewed) &&
    new Set(reviewed).size === reviewed.length &&
    reviewed.every(
      (page) => Number.isInteger(page) && page >= 1 && page <= doc.page_count!,
    ) &&
    unresolved.every((page) => reviewed.includes(page)) &&
    transcript.fields &&
    FIELDS.every(
      (field) =>
        typeof transcript.fields[field]?.value === "string" &&
        !!transcript.fields[field].value.trim() &&
        Number.isInteger(transcript.fields[field].page) &&
        transcript.fields[field].page >= 1 &&
        transcript.fields[field].page <= doc.page_count!,
    )
  )
    return null;
  return `Unread PDF content: ${unresolved.length === 1 ? "Page" : "Pages"} ${unresolved.join(", ")} ${unresolved.length === 1 ? "needs" : "need"} visual review. Inspect every flagged page, including amendments, and confirm the authoritative values. Readable text has been preserved; the document is not verified.`;
}
