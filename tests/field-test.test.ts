import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_TEST, renderEml } from "../lib/field-test";
import { parseEml } from "../lib/eml";
import { parseDocument } from "../lib/parsers";
import { analyze } from "../lib/compare";
import { groupThreads } from "../lib/mail-intel";
import { summaryOf, type Email } from "../lib/types";

// Known, documented disagreements (see docs/FIELD_TEST.md). Anything else that
// changes is a regression and must be investigated, not hidden.
const KNOWN = new Set([
  "ft_02:defects", // SAME AS CONSIGNEE resolves to the (wrong) consignee, so notify party is also flagged
  "ft_06:confidence", // short SI chase: the router asks a person to confirm
  "ft_14:confidence", // "still waiting" billing chase: the router asks a person to confirm
]);

test("team-authored field-test mailbox: results stay at the documented level", async () => {
  const base = new Date("2026-09-21T00:00:00Z");
  const results = [];
  const problems: string[] = [];
  for (const scenario of FIELD_TEST) {
    const mail = await parseEml(renderEml(scenario, base));
    const email: Email = {
      email_id: scenario.id,
      from: mail.from,
      subject: mail.subject,
      body: mail.body,
      attachments: mail.attachments.map((a) => a.name),
      received_at: mail.received_at,
      message_id: mail.message_id,
      in_reply_to: mail.in_reply_to,
      references: mail.references,
    };
    const docs = await Promise.all(
      mail.attachments.map((a) => parseDocument(a.name, a.bytes)),
    );
    const result = analyze(email, docs);
    results.push(result);
    const check = (key: string, ok: boolean, detail: string) => {
      if (!ok && !KNOWN.has(`${scenario.id}:${key}`))
        problems.push(`${scenario.id} ${key}: ${detail}`);
      if (ok && KNOWN.has(`${scenario.id}:${key}`))
        problems.push(
          `${scenario.id} ${key} now passes — update the documented results`,
        );
    };
    check(
      "category",
      result.category === scenario.expect.category,
      `${result.category}`,
    );
    check(
      "confidence",
      result.category !== scenario.expect.category ||
        !result.classification.needs_review,
      "needs review",
    );
    if (scenario.expect.outcome)
      check(
        "outcome",
        result.status === scenario.expect.outcome,
        `${result.status} ${result.summary}`,
      );
    if (scenario.expect.defects)
      check(
        "defects",
        [...result.defect_fields].sort().join() ===
          [...scenario.expect.defects].sort().join(),
        result.defect_fields.join(),
      );
  }
  const threads = groupThreads(
    results.map(summaryOf).map((row) => ({
      id: row.email.email_id,
      subject: row.email.subject,
      refs: row.email.insight?.refs,
      message_id: row.email.message_id,
      in_reply_to: row.email.in_reply_to,
      references: row.email.references,
      excluded: row.result?.category === "SPAM",
    })),
  );
  for (const a of FIELD_TEST)
    for (const b of FIELD_TEST) {
      if (a.id >= b.id) continue;
      const expected = !!a.thread && a.thread === b.thread;
      const actual =
        !!threads.get(a.id) &&
        threads.get(a.id)?.key === threads.get(b.id)?.key;
      if (expected !== actual)
        problems.push(
          `${a.id}+${b.id} conversation ${actual ? "wrongly joined" : "split"}`,
        );
    }
  assert.deepEqual(problems, []);
});
