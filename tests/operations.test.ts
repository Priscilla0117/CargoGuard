import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import {
  FIELDS,
  PIPELINE_VERSION,
  summaryOf,
  type CaseResult,
  type Email,
} from "../lib/types";
import {
  laneFor,
  LANES,
  operationsSnapshot,
  shiftBrief,
} from "../lib/operations";
import {
  amendmentDraft,
  answerCase,
  comparisonComplete,
  GUIDE_QUESTIONS,
  type GuideQuestion,
} from "../lib/case-guide";

const email: Email = {
  email_id: "operations-test",
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

test("unprocessed and older engine results are recheck work, never handoff", async () => {
  assert.equal(laneFor({ email, result: null }), "refresh");
  const r = await fixture();
  assert.equal(laneFor(summaryOf(r)), "handoff");
  r.pipeline_version = "old";
  assert.equal(laneFor(summaryOf(r)), "refresh");
  assert.equal(comparisonComplete(r), false);
  assert.match(answerCase(r, "readiness").paragraphs.join(" "), /older engine/);
});
test("each case belongs to exactly one queue; stable sorting does not mutate input", async () => {
  const r = await fixture();
  const cases = [
    summaryOf({ ...r, email: { ...email, email_id: "z" } }),
    { email: { ...email, email_id: "a" }, result: null },
    summaryOf({ ...r, email: { ...email, email_id: "b" } }),
  ];
  const before = JSON.stringify(cases);
  const s = operationsSnapshot(cases);
  assert.equal(
    LANES.reduce((n, l) => n + s.lanes[l].length, 0),
    3,
  );
  assert.equal(s.actionRequired, 1);
  assert.deepEqual(
    s.lanes.handoff.map((c) => c.email.email_id),
    ["b", "z"],
  );
  assert.equal(JSON.stringify(cases), before);
});
test("all workflow lanes and inconsistent states fail safely", async () => {
  const r = await fixture();
  for (const [workflow, status, category, expected] of [
    ["review", "NEEDS_REVIEW", "BL_COMPARISON", "recover"],
    ["awaiting_documents", "NEEDS_REVIEW", "BL_COMPARISON", "request"],
    ["routed", "OK", "GENERAL", "routed"],
    ["verified", "OK", "SPAM", "recover"],
    ["verified", "MISMATCH", "BL_COMPARISON", "recover"],
  ] as const)
    assert.equal(
      laneFor(summaryOf({ ...r, workflow, status, category })),
      expected,
    );
});
test("uncertain classification is not handoff or routed unless human confirmed", async () => {
  const r = await fixture();
  r.classification.needs_review = true;
  assert.equal(laneFor(summaryOf(r)), "recover");
  assert.equal(comparisonComplete(r), false);
  r.category_override = "BL_COMPARISON";
  assert.equal(laneFor(summaryOf(r)), "handoff");
  assert.equal(comparisonComplete(r), true);
});
test("field patterns count each discrepancy case once and exclude old or review results", async () => {
  const r = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  const repeated = {
    ...r,
    defect_fields: [...r.defect_fields, ...r.defect_fields],
  };
  const s = operationsSnapshot([
    summaryOf(repeated),
    summaryOf({ ...r, pipeline_version: "old" }),
    summaryOf({ ...r, workflow: "review", status: "NEEDS_REVIEW" }),
  ]);
  assert.equal(s.fieldCounts.container_count, 1);
  assert.equal(s.lanes.amend.length, 1);
  assert.equal(s.actionRequired, 3);
});
test("empty operations snapshot and brief contain no fabricated savings", () => {
  const s = operationsSnapshot([]);
  assert.equal(s.total, 0);
  assert.equal(s.actionRequired, 0);
  const text = shiftBrief([], "2026-09-21T00:00:00Z");
  assert.match(text, /Scope: 0/);
  assert.match(text, /not measured time or money saved/);
});
test("shift brief binds to revisions and distinguishes historical engine", async () => {
  const r = await fixture();
  r.version = 9;
  r.pipeline_version = "old";
  const text = shiftBrief([summaryOf(r)], "2026-09-21T00:00:00Z");
  assert.match(text, /PROCESS \/ RECHECK \(1\)/);
  assert.match(text, /r9/);
  assert.match(text, /Later revisions are not included/);
});
test("verified readiness requires all seven distinct field rows", async () => {
  const r = await fixture();
  assert.equal(comparisonComplete(r), true);
  assert.equal(comparisonComplete({ ...r, comparison: [] }), false);
  assert.equal(
    comparisonComplete({
      ...r,
      comparison: [...r.comparison.slice(1), r.comparison[1]],
    }),
    false,
  );
  assert.equal(
    comparisonComplete({
      ...r,
      comparison: r.comparison.map((row, i) =>
        i ? row : { ...row, si: { ...row.si, normalized: null } },
      ),
    }),
    false,
  );
});
test("navigator never equates a completed check with release permission", async () => {
  const answer = answerCase(await fixture(), "readiness");
  assert.match(answer.title, /operational approval is separate/);
  assert.match(answer.paragraphs.join(" "), /does not approve cargo release/);
});
test("navigator exposes known differences alongside uncertainty", async () => {
  const r = await fixture(
    fields
      .replace("Container count: 2", "Container count: 4")
      .replace("Gross weight (KG): 42000", "Gross weight (KG): unknown"),
  );
  assert.equal(r.has_defect, false);
  const answer = answerCase(r, "evidence");
  assert.equal(answer.rows.length, 2);
  assert.deepEqual(answer.rows.map((row) => row.result).sort(), [
    "mismatch",
    "uncertain",
  ]);
  assert.equal(
    answerCase(r, "readiness").title,
    "Do not treat this case as verified",
  );
});
test("navigator missing comparisons never claims all fields match", async () => {
  const answer = answerCase(
    {
      ...(await fixture()),
      comparison: [],
      workflow: "review",
      status: "NEEDS_REVIEW",
    },
    "evidence",
  );
  assert.equal(answer.rows.length, 0);
  assert.match(answer.paragraphs.join(" "), /no completed field comparison/);
});
test("navigator answers all bounded questions without changing the case", async () => {
  const r = await fixture();
  const before = JSON.stringify(r);
  for (const key of Object.keys(GUIDE_QUESTIONS) as GuideQuestion[]) {
    const a = answerCase(r, key);
    assert.ok(a.title);
    assert.ok(a.paragraphs.length);
  }
  assert.equal(JSON.stringify(r), before);
  assert.match(
    answerCase(r, "privacy").paragraphs.join(" "),
    /not an LLM conversation/,
  );
});
test("routing guide explains human override and uncalibrated score", async () => {
  const r = await fixture();
  r.category_override = "BL_COMPARISON";
  const text = answerCase(r, "route").paragraphs.join(" ");
  assert.match(text, /human category override/);
  assert.match(text, /not a calibrated probability/);
});
test("draft copies exact SI reference and BL evidence without modifying case", async () => {
  const r = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  r.version = 8;
  const before = JSON.stringify(r);
  const draft = amendmentDraft(r);
  assert.equal(draft.available, true);
  assert.equal(draft.differences, 1);
  assert.equal(draft.unresolved, 0);
  assert.match(draft.text, /SI reference: 2/);
  assert.match(draft.text, /Current draft BL: 4/);
  assert.match(draft.text, /revision 8/);
  assert.ok(draft.text.includes(r.documents[0].sha256!));
  assert.match(draft.text, /NOTHING HAS BEEN SENT/);
  assert.match(draft.text, /does not resolve the discrepancy/);
  assert.equal(JSON.stringify(r), before);
});
test("partial amendment explicitly includes uncertain fields and never recommends their replacement", async () => {
  const r = await fixture(
    fields
      .replace("Container count: 2", "Container count: 4")
      .replace("Gross weight (KG): 42000", "Gross weight (KG): unknown"),
  );
  const draft = amendmentDraft(r);
  assert.equal(draft.available, true);
  assert.equal(draft.differences, 1);
  assert.equal(draft.unresolved, 1);
  assert.match(draft.text, /INCOMPLETE CHECK/);
  assert.match(draft.text, /Gross weight \(kg\)/);
  assert.match(draft.text, /partial amendment request/);
  assert.doesNotMatch(draft.text, /SI reference: 42000/);
});
test("no mismatch means no fabricated draft", async () => {
  const draft = amendmentDraft(await fixture());
  assert.equal(draft.available, false);
  assert.equal(draft.text, "");
});
test("old results cannot produce an amendment", async () => {
  const r = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  assert.equal(
    amendmentDraft({ ...r, pipeline_version: "old" }).available,
    false,
  );
});
test("wrong roles, unreadable, missing and uncertain routing block amendment", async () => {
  const r = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  for (const review_reason of [
    "wrong_doc_type",
    "unreadable",
    "missing_attachment",
    "uncertain_category",
  ] as const)
    assert.equal(amendmentDraft({ ...r, review_reason }).available, false);
  assert.equal(amendmentDraft({ ...r, category: "GENERAL" }).available, false);
  assert.equal(
    amendmentDraft({
      ...r,
      classification: { ...r.classification, needs_review: true },
    }).available,
    false,
  );
});
test("invalid mismatch values are not exported as amendment facts", async () => {
  const r = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  r.comparison = r.comparison.map((row) =>
    row.result === "mismatch"
      ? { ...row, si: { ...row.si, issue: "uncertain" } }
      : row,
  );
  assert.equal(amendmentDraft(r).available, false);
});
test("queue totals, pattern keys and engine stay tied to actual case data", async () => {
  const r = await fixture();
  assert.equal(r.pipeline_version, PIPELINE_VERSION);
  assert.deepEqual(
    Object.keys(operationsSnapshot([summaryOf(r)]).fieldCounts),
    [...FIELDS],
  );
});
test("amendment refuses incomplete or duplicate-field comparisons", async () => {
  const r = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  assert.equal(
    amendmentDraft({ ...r, comparison: r.comparison.slice(1) }).available,
    false,
  );
  assert.equal(
    amendmentDraft({
      ...r,
      comparison: [...r.comparison.slice(1), r.comparison[1]],
    }).available,
    false,
  );
});
test("excluded invalid differences remain visibly unresolved in a partial draft", async () => {
  const r = await fixture(
    fields
      .replace("Container count: 2", "Container count: 4")
      .replace("Gross weight (KG): 42000", "Gross weight (KG): 50000"),
  );
  r.comparison = r.comparison.map((row) =>
    row.field === "gross_weight_kg"
      ? { ...row, si: { ...row.si, issue: "needs confirmation" } }
      : row,
  );
  const draft = amendmentDraft(r);
  assert.equal(draft.available, true);
  assert.equal(draft.differences, 1);
  assert.equal(draft.unresolved, 1);
  assert.match(draft.text, /INCOMPLETE CHECK/);
  assert.doesNotMatch(draft.text, /SI reference: 42000/);
});
