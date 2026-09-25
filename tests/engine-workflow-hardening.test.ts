import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, extract, recomputeRows, deriveResult } from "../lib/compare";
import { normalize } from "../lib/normalization";
import { parseDocument } from "../lib/parsers";
import { correctField, previewCorrection } from "../lib/corrections";
import { replaceDraftBl } from "../lib/bl-replacement";
import { attachmentPlan, processEmail } from "../lib/processing";
import { retainSourceCorrections } from "../lib/source-corrections";
import { completionBlocker } from "../lib/follow-up";
import { batchReviewBlocker } from "../lib/batch-review";
import { summaryOf, type Email } from "../lib/types";
import { applyTranscript, type Transcript } from "../lib/transcription";
import { evidenceHasLocation } from "../lib/source-location";

const encode = (text: string) => new TextEncoder().encode(text);

test("source evidence uses complete locations rather than numeric prefixes", () => {
  for (const [evidence, location] of [
    ["Line 10", "Line 1"],
    ["Paragraph 12", "Paragraph 1"],
    ["Page 1, y=500", "Page 1, y=50"],
    ["Sheet1!A10", "Sheet1!A1"],
    ["OtherSheet1!A1", "Sheet1!A1"],
    ["SheetX!A1", "Sheet.!A1"],
  ])
    assert.equal(
      evidenceHasLocation(evidence, location),
      false,
      `${evidence} / ${location}`,
    );
  for (const location of [
    "Line 10",
    "Paragraph 12",
    "Page 1, y=500",
    "Sheet (A)!A10",
  ])
    assert.equal(
      evidenceHasLocation(
        `Unconfirmed reading correction; original source: ${location}; value Line 15`,
        location,
      ),
      true,
    );
  assert.equal(evidenceHasLocation("", ""), false);
});
const email: Email = {
  email_id: "engine-synthetic",
  from: "ops@example.test",
  subject: "Check draft BL",
  body: "Please compare the SI and draft BL.",
  attachments: ["uploads/si.txt", "uploads/bl.txt"],
};
const reviewer = {
  actor: "Synthetic reviewer",
  reason: "Inspect the revised source",
};
function source(
  role: "SI" | "BL",
  { shipper = "ALPHA LTD", count = "2", weight = "42000 KG" } = {},
) {
  return [
    role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
    `Shipper: ${shipper}`,
    "Consignee: BETA LTD",
    "Notify Party: SAME AS CONSIGNEE",
    "Port of Loading: SINGAPORE",
    "Port of Discharge: ROTTERDAM",
    `Container Count: ${count}`,
    `Gross Weight: ${weight}`,
  ].join("\n");
}
async function pair(si = source("SI"), bl = source("BL")) {
  return analyze(
    email,
    await Promise.all([
      parseDocument("si.txt", encode(si)),
      parseDocument("bl.txt", encode(bl)),
    ]),
  );
}
/** A real, minimal text-layer PDF; no external fixtures or filesystem writes. */
function pdf(rows: { text: string; x: number; y: number }[]) {
  const content = rows
    .map(
      ({ text, x, y }) =>
        `BT /F1 10 Tf 1 0 0 1 ${x} ${y} Tm (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`,
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 850] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return encode(text);
}

test("whole placeholder combinations cannot become matching party names", async () => {
  for (const shipper of [
    "TBA / TBC",
    "TO BE ADVISED (TBA)",
    "(TBA)",
    "TBC and N/A",
    "Pending; unknown",
  ]) {
    for (const both of [false, true]) {
      const result = await pair(
        source("SI", { shipper }),
        source("BL", { shipper: both ? shipper : "ALPHA LTD" }),
      );
      assert.equal(result.status, "NEEDS_REVIEW", shipper);
      assert.equal(result.comparison[0].result, "uncertain");
      assert.ok(completionBlocker(result));
      assert.ok(batchReviewBlocker(result));
    }
  }
  for (const name of [
    "TBA LOGISTICS LTD",
    "TBC AND SONS LTD",
    "TO BE ADVISED LOGISTICS LTD",
    "ALPHA (TBA) LTD",
  ])
    assert.notEqual(normalize("shipper", name), null, name);
});

