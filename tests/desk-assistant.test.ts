import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8 } from "fflate";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { planAll } from "../lib/conversation";
import { copilotAnswer, copilotStarterGroups } from "../lib/copilot";
import { GLOSSARY, glossaryAnswer } from "../lib/shipping-glossary";
import { splitSignature } from "../lib/email-format";
import { previewCorrection } from "../lib/corrections";
import { summaryOf, type CaseResult, type Email } from "../lib/types";

async function check(email: Partial<Email>, pod = "ROTTERDAM") {
  const text = (p: string) =>
    [
      "Shipper: ALPHA LTD",
      "Consignee: BETA LTD",
      "Notify Party: GAMMA LTD",
      "Port of Loading: SINGAPORE",
      `Port of Discharge: ${p}`,
      "Container Count: 2 x 40HC",
      "Gross Weight: 42,000 KG",
    ].join("\n");
  return {
    ...analyze(
      {
        email_id: "a",
        from: "docs@forwarder.test",
        subject: "Draft BL 5RFR-36541",
        body: "Please check.\n\nBest Regards,\nJasmine Tan",
        attachments: ["SI.txt", "BL.txt"],
        ...email,
      },
      [
        await parseDocument(
          "SI.txt",
          strToU8(`SHIPPING INSTRUCTION\n${text("ROTTERDAM")}`),
        ),
        await parseDocument(
          "BL.txt",
          strToU8(`DRAFT BILL OF LADING\n${text(pod)}`),
        ),
      ],
    ),
    version: 1,
  } as CaseResult;
}
const NOW = Date.parse("2026-09-25T04:00:00Z");
async function rows() {
  const cases = [
    summaryOf(
      await check(
        { email_id: "a", received_at: "2026-09-24T01:00:00Z" },
        "BUSAN",
      ),
    ),
  ];
  const plans = planAll(cases, {}, NOW);
  return cases.map((row) => ({ row, plan: plans.get(row.email.email_id)! }));
}

test("a question about a value loads the SI and BL values for that order", async () => {
  const answer = copilotAnswer(
    "What is the consignee for 5RFR-36541?",
    await rows(),
    NOW,
  );
  assert.equal(answer.intent, "lookup");
  assert.deepEqual(answer.fetch, {
    id: "a",
    mode: "fields",
    fields: ["consignee"],
  });
  const all = copilotAnswer(
    "What do the SI and BL say for 5RFR-36541?",
    await rows(),
    NOW,
  );
  assert.equal(all.fetch?.fields.length, 7);
  const status = copilotAnswer(
    "What happened with 5RFR-36541?",
    await rows(),
    NOW,
  );
  assert.equal(status.intent, "reference");
});

test("asking for a correction email prepares the reply for the open email", async () => {
  const answer = copilotAnswer(
    "Write the correction email for 5RFR-36541",
    await rows(),
    NOW,
  );
  assert.equal(answer.intent, "draft");
  assert.equal(answer.fetch?.mode, "reply");
  assert.deepEqual(answer.items[0].actions, ["reply", "documents"]);
});

test("shipping terms get a fixed plain-English answer, other questions do not", async () => {
  const r = await rows();
  assert.equal(
    copilotAnswer("What is a notify party?", r, NOW).title,
    "Notify party",
  );
  assert.equal(
    copilotAnswer("How do I check a draft BL?", r, NOW).intent,
    "explain",
  );
  assert.equal(
    copilotAnswer("what does telex release mean", r, NOW).intent,
    "explain",
  );
  for (const q of [
    "What should I do first today?",
    "What is due this week?",
    "What do I do first?",
    "Which documents do not match?",
    "What is urgent?",
  ])
    assert.notEqual(copilotAnswer(q, r, NOW).intent, "explain", q);
  for (const entry of GLOSSARY) {
    assert.ok(entry.text.length > 40);
    const probe = `What is ${entry.title.split(" (")[0].toLowerCase()}?`;
    assert.ok(glossaryAnswer(probe), probe);
  }
});

test("the handover is ready to paste and lists the most urgent work", async () => {
  const answer = copilotAnswer(
    "Write my end-of-day handover",
    await rows(),
    NOW,
  );
  assert.equal(answer.intent, "handover");
  assert.match(answer.copy ?? "", /MOST URGENT\n- Draft BL 5RFR-36541/);
  assert.match(answer.copy ?? "", /WAITING FOR REPLIES\n- Nobody/);
});

test("starter questions use real order numbers from the inbox", async () => {
  const groups = copilotStarterGroups(await rows());
  assert.deepEqual(
    groups.map((g) => g.label),
    ["Plan my day", "Check documents", "Team", "Learn"],
  );
  assert.ok(
    groups[1].items.includes("Write the correction email for 5RFR-36541"),
  );
});

test("the email view separates the signature from the message", () => {
  const { body, signature } = splitSignature(
    "Dear Arlene,\n\nPls assist to check.\n\nBest Regards,\nTeo Ei Leen\nShipping Documentation",
  );
  assert.equal(body, "Dear Arlene,\n\nPls assist to check.");
  assert.match(signature, /^Best Regards,\nTeo Ei Leen/);
  assert.equal(splitSignature("Thanks,\nAli").signature, "");
});

test("the correction preview cannot clear a real difference with an unsupported typed value", async () => {
  const result = await check({}, "BUSAN");
  const preview = previewCorrection(result, {
    field: "port_of_discharge",
    side: "bl",
    value: "ROTTERDAM",
  });
  const row = preview.changes.find((c) => c.field === "port_of_discharge");
  assert.equal(row?.before, "mismatch");
  assert.equal(row?.after, "uncertain");
  assert.equal(preview.result?.status, "NEEDS_REVIEW");
});

test("work questions that mention a term are not answered as definitions", async () => {
  const r = await rows();
  assert.notEqual(
    copilotAnswer("What is the SI cut-off this week?", r, NOW).intent,
    "explain",
  );
  assert.notEqual(
    copilotAnswer("What is waiting for the consignee?", r, NOW).intent,
    "explain",
  );
});
