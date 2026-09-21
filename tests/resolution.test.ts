import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { resolutionPlan, resolutionPacket } from "../lib/resolution";
import type { CaseResult, Email } from "../lib/types";

const email: Email = {
  email_id: "handoff-test",
  from: "desk@example.test",
  subject: "Verify draft BL against SI",
  body: "Please compare the attached SI and draft BL and report differences.",
  attachments: ["source.txt", "draft.txt"],
};
const fields =
  "Shipper: Atlas Export\nConsignee: Buyer Two\nNotify party: SAME AS CONSIGNEE\nPort of loading: Port Klang\nPort of discharge: Singapore\nContainer count: 2\nGross weight (KG): 42000";
async function fixture(bl = fields): Promise<CaseResult> {
  return analyze(
    email,
    await Promise.all([
      parseDocument(
        "source.txt",
        new TextEncoder().encode(`SHIPPING INSTRUCTION\n${fields}`),
      ),
      parseDocument(
        "draft.txt",
        new TextEncoder().encode(`DRAFT BILL OF LADING\n${bl}`),
      ),
    ]),
  );
}

test("handoff exposes both uncertainty and known differences without falsely clearing a case", async () => {
  const result = await fixture(
    fields
      .replace("Gross weight (KG): 42000", "Gross weight (KG): unknown")
      .replace("Container count: 2", "Container count: 4"),
  );
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.has_defect, false);
  const plan = resolutionPlan(result);
  assert.equal(plan.uncertain, 1);
  assert.equal(plan.differences, 1);
  assert.match(plan.steps[0].title, /uncertain/);
  assert.match(plan.steps[1].detail, /remain open/);
  assert.match(resolutionPacket(result), /Containers: MISMATCH/);
  assert.match(resolutionPacket(result), /Gross weight \(kg\): UNCERTAIN/);
});

test("handoff retains exact sources, hashes, revision, and no-send limitation", async () => {
  const result = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  result.version = 7;
  result.reviewed = true;
  const packet = resolutionPacket(result);
  assert.match(packet, /Revision: 7/);
  assert.match(packet, /Human-reviewed: yes/);
  assert.match(packet, /Nothing has been sent/);
  assert.match(packet, /not an LLM response/);
  assert.ok(packet.includes(result.documents[0].sha256!));
  assert.match(packet, /exact verdict: MISMATCH/);
  assert.match(packet, /An amendment request is not a resolved discrepancy/);
});

test("verified means document comparison complete, not cargo release", async () => {
  const result = await fixture();
  assert.equal(result.workflow, "verified");
  const plan = resolutionPlan(result);
  assert.equal(plan.label, "Comparison complete");
  assert.match(plan.steps[0].detail, /not permission to release cargo/);
});

test("unreadable, role, routing and missing evidence get distinct next actions", async () => {
  const base = await fixture();
  for (const [reason, phrase, target] of [
    ["unreadable", "Recover readable", "documents"],
    ["wrong_doc_type", "Resolve document roles", "documents"],
    ["missing_attachment", "Obtain the missing", "documents"],
    ["uncertain_category", "Confirm the current", "email"],
  ] as const) {
    const plan = resolutionPlan({
      ...base,
      workflow: "review",
      status: "NEEDS_REVIEW",
      comparison: [],
      review_reason: reason,
    });
    assert.ok(plan.steps[0].title.includes(phrase));
    assert.equal(plan.steps[0].target, target);
  }
});

test("routed spam is not declared verified and retains isolation guidance", async () => {
  const base = await fixture();
  const plan = resolutionPlan({
    ...base,
    category: "SPAM",
    workflow: "routed",
    comparison: [],
    review_reason: null,
  });
  assert.equal(plan.label, "Routing only");
  assert.match(plan.steps[0].detail, /Do not open untrusted links/);
});