test("all wrapped container groups participate in comparison", async () => {
  const bl = source("BL", { count: "\n2 x 20GP\n+ 3 x 40HC" });
  const result = await pair(source("SI"), bl);
  assert.equal(result.status, "MISMATCH");
  assert.equal(result.comparison[5].bl.normalized, 5);
  assert.equal((await pair(source("SI", { count: "5" }), bl)).status, "OK");
  const ambiguous = await pair(
    source("SI"),
    source("BL", { count: "\n2 x 20GP\n3 x 40HC" }),
  );
  assert.equal(ambiguous.status, "NEEDS_REVIEW");
});

test("actual PDF net/tare values cannot fill missing gross weight on the same baseline", async () => {
  const si = await parseDocument("si.txt", encode(source("SI")));
  const rows = source("BL")
    .split("\n")
    .slice(0, -1)
    .map((text, index) => ({ text, x: 40, y: 800 - index * 28 }));
  for (const label of ["Net Weight", "Tare Weight", "Item Weight"]) {
    for (const total of ["Total Gross Weight: TBD", "Total Gross Weight"]) {
      const bl = await parseDocument(
        "bl.pdf",
        pdf([
          ...rows,
          { text: total, x: 40, y: 500 },
          { text: `${label}: 42000 KG`, x: 400, y: 500 },
        ]),
      );
      assert.equal(bl.error, undefined);
      const result = analyze({ ...email, attachments: ["si.txt", "bl.pdf"] }, [
        si,
        bl,
      ]);
      assert.equal(result.status, "NEEDS_REVIEW", `${total} / ${label}`);
      assert.equal(result.comparison[6].bl.normalized, null);
      assert.ok(batchReviewBlocker(result));
    }
  }
  const split = await parseDocument(
    "bl.pdf",
    pdf([
      ...rows,
      { text: "Total Gross Weight", x: 40, y: 500 },
      { text: "(KGS): 42000 KG", x: 400, y: 500 },
    ]),
  );
  assert.equal(extract(split).gross_weight_kg.normalized, 42000);
  const contradictory = await parseDocument(
    "bl.pdf",
    pdf([
      ...rows,
      { text: "Total Gross Weight", x: 40, y: 500 },
      { text: "(KGS): 42000 KG", x: 300, y: 500 },
      { text: "(KGS): 43000 KG", x: 560, y: 500 },
    ]),
  );
  assert.equal(extract(contradictory).gross_weight_kg.normalized, null);
});

test("copying SI into a genuinely different BL saves an unresolved reading, never clearance", async () => {
  const previous = await pair(
    source("SI"),
    source("BL", { weight: "43000 KG" }),
  );
  const originals = structuredClone(previous.documents);
  const edit = {
    field: "gross_weight_kg",
    side: "bl",
    value: "42000 KG",
  } as const;
  assert.equal(
    previewCorrection(previous, edit).result?.status,
    "NEEDS_REVIEW",
  );
  const corrected = correctField(previous, edit, reviewer.actor);
  assert.equal(previous.status, "MISMATCH");
  assert.equal(corrected.status, "NEEDS_REVIEW");
  assert.equal(corrected.comparison[6].bl.raw, "42000 KG");
  assert.equal(corrected.comparison[6].bl.correction?.state, "unresolved");
  assert.deepEqual(corrected.documents, originals);
  assert.equal(extract(corrected.documents[1]).gross_weight_kg.raw, "43000 KG");
  assert.ok(completionBlocker(corrected));
  assert.ok(batchReviewBlocker(corrected));
  const stripped = structuredClone(corrected.comparison);
  delete stripped[6].bl.extraction_issue;
  delete stripped[6].bl.issue;
  assert.equal(recomputeRows(stripped)[6].result, "uncertain");
  assert.equal("retained_corrections" in summaryOf(corrected).result!, false);
});

