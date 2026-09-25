import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze, extract } from "../lib/compare";
import { correctField } from "../lib/corrections";
import { parseDocument } from "../lib/parsers";
import {
  amendmentResolution,
  amendmentResolutionBrief,
} from "../lib/amendment-resolution";
import { shipmentPair, type Shipment } from "../lib/shipments";
import type { CaseResult } from "../lib/types";

const fields = [
  "Shipper: Atlas Export",
  "Consignee: Buyer One",
  "Notify party: SAME AS CONSIGNEE",
  "Port of loading: Port Klang",
  "Port of discharge: Singapore",
  "Container count: 2",
  "Gross weight (KG): 42000",
].join("\n");

async function compared(id: string, si = fields, bl = si): Promise<CaseResult> {
  const docs = await Promise.all([
    parseDocument(
      "si.txt",
      new TextEncoder().encode("SHIPPING INSTRUCTION\n" + si),
    ),
    parseDocument(
      "bl.txt",
      new TextEncoder().encode("DRAFT BILL OF LADING\n" + bl),
    ),
  ]);
  return {
    ...analyze(
      {
        email_id: id,
        from: "desk@example.test",
        subject: "Verify draft BL against SI",
        body: "Please compare the attached SI and draft BL.",
        attachments: ["si.txt", "bl.txt"],
      },
      docs,
    ),
    version: 1,
  };
}

async function fixture() {
  const original = await compared("original");
  const instruction = {
    ...analyze(
      {
        email_id: "instruction",
        from: "desk@example.test",
        subject: "Shipping update",
        body: "Please change consignee to Buyer Two",
        attachments: [],
      },
      [],
    ),
    version: 1,
  };
  const at = "2026-09-24T04:00:00Z";
  const shipment: Shipment = {
    id: "shipment",
    version: 1,
    title: "Synthetic amendment exercise",
    customer: "Example",
    carrier: "Example",
    references: ["TEST123456"],
    case_ids: ["original", "instruction"],
    comparison_case_id: "original",
    owner: "Reviewer",
    owner_id: null,
    state: "open",
    completed_cases: {},
    deadlines: [],
    tasks: [],
    notes: "",
    created_at: at,
    updated_at: at,
    actor: "Reviewer",
    amendments: [
      {
        id: "change",
        field: "consignee",
        value: "Buyer Two",
        quote: instruction.email.body,
        source_case: "instruction",
        source_version: 1,
        si_sha256: shipmentPair(original).si!.sha256!,
        proposed_by: "Operator",
        proposed_at: at,
        status: "approved",
        decided_by: "Reviewer",
        decided_at: at,
        reason: "Confirmed issuer instruction",
      },
    ],
  };
  return { original, instruction, shipment, at };
}

function incorporate(shipment: Shipment, target: CaseResult, at: string) {
  const si = shipmentPair(target).si!;
  const source = extract(si).consignee;
  shipment.amendments[0].incorporation = {
    case_id: target.email.email_id,
    case_version: target.version,
    si_sha256: si.sha256!,
    si_value: source.raw,
    si_evidence: source.evidence,
    actor: "Reviewer",
    at,
    reason: "Checked issuer revised SI against the approved instruction",
  };
}

test("resolution explains why matching original documents cannot satisfy a later instruction", async () => {
  const f = await fixture();
  const brief = amendmentResolution(f.shipment, [f.original, f.instruction]);
  assert.equal(brief.matched_fields, 7);
  assert.equal(brief.state, "awaiting_revised_si");
  assert.equal(brief.rows[0].can_reconcile, false);
  assert.ok(
    brief.blockers.some((b) => b.includes("effective approved instruction")),
  );
});

test("incorporated consignee still exposes an unrelated wrong port in the new BL", async () => {
  const f = await fixture();
  const si = fields.replace("Buyer One", "Buyer Two");
  const revised = await compared(
    "revised",
    si,
    si.replace("Singapore", "Rotterdam"),
  );
  f.shipment.case_ids.push("revised");
  f.shipment.comparison_case_id = "revised";
  const sources = [f.original, f.instruction, revised];
  let model = amendmentResolution(f.shipment, sources);
  assert.equal(model.state, "ready_to_reconcile");
  assert.equal(model.rows[0].can_reconcile, true);
  assert.deepEqual(
    model.issues.map((i) => i.field),
    ["port_of_discharge"],
  );
  incorporate(f.shipment, revised, f.at);
  model = amendmentResolution(f.shipment, sources);
  assert.equal(model.state, "needs_correction");
  assert.equal(model.rows[0].state, "incorporated");
  assert.equal(model.matched_fields, 6);
});

