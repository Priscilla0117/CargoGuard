import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { normalizeValue, normalize, equivalent } from "../lib/normalization";
import type { Email, Field } from "../lib/types";

const email: Email = {
  email_id: "normalization-coverage",
  from: "test@example.test",
  subject: "Please compare the attached SI and draft BL",
  body: "Verify the draft bill of lading against the shipping instruction.",
  attachments: ["si.txt", "bl.txt"],
};
const fields = {
  Shipper: "ALPHA EXPORTS LTD",
  Consignee: "BETA IMPORTS LTD",
  "Notify Party": "SAME AS CONSIGNEE",
  "Port of Loading": "SINGAPORE",
  "Port of Discharge": "SAVANNAH",
  "Container Count": "2 x 40HC",
  "Gross Weight": "42000 KG",
};
async function run(
  si: Record<string, string> = {},
  bl: Record<string, string> = {},
) {
  const document = (role: string, overrides: Record<string, string>) =>
    new TextEncoder().encode(
      `${role}\n${Object.entries({ ...fields, ...overrides })
        .map(([label, value]) => `${label}: ${value}`)
        .join("\n")}`,
    );
  return analyze(email, [
    await parseDocument("si.txt", document("SHIPPING INSTRUCTION", si)),
    await parseDocument("bl.txt", document("DRAFT BILL OF LADING", bl)),
  ]);
}

test("reported Savannah and container suffix formatting now passes the real pipeline", async () => {
  const result = await run(
    {},
    {
      "Port of Discharge": "SAVANNAH (USSAV)",
      "Container Count": "2 x 40HC containers",
    },
  );
  assert.equal(result.status, "OK");
  assert.equal(result.workflow, "verified");
  assert.ok(result.comparison.every((row) => row.result === "match"));
});

for (const [name, code] of [
  ["SAVANNAH", "USSAV"],
  ["HOUSTON", "USHOU"],
]) {
  test(`validated optional port codes and country wording: ${name}`, () => {
    for (const suffix of [
      "",
      ", US",
      ", USA",
      ", United States",
      ", United States of America",
    ])
      for (const optionalCode of [
        `(${code})`,
        `( ${code.slice(0, 2)} ${code.slice(2)} )`,
      ])
        for (const field of ["port_of_loading", "port_of_discharge"] as const)
          assert.equal(
            equivalent(
              field,
              normalize(field, name),
              normalize(field, `${name}${suffix} ${optionalCode}`),
            ),
            true,
            `${name}${suffix} ${optionalCode}`,
          );
  });
}

test("port comparisons retain unknown geography, codes and code-only uncertainty", async () => {
  for (const bl of [
    "SAVANNAH, CA",
    "SAVANNAH, CA (USSAV)",
    "USSAV",
    "HOUSTON (USHOU)",
  ])
    assert.equal(
      (await run({}, { "Port of Discharge": bl })).status,
      "MISMATCH",
      bl,
    );
  assert.equal(
    equivalent("port_of_discharge", "UNKNOWN PORT", "UNKNOWN PORT (ZZZZZ)"),
    false,
  );
  // Do not silently change a longstanding operational alias in this fix.
  assert.equal(
    equivalent("port_of_loading", "SHANGHAI", "SHANGHAI (CNSHA)"),
    true,
  );
});

for (const bad of [
  "SAVANNAH (USHOU)",
  "SAVANNAH, US (SGSIN)",
  "SINGAPORE (USHOU)",
  "HOUSTON (USSAV)",
]) {
  test(`identical contradictory name/code pairs cannot clear: ${bad}`, async () => {
    const result = await run(
      { "Port of Discharge": bad },
      { "Port of Discharge": bad },
    );
    const row = result.comparison.find(
      (entry) => entry.field === "port_of_discharge",
    )!;
    assert.equal(result.status, "NEEDS_REVIEW");
    assert.equal(row.result, "uncertain");
    assert.match(
      row.si.issue ?? "",
      /port name and location code do not agree/,
    );
    assert.match(
      row.bl.issue ?? "",
      /port name and location code do not agree/,
    );
  });
}

for (const [raw, total] of [
  ["2 x 40HC containers", 2],
  ["1 x 40HC container", 1],
  ["2 × 40' HC units", 2],
  ["TWO (2) X 40' HC CONTAINERS", 2],
  ["2 x 20GP containers + 3 x 40HC containers", 5],
  ["2 x 20 feet units and 3 x 40HQ containers", 5],
] as const)
  test(`container count supports complete expression: ${raw}`, () => {
    assert.equal(normalize("container_count", raw), total);
  });

for (const raw of [
  "2 x 40HC containers extra 3",
  "2 x 40HC containers (total 5)",
  "2 x 40HC containers or 3",
  "THREE (2) X 40HC containers",
  "2 x 40HC containers / 3 x 20GP containers",
  "2 x 40HC containers +",
  "2 x 40HC kg",
  "2 x 40HC containers 3",
  "2 x 40HCcontainers",
  "2.5 x 40HC containers",
  "0 x 40HC containers",
])
  test(`new container suffix handling never discards conflicting content: ${raw}`, () => {
    assert.equal(normalizeValue("container_count", raw).value, null);
  });

test("formatting tolerance preserves real quantities, units and dependent party differences", async () => {
  const result = await run(
    {},
    {
      Consignee: "GAMMA IMPORTS LTD",
      "Container Count": "3 x 40HC containers",
      "Gross Weight": "43 MT",
    },
  );
  assert.equal(result.status, "MISMATCH");
  assert.deepEqual(result.defect_fields, [
    "consignee",
    "notify_party",
    "container_count",
    "gross_weight_kg",
  ]);
  for (const raw of ["42000 KG MT", "42 MT plus 50 KG", "42,50 KG"])
    assert.equal(normalize("gross_weight_kg", raw), null);
  for (const [raw, expected] of [
    ["42 MT", 42000],
    ["42,000 KG", 42000],
  ] as const)
    assert.equal(normalize("gross_weight_kg" satisfies Field, raw), expected);
});
