import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import { correctField } from "../lib/corrections";
import {
  blAmendmentSuggestion,
  readingSuggestion,
} from "../lib/correction-suggestions";
import { parseDocument } from "../lib/parsers";
import { draftReply } from "../lib/reply";
import type { CaseResult } from "../lib/types";

async function fixture(
  options: {
    siWeight?: string;
    blWeight?: string;
    blConsignee?: string;
    blNotify?: string;
  } = {},
) {
  const source = (
    kind: string,
    weight: string,
    consignee = "BETA LTD",
    notify = "SAME AS CONSIGNEE",
  ) =>
    new TextEncoder().encode(
      `${kind}\nShipper: ALPHA LTD\nConsignee: ${consignee}\nNotify Party: ${notify}\nPort of Loading: SINGAPORE\nPort of Discharge: ROTTERDAM\nContainer Count: 2 x 40HC\nGross Weight: ${weight}`,
    );
  return analyze(
    {
      email_id: "correction-suggestions",
      from: "desk@example.test",
      subject: "Please check draft BL",
      body: "Please compare the SI and draft BL.",
      attachments: ["si.txt", "bl.txt"],
    },
    [
      await parseDocument(
        "si.txt",
        source("SHIPPING INSTRUCTION", options.siWeight ?? "42000 KG"),
      ),
      await parseDocument(
        "bl.txt",
        source(
          "DRAFT BILL OF LADING",
          options.blWeight ?? "43000 KG",
          options.blConsignee,
          options.blNotify,
        ),
      ),
    ],
  );
}

function selectCurrent(result: CaseResult) {
  return {
    si: { name: result.documents[0].name, sha256: result.documents[0].sha256! },
    bl: { name: result.documents[1].name, sha256: result.documents[1].sha256! },
    actor: "Reviewer",
    reason: "Confirmed the current pair",
    selected_at: new Date().toISOString(),
  };
}

test("a BL amendment prefill uses the SI without changing the received reading or source", async () => {
  const result = await fixture();
  const snapshot = structuredClone(result);
  assert.deepEqual(blAmendmentSuggestion(result, "gross_weight_kg"), {
    value: "42000 KG",
    current: "43000 KG",
    source: "si.txt",
    evidence: "Line 8",
  });
  assert.equal(readingSuggestion(result, "gross_weight_kg", "bl"), null);
  const draft = draftReply(result, { intent: "request_correction" });
  assert.match(draft.body, /42000 KG/);
  assert.match(draft.body, /43000 KG/);
  assert.deepEqual(result, snapshot);
});

test("a mistaken manual reading can be restored from the BL evidence without copying the SI", async () => {
  const result = correctField(
    await fixture(),
    {
      field: "gross_weight_kg",
      side: "bl",
      value: "42000 KG",
    },
    "Reviewer",
  );
  assert.equal(result.status, "NEEDS_REVIEW");
  const suggestion = readingSuggestion(result, "gross_weight_kg", "bl");
  assert.equal(suggestion?.value, "43000 KG");
  assert.equal(suggestion?.source, "bl.txt");
  assert.equal(blAmendmentSuggestion(result, "gross_weight_kg"), null);
  const restored = correctField(
    result,
    {
      field: "gross_weight_kg",
      side: "bl",
      value: suggestion!.value,
    },
    "Reviewer",
  );
  assert.equal(
    restored.comparison.find((row) => row.field === "gross_weight_kg")?.result,
    "mismatch",
  );
});

test("missing, uncertain and already matching fields do not invent an amendment", async () => {
  for (const options of [
    { siWeight: "TBA / TBC" },
    { blWeight: "TO BE ADVISED (TBA)" },
    { blWeight: "42000 KG" },
  ]) {
    const result = await fixture(options);
    assert.equal(blAmendmentSuggestion(result, "gross_weight_kg"), null);
    assert.equal(readingSuggestion(result, "gross_weight_kg", "bl"), null);
  }
});

