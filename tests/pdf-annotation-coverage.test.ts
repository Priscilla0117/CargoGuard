import test from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "../lib/parsers";
import { analyze } from "../lib/compare";
import { completionBlocker } from "../lib/follow-up";
import {
  applyTranscript,
  canTranscribe,
  type Transcript,
} from "../lib/transcription";
import { canRecover } from "../lib/recovery-schema";
import { pdfCoverageIssue, unresolvedPdfPages } from "../lib/pdf-coverage";
import { FIELDS, type Email } from "../lib/types";

const rows = [
  "DRAFT BILL OF LADING",
  "Shipper: ALPHA EXPORTS LTD",
  "Consignee: BETA IMPORTS LTD",
  "Notify Party: SAME AS CONSIGNEE",
  "Port of Loading: SINGAPORE",
  "Port of Discharge: PORT KLANG, MALAYSIA",
  "Container Count: 2 x 40HC",
  "Gross Weight: 42,000 KG",
];
const email: Email = {
  email_id: "pdf-visual-content-regression",
  from: "review@example.test",
  subject: "Please compare the attached SI and draft BL",
  body: "Please verify all shipment fields and report discrepancies.",
  attachments: ["si.txt", "bl.pdf"],
};

/** Real PDF bytes exercise PDF.js operator and annotation discovery. The tiny
 * RGB image intentionally has no text layer: its content must stay unverified
 * even when this same page has seven readable fields and a readable footer. */
