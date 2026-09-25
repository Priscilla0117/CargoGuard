import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8 } from "fflate";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { dateWindow, planFor } from "../lib/priority";
import { draftProgress, planAll, threadsFor } from "../lib/conversation";
import {
  senderCompany,
  senderHeadsUp,
  senderScores,
} from "../lib/sender-insights";
import { FIELD_RISK, byImpact, impactPhrase } from "../lib/field-risk";
import { caseStatus } from "../lib/case-status";
import { summaryOf, type CaseResult, type Email } from "../lib/types";
import type { FollowUp } from "../lib/follow-up";

const doc = (
  role: "SI" | "BL",
  over: Partial<Record<"pod" | "weight" | "consignee" | "notify", string>> = {},
) =>
  parseDocument(
    `${role}.txt`,
    strToU8(
      [
        role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
        "Shipper: ALPHA LTD",
        `Consignee: ${over.consignee ?? "BETA LTD"}`,
        `Notify Party: ${over.notify ?? "GAMMA LTD"}`,
        "Port of Loading: SINGAPORE",
        `Port of Discharge: ${over.pod ?? "ROTTERDAM"}`,
        "Container Count: 2 x 40HC",
        `Gross Weight: ${over.weight ?? "42,000 KG"}`,
      ].join("\n"),
    ),
  );
async function draft(
  bl: Parameters<typeof doc>[1],
  email: Partial<Email> = {},
): Promise<CaseResult> {
  return analyze(
    {
      email_id: "case-1",
      from: "docs@forwarder.test",
      subject: "TO CONFIRM DOCS _ 5RFR-36541 _ ROTTERDAM",
      body: "Pls check the draft BL against the SI and revert asap.\n\nBest Regards,\nJasmine",
      attachments: ["SI.txt", "BL.txt"],
      ...email,
    },
    [await doc("SI"), await doc("BL", bl)],
  );
}
const NOW = Date.parse("2026-09-25T04:00:00Z");

test("a wrong destination port outranks a wrong notify party", async () => {
  const port = summaryOf(await draft({ pod: "BUSAN" }, { email_id: "port" }));
  const notify = summaryOf(
    await draft({ notify: "DELTA LTD" }, { email_id: "notify" }),
  );
  const a = planFor(port, undefined, NOW);
  const b = planFor(notify, undefined, NOW);
  assert.ok(a.score > b.score);
  assert.equal(a.reasons[0], "Wrong destination port");
  assert.equal(b.reasons[0], "Wrong notify party");
});

test("routine 'asap' barely moves priority; strong words and deadlines do", async () => {
  const routine = summaryOf(await draft({ weight: "43,000 KG" }));
  const pressing = summaryOf(
    await draft(
      { weight: "43,000 KG" },
      {
        email_id: "pressing",
        received_at: "2026-09-25T01:00:00Z",
        body: "FINAL REMINDER: cargo is on hold. SI cut-off is 26 Sep 2026.",
      },
    ),
  );
  const a = planFor(routine, undefined, NOW);
  const b = planFor(pressing, undefined, NOW);
  assert.ok(
    a.factors.some(
      (f) => f.label === "Asked for a quick answer" && f.points <= 5,
    ),
  );
  assert.ok(b.score - a.score >= 40);
  assert.equal(b.level, "urgent");
});

test("unchecked email cannot jump the queue with 'urgent' wording", () => {
  const phishing = {
    email: {
      email_id: "x",
      from: "admin@phish.test",
      subject: "URGENT: verify your account immediately",
      attachments: [],
      insight: {
        refs: { shipment: [], po: [], booking: [], invoice: [], container: [] },
        dates: [],
        urgent_terms: ["urgent", "immediately"],
        snippet: "",
        sender_name: "Admin",
      },
    },
    result: null,
  };
  const plan = planFor(phishing, undefined, NOW);
  assert.equal(plan.reason, "unprocessed");
  assert.ok(!plan.reasons.some((r) => r.startsWith("Sender says")));
  assert.equal(plan.level, "low");
});

