import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ocrPage,
  scanSuggestions,
  type OcrLine,
  type OcrPage,
} from "../lib/ocr-evidence";
import { analyze, extract } from "../lib/compare";
import type { Email, ParsedDocument } from "../lib/types";

const scan: ParsedDocument = {
  name: "scan.pdf",
  format: "pdf",
  type: "UNKNOWN",
  lines: [],
  error: "Image-only scan: no text layer.",
  method: "PDF text",
  sha256: "a".repeat(64),
  page_count: 2,
};
function line(text: string, y: number, confidences: number[] = []): OcrLine {
  return {
    text,
    words: text
      .split(/\s+/)
      .map((text, i) => ({
        text,
        confidence: confidences[i] ?? 95,
        bbox: { x0: 20 + i * 80, x1: 90 + i * 80, y0: y, y1: y + 25 },
      })),
  };
}
const page = (lines: OcrLine[], n = 1): OcrPage => ({
  page: n,
  width: 1600,
  height: 2000,
  lines,
});

test("OCR confidence uses only actual supporting value words, not the label or page average", () => {
  const found = scanSuggestions(scan, [
    page([
      line("Port of loading: SINGAPORE", 20, [5, 8, 9, 81]),
      line("Vessel: EXAMPLE", 60, [100, 100]),
    ]),
  ]);
  assert.equal(found.fields.port_of_loading.raw, "SINGAPORE");
  assert.deepEqual(
    {
      mean: found.evidence.port_of_loading.mean,
      lowest: found.evidence.port_of_loading.lowest,
      count: found.evidence.port_of_loading.wordCount,
    },
    { mean: 81, lowest: 81, count: 1 },
  );
  assert.equal(found.evidence.port_of_loading.regions[0].words[0].x0, 260);
});
test("multiline company values map every word and retain the weakest recognition signal", () => {
  const found = scanSuggestions(scan, [
    page([
      line("Shipper: ALPHA EXPORTS", 20, [99, 90, 80]),
      line("12 INDUSTRIAL ROAD", 60, [40, 90, 90]),
      line("Consignee: BETA", 100),
    ]),
  ]);
  assert.equal(found.evidence.shipper.wordCount, 5);
  assert.equal(found.evidence.shipper.mean, 78);
  assert.equal(found.evidence.shipper.lowest, 40);
  assert.equal(found.evidence.shipper.regions[0].box.y1, 101);
});
test("OCR source crops retain page mapping and clamp context padding to the page", () => {
  const found = scanSuggestions(scan, [
    page([line("Vessel: EXAMPLE", 20)]),
    page([line("Gross weight: 42,000 KG", 2)], 2),
  ]);
  assert.equal(found.fields.gross_weight_kg.normalized, 42000);
  assert.equal(found.evidence.gross_weight_kg.regions[0].page, 2);
  assert.equal(found.evidence.gross_weight_kg.regions[0].box.y0, 0);
});
test("uncertain OCR digits are neither guessed nor represented as confirmed values", () => {
  const found = scanSuggestions(scan, [
    page([line("Gross weight: 42.OOO KG", 20)]),
  ]);
  assert.equal(found.fields.gross_weight_kg.raw, "42.OOO KG");
  assert.equal(found.fields.gross_weight_kg.normalized, null);
  assert.ok(found.evidence.gross_weight_kg.issue);
  assert.equal(scan.transcription, undefined);
});
test("missing coordinates or invalid confidence never fall back to document confidence", () => {
  const noWords = ocrPage(
    { text: "Gross weight: 42000 KG", blocks: null },
    1,
    1600,
    2000,
  );
  assert.equal(
    scanSuggestions(scan, [noWords]).evidence.gross_weight_kg.mean,
    null,
  );
  const invalid = page([line("Gross weight: 42000 KG", 20, [90, 90, NaN, 90])]);
  assert.equal(
    scanSuggestions(scan, [invalid]).evidence.gross_weight_kg.mean,
    null,
  );
  invalid.lines[0].words[2].confidence = 101;
  assert.equal(
    scanSuggestions(scan, [invalid]).evidence.gross_weight_kg.mean,
    null,
  );
});
test("invalid coordinates and header-inherited units do not produce fabricated field evidence", () => {
  const invalid = page([line("Gross weight: 42000 KG", 20)]);
  invalid.lines[0].words[2].bbox.x1 = 9999;
  assert.equal(
    scanSuggestions(scan, [invalid]).evidence.gross_weight_kg.mean,
    null,
  );
  const inherited = scanSuggestions(scan, [
    page([line("Gross weight (MT): 42", 20)]),
  ]);
  assert.equal(inherited.fields.gross_weight_kg.normalized, 42000);
  assert.equal(inherited.evidence.gross_weight_kg.mean, null);
});
test("contradictory OCR fields have no reassuring aggregate confidence", () => {
  const found = scanSuggestions(scan, [
    page([
      line("Gross weight: 42000 KG", 20),
      line("Gross weight: 43000 KG", 70),
    ]),
  ]);
  assert.match(found.evidence.gross_weight_kg.issue!, /Conflicting/);
  assert.equal(found.evidence.gross_weight_kg.mean, null);
});
test("block lines determine both text and evidence order; OCR inputs remain bounded", () => {
  const p = ocrPage(
    {
      text: "different page text order",
      blocks: [
        { paragraphs: [{ lines: [line("Port of loading: SINGAPORE", 20)] }] },
      ],
    },
    1,
    1600,
    2000,
  );
  assert.equal(
    scanSuggestions(scan, [p]).fields.port_of_loading.raw,
    "SINGAPORE",
  );
  assert.throws(
    () => ocrPage({ text: "x".repeat(100001) }, 1, 1600, 2000),
    /too large/,
  );
  assert.throws(() => ocrPage({ text: "test" }, 0, 1600, 2000), /dimensions/);
  assert.throws(() => ocrPage({ text: "test" }, 1, NaN, 2000), /dimensions/);
});

