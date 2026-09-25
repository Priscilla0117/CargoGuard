import { test } from "node:test";
import assert from "node:assert/strict";
import { emails, bundleBytes } from "../lib/bundle";
import {
  applyTranscript,
  canTranscribe,
  transcribeDocument,
  type Transcript,
} from "../lib/transcription";
import { analyze, extract } from "../lib/compare";
import { processEmail } from "../lib/processing";
import { parseDocument } from "../lib/parsers";
import { suggestScanFields } from "../lib/ocr";
import { FIELDS, type Email, type ParsedDocument } from "../lib/types";

const values = [
  "ALPHA EXPORTS",
  "BETA IMPORTS",
  "SAME AS CONSIGNEE",
  "SINGAPORE",
  "PORT KLANG",
  "2 x 20FCL + 1 x 40HC",
  "42000 KG",
];
const transcript: Transcript = {
  role: "SI",
  fields: Object.fromEntries(
    FIELDS.map((f, i) => [f, { value: values[i], page: 1 }]),
  ) as Transcript["fields"],
  actor: "Regression tester",
  reason: "Checked all values against the original synthetic scan",
  confirmed_at: "2026-09-20T00:00:00Z",
  reviewed_pages: [1],
};
const scan: ParsedDocument = {
  name: "scan.pdf",
  format: "pdf",
  type: "UNKNOWN",
  lines: [],
  error: "Image-only scan: no text layer.",
  method: "PDF text and layout",
  sha256: "a".repeat(64),
  page_count: 1,
  pdf_coverage: {
    version: 1,
    pages: [
      { page: 1, text_items: 0, has_images: true, requires_review: true },
    ],
  },
};
const email: Email = {
  email_id: "scan-test",
  from: "test@example.test",
  subject: "Compare SI and draft BL",
  body: "Please compare the SI and draft BL",
  attachments: ["si.pdf", "bl.pdf"],
};
test("OCR label recovery proposes seven fields without repairing uncertain source numbers", () => {
  const lines = [
    "Shipper. ALPHA EXPORTS",
    "Consignee: BETA IMPORTS",
    "Notify BETA IMPORTS",
    "Portof Loading: SINGAPORE",
    "Fortaf Discharge: PORT KLANG",
    "Containers 2 x 40HC",
    "Gross Weight 42.OOO KG",
    "Vessel TEST",
  ].map((text) => ({ text, location: "Page 1; OCR line" }));
  const fields = suggestScanFields(scan, lines);
  assert.equal(fields.port_of_loading.raw, "SINGAPORE");
  assert.equal(fields.port_of_discharge.raw, "PORT KLANG");
  assert.equal(fields.notify_party.raw, "BETA IMPORTS");
  assert.equal(fields.gross_weight_kg.raw, "42.OOO KG");
  assert.equal(fields.gross_weight_kg.normalized, null);
});

test("scan cannot silently clear: two original images remain in review", () => {
  assert.equal(
    analyze(email, [scan, { ...scan, name: "bl.pdf" }]).workflow,
    "review",
  );
});
test("confirmed scan fields use shared normalization and page evidence", () => {
  const d = transcribeDocument(scan, transcript),
    fields = extract(d);
  assert.equal(fields.container_count.normalized, 3);
  assert.equal(fields.notify_party.normalized, "BETA IMPORTS");
  assert.equal(fields.shipper.evidence, "Page 1; Shipper; human-confirmed");
  assert.equal(d.sha256, scan.sha256);
  assert.equal(d.error, undefined);
});
test("only one confirmed scan cannot clear the other unreadable source", () => {
  const base = analyze(email, [scan, { ...scan, name: "bl.pdf" }]);
  assert.equal(
    applyTranscript(base, scan.name, scan.sha256!, transcript).workflow,
    "review",
  );
});
test("two confirmed scans recompute seven fields and detect an OCR correction difference", () => {
  const base = analyze(email, [scan, { ...scan, name: "bl.pdf" }]);
  const one = applyTranscript(base, scan.name, scan.sha256!, transcript);
  const t = structuredClone(transcript);
  t.role = "BL";
  t.fields.gross_weight_kg.value = "43000 KG";
  const two = applyTranscript(one, "bl.pdf", scan.sha256!, t);
  assert.equal(two.workflow, "discrepancy");
  assert.deepEqual(two.defect_fields, ["gross_weight_kg"]);
  assert.equal(two.reviewed, true);
});
test("placeholder scan fields cannot be confirmed", () => {
  const t = structuredClone(transcript);
  t.fields.consignee.value = "NOT PROVIDED";
  assert.throws(() => transcribeDocument(scan, t), /Consignee/);
});
test("source page references must exist in the original PDF", () => {
  const t = structuredClone(transcript);
  t.fields.shipper.page = 2;
  assert.throws(() => transcribeDocument(scan, t), /Every source page/);
});
test("corrupt PDF and text documents cannot use scan confirmation", () => {
  assert.equal(canTranscribe({ ...scan, error: "Invalid PDF header" }), false);
  assert.throws(
    () =>
      transcribeDocument({ ...scan, error: "Invalid PDF header" }, transcript),
    /corrupted/,
  );
  assert.equal(canTranscribe({ ...scan, format: "txt" }), false);
});
test("scan confirmation refuses a stale fingerprint", () => {
  assert.throws(
    () =>
      applyTranscript(
        analyze(email, [scan]),
        scan.name,
        "b".repeat(64),
        transcript,
      ),
    /Source changed/,
  );
});
test("scan reprocessing keeps human-confirmed data only for identical bytes", async () => {
  const scanEmail = emails.find((e) => e.email_id === "email_512")!;
  const docs = await Promise.all(
    scanEmail.attachments.map((p) =>
      parseDocument(p.split("/").pop()!, bundleBytes(p)!),
    ),
  );
  const record = analyze(scanEmail, docs),
    document = docs.find(canTranscribe)!;
  const parsed = await parseDocument(
    document.name,
    bundleBytes(scanEmail.attachments.find((p) => p.endsWith(document.name))!)!,
  );
  assert.ok(canTranscribe(parsed));
  const prev = {
    ...record,
    documents: record.documents.map((d: ParsedDocument) =>
      d.name === document.name ? transcribeDocument(d, transcript) : d,
    ),
  };
  const result = await processEmail(
    record.email,
    async (p) => bundleBytes(p),
    prev,
  );
  assert.deepEqual(
    result.documents.find((d) => d.name === document.name)?.transcription,
    prev.documents.find((d) => d.name === document.name)?.transcription,
  );
});
