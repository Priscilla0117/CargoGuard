import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDocument } from "../lib/parsers";
import { analyze } from "../lib/compare";
import {
  analyzeReplacement,
  replacementSources,
} from "../lib/source-replacement";

const bytes = (role: string, weight = 42000) =>
  new TextEncoder().encode(
    `${role}\nShipper: EXPORT LTD\nConsignee: IMPORT LTD\nNotify Party: SAME AS CONSIGNEE\nPort of Loading: PORT KLANG\nPort of Discharge: SINGAPORE\nContainer Count: 2\nGross Weight: ${weight} KG`,
  );
async function fixture() {
  const docs = await Promise.all([
    parseDocument("si.txt", bytes("SHIPPING INSTRUCTION")),
    parseDocument("bl.txt", bytes("BILL OF LADING", 43000)),
  ]);
  return analyze(
    {
      email_id: "test",
      from: "x@example.test",
      subject: "Please compare SI and draft BL",
      body: "Check all fields",
      attachments: ["si.txt", "bl.txt"],
    },
    docs,
    0,
    "BL_COMPARISON",
  );
}
test("replace one BL preserves SI, historical objects, and recomputes verdict", async () => {
  const previous = await fixture(),
    original = structuredClone(previous);
  assert.equal(previous.status, "MISMATCH");
  const retained = replacementSources(
    previous,
    "replace_one",
    "bl.txt",
    previous.documents[1].sha256,
  );
  assert.deepEqual(retained.paths, ["si.txt"]);
  const updated = await parseDocument("new-bl.txt", bytes("BILL OF LADING"));
  const next = analyzeReplacement(
    previous,
    [...retained.documents, updated],
    [...retained.paths, "new-bl.txt"],
  );
  assert.equal(next.status, "OK");
  assert.equal(next.documents[0].sha256, previous.documents[0].sha256);
  assert.deepEqual(previous, original);
  assert.equal(next.source_replaced, true);
});
test("replacement rejects missing and stale document identity", async () => {
  const previous = await fixture();
  assert.throws(
    () => replacementSources(previous, "replace_one", "bl.txt", "bad-hash"),
    /changed/,
  );
  assert.throws(
    () => replacementSources(previous, "replace_one", "not-a-source.txt"),
    /changed/,
  );
});
test("appending a second BL never silently selects the latest one", async () => {
  const previous = await fixture(),
    retained = replacementSources(previous, "append");
  const extra = await parseDocument("extra.txt", bytes("BILL OF LADING"));
  const next = analyzeReplacement(
    previous,
    [...retained.documents, extra],
    [...retained.paths, extra.name],
  );
  assert.equal(next.status, "NEEDS_REVIEW");
});
test("unchanged SI corrections survive but corrections on a replaced BL do not", async () => {
  const previous = await fixture();
  for (const row of previous.comparison)
    if (row.field === "gross_weight_kg") {
      row.si = {
        ...row.si,
        raw: "42500 KG",
        normalized: 42500,
        method: "Human correction — confirmed",
      };
      row.bl = {
        ...row.bl,
        raw: "42500 KG",
        normalized: 42500,
        method: "Human correction — confirmed",
      };
    }
  const retained = replacementSources(
    previous,
    "replace_one",
    "bl.txt",
    previous.documents[1].sha256,
  );
  const doc = await parseDocument("new-bl.txt", bytes("BILL OF LADING"));
  const next = analyzeReplacement(
    previous,
    [...retained.documents, doc],
    [...retained.paths, doc.name],
  );
  const weight = next.comparison.find((r) => r.field === "gross_weight_kg")!;
  assert.equal(weight.si.normalized, 42500);
  assert.equal(weight.bl.normalized, 42000);
  assert.equal(next.status, "MISMATCH");
});