const referenceLines = [
  "Shipper: ALPHA EXPORTS",
  "Consignee: BETA IMPORTS",
  "Notify party: SAME AS CONSIGNEE",
  "Port of loading: SINGAPORE",
  "Port of discharge: PORT KLANG",
  "Container count: 2 x 40HC",
  "Gross weight: 42000 KG",
];
const doc = (extra: string[], type: "SI" | "BL" = "BL"): ParsedDocument => ({
  name: `${type}.txt`,
  type,
  format: "txt",
  method: "Text",
  sha256: "b".repeat(64),
  lines: [...referenceLines, ...extra].map((text, i) => ({
    text,
    location: `Line ${i + 1}`,
  })),
});
const email: Email = {
  email_id: "remarks-test",
  from: "test@example.test",
  subject: "Please compare SI and draft BL",
  body: "Please verify attached SI and draft BL",
  attachments: ["SI.txt", "BL.txt"],
};

test("explicit harmless Remarks and Notes stop the preceding weight value", () => {
  for (const notes of [
    ["Remarks: Delivery pending."],
    ["Notes:", "Delivery expected in 2 days; reference 43000."],
  ]) {
    const found = extract(doc(notes));
    assert.equal(found.gross_weight_kg.raw, "42000 KG");
    assert.equal(found.gross_weight_kg.normalized, 42000);
    assert.equal(
      analyze(email, [doc([], "SI"), doc(notes)]).workflow,
      "verified",
    );
  }
});
test("notes with a contradictory weight, unit or amendment remain in review", () => {
  for (const notes of [
    ["Remarks: 43000 KG"],
    ["Notes:", "Actually 42 MT, use 43 MT."],
    ["Remarks: Gross weight corrected by issuer."],
    ["Notes: weight unchanged"],
    ["Notes:", "Gross weight: 43000 KG"],
  ]) {
    const found = extract(doc(notes));
    assert.equal(found.gross_weight_kg.normalized, null, notes.join(" "));
    assert.equal(
      analyze(email, [doc([], "SI"), doc(notes)]).workflow,
      "review",
    );
  }
});
test("unlabelled numeric continuation and conflicting header units cannot be discarded", () => {
  for (const extra of [
    ["43000 KG"],
    ["Remarks:", "Gross weight (MT): 42000 KG"],
  ]) {
    assert.equal(extract(doc(extra)).gross_weight_kg.normalized, null);
    assert.equal(
      analyze(email, [doc([], "SI"), doc(extra)]).workflow,
      "review",
    );
  }
});

test("a repeated weight inside notes cannot hide behind total-weight precedence", () => {
  const source = doc(["Notes:", "Gross weight: 43000 KG"]);
  source.lines[6].text = "Total gross weight: 42000 KG";
  assert.equal(extract(source).gross_weight_kg.normalized, null);
  assert.equal(analyze(email, [doc([], "SI"), source]).workflow, "review");
});