test("replying parks the email; a new email in the conversation brings it back", async () => {
  const first = summaryOf(
    await draft(
      { pod: "BUSAN" },
      { email_id: "a", received_at: "2026-09-23T01:00:00Z" },
    ),
  );
  const answer = summaryOf(
    await draft(
      { pod: "BUSAN" },
      {
        email_id: "b",
        subject: "RE: TO CONFIRM DOCS _ 5RFR-36541 _ ROTTERDAM",
        received_at: "2026-09-25T02:00:00Z",
      },
    ),
  );
  const waiting: FollowUp = {
    email_id: "a",
    version: 1,
    case_version: first.result!.version,
    owner: "Najiha",
    shipment_reference: "5RFR-36541",
    due_at: "2026-09-26T01:00:00Z",
    state: "waiting",
    request: {
      id: "external-request",
      case_version: first.result!.version,
      at: "2026-09-24T01:00:00Z",
      channel: "external",
      note: "Requested a corrected draft from the issuer.",
    },
    note: "Reply sent. Waiting for the sender to answer.",
    actor: "Najiha",
    updated_at: "2026-09-24T01:00:00Z",
    created_at: "2026-09-24T01:00:00Z",
    completed_at: null,
  };
  const quiet = planAll([first], { a: waiting }, NOW);
  assert.equal(quiet.get("a")!.bucket, "waiting");
  assert.equal(
    caseStatus(await draft({ pod: "BUSAN" }), quiet.get("a")).tone,
    "waiting",
  );
  const replied = planAll([first, answer], { a: waiting }, NOW);
  assert.equal(replied.get("a")!.bucket, "todo");
  assert.ok(
    replied.get("a")!.reasons.includes("Sender replied — read the answer"),
  );
});

test("a corrected draft closes the earlier one and shows what was fixed", async () => {
  const before = summaryOf(
    await draft(
      { pod: "BUSAN", weight: "43,000 KG" },
      { email_id: "v1", received_at: "2026-09-22T01:00:00Z" },
    ),
  );
  const partly = summaryOf(
    await draft(
      { weight: "43,000 KG", consignee: "OMEGA LTD" },
      {
        email_id: "v2",
        subject: "RE: TO CONFIRM DOCS _ 5RFR-36541 _ ROTTERDAM",
        received_at: "2026-09-23T01:00:00Z",
      },
    ),
  );
  const fixed = summaryOf(
    await draft(
      {},
      {
        email_id: "v3",
        subject: "RE: TO CONFIRM DOCS _ 5RFR-36541 _ ROTTERDAM",
        received_at: "2026-09-24T01:00:00Z",
      },
    ),
  );
  const cases = [before, partly, fixed];
  const threads = threadsFor(cases);
  const progress = draftProgress(partly, cases, threads.get("v2"));
  assert.deepEqual(progress?.fixed, ["port_of_discharge"]);
  assert.deepEqual(progress?.still, ["gross_weight_kg"]);
  assert.deepEqual(progress?.added, ["consignee"]);
  const plans = planAll(cases, {}, NOW, threads);
  assert.equal(plans.get("v1")!.bucket, "done");
  assert.ok(plans.get("v1")!.note);
  assert.equal(plans.get("v3")!.bucket, "done");
});

test("sender scorecard counts drafts with mistakes per company", async () => {
  const rows = await Promise.all(
    [{ pod: "BUSAN" }, { weight: "40,000 KG" }, { pod: "HAMBURG" }, {}].map(
      async (over, i) =>
        summaryOf(
          await draft(over, {
            email_id: `s${i}`,
            from: "Docs Team <docs@sloppy.test>",
          }),
        ),
    ),
  );
  assert.equal(senderCompany("Docs Team <docs@sloppy.test>"), "sloppy.test");
  const [score] = senderScores(rows);
  assert.equal(score.checked, 4);
  assert.equal(score.with_errors, 3);
  assert.equal(score.top[0].field, "port_of_discharge");
  const hint = senderHeadsUp(rows, "other@sloppy.test", "new");
  assert.match(hint ?? "", /3 of 4 earlier drafts from sloppy\.test/);
  assert.equal(senderHeadsUp(rows.slice(0, 2), "x@sloppy.test", "new"), null);
});

test("impact order and plain phrases cover every field", () => {
  assert.deepEqual(byImpact(["shipper", "consignee", "port_of_discharge"]), [
    "port_of_discharge",
    "consignee",
    "shipper",
  ]);
  assert.equal(
    impactPhrase(["notify_party", "gross_weight_kg"]),
    "Weight differs (+1 more)",
  );
  for (const value of Object.values(FIELD_RISK))
    assert.ok(value.risk.length > 20);
});

test("date filter supports the last 24 hours and exact times", () => {
  const now = new Date(2026, 8, 25, 12, 0).getTime();
  const day = dateWindow("24h", now)!;
  assert.ok(day.start === now - 86400000);
  const exact = dateWindow(
    "custom",
    now,
    "2026-09-25T09:00",
    "2026-09-25T10:30",
  )!;
  assert.equal(exact.start, new Date(2026, 8, 25, 9, 0).getTime());
  assert.equal(exact.end, new Date(2026, 8, 25, 10, 31).getTime());
});