test("a source revision makes recorded incorporation stale and the brief says so", async () => {
  const f = await fixture();
  const revised = await compared(
    "revised",
    fields.replace("Buyer One", "Buyer Two"),
  );
  f.shipment.case_ids.push("revised");
  f.shipment.comparison_case_id = "revised";
  incorporate(f.shipment, revised, f.at);
  const changed = { ...revised, version: 2 };
  const model = amendmentResolution(f.shipment, [
    f.original,
    f.instruction,
    changed,
  ]);
  assert.equal(model.state, "ready_to_reconcile");
  assert.equal(model.rows[0].state, "reconcile");
  const text = amendmentResolutionBrief(
    f.shipment,
    [f.original, f.instruction, changed],
    f.at,
  );
  assert.match(text, /Proof is current: No/);
  assert.match(text, /revised, revision 2/);
  assert.match(text, new RegExp(revised.documents[0].sha256!));
});

test("changed instruction evidence cannot look ready for sign-off", async () => {
  const f = await fixture();
  const revised = await compared(
    "revised",
    fields.replace("Buyer One", "Buyer Two"),
  );
  f.shipment.case_ids.push("revised");
  f.shipment.comparison_case_id = "revised";
  incorporate(f.shipment, revised, f.at);
  const model = amendmentResolution(f.shipment, [
    f.original,
    { ...f.instruction, version: 2 },
    revised,
  ]);
  assert.equal(model.state, "needs_review");
  assert.equal(model.rows[0].can_reconcile, false);
  assert.match(model.rows[0].reason!, /evidence changed/);
});

test("case selection cannot be inferred from an unrelated displayed email", async () => {
  const f = await fixture();
  f.shipment.comparison_case_id = null;
  const model = amendmentResolution(f.shipment, [f.original, f.instruction]);
  assert.equal(model.state, "awaiting_selection");
  assert.equal(model.comparison_case_id, null);
  assert.equal(model.matched_fields, 0);
});

test("an incomplete comparison is explained without manufacturing a seven-field result", async () => {
  const f = await fixture();
  const model = amendmentResolution(f.shipment, [
    { ...f.original, comparison: [] },
    f.instruction,
  ]);
  assert.equal(model.matched_fields, 0);
  assert.equal(model.rows[0].can_reconcile, false);
  assert.notEqual(model.state, "ready_for_signoff");
});

test("formatting-only instruction already supported by original SI needs no replacement", async () => {
  const f = await fixture();
  f.shipment.amendments[0].value = "BUYER ONE";
  f.shipment.amendments[0].quote = "Please change consignee to BUYER ONE";
  f.instruction.email.body = f.shipment.amendments[0].quote;
  const model = amendmentResolution(f.shipment, [f.original, f.instruction]);
  assert.equal(model.rows[0].state, "aligned");
  assert.equal(model.rows[0].can_reconcile, false);
  assert.notEqual(model.state, "awaiting_revised_si");
});

test("manual SI edits cannot make an approved change look supported by the original source", async () => {
  const f = await fixture();
  let edited = correctField(
    f.original,
    { field: "consignee", side: "si", value: "Buyer Two" },
    "Reviewer",
  );
  edited = correctField(
    edited,
    { field: "consignee", side: "bl", value: "Buyer Two" },
    "Reviewer",
  );
  const model = amendmentResolution(f.shipment, [edited, f.instruction]);
  assert.equal(model.rows[0].state, "blocked");
  assert.equal(model.state, "awaiting_revised_si");
  assert.ok(model.blockers.some((b) => b.includes("revised SI")));
  assert.equal(model.can_request_revised_si, true);
});

test("pending proposal takes priority and an open task remains a sign-off blocker", async () => {
  const f = await fixture();
  f.shipment.amendments[0].status = "proposed";
  f.shipment.tasks.push({
    id: "task",
    case_id: "original",
    kind: "handover",
    title: "Contact issuer",
    body: "Draft",
    owner: "Operator",
    state: "waiting",
    created_at: f.at,
    updated_at: f.at,
    actor: "Reviewer",
  });
  const model = amendmentResolution(f.shipment, [f.original, f.instruction]);
  assert.equal(model.state, "awaiting_decisions");
  assert.equal(model.open_tasks, 1);
  assert.ok(model.blockers.some((b) => b.includes("task is still open")));
});
