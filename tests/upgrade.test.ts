import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../lib/classifier";
import { sameRequestOrigin } from "../lib/http";
import { equivalent } from "../lib/normalization";
import {
  assessPolicy,
  DEFAULT_POLICY,
  policyRules,
  withPolicy,
} from "../lib/policy";
import { analyze, deriveResult } from "../lib/compare";
import { FIELDS, type CaseResult, type ComparisonRow } from "../lib/types";

for (const subject of ["Reminder: overdue invoice", "Check draft BL"]) {
  test(`active billing request overrides stale subject: ${subject}`, () => {
    const result = classify({
      email_id: "new",
      from: "test@example.test",
      subject,
      body: "Can you explain these invoice charges and send a breakdown?",
      attachments: [],
    });
    assert.equal(result.category, "INVOICE_QUERY");
    assert.equal(result.needs_review, false);
  });
}
test("promotional call to action overrides invoice subject", () => {
  assert.equal(
    classify({
      email_id: "new",
      from: "test@example.test",
      subject: "Invoice payment",
      body: "LIMITED TIME OFFER! Get 90% off our software. Buy now before this deal expires!",
      attachments: [],
    }).category,
    "SPAM",
  );
});
test("invoice discount discussion is not promotional quarantine", () => {
  assert.equal(
    classify({
      email_id: "new",
      from: "test@example.test",
      subject: "Invoice discount",
      body: "Please explain the invoice charges. Our agreed discount was 90% off.",
      attachments: [],
    }).category,
    "INVOICE_QUERY",
  );
});
test("known optional port code retains contradictory-code safety", () => {
  assert.ok(equivalent("port_of_loading", "SINGAPORE (SGSIN)", "SINGAPORE"));
  for (const other of [
    "SINGAPORE (MYPKG)",
    "SGSIN",
    "ROTTERDAM (SGSIN)",
    "SINGAPORE (XXXXX)",
  ])
    assert.equal(equivalent("port_of_loading", other, "SINGAPORE"), false);
  assert.equal(
    equivalent("consignee", "SINGAPORE (SGSIN)", "SINGAPORE"),
    false,
  );
  assert.equal(equivalent("port_of_loading", null, null), false);
});
const rows: ComparisonRow[] = FIELDS.map((field) => ({
  field,
  result: field === "gross_weight_kg" ? "mismatch" : "match",
  si: {
    raw: "1000",
    normalized: 1000,
    source: "si.txt",
    evidence: "line 1",
    method: "test",
  },
  bl: {
    raw: "1010",
    normalized: field === "gross_weight_kg" ? 1010 : 1000,
    source: "bl.txt",
    evidence: "line 1",
    method: "test",
  },
}));
test("CSRF boundary supports reverse proxies without trusting forwarded origins", () => {
  const request = (origin: string) =>
    new Request("http://localhost:3000/api/cases", {
      headers: {
        host: "127.0.0.1:3000",
        origin,
        "x-forwarded-host": "evil.test",
      },
    });
  assert.equal(sameRequestOrigin(request("http://127.0.0.1:3000")), true);
  assert.equal(sameRequestOrigin(request("https://evil.test")), false);
  assert.equal(sameRequestOrigin(request("null")), false);
  assert.equal(
    sameRequestOrigin(
      request("https://demo.onrender.com"),
      "https://demo.onrender.com",
    ),
    true,
  );
  assert.equal(
    sameRequestOrigin(
      request("https://evil.test"),
      "https://demo.onrender.com",
    ),
    false,
  );
});
const policy = {
  ...DEFAULT_POLICY,
  version: 1,
  rules: { weightToleranceKg: 20, weightTolerancePercent: 0.5 },
};
test("weight exception requires both enabled bounds", () => {
  assert.equal(assessPolicy(rows, policy).covered, false);
  assert.equal(
    assessPolicy(rows, {
      ...policy,
      rules: { weightToleranceKg: 20, weightTolerancePercent: 1 },
    }).covered,
    true,
  );
  assert.equal(assessPolicy(rows, DEFAULT_POLICY).covered, false);
});
test("policy cannot conceal strict mismatches or clear uncertain evidence", () => {
  const base = analyze(
    {
      email_id: "p",
      from: "t@example.test",
      subject: "Check draft BL",
      body: "Please compare SI and draft BL",
      attachments: [],
    },
    [],
  ) as CaseResult;
  const r = deriveResult(
    {
      ...base,
      policy: {
        ...policy,
        rules: { weightToleranceKg: 20, weightTolerancePercent: 0 },
      },
    },
    rows,
  );
  assert.equal(r.policy_assessment?.covered, true);
  assert.equal(r.status, "MISMATCH");
  assert.deepEqual(r.defect_fields, ["gross_weight_kg"]);
  const uncertain = structuredClone(rows);
  uncertain[6].si.normalized = null;
  uncertain[6].result = "uncertain";
  const review = deriveResult(r, uncertain);
  assert.equal(review.status, "NEEDS_REVIEW");
  assert.equal(review.policy_assessment?.covered, false);
});
test("policy values are bounded and snapshots cannot be mutated by callers", () => {
  for (const rules of [
    { weightToleranceKg: -1, weightTolerancePercent: 0 },
    { weightToleranceKg: 1, weightTolerancePercent: 6 },
    { weightToleranceKg: Infinity, weightTolerancePercent: 0 },
  ])
    assert.equal(policyRules.safeParse(rules).success, false);
  const r = withPolicy(
    analyze(
      {
        email_id: "x",
        from: "t@example.test",
        subject: "hi",
        body: "hi",
        attachments: [],
      },
      [],
    ),
    policy,
  );
  r.policy!.rules.weightToleranceKg = 999;
  assert.equal(policy.rules.weightToleranceKg, 20);
});
