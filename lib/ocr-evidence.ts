import { suggestScanFields } from "./ocr";
import {
  FIELDS,
  type Extracted,
  type Field,
  type ParsedDocument,
} from "./types";

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrBox;
}
export interface OcrLine {
  text: string;
  words: OcrWord[];
}
export interface OcrPage {
  page: number;
  width: number;
  height: number;
  lines: OcrLine[];
}
interface OcrOutput {
  text: string;
  blocks?: { paragraphs: { lines: OcrLine[] }[] }[] | null;
}
export interface FieldScanEvidence {
  /** Word recognition signals, never a probability that the shipment is correct. */
  mean: number | null;
  lowest: number | null;
  wordCount: number;
  regions: { page: number; box: OcrBox; words: OcrBox[] }[];
  issue: string | null;
}

/** Keep the same block-line order for text extraction and coordinate mapping. */
export function ocrPage(
  output: OcrOutput,
  page: number,
  width: number,
  height: number,
): OcrPage {
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Invalid OCR page dimensions.");
  if (output.text.length > 100000)
    throw new Error(
      "OCR output is too large for safe review. Replace the source.",
    );
  const lines =
    output.blocks
      ?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
      .filter((line) => line.text.trim()) ?? [];
  if (lines.reduce((count, line) => count + line.words.length, 0) > 20000)
    throw new Error(
      "OCR word output is too large for safe review. Replace the source.",
    );
  return {
    page,
    width,
    height,
    lines: lines.length
      ? lines
      : output.text.split(/\r?\n/).map((text) => ({ text, words: [] })),
  };
}

const tokens = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleUpperCase("en-US")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
const validBox = (box: OcrBox, page: OcrPage) =>
  [box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) &&
  box.x0 >= 0 &&
  box.y0 >= 0 &&
  box.x1 > box.x0 &&
  box.y1 > box.y0 &&
  box.x1 <= page.width &&
  box.y1 <= page.height;

function fieldEvidence(
  value: Extracted[Field],
  pages: OcrPage[],
): FieldScanEvidence {
  const empty = (issue: string): FieldScanEvidence => ({
    mean: null,
    lowest: null,
    wordCount: 0,
    regions: [],
    issue,
  });
  if (!value.raw.trim())
    return empty(
      "No value was located. Read this field from the original page.",
    );
  // Contradictory extraction is never summarized into a reassuring confidence.
  if (value.extraction_issue) return empty(value.extraction_issue);
  const wanted = tokens(value.raw);
  if (!wanted.length)
    return empty("No recognizable value tokens; inspect the original page.");
  const anchors = [...value.evidence.matchAll(/Page (\d+); OCR line (\d+)/g)];
  const groups: { page: OcrPage; words: OcrWord[] }[] = [];
  for (const anchor of anchors) {
    const page = pages.find((p) => p.page === Number(anchor[1]));
    const start = Number(anchor[2]) - 1;
    if (!page || start < 0 || start >= page.lines.length) continue;
    // Limit the search to the cited line plus the raw value's continuation lines.
    // This cannot borrow a matching number from an unrelated later field.
    const lines = page.lines.slice(
      start,
      start + value.raw.split(/\r?\n/).length + 1,
    );
    const stream = lines.flatMap((line, offset) =>
      line.words.flatMap((word) =>
        tokens(word.text).map((token) => ({
          token,
          word,
          line: start + offset,
        })),
      ),
    );
    for (let i = 0; i <= stream.length - wanted.length; i++) {
      if (stream[i].line > start + 1) break;
      if (!wanted.every((token, n) => stream[i + n].token === token)) continue;
      const words = [
        ...new Set(
          stream.slice(i, i + wanted.length).map((entry) => entry.word),
        ),
      ];
      if (
        words.every(
          (word) =>
            validBox(word.bbox, page) &&
            Number.isFinite(word.confidence) &&
            word.confidence >= 0 &&
            word.confidence <= 100,
        )
      )
        groups.push({ page, words });
      break;
    }
  }
  if (!groups.length)
    return empty(
      "Word coordinates could not be matched to this suggestion. Inspect the full original page; no field score is available.",
    );
  const scores = groups.flatMap((group) =>
    group.words.map((word) => word.confidence),
  );
  return {
    mean: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    lowest: Math.round(Math.min(...scores)),
    wordCount: scores.length,
    regions: groups.map(({ page, words }) => ({
      page: page.page,
      box: {
        x0: Math.max(0, Math.min(...words.map((w) => w.bbox.x0)) - 20),
        y0: Math.max(0, Math.min(...words.map((w) => w.bbox.y0)) - 16),
        x1: Math.min(page.width, Math.max(...words.map((w) => w.bbox.x1)) + 20),
        y1: Math.min(
          page.height,
          Math.max(...words.map((w) => w.bbox.y1)) + 16,
        ),
      },
      words: words.map((word) => word.bbox),
    })),
    issue:
      value.issue ??
      (value.normalized === null
        ? "The suggested value is uncertain. Confirm or correct it from the original page."
        : null),
  };
}

export function scanSuggestions(doc: ParsedDocument, pages: OcrPage[]) {
  const lines = pages.flatMap((page) =>
    page.lines.map((line, index) => ({
      text: line.text.trim(),
      location: `Page ${page.page}; OCR line ${index + 1}`,
    })),
  );
  const fields = suggestScanFields(doc, lines);
  const evidence = Object.fromEntries(
    FIELDS.map((field) => [field, fieldEvidence(fields[field], pages)]),
  ) as Record<Field, FieldScanEvidence>;
  return {
    fields,
    evidence,
    text: lines.map((line) => `${line.location}: ${line.text}`).join("\n"),
  };
}
