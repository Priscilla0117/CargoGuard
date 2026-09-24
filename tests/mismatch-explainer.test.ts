import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, submissionEntry } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { editDistance, explainMismatches } from "../lib/mismatch-explainer";
import { amendmentDraft } from "../lib/case-guide";
import { resolutionPacket } from "../lib/resolution";
import type { Field } from "../lib/types";

const BASE: Record<string, string> = {
  Shipper: "ATLAS EXPORT SDN BHD\nTOWER 2, JALAN KERINCHI; KUALA LUMPUR",
  Consignee: "HARBOUR BUYER LTD\n12 DOCK ROAD; MOMBASA, KENYA",
  "Notify party": "PORT AGENCY LIMITED",
  "Port of loading": "PORT KLANG, MALAYSIA (MYPKG)",
  "Port of discharge": "MOMBASA, KENYA (KEMBA)",
  "Container count": "3",
  "Gross weight (KG)": "22000",
};
const render = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
async function compare(bl: Record<string, string>) {
  return analyze(
    {
      email_id: "explain",
      from: "docs@example.test",
      subject: "Please check the draft BL against the SI",
      body: "Please compare the attached SI and draft BL.",
      attachments: ["si.txt", "bl.txt"],
    },
    await Promise.all([
      parseDocument(
        "si.txt",
        new TextEncoder().encode(`SHIPPING INSTRUCTION\n${render(BASE)}`),
      ),
      parseDocument(
        "bl.txt",
        new TextEncoder().encode(
          `DRAFT BILL OF LADING\n${render({ ...BASE, ...bl })}`,
        ),
      ),
    ]),
  );
}
async function compareWith(
  si: Record<string, string>,
  bl: Record<string, string>,
) {
  return analyze(
    {
      email_id: "explain",
      from: "docs@example.test",
      subject: "Please check the draft BL against the SI",
      body: "Please compare the attached SI and draft BL.",
      attachments: ["si.txt", "bl.txt"],
    },
    await Promise.all([
      parseDocument(
        "si.txt",
        new TextEncoder().encode(
          `SHIPPING INSTRUCTION\n${render({ ...BASE, ...si })}`,
        ),
      ),
      parseDocument(
        "bl.txt",
        new TextEncoder().encode(
          `DRAFT BILL OF LADING\n${render({ ...BASE, ...si, ...bl })}`,
        ),
      ),
    ]),
  );
}
async function explain(bl: Record<string, string>, field: Field) {
  const result = await compare(bl);
  return explainMismatches(result.comparison)[field];
}

test("weights: swapped digits, one-digit typo, tonnes vs kg and a real change", async () => {
  const swapped = await explain(
    { "Gross weight (KG)": "20200" },
    "gross_weight_kg",
  );
  assert.equal(swapped?.kind, "clerical");
  assert.match(swapped!.title, /swapped digits/);
  const typo = await explain(
    { "Gross weight (KG)": "23000" },
    "gross_weight_kg",
  );
  assert.equal(typo?.kind, "clerical");
  assert.match(typo!.title, /one-digit/);
  const tonnes = await explain(
    { "Gross weight (KG)": "22" },
    "gross_weight_kg",
  );
  assert.equal(tonnes?.kind, "clerical");
  assert.match(tonnes!.title, /tonnes/);
  const real = await explain(
    { "Gross weight (KG)": "24500" },
    "gross_weight_kg",
  );
  assert.equal(real?.kind, "material");
  assert.match(real!.title, /2,500 kg higher/);
});

test("container count differences are always material", async () => {
  const more = await explain({ "Container count": "4" }, "container_count");
  assert.equal(more?.kind, "material");
  assert.equal(more?.title, "BL lists 1 container more");
  assert.match(more!.detail, /SI: 3 \/ BL: 4/);
});