test("a reading correction supported by the original field can resolve a stale extraction", async () => {
  const previous = await pair();
  previous.comparison[6].bl.raw = "43000 KG";
  const stale = deriveResult(previous, recomputeRows(previous.comparison));
  const corrected = correctField(
    stale,
    { field: "gross_weight_kg", side: "bl", value: "42 MT" },
    reviewer.actor,
  );
  assert.equal(corrected.status, "OK");
  assert.equal(corrected.comparison[6].bl.correction?.state, "confirmed");
  assert.equal(
    corrected.comparison[6].bl.correction?.source_sha256,
    previous.documents[1].sha256,
  );
});

test("a typed PDF correction preserves every original byte, fingerprint and extracted source line", async () => {
  const siBytes = pdf(
    source("SI")
      .split("\n")
      .map((text, index) => ({ text, x: 40, y: 800 - index * 28 })),
  );
  const blBytes = pdf(
    source("BL", { weight: "43000 KG" })
      .split("\n")
      .map((text, index) => ({ text, x: 40, y: 800 - index * 28 })),
  );
  const originalBytes = blBytes.slice();
  const docs = await Promise.all([
    parseDocument("si.pdf", siBytes),
    parseDocument("bl.pdf", blBytes),
  ]);
  const originalDocs = structuredClone(docs);
  const corrected = correctField(
    analyze({ ...email, attachments: ["si.pdf", "bl.pdf"] }, docs),
    { field: "gross_weight_kg", side: "bl", value: "42000 KG" },
    reviewer.actor,
  );
  assert.equal(corrected.status, "NEEDS_REVIEW");
  assert.deepEqual(corrected.documents, originalDocs);
  assert.deepEqual(blBytes, originalBytes);
  assert.equal(
    extract(await parseDocument("bl.pdf", blBytes)).gross_weight_kg.raw,
    "43000 KG",
  );
});

test("correction evidence must belong to that field, not a different numeric label", async () => {
  const previous = await pair(
    source("SI"),
    source("BL", { weight: "43000 KG" }) +
      "\nRemarks: Equipment details\nNet Weight: 42000 KG",
  );
  const corrected = correctField(
    previous,
    { field: "gross_weight_kg", side: "bl", value: "42000 KG" },
    reviewer.actor,
  );
  assert.equal(corrected.status, "NEEDS_REVIEW");
});

test("unchanged SI reading survives invalid BL then valid replacement without false clearance", async () => {
  const bytes = new Map<string, Uint8Array>([
    ["uploads/si.txt", encode(source("SI"))],
    ["uploads/bl.txt", encode(source("BL"))],
  ]);
  const read = async (path: string) => bytes.get(path) ?? null;
  let result = correctField(
    await processEmail(email, read),
    { field: "gross_weight_kg", side: "si", value: "42500 KG" },
    reviewer.actor,
  );
  for (const [name, text] of [
    ["wrong.txt", "COMMERCIAL INVOICE\nInvoice: SYNTHETIC"],
    ["revised.txt", source("BL")],
  ]) {
    bytes.set(`uploads/${name}`, encode(text));
    result = (
      await replaceDraftBl(
        result,
        await parseDocument(name, encode(text)),
        read,
        reviewer,
      )
    ).result;
    assert.equal(result.retained_corrections?.[0].value.raw, "42500 KG");
    assert.equal(result.status, "NEEDS_REVIEW");
  }
  assert.equal(result.comparison[6].si.raw, "42500 KG");
  assert.equal(result.comparison[6].si.correction?.state, "unresolved");
  assert.ok(completionBlocker(result));
  const cleared = await processEmail(result.email, read, result, false);
  assert.equal(cleared.retained_corrections, undefined);
});

test("correction snapshot never crosses a changed source and source confirmation supersedes its own edits", async () => {
  const previous = correctField(
    await pair(),
    { field: "shipper", side: "si", value: "UNCONFIRMED LTD" },
    reviewer.actor,
  );
  const replaced = await pair(source("SI", { shipper: "NEW LTD" }));
  assert.equal(
    retainSourceCorrections(previous, replaced).retained_corrections,
    undefined,
  );
  const confirmed = retainSourceCorrections(previous, await pair(), {
    excludeSources: ["si.txt"],
  });
  assert.equal(confirmed.retained_corrections, undefined);
  assert.equal(confirmed.status, "OK");
});

