import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import {
  hasUnconfirmedMarker,
  normalizeValue,
  placeholderOnly,
} from "../lib/normalization";
import type { Field } from "../lib/types";

async function sameInBoth(field: string, value: string) {
  const base: Record<string, string> = {
    Shipper: "ATLAS EXPORT SDN BHD",
    Consignee: "HARBOUR BUYER LTD",
    "Notify party": "HARBOUR BUYER LTD",
    "Port of loading": "PORT KLANG",
    "Port of discharge": "SINGAPORE",
    "Container count": "2",
    "Gross weight (KG)": "42000",
  };
  base[field] = value;
  const text = Object.entries(base)
    .map(([label, raw]) => `${label}: ${raw}`)
    .join("\n");
  return analyze(
    {
      email_id: "placeholder",
      from: "docs@example.test",
      subject: "Please check the draft BL against the SI",
      body: "Please compare the attached SI and draft BL.",
      attachments: ["si.txt", "bl.txt"],
    },
    await Promise.all([
      parseDocument(
        "si.txt",
        new TextEncoder().encode(`SHIPPING INSTRUCTION\n${text}`),
      ),
      parseDocument(
        "bl.txt",
        new TextEncoder().encode(`DRAFT BILL OF LADING\n${text}`),
      ),
    ]),
  );
}

// Reported by a preliminary-round judge: these matched and were verified.
const UNKNOWN_PARTIES = [
  "TBA / TBC",
  "TO BE ADVISED (TBA)",
  "TBA/TBC",
  "T.B.A. / T.B.C.",
  "N/A / TBA",
  "TBC - TO BE CONFIRMED",
  "SEE ATTACHED",
  "AS PER SI",
  "As per shipping instruction",
  "XXX",
  "***",
  "TO FOLLOW",
  "ABC TRADING SDN BHD (TBC)",
  "ABC TRADING SDN BHD - TBA",
  "HARBOUR BUYER LTD (TO BE CONFIRMED)",
];
for (const value of UNKNOWN_PARTIES)
  test(`matching unknown party “${value}” goes to review, never verified`, async () => {
    const result = await sameInBoth("Shipper", value);
    assert.equal(result.workflow, "review");
    assert.equal(result.status, "NEEDS_REVIEW");
    // A BL quoting "shipping instruction" may also make its role ambiguous.
    assert.ok(
      ["missing_value", "wrong_doc_type"].includes(result.review_reason ?? ""),
      result.review_reason ?? "none",
    );
    const row = result.comparison.find((r) => r.field === "shipper");
    if (row) assert.equal(row.result, "uncertain");
  });

test("placeholder ports, counts and weights are unknown too", async () => {
  for (const [field, value] of [
    ["Port of discharge", "TBA / TBC"],
    ["Port of loading", "TO BE ADVISED (TBA)"],
    ["Container count", "TBA / TBC"],
    ["Gross weight (KG)", "TBC / TBA"],
    ["Port of discharge", "SINGAPORE (TBC)"],
  ])
    assert.equal((await sameInBoth(field, value)).workflow, "review", value);
});

// Real values must keep matching: no false alarms.
const REAL_VALUES = [
  "TO ORDER",
  "TO THE ORDER OF ABC BANK BERHAD",
  "A & B TRADING SDN BHD",
  "JOHNSON AND JOHNSON PTE LTD",
  "PT. X-Y INDONESIA",
  "ATLAS EXPORT (M) SDN BHD",
  "ABC TRADING SDN BHD; 12 JALAN X, KUALA LUMPUR",
  "TBAX LOGISTICS LTD",
  "PENDING HOLDINGS LTD",
];
for (const value of REAL_VALUES)
  test(`real party “${value}” still verifies when both documents agree`, async () => {
    const result = await sameInBoth("Shipper", value);
    assert.equal(result.workflow, "verified");
    assert.equal(result.status, "OK");
  });

test("notify party SAME AS CONSIGNEE still resolves to the consignee", async () => {
  const result = await sameInBoth("Notify party", "SAME AS CONSIGNEE");
  assert.equal(result.workflow, "verified");
});

test("helpers classify whole-value placeholders and unconfirmed markers", () => {
  assert.equal(placeholderOnly("TBA / TBC"), true);
  assert.equal(placeholderOnly("TO BE ADVISED (TBA)"), true);
  assert.equal(placeholderOnly("ATLAS EXPORT"), false);
  assert.equal(placeholderOnly("TO ORDER"), false);
  assert.equal(hasUnconfirmedMarker("ATLAS EXPORT (TBC)"), true);
  assert.equal(hasUnconfirmedMarker("PENDING HOLDINGS LTD"), false);
  for (const field of [
    "shipper",
    "container_count",
    "gross_weight_kg",
  ] as Field[])
    assert.equal(normalizeValue(field, "TBA / TBC").value, null);
});
