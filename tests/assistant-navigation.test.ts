import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assistantCases,
  assistantAvailability,
  assistantWorkspaceSummary,
  refersToAnotherCase,
} from "../lib/assistant-navigation";
import { PIPELINE_VERSION, type CaseSummary } from "../lib/types";

const row = (id: string, workflow: string | null): CaseSummary => ({
  email: {
    email_id: id,
    subject: `Shipping ${id}`,
    from: "agent@example.test",
    attachments: [],
  },
  result: workflow
    ? ({
        workflow,
        version: 1,
        pipeline_version: PIPELINE_VERSION,
      } as CaseSummary["result"])
    : null,
});
test("explicit other-case identifiers cannot be silently answered against this shipment", () => {
  assert.equal(
    refersToAnotherCase("Explain EMAIL_004 please", "email_004"),
    false,
  );
  assert.equal(
    refersToAnotherCase("Explain email_005 please", "email_004"),
    true,
  );
  assert.equal(
    refersToAnotherCase("Compare email_004 and email_005", "email_004"),
    true,
  );
  assert.equal(
    refersToAnotherCase(
      "Read upload_12345678-1234-1234-1234-123456789abc",
      "email_004",
    ),
    true,
  );
  assert.equal(
    refersToAnotherCase("Explain the five matching fields", "email_004"),
    false,
  );
});
test("global assistant search is case-insensitive, bounded to supplied workspace and does not mutate inbox", () => {
  const cases = [
    row("match", "verified"),
    row("pending", null),
    row("difference", "discrepancy"),
    row("unreadable", "review"),
  ];
  const original = structuredClone(cases);
  assert.deepEqual(
    assistantCases(cases, "").map((c) => c.email.email_id),
    ["difference", "unreadable", "match", "pending"],
  );
  assert.deepEqual(
    assistantCases(cases, "  DIFFERENCE  ").map((c) => c.email.email_id),
    ["difference"],
  );
  assert.equal(assistantCases(cases, "AGENT@EXAMPLE.TEST").length, 4);
  assert.equal(assistantCases(cases, "another-workspace").length, 0);
  assert.equal(assistantCases(cases, "private message").length, 0);
  assert.deepEqual(cases, original);
});
test("assistant requires a saved current-engine result and summarizes pending/review/missing separately", () => {
  const cases = [
    row("a", "verified"),
    row("b", "awaiting_documents"),
    row("c", null),
    row("d", "review"),
    row("e", "discrepancy"),
  ];
  assert.equal(assistantAvailability(cases[0]), null);
  assert.match(assistantAvailability(cases[2])!, /Verify/);
  assert.match(
    assistantAvailability({
      ...cases[0],
      result: { ...cases[0].result!, pipeline_version: "old" },
    })!,
    /Refresh/,
  );
  assert.deepEqual(assistantWorkspaceSummary(cases), {
    total: 5,
    discrepancies: 1,
    reviews: 1,
    awaiting: 1,
    pending: 1,
  });
  assert.deepEqual(assistantCases([], ""), []);
});
