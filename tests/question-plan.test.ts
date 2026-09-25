import { test } from "node:test";
import assert from "node:assert/strict";
import { strToU8 } from "fflate";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { planFor } from "../lib/priority";
import { copilotAnswer, type Planned } from "../lib/copilot";
import {
  checkedPlan,
  planLabel,
  PlanRejected,
  questionPlanSchema,
  type QuestionPlan,
} from "../lib/question-plan";
import {
  PLAN_SYSTEM,
  planQuestion,
  questionPlanAvailable,
} from "../lib/question-plan-ai";
import { answerPlan } from "../lib/question-plan-run";
import { POST as understandRoute } from "../app/api/copilot/understand/route";
import {
  GET as copilotGet,
  POST as copilotPost,
} from "../app/api/copilot/route";
import { summaryOf, type Email } from "../lib/types";

const NOW = Date.parse("2026-09-21T04:00:00Z");
const AI_ENV = {
  CARGO_REPLY_AI_PROVIDER: "openai",
  CARGO_REPLY_AI_API_KEY: "test-key-not-real",
};
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
      from: "Ops <ops@oceanline.test>",
      received_at: "2026-09-20T05:00:00Z",
    }),
    await row("c", "42,500 KG", {
      subject: "URGENT draft BL for PO 25_1234",
      body: "Please confirm before cut-off 22 Sep 2026.\n\nThanks",
      received_at: "2026-09-19T01:00:00Z",
    }),
  ];
}
const plan = (value: Partial<QuestionPlan> & Pick<QuestionPlan, "action">) =>
  questionPlanSchema.parse(value);
const completion = (text: string) =>
  new Response(
    JSON.stringify({
      output: [{ type: "message", content: [{ type: "output_text", text }] }],
    }),
  );

test("a plan is accepted only in the fixed format, with defaults for omitted parts", () => {
  const ok = checkedPlan(
    'Sure: {"action":"find","find":{"status":["differences"],"group_by_sender":true},"extra":"ignored"}',
    "which customer keeps sending wrong BLs lately?",
  );
  assert.equal(ok.action, "find");
  assert.deepEqual(ok.find?.status, ["differences"]);
  assert.equal(ok.find?.group_by_sender, true);
  assert.deepEqual(ok.find?.words, []);
  assert.equal(ok.reference, null);
  assert.ok(!("extra" in ok));
  for (const [raw, message] of [
    ["no json at all", /not a readable plan/],
    ['{"action":"approve_all"}', /did not follow the plan format/],
    ['{"action":"find","find":{"status":["released"]}}', /plan format/],
    ['{"action":"find","fields":["price"]}', /plan format/],
    ['{"action":"explain_term","term":"made-up"}', /plan format/],
    ['{"action":"reference"}', /missing the reference/],
    ['{"action":"explain_term"}', /did not name a shipping term/],
  ] as const)
    assert.throws(() => checkedPlan(raw, "anything"), message, raw);
});

test("null and empty values from the model count as not given", () => {
  const tolerant = checkedPlan(
    '{"action":"find","reference":"","fields":null,"period":null,"term":"","find":{"status":null,"kind":["spam"],"words":null,"sender":"","newest_first":null,"group_by_sender":null,"count_only":null}}',
    "anything shady?",
  );
  assert.deepEqual(tolerant.find, {
    status: [],
    kind: ["spam"],
    words: [],
    sender: null,
    newest_first: false,
    group_by_sender: false,
    count_only: false,
  });
  assert.equal(tolerant.reference, null);
  assert.deepEqual(tolerant.fields, []);
  assert.equal(
    checkedPlan('{"action":"plan_day","find":null}', "where do I start").action,
    "plan_day",
  );
});

test("the AI can only copy references, words and senders that were typed", () => {
  const question = "what does the bl say for order 5rfr 36541 from roxcel?";
  assert.equal(
    checkedPlan(
      '{"action":"document_values","reference":"5RFR-36541"}',
      question,
    ).reference,
    "5RFR-36541",
  );
  assert.throws(
    () =>
      checkedPlan('{"action":"reference","reference":"5RFR-99999"}', question),
    PlanRejected,
  );
  assert.throws(
    () =>
      checkedPlan('{"action":"find","find":{"words":["mombasa"]}}', question),
    /not in your question/,
  );
  assert.throws(
    () => checkedPlan('{"action":"find","find":{"sender":"maersk"}}', question),
    /not in your question/,
  );
  assert.equal(
    checkedPlan('{"action":"find","find":{"sender":"Roxcel"}}', question).find
      ?.sender,
    "Roxcel",
  );
});

