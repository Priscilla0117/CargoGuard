import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDocument } from "../lib/parsers";
import { processEmail } from "../lib/processing";
import { analyze, deriveResult } from "../lib/compare";
import { completionBlocker, finishBlocker } from "../lib/follow-up";
import { checkDocumentIntegrity } from "../lib/integrity-checks";
import {
  applyTranscript,
  canTranscribe,
  type Transcript,
} from "../lib/transcription";
import { canRecover } from "../lib/recovery-schema";
import { selectedDocuments } from "../lib/document-selection";
import { pdfCoverageIssue, unresolvedPdfPages } from "../lib/pdf-coverage";
import { caseStatus } from "../lib/case-status";
import { FIELDS, type Email } from "../lib/types";

const values = [
  "ALPHA EXPORTS LTD",
  "BETA IMPORTS LTD",
  "SAME AS CONSIGNEE",
  "SINGAPORE",
  "PORT KLANG, MALAYSIA",
  "2 x 40HC",
  "42,000 KG",
];
const labels = [
  "Shipper",
  "Consignee",
  "Notify Party",
  "Port of Loading",
  "Port of Discharge",
  "Container Count",
  "Gross Weight",
];
const siBytes = new TextEncoder().encode(
  "SHIPPING INSTRUCTION\n" +
    values.map((v, i) => `${labels[i]}: ${v}`).join("\n"),
);
const fixture = (name: string) =>
  new Uint8Array(
    readFileSync(new URL(`./fixtures/pdf-coverage/${name}`, import.meta.url)),
  );
const email: Email = {
  email_id: "mixed-pdf-regression",
  from: "regression@example.test",
  subject: "Please compare the attached SI and draft BL",
  body: "Please verify all shipment fields and report any discrepancies.",
  attachments: ["si.txt", "bl-mixed.pdf"],
};
async function mixed() {
  return processEmail(email, async (path) =>
    path === "si.txt" ? siBytes : fixture(path),
  );
}
function confirmation(): Transcript {
  return {
    role: "BL",
    actor: "Synthetic reviewer",
    reason: "Inspected page 2 amendment superseding page 1 gross weight",
    confirmed_at: new Date().toISOString(),
    reviewed_pages: [2],
    fields: Object.fromEntries(
      FIELDS.map((field, i) => [
        field,
        {
          value: field === "gross_weight_kg" ? "43,000 KG" : values[i],
          page: field === "gross_weight_kg" ? 2 : 1,
        },
      ]),
    ) as Transcript["fields"],
  };
}

test("mixed PDF amendment cannot clear despite seven matching text-layer values", async () => {
  const result = await mixed();
  const bl = result.documents[1];
  assert.equal(bl.page_count, 2);
  assert.equal(bl.type, "BL");
  assert.ok(bl.lines.some((line) => line.text.includes("42,000")));
  assert.deepEqual(unresolvedPdfPages(bl), [2]);
  assert.equal(bl.pdf_coverage?.pages[1].has_images, true);
  assert.equal(result.comparison.length, 7);
  assert.equal(result.comparison[6].result, "match");
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.review_reason, "unreadable");
  assert.match(result.summary, /Page 2/);
  assert.ok(completionBlocker(result));
  assert.ok(finishBlocker(result));
  assert.equal(checkDocumentIntegrity(result).requires_attention, true);
  assert.equal(canTranscribe(bl), true);
  assert.equal(canRecover(bl), false);
  assert.equal(caseStatus(result).title, "Some PDF pages still need review");
  assert.match(caseStatus(result).detail, /page 2/);
  const provisionalDifference = structuredClone(result);
  provisionalDifference.comparison[0].result = "mismatch";
  assert.equal(caseStatus(provisionalDifference).action?.target, "documents");
});

test("clearing a display error or editing rows cannot bypass original page coverage", async () => {
  const original = await mixed();
  const result = structuredClone(original);
  delete result.documents[1].error;
  assert.equal(deriveResult(result, result.comparison).status, "NEEDS_REVIEW");
  assert.equal(analyze(result.email, result.documents).status, "NEEDS_REVIEW");
  const spoofed = {
    ...result,
    status: "OK" as const,
    workflow: "verified" as const,
    review_reason: null,
  };
  assert.ok(completionBlocker(spoofed));
  assert.equal(canRecover(result.documents[1]), false);
  assert.throws(() =>
    selectedDocuments(result.documents, {
      si: { name: "si.txt", sha256: result.documents[0].sha256! },
      bl: { name: "bl-mixed.pdf", sha256: result.documents[1].sha256! },
      actor: "Test reviewer",
      reason: "Trying a selected pair",
      selected_at: new Date().toISOString(),
    }),
  );
});

test("every unread page must be acknowledged, not merely the seven field values", async () => {
  const result = await mixed();
  const bl = result.documents[1];
  for (const reviewed_pages of [undefined, [], [1], [2, 2], [3]]) {
    assert.throws(
      () =>
        applyTranscript(result, bl.name, bl.sha256!, {
          ...confirmation(),
          reviewed_pages,
        }),
      /every flagged original page/,
    );
  }
});

