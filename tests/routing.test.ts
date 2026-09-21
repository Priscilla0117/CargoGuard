import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../lib/classifier";
import {
  currentRoutingMessage,
  routingFeatureCounts,
} from "../lib/routing-features";
import { classifyLearned } from "../lib/routing";
import type { Email } from "../lib/types";
import { analyze } from "../lib/compare";

const email: Email = {
  email_id: "fresh-id",
  from: "desk@example.test",
  subject: "Office notice",
  body: "Our office is closed this Friday. This is a general operations notice.",
  attachments: [],
};
test("Gmail quoted comparison cannot become the active office-closure request", () => {
  const body = `${email.body}\nOn Tue, Pat wrote:\n> Please compare SI and draft BL.`;
  assert.equal(currentRoutingMessage(body), email.body);
  assert.equal(classify({ ...email, body }).category, "GENERAL");
});
test("a negated BL check is always escalated and never rule-corroborated away", () => {
  const result = classify({
    ...email,
    subject: "Draft BL",
    body: "Do not compare the draft BL. This is only an office status update.",
  });
  assert.equal(result.needs_review, true);
  assert.match(result.review_note!, /negates/);
});
test("mixed document and billing requests need review", () => {
  const result = classify({
    ...email,
    body: "Please compare the draft BL against the SI. Also cancel the invoice charges.",
  });
  assert.equal(result.needs_review, true);
  assert.match(result.review_note!, /multiple/);
});
test("actual learned inference does not use IDs, sender or filenames", () => {
  const changed = {
    ...email,
    email_id: "email_001",
    from: "invoice@malicious.invalid",
    attachments: ["SPAM-SI_REQUEST-BL_COMPARISON.txt"],
  };
  assert.deepEqual(classifyLearned(changed), classifyLearned(email));
  assert.deepEqual(routingFeatureCounts(changed), routingFeatureCounts(email));
});
test("scores are finite normalized model signals, not claimed calibrated probabilities", () => {
  const result = classifyLearned(email);
  assert.ok(
    Math.abs(Object.values(result.scores).reduce((a, b) => a + b, 0) - 1) <
      1e-10,
  );
  assert.ok(result.signals.some((s) => /not calibrated/.test(s)));
  assert.equal(
    classifyLearned({ subject: "zxv qqq", body: "nrr zz" }).needs_review,
    true,
  );
});

test("a positively identified wrong document remains visible alongside routing uncertainty", () => {
  const result = analyze(
    {
      ...email,
      subject: "For review",
      body: "Dear Team,\n\nPlease find attached the SI and the Commercial Invoice for a booking. Kindly confirm the BL is in order.\n\n(Note: the second attachment is a Commercial Invoice, not the draft BL.)",
    },
    [
      { name: "si.txt", type: "SI", format: "txt", lines: [], method: "text" },
      {
        name: "invoice.txt",
        type: "OTHER",
        format: "txt",
        lines: [],
        method: "text",
      },
    ],
  );
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.workflow, "review");
  assert.equal(result.review_reason, "wrong_doc_type");
  assert.equal(result.comparison.length, 0);
});
