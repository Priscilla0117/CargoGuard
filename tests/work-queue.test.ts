import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import {
  matchesQueue,
  nextQueueCase,
  workQueue,
  caseDestination,
} from "../lib/work-queue";
import { PIPELINE_VERSION, summaryOf, type CaseSummary } from "../lib/types";

function row(
  id: string,
  workflow:
    | "verified"
    | "discrepancy"
    | "review"
    | "awaiting_documents"
    | "routed"
    | "pending",
): CaseSummary {
  const email = {
    email_id: id,
    subject: "Review Atlas shipment",
    from: "ship@example.test",
    body: "Please compare shipping instructions against draft BL",
    attachments: [],
  };
  if (workflow === "pending") return { email, result: null };
  const base = analyze(email, []);
  return summaryOf({
    ...base,
    workflow,
    pipeline_version: PIPELINE_VERSION,
    classification: { ...base.classification, needs_review: false },
    category: workflow === "routed" ? "GENERAL" : "BL_COMPARISON",
    status:
      workflow === "discrepancy"
        ? "MISMATCH"
        : workflow === "review" || workflow === "awaiting_documents"
          ? "NEEDS_REVIEW"
          : "OK",
    has_defect: workflow === "discrepancy",
    defect_fields: workflow === "discrepancy" ? ["container_count"] : [],
    review_reason:
      workflow === "awaiting_documents"
        ? "missing_attachment"
        : workflow === "review"
          ? "unreadable"
          : null,
  });
}
test("unified queue prioritizes work while keeping every category accessible", () => {
  const cases = [
    row("a", "routed"),
    row("b", "pending"),
    row("c", "verified"),
    row("d", "awaiting_documents"),
    row("e", "review"),
    row("f", "discrepancy"),
  ];
  const original = JSON.stringify(cases);
  assert.deepEqual(
    workQueue(cases).map((r) => r.email.email_id),
    ["f", "e", "d", "b", "c", "a"],
  );
  assert.equal(workQueue(cases, "action").length, 4);
  for (const filter of [
    "routed",
    "pending",
    "verified",
    "awaiting_documents",
    "review",
    "discrepancy",
  ])
    assert.equal(workQueue(cases, filter).length, 1);
  assert.equal(JSON.stringify(cases), original);
});
test("queue search combines outcome, category, ID, sender and defect fields", () => {
  const cases = [row("email_004", "discrepancy"), row("email_005", "routed")];
  assert.equal(
    workQueue(cases, "action", "BL_COMPARISON", " CONTAINER_COUNT ").length,
    1,
  );
  assert.equal(workQueue(cases, "all", "GENERAL", "atlas").length, 1);
  assert.equal(workQueue(cases, "all", "all", "ship@example.test").length, 2);
  assert.equal(workQueue(cases, "all", "all", "email_005").length, 1);
  assert.equal(workQueue(cases, "verified").length, 0);
});
test("old-engine verified cases belong to recheck, not checked", () => {
  const r = row("old", "verified");
  r.result!.pipeline_version = "older";
  assert.equal(matchesQueue(r, "verified"), false);
  assert.equal(matchesQueue(r, "action"), true);
  assert.equal(matchesQueue(r, "pending"), true);
});
test("unknown filter and empty input return no cases safely", () => {
  assert.deepEqual(workQueue([], "all"), []);
  assert.deepEqual(workQueue([row("one", "review")], "unknown"), []);
});
test("ties are stably ordered by case ID", () => {
  assert.deepEqual(
    workQueue([row("z", "review"), row("a", "review")]).map(
      (r) => r.email.email_id,
    ),
    ["a", "z"],
  );
});
test("next case uses original queue after a saved correction leaves the filter", () => {
  assert.equal(nextQueueCase(["a", "b", "c"], "a", ["a", "b", "c"]), "b");
  assert.equal(nextQueueCase(["a", "b", "c"], "a", ["b", "c"]), "b");
});
test("next case never wraps, jumps out of the queue, or returns removed cases", () => {
  assert.equal(nextQueueCase(["a", "b", "c"], "b", ["a", "b", "d"]), null);
  assert.equal(nextQueueCase(["a", "b", "c"], "c", ["a", "b", "c"]), null);
  assert.equal(
    nextQueueCase(["a", "b", "c"], "outside", ["a", "b", "c"]),
    null,
  );
  assert.equal(nextQueueCase(["a", "b", "c"], "a", ["a", "c"]), "c");
  assert.equal(nextQueueCase([], "a", ["a"]), null);
});
test("legacy evidence and assistant destinations resolve to three case sections", () => {
  assert.deepEqual(caseDestination("resolution"), {
    tab: "comparison",
    email: false,
    resolution: true,
  });
  assert.deepEqual(caseDestination("email"), {
    tab: "documents",
    email: true,
    resolution: false,
  });
  assert.deepEqual(caseDestination("documents"), {
    tab: "documents",
    email: false,
    resolution: false,
  });
  assert.equal(caseDestination("history").tab, "history");
  assert.equal(caseDestination("unknown").tab, "comparison");
});
