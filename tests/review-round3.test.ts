import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { strToU8 } from "fflate";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import { saveCases } from "../lib/storage";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { planAll, draftProgress, threadsFor } from "../lib/conversation";
import { buildOrders } from "../lib/orders";
import { batchReviewBlocker } from "../lib/batch-review";
import { finishBlocker, integrityNeedsConfirmation } from "../lib/follow-up";
import { saveFollowUp } from "../lib/follow-up-storage";
import { checkDocumentIntegrity } from "../lib/integrity-checks";
import { gmailUnseen } from "../lib/gmail";
import { revisionDiff } from "../lib/revision-diff";
import { inventedFacts, polishReply, writeReply } from "../lib/reply-ai";
import { copilotAnswer } from "../lib/copilot";
import { summaryOf, type CaseResult, type Email } from "../lib/types";

const FIELDS_TEXT = (over: Record<string, string> = {}) =>
  [
    "Shipper: ALPHA LTD",
    `Consignee: ${over.consignee ?? "BETA LTD"}`,
    "Notify Party: GAMMA LTD",
    "Port of Loading: SINGAPORE",
    `Port of Discharge: ${over.pod ?? "ROTTERDAM"}`,
    "Container Count: 2 x 40HC",
    "Gross Weight: 42,000 KG",
    ...(over.extra ? [over.extra] : []),
  ].join("\n");
async function check(
  email: Partial<Email>,
  bl: Record<string, string> = {},
  si: Record<string, string> = {},
): Promise<CaseResult> {
  return {
    ...analyze(
      {
        email_id: "x",
        from: "docs@forwarder.test",
        subject: "Draft BL for review",
        body: "Please check the attached SI and draft BL.",
        attachments: ["SI.txt", "BL.txt"],
        ...email,
      },
      [
        await parseDocument(
          "SI.txt",
          strToU8(`SHIPPING INSTRUCTION\n${FIELDS_TEXT(si)}`),
        ),
        await parseDocument(
          "BL.txt",
          strToU8(`DRAFT BILL OF LADING\n${FIELDS_TEXT(bl)}`),
        ),
      ],
    ),
    version: 1,
  };
}
const NOW = Date.parse("2026-09-25T04:00:00Z");

test("a same-subject email from another sender never closes an open difference", async () => {
  const problem = summaryOf(
    await check(
      {
        email_id: "a",
        from: "ops@one.test",
        received_at: "2026-09-23T01:00:00Z",
      },
      { pod: "BUSAN" },
    ),
  );
  const unrelated = summaryOf(
    await check({
      email_id: "b",
      from: "docs@two.test",
      received_at: "2026-09-24T01:00:00Z",
    }),
  );
  const cases = [problem, unrelated];
  const threads = threadsFor(cases);
  // Still shown together as a hint…
  assert.equal(threads.get("a")?.key, threads.get("b")?.key);
  // …but nothing is closed or compared across them.
  const plans = planAll(cases, {}, NOW, threads);
  assert.equal(plans.get("a")!.bucket, "todo");
  assert.equal(plans.get("a")!.note, null);
  assert.equal(draftProgress(unrelated, cases, threads.get("b")), null);
  assert.equal(buildOrders(cases, {}, NOW).length, 0);
});

test("the same order number or reply headers do prove the relationship", async () => {
  const problem = summaryOf(
    await check(
      {
        email_id: "a",
        subject: "Draft BL 5RFR-36541",
        message_id: "m1@test",
        received_at: "2026-09-23T01:00:00Z",
      },
      { pod: "BUSAN" },
    ),
  );
  const reply = summaryOf(
    await check({
      email_id: "b",
      subject: "Corrected draft",
      in_reply_to: "m1@test",
      received_at: "2026-09-24T01:00:00Z",
    }),
  );
  const plans = planAll([problem, reply], {}, NOW);
  assert.equal(plans.get("a")!.bucket, "done");
  const orders = buildOrders([problem, reply], {}, NOW);
  assert.equal(orders.length, 1);
  assert.equal(orders[0].emails.length, 2);
});

