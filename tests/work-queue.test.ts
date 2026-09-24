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
import type { FollowUp } from "../lib/follow-up";

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
  assert.equal(caseDestination("followup").tab, "followup");
});

function followup(
  current: CaseSummary,
  overrides: Partial<FollowUp> = {},
): FollowUp {
  return {
    email_id: current.email.email_id,
    version: 1,
    case_version: current.result!.version,
    owner: "Amina",
    shipment_reference: "BOOK-204",
    due_at: "2026-09-23T02:00:00.000Z",
    state: "waiting",
    note: "Await corrected port from issuer",
    actor: "Amina",
    updated_at: "2026-09-22T02:00:00.000Z",
    created_at: "2026-09-22T02:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}
const queueTime = Date.parse("2026-09-23T04:00:00.000Z");

test("follow-up queues keep document mismatches visible and use only recorded deadlines", () => {
  const mismatch = row("mismatch", "discrepancy"),
    missing = row("missing", "review"),
    verified = row("checked", "verified");
  const map = {
    mismatch: followup(mismatch),
    missing: followup(missing, { due_at: null }),
    checked: followup(verified, { state: "completed" }),
  };
  assert.equal(matchesQueue(mismatch, "waiting", map, queueTime), true);
  assert.equal(matchesQueue(mismatch, "discrepancy", map, queueTime), true);
  assert.equal(matchesQueue(mismatch, "overdue", map, queueTime), true);
  assert.equal(matchesQueue(missing, "overdue", map, queueTime), false);
  assert.equal(matchesQueue(verified, "overdue", map, queueTime), false);
  assert.equal(
    workQueue([mismatch], "all", "all", "amina", map, queueTime).length,
    1,
  );
  assert.equal(
    workQueue([mismatch], "all", "all", "book-204", map, queueTime).length,
    1,
  );
});

test("changed revision reopens completed follow-up even when new comparison matches", () => {
  const current = row("one", "verified");
  current.result!.version = 2;
  const map = {
    one: followup(current, { case_version: 1, state: "completed" }),
  };
  assert.equal(matchesQueue(current, "reopened", map, queueTime), true);
  assert.equal(matchesQueue(current, "action", map, queueTime), true);
  assert.equal(matchesQueue(current, "overdue", map, queueTime), true);
  assert.equal(matchesQueue(current, "verified", map, queueTime), true);
  assert.equal(matchesQueue(current, "waiting", map, queueTime), false);
});

test("needs action includes renewed review and working follow-ups but excludes future waits and completed checks", () => {
  const cases = [
    "reopened",
    "completed",
    "working",
    "future",
    "overdue",
    "undated",
  ].map((id) => {
    const current = row(id, "verified");
    current.result!.version = 2;
    return current;
  });
  const mismatch = row("mismatch", "discrepancy");
  cases.push(mismatch);
  const futureDue = "2026-09-24T02:00:00.000Z";
  const map = {
    reopened: followup(cases[0], {
      state: "completed",
      case_version: 1,
      due_at: futureDue,
    }),
    completed: followup(cases[1], { state: "completed" }),
    working: followup(cases[2], { state: "open", due_at: null }),
    future: followup(cases[3], { state: "waiting", due_at: futureDue }),
    overdue: followup(cases[4], { state: "waiting" }),
    undated: followup(cases[5], { state: "waiting", due_at: null }),
    mismatch: followup(mismatch, { state: "waiting", due_at: futureDue }),
  };
  const original = JSON.stringify({ cases, map });
  assert.deepEqual(
    new Set(
      workQueue(cases, "action", "all", "", map, queueTime).map(
        (current) => current.email.email_id,
      ),
    ),
    new Set(["reopened", "working", "overdue", "mismatch"]),
  );
  assert.equal(matchesQueue(cases[3], "waiting", map, queueTime), true);
  assert.equal(matchesQueue(cases[5], "waiting", map, queueTime), true);
  assert.equal(
    workQueue(cases, "verified", "all", "", map, queueTime).length,
    6,
  );
  assert.equal(JSON.stringify({ cases, map }), original);
});

test("recorded active deadlines sort before lane order without mutating cases", () => {
  const cases = [
    row("mismatch", "discrepancy"),
    row("later", "review"),
    row("due", "verified"),
    row("done", "verified"),
  ];
  const original = JSON.stringify(cases);
  const map = {
    later: followup(cases[1], { due_at: "2026-09-24T02:00:00.000Z" }),
    due: followup(cases[2]),
    done: followup(cases[3], {
      state: "completed",
      due_at: "2026-09-20T02:00:00.000Z",
    }),
  };
  assert.deepEqual(
    workQueue(cases, "all", "all", "", map, queueTime).map(
      (c) => c.email.email_id,
    ),
    ["due", "later", "mismatch", "done"],
  );
  assert.equal(JSON.stringify(cases), original);
});
