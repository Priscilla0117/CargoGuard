import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8 } from "fflate";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { planFor } from "../lib/priority";
import { copilotAnswer, type Planned } from "../lib/copilot";
import {
  copilotContext,
  validateCopilotAnswer,
  askCopilotAi,
} from "../lib/copilot-ai";
import { summaryOf, type Email } from "../lib/types";

const NOW = Date.parse("2026-09-21T04:00:00Z");
const doc = (role: "SI" | "BL", weight: string) =>
  parseDocument(
    `${role}.txt`,
    strToU8(
      [
        role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
        "Shipper: ALPHA LTD",
        "Consignee: BETA LTD",
        "Notify Party: GAMMA LTD",
        "Port of Loading: SINGAPORE",
        "Port of Discharge: ROTTERDAM",
        "Container Count: 2 x 40HC",
        `Gross Weight: ${weight}`,
      ].join("\n"),
    ),
  );
async function row(
  id: string,
  weight: string,
  email: Partial<Email> = {},
): Promise<Planned> {
  const result = await analyze(
    {
      email_id: id,
      from: "Jasmine Tan <jasmine.tan@carrier.test>",
      subject: `TO CONFIRM DOCS _ 5RFR-36541 _ ROTTERDAM`,
      body: "Please check the draft BL against the SI.\n\nBest Regards,\nJasmine Tan",
      attachments: ["SI.txt", "BL.txt"],
      received_at: "2026-09-20T02:00:00Z",
      ...email,
    },
    [await doc("SI", "42,000 KG"), await doc("BL", weight)],
  );
  const summary = summaryOf(result);
  return { row: summary, plan: planFor(summary, undefined, NOW) };
}
async function inbox() {
  return [
    await row("a", "43,000 KG"),
    await row("b", "42000 KG", {
      subject: "BL OK _ 7ABC-11111",
      body: "Fine.",
    }),
    await row("c", "42,500 KG", {
      subject: "URGENT draft BL for PO 25_1234",
      body: "Please confirm before cut-off 22 Sep 2026.\n\nThanks",
    }),
  ];
}

test("copilot plans the day from the to-do list, most urgent first", async () => {
  const answer = copilotAnswer(
    "What should I do first today?",
    await inbox(),
    NOW,
  );
  assert.equal(answer.intent, "plan");
  assert.deepEqual(answer.items.map((item) => item.id).sort(), ["a", "c"]);
  assert.equal(
    answer.items[0].id,
    "c",
    "urgent email with a cut-off comes first",
  );
});

test("copilot finds everything about an order number, including done emails", async () => {
  const answer = copilotAnswer("tell me about 5rfr-36541", await inbox(), NOW);
  assert.equal(answer.intent, "reference");
  assert.equal(answer.title, "Order 5RFR-36541");
  assert.deepEqual(
    answer.items.map((item) => item.id),
    ["a"],
  );
  assert.ok(
    answer.facts.some(
      (f) => f.label === "Differences seen" && /Gross weight/i.test(f.value),
    ),
  );
  const missing = copilotAnswer("5RFR-99999", await inbox(), NOW);
  assert.equal(missing.items.length, 0);
  assert.match(missing.text, /could not find/);
});

test("copilot lists open POs and matches PO numbers written differently", async () => {
  const rows = await inbox();
  const list = copilotAnswer("show open POs", rows, NOW);
  assert.equal(list.intent, "po");
  assert.deepEqual(
    list.items.map((item) => item.id),
    ["c"],
  );
  const one = copilotAnswer("status of PO 25-1234", rows, NOW);
  assert.equal(one.intent, "reference");
  assert.deepEqual(
    one.items.map((item) => item.id),
    ["c"],
  );
});

test("copilot answers due dates from dates written in emails", async () => {
  const due = copilotAnswer("what is due tomorrow", await inbox(), NOW);
  assert.equal(due.intent, "due");
  assert.deepEqual(
    due.items.map((item) => item.id),
    ["c"],
  );
});

test("copilot never treats place names as booking numbers", async () => {
  const answer = copilotAnswer("emails from singapore", await inbox(), NOW);
  assert.notEqual(answer.intent, "reference");
});

test("copilot summary and unknown questions are safe", async () => {
  const rows = await inbox();
  const summary = copilotAnswer("summarise my inbox", rows, NOW);
  assert.equal(summary.intent, "summary");
  assert.ok(summary.facts.some((f) => f.label === "Done" && f.value === "1"));
  assert.equal(copilotAnswer("xyzzy plugh", rows, NOW).intent, "none");
  assert.equal(copilotAnswer("anything", [], NOW).intent, "none");
});

test("AI answers are rejected when they cite unknown emails or invented references", async () => {
  const context = copilotContext(await inbox());
  assert.ok(context.items.every((item) => item.bucket !== "done"));
  const ok = validateCopilotAnswer(
    '{"answer":"Start with [[c]] because the cut-off is tomorrow.","email_ids":["c","a"]}',
    context,
  );
  assert.deepEqual(ok.email_ids, ["c", "a"]);
  assert.match(ok.answer, /URGENT draft BL/);
  assert.throws(
    () =>
      validateCopilotAnswer(
        '{"answer":"Open [[zzz]]","email_ids":[]}',
        context,
      ),
    /not in your inbox/,
  );
  assert.throws(
    () =>
      validateCopilotAnswer(
        '{"answer":"Order 9XYZ-12345 is late","email_ids":[]}',
        context,
      ),
    /9XYZ-12345/,
  );
  assert.throws(
    () => validateCopilotAnswer("no json", context),
    /could not be read/,
  );
});

test("AI mode sends only the compact list and is off without a key", async () => {
  const rows = await inbox();
  await assert.rejects(
    askCopilotAi("plan", rows, new Date(NOW), fetch, {}),
    /not set up/,
  );
  let sent = "";
  const fake = (async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(
      JSON.stringify({
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: '{"answer":"Do [[a]] next.","email_ids":["a"]}',
              },
            ],
          },
        ],
      }),
    );
  }) as unknown as typeof fetch;
  const answer = await askCopilotAi("plan", rows, new Date(NOW), fake, {
    CARGO_REPLY_AI_PROVIDER: "openai",
    CARGO_REPLY_AI_API_KEY: "test",
  });
  assert.deepEqual(answer.email_ids, ["a"]);
  assert.doesNotMatch(
    sent,
    /Please check the draft BL/,
    "email bodies are never sent",
  );
});