test("parties: typo, legal form, added address, same address and a different company", async () => {
  const typo = await explain(
    { Shipper: "ATLAS EXPROT SDN BHD\nTOWER 2, JALAN KERINCHI; KUALA LUMPUR" },
    "shipper",
  );
  assert.equal(typo?.kind, "clerical");
  assert.match(typo!.title, /typo/);
  const form = await explain(
    { "Notify party": "PORT AGENCY LTD" },
    "notify_party",
  );
  assert.equal(form?.kind, "clerical");
  assert.match(form!.title, /legal-form/);
  const added = await explain(
    { "Notify party": "PORT AGENCY LIMITED\n5 HARBOUR LANE" },
    "notify_party",
  );
  assert.equal(added?.kind, "clerical");
  assert.match(added!.title, /adds address lines/);
  const sameAddress = await explain(
    { Consignee: "OTHER TRADING LLC\n12 DOCK ROAD; MOMBASA, KENYA" },
    "consignee",
  );
  assert.equal(sameAddress?.kind, "material");
  assert.match(sameAddress!.title, /same address/);
  const different = await explain(
    { Consignee: "OTHER TRADING LLC\n1 MAIN STREET; DUBAI" },
    "consignee",
  );
  assert.equal(different?.kind, "material");
  assert.equal(different!.title, "A different party");
});

test("ports: name changed with code kept, code changed, and a different port", async () => {
  const name = await explain(
    { "Port of discharge": "TUTICORIN, INDIA (KEMBA)" },
    "port_of_discharge",
  );
  assert.equal(name?.kind, "clerical");
  assert.match(name!.title, /Same port code \(KEMBA\), different port name/);
  const code = await explain(
    { "Port of discharge": "MOMBASA, KENYA (KEMBO)" },
    "port_of_discharge",
  );
  assert.equal(code?.kind, "clerical");
  assert.match(code!.title, /different code/);
  const port = await explain(
    { "Port of discharge": "DAR ES SALAAM, TANZANIA (TZDAR)" },
    "port_of_discharge",
  );
  assert.equal(port?.kind, "material");
});

test("swapped consignee / notify and swapped ports are one clerical slip", async () => {
  const parties = explainMismatches(
    (
      await compare({
        Consignee: BASE["Notify party"],
        "Notify party": BASE.Consignee,
      })
    ).comparison,
  );
  assert.match(parties.consignee!.title, /swapped/);
  assert.match(parties.notify_party!.title, /swapped/);
  const ports = explainMismatches(
    (
      await compare({
        "Port of loading": BASE["Port of discharge"],
        "Port of discharge": BASE["Port of loading"],
      })
    ).comparison,
  );
  assert.match(ports.port_of_loading!.title, /ports are swapped/);
});

test("notify party SAME AS CONSIGNEE follows the consignee explanation", async () => {
  const both = explainMismatches(
    (
      await compareWith(
        { "Notify party": "SAME AS CONSIGNEE" },
        { Consignee: "HARBOUR BUYER LIMITED\n12 DOCK ROAD; MOMBASA, KENYA" },
      )
    ).comparison,
  );
  assert.match(both.consignee!.title, /legal-form/);
  assert.equal(both.notify_party?.title, "Follows the consignee difference");
  assert.equal(both.notify_party?.kind, both.consignee?.kind);
  const one = explainMismatches(
    (
      await compareWith(
        { "Notify party": "SAME AS CONSIGNEE" },
        { "Notify party": "PORT AGENCY LIMITED" },
      )
    ).comparison,
  );
  assert.match(one.notify_party!.title, /Only the SI says SAME AS CONSIGNEE/);
});

test("explanations never change the verdict and never explain a match", async () => {
  const clean = await compare({});
  assert.equal(clean.workflow, "verified");
  assert.deepEqual(explainMismatches(clean.comparison), {});
  const result = await compare({ "Gross weight (KG)": "20200" });
  const before = JSON.stringify(submissionEntry(result));
  explainMismatches(result.comparison);
  assert.equal(JSON.stringify(submissionEntry(result)), before);
  assert.equal(result.status, "MISMATCH");
});

test("the correction draft and evidence packet carry the explanation", async () => {
  const result = await compare({
    "Port of discharge": "TUTICORIN, INDIA (KEMBA)",
  });
  const draft = amendmentDraft(result);
  assert.equal(draft.available, true);
  assert.match(
    draft.text,
    /What changed: Same port code \(KEMBA\), different port name/,
  );
  assert.match(resolutionPacket(result), /Why \(clerical\): Same port code/);
});

test("edit distance", () => {
  assert.equal(editDistance("ATLAS", "ATLAS"), 0);
  assert.equal(editDistance("EXPORT", "EXPROT"), 2);
  assert.equal(editDistance("22000", "23000"), 1);
  assert.equal(editDistance("A", "ABCDEFGH"), 99);
});