test("only the question is sent to the AI: no email, subject, sender or count", async () => {
  const rows = await inbox();
  let url = "";
  let body: {
    store?: boolean;
    input?: { role: string; content: string }[];
  } = {};
  const fake = (async (target: string, init: RequestInit) => {
    url = target;
    body = JSON.parse(String(init.body));
    return completion(
      '{"action":"find","find":{"status":["differences"],"newest_first":true}}',
    );
  }) as unknown as typeof fetch;
  const result = await planQuestion(
    "anything wrong in my latest drafts?",
    fake,
    AI_ENV,
  );
  assert.equal(result.label, "OpenAI");
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.equal(body.store, false);
  assert.equal(body.input?.length, 2);
  assert.equal(body.input?.[0].content, PLAN_SYSTEM);
  assert.equal(
    body.input?.[1].content,
    JSON.stringify({ question: "anything wrong in my latest drafts?" }),
  );
  const sent = JSON.stringify(body);
  for (const { row } of rows)
    for (const secret of [
      row.email.subject,
      row.email.from,
      "carrier.test",
      "oceanline",
      "5RFR-36541",
    ])
      assert.ok(!sent.includes(secret), `${secret} must not be sent`);
  assert.doesNotMatch(PLAN_SYSTEM, /5RFR-36541|ROTTERDAM|carrier\.test/);
  assert.equal(result.plan.action, "find");
});

test("AI question reading is off without a key, when switched off, or when the service fails", async () => {
  const never = (async () => {
    throw new Error("must not be called");
  }) as unknown as typeof fetch;
  assert.equal(questionPlanAvailable({}), false);
  await assert.rejects(planQuestion("hello there", never, {}), /not set up/);
  assert.equal(
    questionPlanAvailable({ ...AI_ENV, CARGO_COPILOT_UNDERSTAND: "off" }),
    false,
  );
  await assert.rejects(
    planQuestion("hello there", never, {
      ...AI_ENV,
      CARGO_COPILOT_UNDERSTAND: "Off",
    }),
    /not set up/,
  );
  await assert.rejects(
    planQuestion(
      "hello there",
      (async () =>
        new Response("", { status: 500 })) as unknown as typeof fetch,
      AI_ENV,
    ),
    /did not respond/,
  );
  await assert.rejects(
    planQuestion(
      "tell me about my orders",
      (async () =>
        completion(
          '{"action":"reference","reference":"5RFR-36541"}',
        )) as unknown as typeof fetch,
      AI_ENV,
    ),
    (error: Error & { status?: number }) =>
      /not in your question/.test(error.message) && error.status === 422,
  );
});

test("a plan runs the same local answers as the matching instant question", async () => {
  const rows = await inbox();
  const same = (p: QuestionPlan, question: string) =>
    assert.deepEqual(
      answerPlan(p, rows, NOW),
      copilotAnswer(question, rows, NOW),
      question,
    );
  same(plan({ action: "plan_day" }), "What should I do first today?");
  same(plan({ action: "due", period: "tomorrow" }), "What is due tomorrow?");
  same(plan({ action: "due" }), "What is due this week?");
  same(plan({ action: "waiting" }), "Which emails am I waiting on?");
  same(plan({ action: "summary" }), "Summarise my inbox");
  same(plan({ action: "handover" }), "Write my end-of-day handover");
  same(plan({ action: "open_pos" }), "Show open POs");
  same(plan({ action: "sender_quality" }), "Who sends drafts with mistakes?");
  assert.equal(
    answerPlan(plan({ action: "due", period: "overdue" }), rows, NOW).intent,
    "due",
  );
  const order = answerPlan(
    plan({ action: "reference", reference: "5RFR-36541" }),
    rows,
    NOW,
  );
  assert.equal(order.intent, "reference");
  assert.equal(order.title, "Order 5RFR-36541");
  const values = answerPlan(
    plan({
      action: "document_values",
      reference: "5RFR-36541",
      fields: ["gross_weight_kg", "consignee"],
    }),
    rows,
    NOW,
  );
  assert.equal(values.intent, "lookup");
  assert.deepEqual(values.fetch?.fields, ["consignee", "gross_weight_kg"]);
  assert.equal(
    answerPlan(
      plan({ action: "correction_email", reference: "5RFR-36541" }),
      rows,
      NOW,
    ).intent,
    "draft",
  );
  const term = answerPlan(plan({ action: "explain_term", term: "vgm" }), rows);
  assert.equal(term.intent, "explain");
  assert.match(term.title, /VGM/);
  const outside = answerPlan(plan({ action: "unsupported" }), rows);
  assert.equal(outside.intent, "none");
  assert.match(outside.text, /never approve, release or send/);
});