test("confirming the scanned 43000 KG amendment reruns comparison and retains source evidence", async () => {
  const result = await mixed();
  const bl = result.documents[1];
  const sourceLines = structuredClone(bl.lines);
  const confirmed = applyTranscript(
    result,
    bl.name,
    bl.sha256!,
    confirmation(),
  );
  assert.equal(confirmed.status, "MISMATCH");
  assert.deepEqual(confirmed.defect_fields, ["gross_weight_kg"]);
  assert.equal(confirmed.comparison[6].bl.normalized, 43000);
  assert.match(confirmed.comparison[6].bl.evidence, /Page 2/);
  assert.deepEqual(confirmed.documents[1].lines, sourceLines);
  assert.deepEqual(confirmed.documents[1].transcription?.reviewed_pages, [2]);
  assert.equal(confirmed.documents[1].transcription?.source_sha256, bl.sha256);
  assert.equal(pdfCoverageIssue(confirmed.documents[1]), null);
  assert.ok(completionBlocker(confirmed));
  const replayed = await processEmail(
    email,
    async (path) => (path === "si.txt" ? siBytes : fixture(path)),
    confirmed,
  );
  assert.equal(replayed.status, "MISMATCH");
  assert.deepEqual(
    replayed.documents[1].transcription,
    confirmed.documents[1].transcription,
  );
});

test("old or source-mismatched page confirmations cannot certify current PDF coverage", async () => {
  const result = await mixed();
  const confirmed = applyTranscript(
    result,
    result.documents[1].name,
    result.documents[1].sha256!,
    confirmation(),
  );
  const source = confirmed.documents[1];
  delete source.transcription!.reviewed_pages;
  assert.ok(pdfCoverageIssue(source));
  const replayed = await processEmail(
    email,
    async (path) => (path === "si.txt" ? siBytes : fixture(path)),
    confirmed,
  );
  assert.equal(replayed.status, "NEEDS_REVIEW");
  source.transcription!.reviewed_pages = [2];
  source.transcription!.source_sha256 = "0".repeat(64);
  assert.ok(pdfCoverageIssue(source));
});

test("text amendments still conflict and image-only documents still require explicit review", async () => {
  const si = await parseDocument("si.txt", siBytes);
  const text = await parseDocument(
    "bl-text-amendment.pdf",
    fixture("bl-text-amendment.pdf"),
  );
  assert.equal(pdfCoverageIssue(text), null);
  assert.equal(analyze(email, [si, text]).status, "NEEDS_REVIEW");
  const scan = await parseDocument(
    "bl-scan-only.pdf",
    fixture("bl-scan-only.pdf"),
  );
  assert.equal(canTranscribe(scan), true);
  assert.equal(canRecover(scan), false);
  assert.deepEqual(unresolvedPdfPages(scan), [1]);
  assert.equal(analyze(email, [si, scan]).status, "NEEDS_REVIEW");
});

test("missing or inconsistent coverage cannot be treated as a fully read PDF", async () => {
  const { documents } = await mixed();
  const source = structuredClone(documents[1]);
  delete source.pdf_coverage;
  assert.match(pdfCoverageIssue(source)!, /Reprocess/);
  source.pdf_coverage = {
    version: 1,
    pages: [
      { page: 1, text_items: 8, has_images: false, requires_review: false },
    ],
  };
  assert.ok(pdfCoverageIssue(source));
  source.pdf_coverage.pages.push({
    page: 2,
    text_items: 0,
    has_images: true,
    requires_review: false,
  });
  assert.ok(pdfCoverageIssue(source));
});

test("rechecking an old AI recovery keeps the mixed PDF manual-review route available", async () => {
  const previous = await mixed();
  const bl = previous.documents[1];
  bl.recovery = {
    proposal_id: "legacy-text-only-recovery",
    sha256: bl.sha256!,
    text_sha256: "0".repeat(64),
    role: "BL",
    fields: Object.fromEntries(
      FIELDS.map((field, index) => [
        field,
        {
          value: values[index],
          citations: [{ line: index + 2, quote: values[index] }],
          unit_citation: null,
        },
      ]),
    ) as NonNullable<typeof bl.recovery>["fields"],
    provider: "openai",
    model: "synthetic-legacy-model",
    prompt_version: "evidence-selectors-v3",
    actor: "Synthetic reviewer",
    reason: "Legacy text-only review",
    confirmed_at: new Date().toISOString(),
  };
  const rechecked = await processEmail(
    email,
    async (path) => (path === "si.txt" ? siBytes : fixture(path)),
    previous,
  );
  assert.equal(rechecked.status, "NEEDS_REVIEW");
  assert.match(rechecked.documents[1].error!, /Unread PDF content/);
  assert.equal(canTranscribe(rechecked.documents[1]), true);
  assert.equal(rechecked.documents[1].recovery, undefined);
});
