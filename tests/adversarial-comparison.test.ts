import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { analyze, extract } from "../lib/compare";
import { normalize } from "../lib/normalization";
import { parseDocument } from "../lib/parsers";
import type { Email, ParsedDocument } from "../lib/types";

const email: Email = {
  email_id: "independent-unit-context",
  from: "operations@example.test",
  subject: "Check draft BL",
  body: "Please compare the SI and draft BL.",
  attachments: ["si.txt", "bl.txt"],
};
async function document(
  role: "SI" | "BL",
  weightLabel: string,
  weight: string,
) {
  return parseDocument(
    `${role.toLowerCase()}.txt`,
    new TextEncoder().encode(
      [
        role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
        "Shipper: ALPHA EXPORT LTD",
        "Consignee: BETA IMPORT LTD",
        "Notify Party: SAME AS CONSIGNEE",
        "Port of Loading: SINGAPORE",
        "Port of Discharge: PORT KLANG",
        "Container Count: 2 x 40HC",
        `${weightLabel}: ${weight}`,
      ].join("\n"),
    ),
  );
}

test("a unit in the weight header must not be lost: 42 MT is not 42 KG", async () => {
  const result = analyze(email, [
    await document("SI", "Gross Weight (MT)", "42"),
    await document("BL", "Gross Weight (KG)", "42"),
  ]);
  assert.equal(result.status, "MISMATCH");
  assert.deepEqual(result.defect_fields, ["gross_weight_kg"]);
  assert.equal(result.comparison.at(-1)!.si.normalized, 42000);
});

test("header-only tonnes and explicitly written kilograms are equivalent", async () => {
  const result = analyze(email, [
    await document("SI", "Gross Weight (metric tonnes)", "42.5"),
    await document("BL", "Gross Weight (KG)", "42,500 KG"),
  ]);
  assert.equal(result.workflow, "verified");
});

test("a repeated bilingual kilogram label does not lose or contradict its unit", async () => {
  const result = analyze(email, [
    await document("SI", "Gross Weight (KG)", "42500"),
    await document("BL", "Gross Wt (kgs) (毛重 KGS)", "42,500"),
  ]);
  assert.equal(result.workflow, "verified");
});

for (const [label, value] of [
  ["Gross Weight (KG)", "42 MT"],
  ["Gross Weight (MT)", "42 KG"],
  ["Gross Weight (LB)", "42000"],
  ["Gross Weight (KG) (MT)", "42000"],
]) {
  test(`conflicting or unsupported weight units require review: ${label}: ${value}`, async () => {
    const result = analyze(email, [
      await document("SI", label, value),
      await document("BL", label, value),
    ]);
    assert.equal(result.workflow, "review");
    assert.match(result.comparison.at(-1)!.si.issue ?? "", /unit/i);
  });
}

for (const marker of [",", ";", "()", ":", "??? KGS", "____MT", "__ MT"]) {
  test(`punctuation or unit-suffixed blanks are not shipment values: ${marker}`, () => {
    assert.equal(normalize("shipper", marker), null);
    assert.equal(normalize("port_of_loading", marker), null);
  });
}

test("split PDF totals retain the unit from the same-baseline label", () => {
  const doc: ParsedDocument = {
    name: "separate-fonts.pdf",
    format: "pdf",
    type: "BL",
    method: "PDF text and layout",
    lines: [
      { text: "TOTAL Gross Weight", location: "Page 1, y=200" },
      { text: "nn", location: "Page 1, y=200" },
      { text: "(MT): 42", location: "Page 1, y=200" },
    ],
  };
  assert.equal(extract(doc).gross_weight_kg.normalized, 42000);
});

function spreadsheet(cell: string) {
  return zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook><sheets><sheet name="Data" r:id="r1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData><row>${cell}</row></sheetData></worksheet>`,
    ),
  });
}

for (const content of [
  '<c r="B2"><f>42000+500</f><v>42000</v></c>',
  '<c r="B2"><f t="shared" si="0"/><v>42000</v></c>',
  '<c r="B2"><f>42000+500</f></c>',
]) {
  test(`spreadsheet formulas cannot silently verify stale cached values: ${content}`, async () => {
    const doc = await parseDocument("formula.xlsx", spreadsheet(content));
    assert.match(doc.error ?? "", /formula.*recalculated/i);
    assert.deepEqual(doc.lines, []);
  });
}

test("spreadsheet error cells cannot become matching party names", async () => {
  const doc = await parseDocument(
    "broken.xlsx",
    spreadsheet('<c r="A1" t="e"><v>#REF!</v></c>'),
  );
  assert.match(doc.error ?? "", /error cell/i);
  assert.deepEqual(doc.lines, []);
});

test("normal numeric spreadsheet cells and header units remain supported", async () => {
  const doc = await parseDocument(
    "units.xlsx",
    spreadsheet(
      '<c r="A1" t="inlineStr"><is><t>Gross Weight (MT)</t></is></c><c r="B1"><v>42</v></c>',
    ),
  );
  assert.equal(doc.error, undefined);
  assert.equal(extract(doc).gross_weight_kg.normalized, 42000);
});

test("an extra unidentified attachment cannot be silently ignored when clearing", async () => {
  const docs = [
    await document("SI", "Gross Weight (KG)", "42000"),
    await document("BL", "Gross Weight (KG)", "42000"),
    await parseDocument(
      "unidentified.txt",
      strToU8("Updated shipment sheet\nGross Weight: 43000 KG"),
    ),
  ];
  const result = analyze(
    { ...email, attachments: docs.map((doc) => doc.name) },
    docs,
  );
  assert.equal(result.workflow, "review");
  assert.equal(result.review_reason, "wrong_doc_type");
});