test("stale engines, changed selections and changed source identities suppress prefills", async () => {
  const base = await fixture();
  const staleSelection = structuredClone(base);
  staleSelection.document_selection = selectCurrent(staleSelection);
  staleSelection.document_selection.si.sha256 = "0".repeat(64);
  const wrongSource = structuredClone(base);
  wrongSource.comparison.find(
    (row) => row.field === "gross_weight_kg",
  )!.si.source = "old-si.txt";
  const staleCorrection = structuredClone(base);
  staleCorrection.comparison.find(
    (row) => row.field === "gross_weight_kg",
  )!.bl.correction = {
    state: "confirmed",
    source_sha256: "0".repeat(64),
  };
  for (const result of [
    { ...base, pipeline_version: "outdated" },
    staleSelection,
    wrongSource,
    staleCorrection,
  ]) {
    assert.equal(blAmendmentSuggestion(result, "gross_weight_kg"), null);
    assert.equal(readingSuggestion(result, "gross_weight_kg", "bl"), null);
  }
});

test("multiple SI drafts require an explicit current source selection", async () => {
  const result = await fixture();
  result.documents.push({
    ...structuredClone(result.documents[0]),
    name: "other-si.txt",
  });
  assert.equal(blAmendmentSuggestion(result, "gross_weight_kg"), null);
  result.document_selection = selectCurrent(result);
  assert.equal(
    blAmendmentSuggestion(result, "gross_weight_kg")?.value,
    "42000 KG",
  );
});

test("unsupported or stale manual values cannot become proposed SI instructions", async () => {
  const base = await fixture();
  const result = correctField(
    base,
    {
      field: "gross_weight_kg",
      side: "si",
      value: "44000 KG",
    },
    "Reviewer",
  );
  // Also defend the UI helper when a stored row contains an inconsistent result.
  result.comparison.find((row) => row.field === "gross_weight_kg")!.result =
    "mismatch";
  assert.equal(blAmendmentSuggestion(result, "gross_weight_kg"), null);
  assert.equal(
    readingSuggestion(result, "gross_weight_kg", "si")?.value,
    "42000 KG",
  );
  const stale = structuredClone(base);
  stale.comparison.find(
    (row) => row.field === "gross_weight_kg",
  )!.si.normalized = 44000;
  assert.equal(blAmendmentSuggestion(stale, "gross_weight_kg"), null);
});

test("a derived notify-party difference proposes its actual consignee correction only", async () => {
  const result = await fixture({ blConsignee: "DIFFERENT LTD" });
  assert.equal(
    result.comparison.find((row) => row.field === "notify_party")!.result,
    "mismatch",
  );
  assert.equal(blAmendmentSuggestion(result, "notify_party"), null);
  assert.equal(blAmendmentSuggestion(result, "consignee")?.value, "BETA LTD");
});

test("equivalent notify-party references request only the underlying consignee amendment", async () => {
  const result = await fixture({
    blConsignee: "DIFFERENT LTD",
    blNotify: "AS PER THE CONSIGNEE.",
    blWeight: "42000 KG",
  });
  assert.equal(
    result.comparison.find((row) => row.field === "notify_party")!.result,
    "mismatch",
  );
  assert.equal(blAmendmentSuggestion(result, "notify_party"), null);
  assert.equal(blAmendmentSuggestion(result, "consignee")?.value, "BETA LTD");
  for (const tone of ["short", "formal", "friendly"] as const) {
    const draft = draftReply(result, { intent: "request_correction", tone });
    assert.match(draft.body, /following detail does not match/);
    assert.match(draft.body, /1\. Consignee/);
    assert.doesNotMatch(draft.body, /2\./);
    assert.match(
      draft.body,
      /Notify party .*AS PER THE CONSIGNEE\.\W+ will be correct once the above is amended\./,
    );
  }
});

test("unclear source evidence and malformed duplicate rows cannot supply a reading prefill", async () => {
  const result = await fixture();
  const row = result.comparison.find(
    (item) => item.field === "gross_weight_kg",
  )!;
  row.bl.raw = "41000 KG";
  result.documents[1].lines.push({
    text: "Gross Weight: 45000 KG",
    location: "Line 10",
  });
  assert.equal(readingSuggestion(result, "gross_weight_kg", "bl"), null);
  const duplicate = await fixture();
  duplicate.comparison.push(
    structuredClone(
      duplicate.comparison.find((item) => item.field === "gross_weight_kg")!,
    ),
  );
  assert.equal(blAmendmentSuggestion(duplicate, "gross_weight_kg"), null);
});