test("batch completion accepts only a complete matching SI / draft BL check", async () => {
  const general = await check({});
  general.category = "GENERAL";
  general.workflow = "routed";
  general.comparison = [];
  general.documents = [];
  assert.match(batchReviewBlocker(general) ?? "", /Only a complete SI/);
  const matching = await check({});
  assert.equal(matching.workflow, "verified");
  assert.equal(batchReviewBlocker(matching), null);
});

test("an open safety finding blocks finishing until a person confirms it", async () => {
  const flagged = await check(
    {},
    { extra: "Container No.: MSKU1234560" },
    { extra: "Container No.: MSKU1234560" },
  );
  assert.equal(flagged.workflow, "verified");
  assert.equal(checkDocumentIntegrity(flagged).requires_attention, true);
  assert.equal(integrityNeedsConfirmation(flagged), true);
  assert.match(finishBlocker(flagged) ?? "", /extra safety check/);
  const client = createClient({ url: ":memory:" });
  for (const file of (await fs.readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await client.executeMultiple(await fs.readFile(`drizzle/${file}`, "utf8"));
  const { DB } = createNodeBindings(client);
  await saveCases(
    "w",
    [
      {
        result: { ...flagged, email_id: "x" } as CaseResult,
        expected: 0,
        action: "PROCESSED",
        actor: "CargoGuard",
        detail: "fixture",
      },
    ],
    DB,
  );
  const input = {
    id: "x",
    case_version: 1,
    version: 0,
    owner: "Najiha",
    shipment_reference: "",
    due_at: null,
    state: "completed" as const,
    note: "Checked and handled.",
    actor: "Najiha",
  };
  await assert.rejects(saveFollowUp("w", input, DB), /extra safety check/);
  const saved = await saveFollowUp(
    "w",
    { ...input, integrity_confirmed: true },
    DB,
  );
  assert.equal(saved.state, "completed");
  assert.equal(saved.integrity_confirmed, true);
});

test("HS codes and labelled BL numbers are not reported as container numbers", async () => {
  const clean = await check(
    {},
    { extra: "HS CODE 48025700 | B/L No.: SINF93802620" },
    { extra: "HS CODE 48025700" },
  );
  assert.equal(checkDocumentIntegrity(clean).requires_attention, false);
});

test("mailbox import walks past a full page of already-imported mail", async () => {
  const ids = Array.from(
    { length: 150 },
    (_, i) => `msg${String(i).padStart(4, "0")}`,
  );
  const pages: string[] = [];
  const fetcher = (async (url: string) => {
    const u = new URL(url);
    const token = u.searchParams.get("pageToken") ?? "0";
    pages.push(token);
    const start = Number(token);
    const slice = ids.slice(start, start + 100);
    return new Response(
      JSON.stringify({
        messages: slice.map((id) => ({ id, threadId: "t" })),
        ...(start + 100 < ids.length
          ? { nextPageToken: String(start + 100) }
          : {}),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  // The newest 120 messages are already imported.
  const known = new Set(ids.slice(0, 120).map((id) => `gmail:${id}`));
  const result = await gmailUnseen(
    "token",
    "in:inbox",
    10,
    async (keys) => new Set(keys.filter((key) => known.has(key))),
    fetcher,
  );
  assert.deepEqual(pages, ["0", "100"]);
  assert.equal(result.messages.length, 10);
  assert.equal(result.messages[0].id, "msg0120");
  assert.equal(result.more, true);
});

test("replacing the BL shows that different files were checked", async () => {
  const before = await check({ email_id: "r" });
  const after = await check({ email_id: "r" }, { consignee: "BETA  LTD" });
  after.version = 2;
  const blBefore = before.documents.find((d) => d.type === "BL")!;
  const blAfter = after.documents.find((d) => d.type === "BL")!;
  assert.notEqual(blBefore.sha256, blAfter.sha256);
  const diff = revisionDiff(before, after);
  assert.equal(diff.documentPairChanged, true);
  assert.equal(diff.integrity.added, 0);
});

test("AI text is rejected when it drops a checked value or adds a new fact", async () => {
  const draft =
    "Dear Jasmine Tan,\n\n1. Gross weight (kg)\n   Per our SI:      42,000 KG\n   Draft BL shows: 43,000 KG\n\nRegards,\nNajiha";
  assert.deepEqual(inventedFacts("We will revert by 5pm on 26 Sep.", [draft]), [
    "5pm",
    "26",
  ]);
  assert.deepEqual(inventedFacts(draft, [draft]), []);
  const env = {
    CARGO_REPLY_AI_PROVIDER: "openai",
    CARGO_REPLY_AI_API_KEY: "k",
  };
  const answer = (text: string) =>
    (async () =>
      new Response(
        JSON.stringify({
          output: [
            { type: "message", content: [{ type: "output_text", text }] },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
  const good = draft.replace(
    "Dear Jasmine Tan,",
    "Dear Jasmine Tan,\n\nThank you.",
  );
  assert.equal(await polishReply(draft, "formal", answer(good), env), good);
  await assert.rejects(
    polishReply(
      draft,
      "formal",
      answer(draft.replace("42,000", "24,000")),
      env,
    ),
    /changed or dropped/,
  );
  await assert.rejects(
    writeReply(
      {
        draft,
        tone: "formal",
        intent: "Ask for a corrected BL",
        email: { from: "a@b.test", subject: "Draft BL", body: "Pls check." },
        summary: "1 difference",
      },
      answer(`${draft}\nWe will revert by 5pm.`),
      env,
    ),
    /added 1 detail/,
  );
  const written = await writeReply(
    {
      draft,
      tone: "formal",
      intent: "Ask for a corrected BL",
      email: {
        from: "a@b.test",
        subject: "Draft BL",
        body: "Pls check before cut-off on 26/09.",
      },
      summary: "1 difference",
    },
    answer(`${draft}\nWe note the cut-off on 26/09.`),
    env,
  );
  assert.match(written, /26\/09/);
});

test("Ask CargoGuard explains an order's progress and who sends mistakes", async () => {
  const rows = [
    summaryOf(
      await check(
        {
          email_id: "d1",
          from: "docs@sloppy.test",
          subject: "Draft BL 5RFR-36541",
          received_at: "2026-09-22T01:00:00Z",
        },
        { pod: "BUSAN" },
      ),
    ),
    summaryOf(
      await check(
        {
          email_id: "d2",
          from: "docs@sloppy.test",
          subject: "RE: Draft BL 5RFR-36541",
          received_at: "2026-09-24T01:00:00Z",
        },
        { consignee: "OMEGA LTD" },
      ),
    ),
    summaryOf(
      await check(
        {
          email_id: "d3",
          from: "docs@sloppy.test",
          subject: "Draft BL 5RAE-11111",
          received_at: "2026-09-24T02:00:00Z",
        },
        { pod: "HAMBURG" },
      ),
    ),
  ];
  const plans = planAll(rows, {}, NOW);
  const planned = rows.map((row) => ({
    row,
    plan: plans.get(row.email.email_id)!,
  }));
  const order = copilotAnswer("What about 5RFR-36541?", planned, NOW);
  assert.equal(order.intent, "reference");
  assert.match(order.text, /fixed port of discharge; new problem: consignee/);
  assert.ok(order.facts.some((fact) => fact.label === "Progress"));
  const quality = copilotAnswer(
    "Who sends drafts with mistakes?",
    planned,
    NOW,
  );
  assert.equal(quality.intent, "quality");
  assert.match(quality.title, /sloppy\.test/);
  assert.equal(quality.items.length, 3);
});