function pdfBytes({
  annotation,
  image = false,
  beforeText = "",
  afterText = "",
  heading = rows[0],
}: {
  annotation?: string;
  image?: boolean;
  beforeText?: string;
  afterText?: string;
  heading?: string;
} = {}) {
  const content =
    beforeText +
    "\n" +
    "BT /F1 10 Tf 50 30 Td (Page 1 of 1) Tj ET\n" +
    "BT /F1 12 Tf 50 750 Td " +
    [heading, ...rows.slice(1)]
      .map((line, index) => `${index ? "0 -25 Td " : ""}(${line}) Tj`)
      .join("\n") +
    " ET\n" +
    (image ? "q 60 0 0 20 50 520 cm /Im1 Do Q\n" : "") +
    afterText;
  const pixels = "000000ff0000ff0000000000>";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> ${image ? "/XObject << /Im1 7 0 R >>" : ""} >> /Contents 5 0 R ${annotation ? "/Annots [6 0 R]" : ""} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    annotation ?? "null",
    `<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${pixels.length} >>\nstream\n${pixels}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

async function compare(bytes: Uint8Array) {
  const si = await parseDocument(
    "si.txt",
    new TextEncoder().encode(
      rows.join("\n").replace("DRAFT BILL OF LADING", "SHIPPING INSTRUCTION"),
    ),
  );
  const bl = await parseDocument("bl.pdf", bytes);
  return { bl, result: analyze(email, [si, bl]) };
}

function assertReviewRequired({
  bl,
  result,
}: Awaited<ReturnType<typeof compare>>) {
  assert.equal(bl.page_count, 1);
  assert.deepEqual(unresolvedPdfPages(bl), [1]);
  assert.ok(pdfCoverageIssue(bl));
  // The readable fields agree, but they do not certify visual content.
  assert.equal(result.comparison.length, 7);
  assert.ok(result.comparison.every((row) => row.result === "match"));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.review_reason, "unreadable");
  assert.ok(completionBlocker(result));
  assert.equal(canTranscribe(bl), true);
  assert.equal(canRecover(bl), false);
}

test("a strike-through withdrawing a matching weight requires visual review", async () => {
  const result = await compare(
    pdfBytes({
      annotation:
        "<< /Type /Annot /Subtype /StrikeOut /Rect [50 570 230 590] /QuadPoints [50 590 230 590 50 570 230 570] /C [1 0 0] /Contents (Gross weight withdrawn; issuer clarification pending.) >>",
    }),
  );
  assert.equal(result.bl.pdf_coverage?.pages[0].has_images, false);
  assertReviewRequired(result);
});

test("a plain navigation link does not force otherwise readable PDF fields into review", async () => {
  const { bl, result } = await compare(
    pdfBytes({
      annotation:
        "<< /Type /Annot /Subtype /Link /Rect [50 25 200 40] /Border [0 0 0] /A << /S /URI /URI (https://example.test/shipping) >> >>",
    }),
  );
  assert.equal(pdfCoverageIssue(bl), null);
  assert.deepEqual(unresolvedPdfPages(bl), []);
  assert.equal(result.comparison.length, 7);
  assert.ok(result.comparison.every((row) => row.result === "match"));
  assert.equal(result.status, "OK");
  assert.equal(result.workflow, "verified");
  assert.equal(completionBlocker(result), null);
  assert.equal(canTranscribe(bl), false);
});

test("a link containing an amendment comment is not treated as plain navigation", async () => {
  assertReviewRequired(
    await compare(
      pdfBytes({
        annotation:
          "<< /Type /Annot /Subtype /Link /Rect [50 25 200 40] /Contents (Amend gross weight to 43000 KG.) /A << /S /URI /URI (https://example.test/shipping) >> >>",
      }),
    ),
  );
});

test("same-page image content cannot hide behind matching fields and a readable footer", async () => {
  const result = await compare(pdfBytes({ image: true }));
  assert.ok(result.bl.lines.some((line) => line.text === "Page 1 of 1"));
  assert.ok((result.bl.pdf_coverage?.pages[0].text_items ?? 0) > 7);
  assert.equal(result.bl.pdf_coverage?.pages[0].has_images, true);
  assertReviewRequired(result);
});

test("a painted rectangle hiding a matching weight requires visual review", async () => {
  const result = await compare(
    pdfBytes({
      afterText: "q 0 0 0 rg 50 570 200 18 re f Q",
    }),
  );
  assert.equal(result.bl.pdf_coverage?.pages[0].has_images, false);
  assert.match(
    result.bl.pdf_coverage?.pages[0].reason ?? "",
    /shapes or lines after readable text/,
  );
  assertReviewRequired(result);
});

test("a painted stroke crossing out a matching weight requires visual review", async () => {
  const result = await compare(
    pdfBytes({
      afterText: "q 1 0 0 RG 2 w 50 578 m 250 578 l S Q",
    }),
  );
  assertReviewRequired(result);
});

test("a background painted before any text does not imply an overlay", async () => {
  const { bl, result } = await compare(
    pdfBytes({
      beforeText: "q 1 1 1 rg 0 0 600 800 re f Q",
    }),
  );
  assert.equal(pdfCoverageIssue(bl), null);
  assert.deepEqual(unresolvedPdfPages(bl), []);
  assert.equal(result.status, "OK");
  assert.equal(completionBlocker(result), null);
});

function confirmFields(role: "SI" | "BL"): Transcript {
  return {
    role,
    actor: "Synthetic reviewer",
    reason: "Inspected original page and each authoritative source value",
    confirmed_at: new Date().toISOString(),
    reviewed_pages: [1],
    fields: Object.fromEntries(
      FIELDS.map((field, index) => [
        field,
        {
          value: rows[index + 1].split(": ").slice(1).join(": "),
          page: 1,
        },
      ]),
    ) as Transcript["fields"],
  };
}

test("a recognized invoice with image content cannot be promoted to an SI or draft BL", async () => {
  const { bl: invoice, result } = await compare(
    pdfBytes({
      heading: "COMMERCIAL INVOICE",
      image: true,
    }),
  );
  assert.equal(invoice.type, "OTHER");
  assert.ok(pdfCoverageIssue(invoice));
  assert.equal(canTranscribe(invoice), false);
  for (const role of ["SI", "BL"] as const)
    assert.throws(
      () =>
        applyTranscript(
          result,
          invoice.name,
          invoice.sha256!,
          confirmFields(role),
        ),
      /recognized invoice or other non-comparison document/,
    );
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.ok(completionBlocker(result));
});

test("an unidentified scan stays recoverable with an explicit confirmed role", async () => {
  const { bl: scan, result } = await compare(
    pdfBytes({
      heading: "UNIDENTIFIED ATTACHMENT",
      image: true,
    }),
  );
  assert.equal(scan.type, "UNKNOWN");
  assert.equal(canTranscribe(scan), true);
  const confirmed = applyTranscript(
    result,
    scan.name,
    scan.sha256!,
    confirmFields("BL"),
  );
  assert.equal(confirmed.documents[1].type, "BL");
  assert.deepEqual(confirmed.documents[1].transcription?.reviewed_pages, [1]);
  assert.equal(
    confirmed.documents[1].transcription?.source_sha256,
    scan.sha256,
  );
  assert.equal(pdfCoverageIssue(confirmed.documents[1]), null);
  assert.equal(confirmed.status, "OK");
});