test("find plans filter, group and order the saved emails locally", async () => {
  const rows = await inbox();
  const differences = answerPlan(
    plan({
      action: "find",
      find: {
        status: ["differences"],
        kind: [],
        words: [],
        sender: null,
        newest_first: true,
        group_by_sender: true,
        count_only: false,
      },
    }),
    rows,
    NOW,
  );
  assert.equal(differences.intent, "search");
  assert.deepEqual(
    differences.items.map((item) => item.id),
    ["a", "c"],
  );
  assert.deepEqual(differences.facts, [
    { label: "carrier.test", value: "2 emails" },
  ]);
  assert.match(differences.title, /carrier\.test has the most/);
  assert.match(differences.text, /Newest first/);
  const matched = answerPlan(
    plan({
      action: "find",
      fields: [],
      find: {
        status: ["matched"],
        kind: ["document_check"],
        words: [],
        sender: "oceanline",
        newest_first: false,
        group_by_sender: false,
        count_only: true,
      },
    }),
    rows,
    NOW,
  );
  assert.deepEqual(
    matched.items.map((item) => item.id),
    ["b"],
  );
  assert.equal(matched.title, "1 email found");
  const weight = answerPlan(
    plan({
      action: "find",
      fields: ["gross_weight_kg"],
      find: {
        status: [],
        kind: [],
        words: ["urgent"],
        sender: null,
        newest_first: false,
        group_by_sender: false,
        count_only: false,
      },
    }),
    rows,
    NOW,
  );
  assert.deepEqual(
    weight.items.map((item) => item.id),
    ["c"],
  );
  const none = answerPlan(
    plan({
      action: "find",
      find: {
        status: [],
        kind: ["spam"],
        words: [],
        sender: null,
        newest_first: false,
        group_by_sender: false,
        count_only: false,
      },
    }),
    rows,
    NOW,
  );
  assert.equal(none.title, "No email matches");
  assert.equal(none.items.length, 0);
  // Generic words describe the search; they do not have to be in an email.
  const generic = answerPlan(
    plan({
      action: "find",
      find: {
        status: ["differences"],
        kind: [],
        words: ["drafts", "wrong"],
        sender: null,
        newest_first: false,
        group_by_sender: false,
        count_only: false,
      },
    }),
    rows,
    NOW,
  );
  assert.deepEqual(generic.items.map((item) => item.id).sort(), ["a", "c"]);
  // A "reference" that is really a name falls back to a plain search.
  const named = answerPlan(
    plan({ action: "reference", reference: "URGENT" }),
    rows,
    NOW,
  );
  assert.equal(named.intent, "search");
  assert.deepEqual(
    named.items.map((item) => item.id),
    ["c"],
  );
});

test("the app, not the AI, writes the plain-English reading of a plan", () => {
  assert.equal(
    planLabel(
      plan({
        action: "find",
        find: {
          status: ["differences"],
          kind: [],
          words: ["mombasa"],
          sender: "roxcel",
          newest_first: true,
          group_by_sender: true,
          count_only: false,
        },
      }),
    ),
    "Find emails where the SI and BL differ from “roxcel” mentioning “mombasa”, grouped by sender company, newest first",
  );
  assert.equal(
    planLabel(plan({ action: "due", period: "overdue" })),
    "Emails overdue",
  );
  assert.equal(
    planLabel(
      plan({
        action: "document_values",
        reference: "5RFR-36541",
        fields: ["gross_weight_kg"],
      }),
    ),
    "SI and BL gross weight for 5RFR-36541",
  );
});