test("confirming a replacement scan preserves another source's correction ledger and supersedes only its own", async () => {
  const initial = correctField(
    await pair(),
    { field: "gross_weight_kg", side: "si", value: "42500 KG" },
    reviewer.actor,
  );
  const scanBytes = pdf([]);
  const scan = await parseDocument("scan.pdf", scanBytes);
  const bytes = new Map([
    ["uploads/si.txt", encode(source("SI"))],
    ["uploads/scan.pdf", scanBytes],
  ]);
  const replaced = (
    await replaceDraftBl(
      initial,
      scan,
      async (path) => bytes.get(path) ?? null,
      reviewer,
    )
  ).result;
  assert.equal(replaced.comparison.length, 0);
  const transcript: Transcript = {
    role: "BL",
    ...reviewer,
    confirmed_at: new Date().toISOString(),
    fields: {
      shipper: { value: "ALPHA LTD", page: 1 },
      consignee: { value: "BETA LTD", page: 1 },
      notify_party: { value: "SAME AS CONSIGNEE", page: 1 },
      port_of_loading: { value: "SINGAPORE", page: 1 },
      port_of_discharge: { value: "ROTTERDAM", page: 1 },
      container_count: { value: "2", page: 1 },
      gross_weight_kg: { value: "42000 KG", page: 1 },
    },
  };
  const confirmed = applyTranscript(
    replaced,
    scan.name,
    scan.sha256!,
    transcript,
  );
  assert.equal(confirmed.comparison[6].si.raw, "42500 KG");
  const edited = correctField(
    confirmed,
    { field: "gross_weight_kg", side: "bl", value: "42500 KG" },
    reviewer.actor,
  );
  assert.equal(edited.retained_corrections?.length, 2);
  const reconfirmed = applyTranscript(
    edited,
    scan.name,
    scan.sha256!,
    transcript,
  );
  assert.equal(reconfirmed.retained_corrections?.length, 1);
  assert.equal(reconfirmed.retained_corrections?.[0].side, "si");
  assert.equal(reconfirmed.comparison[6].bl.normalized, 42000);
  assert.equal(reconfirmed.status, "NEEDS_REVIEW");
});

test("confident invoice-only and spam routes do not read attachments; BL confirmation parses them", async () => {
  const invoice = {
    ...email,
    subject: "Invoice INV-001 payment status",
    body: "Please send the payment status for invoice INV-001.",
    attachments: ["uploads/invoice.txt"],
  };
  assert.equal(attachmentPlan(invoice).parse, false);
  let reads = 0;
  const routed = await processEmail(invoice, async () => {
    reads++;
    return encode("COMMERCIAL INVOICE");
  });
  assert.equal(reads, 0);
  assert.equal(routed.documents[0].deferred, true);
  assert.equal(routed.documents[0].sha256, undefined);
  assert.equal(routed.category, "INVOICE_QUERY");
  assert.match(routed.summary, /have not been read or verified/);
  await processEmail(
    invoice,
    async () => {
      reads++;
      return encode("COMMERCIAL INVOICE");
    },
    { ...routed, category_override: "BL_COMPARISON" },
  );
  assert.equal(reads, 1);
  const spam = {
    ...invoice,
    subject: "Urgent mailbox verification",
    body: "Your mailbox is full and will be disabled. Enter your password at the verification page immediately.",
  };
  assert.equal(attachmentPlan(spam).parse, false);
  await processEmail(spam, async () => {
    throw new Error("Spam attachment must stay unopened");
  });
});

test("generic filenames, mixed requests and comparison sources remain parsed conservatively", async () => {
  const invoice = {
    ...email,
    subject: "Invoice INV-001 payment status",
    body: "Please send the payment status for invoice INV-001.",
    attachments: ["uploads/document.pdf"],
  };
  assert.equal(attachmentPlan(invoice).parse, true);
  assert.equal(attachmentPlan(email).parse, true);
  assert.equal(
    attachmentPlan({
      ...invoice,
      body: "Please compare the draft BL against SI and revise the invoice charges.",
    }).parse,
    true,
  );
  assert.equal(
    attachmentPlan({ ...invoice, attachments: ["invoice.txt"] }, await pair())
      .parse,
    true,
  );
});