const workspace = crypto.randomUUID();
const json = async (response: Response) =>
  (await response.json()) as {
    understand?: boolean;
    error?: string;
    label?: string;
    plan?: { action: string };
  };
const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  origin = "https://cargo.example",
) =>
  handler(
    new Request(`https://cargo.example${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `cargo_workspace=${workspace}`,
        Origin: origin,
      },
      body: JSON.stringify(body),
    }),
  );

test("the understand API checks origin, input and secrets, caches, and limits use", async () => {
  const oldEnv = { ...process.env },
    oldFetch = globalThis.fetch;
  for (const key of [
    "CARGO_PUBLIC_ORIGIN",
    "RENDER_EXTERNAL_URL",
    "CARGO_AUTH_MODE",
    "CARGO_COPILOT_UNDERSTAND",
  ])
    delete process.env[key];
  let calls = 0;
  const sent: string[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    calls++;
    sent.push(String(init.body));
    return completion('{"action":"plan_day"}');
  }) as unknown as typeof fetch;
  try {
    delete process.env.CARGO_REPLY_AI_PROVIDER;
    delete process.env.CARGO_REPLY_AI_API_KEY;
    delete process.env.CARGO_AI_API_KEY;
    const off = await post(understandRoute, "/api/copilot/understand", {
      question: "where do I start today?",
    });
    assert.equal(off.status, 503);
    const status = await json(
      await copilotGet(
        new Request("https://cargo.example/api/copilot", {
          headers: { Cookie: `cargo_workspace=${workspace}` },
        }),
      ),
    );
    assert.equal(status.understand, false);

    Object.assign(process.env, AI_ENV);
    const on = await json(
      await copilotGet(
        new Request("https://cargo.example/api/copilot", {
          headers: { Cookie: `cargo_workspace=${workspace}` },
        }),
      ),
    );
    assert.equal(on.understand, true);
    assert.ok(!JSON.stringify(on).includes(AI_ENV.CARGO_REPLY_AI_API_KEY));

    assert.equal(
      (
        await post(
          understandRoute,
          "/api/copilot/understand",
          { question: "where do I start today?" },
          "https://evil.invalid",
        )
      ).status,
      403,
    );
    assert.equal(
      (await post(understandRoute, "/api/copilot/understand", { question: "" }))
        .status,
      400,
    );
    assert.equal(
      (
        await post(understandRoute, "/api/copilot/understand", {
          question: "where do I start?",
          inbox: ["email_001"],
        })
      ).status,
      400,
    );
    const secret = await post(understandRoute, "/api/copilot/understand", {
      question: "my password is Hunter2024, where do I start?",
    });
    assert.equal(secret.status, 422);
    assert.match((await json(secret)).error ?? "", /nothing was sent to AI/);
    const advice = await post(copilotPost, "/api/copilot", {
      question: "card 4111 1111 1111 1111 what next?",
      consent: true,
    });
    assert.equal(advice.status, 422);
    assert.equal(calls, 0);

    const first = await post(understandRoute, "/api/copilot/understand", {
      question: "Where do I start today?",
    });
    assert.equal(first.status, 200);
    const data = await json(first);
    assert.equal(data.plan?.action, "plan_day");
    assert.equal(data.label, "OpenAI");
    assert.equal(calls, 1);
    assert.equal(
      JSON.parse(sent[0]).input[1].content,
      JSON.stringify({ question: "Where do I start today?" }),
    );
    // The same question again is answered from memory, not sent twice.
    const again = await post(understandRoute, "/api/copilot/understand", {
      question: "  where do i start   today? ",
    });
    assert.equal(again.status, 200);
    assert.equal(calls, 1);

    let limited = 0;
    for (let i = 0; i < 61; i++) {
      const response = await post(understandRoute, "/api/copilot/understand", {
        question: `question number ${i}`,
      });
      if (response.status === 429) limited++;
    }
    assert.equal(limited, 2);
    assert.equal(calls, 60);
  } finally {
    process.env = oldEnv;
    globalThis.fetch = oldFetch;
  }
});
