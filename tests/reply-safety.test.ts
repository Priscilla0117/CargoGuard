import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { draftReply, replyIntentBlocker } from "../lib/reply";
import { polishReply } from "../lib/reply-ai";
import {
  replyOperationId,
  rememberReplyAttempt,
  readReplyAttempt,
  selectReplyOperations,
  canRetryResponseTracking,
  type ReplyOperation,
} from "../lib/reply-operation";

async function fixture(weight = "42000 KG") {
  const source = (kind: string, value: string) =>
    new TextEncoder().encode(
      `${kind}\nShipper: ALPHA LTD\nConsignee: BETA LTD\nNotify Party: SAME AS CONSIGNEE\nPort of Loading: SINGAPORE\nPort of Discharge: ROTTERDAM\nContainer Count: 2 x 40HC\nGross Weight: ${value}`,
    );
  return analyze(
    {
      email_id: "reply-safety",
      from: "desk@example.test",
      subject: "Please check draft BL",
      body: "Please compare the SI and draft BL.",
      attachments: ["si.txt", "bl.txt"],
    },
    [
      await parseDocument("si.txt", source("SHIPPING INSTRUCTION", "42000 KG")),
      await parseDocument("bl.txt", source("DRAFT BILL OF LADING", weight)),
    ],
  );
}

test("a matching-fields report never approves BL finalisation or release", async () => {
  const result = await fixture();
  assert.equal(replyIntentBlocker(result, "confirm_match"), null);
  for (const tone of ["short", "formal", "friendly"] as const) {
    const draft = draftReply(result, { intent: "confirm_match", tone });
    assert.match(draft.body, /case revision/);
    assert.match(
      draft.body,
      /does not approve BL finalisation or cargo release/,
    );
    assert.doesNotMatch(draft.body, /Please proceed/);
  }
});

test("unresolved or stale checks cannot produce an affirmative matching report", async () => {
  const mismatch = await fixture("43000 KG");
  for (const result of [
    mismatch,
    { ...(await fixture()), pipeline_version: "outdated" },
  ]) {
    assert.ok(replyIntentBlocker(result, "confirm_match"));
    const draft = draftReply(result, { intent: "confirm_match" });
    assert.match(draft.body, /still under review/);
    assert.doesNotMatch(draft.body, /all match|fields.*match\./);
  }
});

test("AI wording must preserve comparison scope and cannot add approval", async () => {
  const draft = draftReply(await fixture(), { intent: "confirm_match" }).body;
  const env = {
    CARGO_REPLY_AI_PROVIDER: "openai",
    CARGO_REPLY_AI_API_KEY: "test-only",
  };
  const reply = (text: string) =>
    (async () =>
      Response.json({
        output: [{ type: "message", content: [{ type: "output_text", text }] }],
      })) as typeof fetch;
  assert.equal(await polishReply(draft, "formal", reply(draft), env), draft);
  await assert.rejects(
    () =>
      polishReply(
        draft,
        "formal",
        reply(
          draft.replace(
            "It does not approve BL finalisation or cargo release.",
            "Please proceed to finalise the BL.",
          ),
        ),
        env,
      ),
    /scope/,
  );
  await assert.rejects(
    () =>
      polishReply(
        draft,
        "formal",
        reply(`${draft}\nPlease proceed to finalise the BL.`),
        env,
      ),
    /approval wording/,
  );
});

test("delivery retries reuse an identity without storing private email text", async () => {
  const saved = new Map<string, string>();
  const store = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const payload = {
    case_version: 3,
    account: "reviewer@example.test",
    body: "Private shipment text",
    mode: "send",
  };
  const first = await replyOperationId(payload, store);
  assert.equal(await replyOperationId(payload, store), first);
  assert.notEqual(
    await replyOperationId({ ...payload, case_version: 4 }, store),
    first,
  );
  assert.notEqual(
    await replyOperationId({ ...payload, mode: "draft" }, store),
    first,
  );
  assert.doesNotMatch(
    JSON.stringify([...saved]),
    /Private shipment|reviewer@example/,
  );
  const renewed = await replyOperationId(payload, store, [first]);
  assert.notEqual(renewed, first);
  assert.equal(await replyOperationId(payload, store), renewed);
});

test("a last attempted request survives changed draft wording without storing email content", async () => {
  const saved = new Map<string, string>();
  const store = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => {
      saved.set(key, value);
    },
  };
  const context = {
    case_id: "private-order-number",
    account: "employee@example.test",
  };
  const id = await replyOperationId(
    { ...context, body: "Original private wording" },
    store,
  );
  await rememberReplyAttempt(context, id, store);
  await replyOperationId(
    { ...context, body: "Changed wording after refresh" },
    store,
  );
  assert.equal(await readReplyAttempt(context, store), id);
  assert.equal(
    await readReplyAttempt({ ...context, case_id: "other-order" }, store),
    null,
  );
  assert.equal(
    await readReplyAttempt(
      { ...context, account: "other@example.test" },
      store,
    ),
    null,
  );
  assert.doesNotMatch(
    JSON.stringify([...saved]),
    /private-order|employee@example|private wording|Changed wording/,
  );
  assert.ok(
    [...saved.values()].every((value) => /^[0-9a-f-]{36}$/i.test(value)),
  );
});

const operation = (
  operation_id: string,
  status: ReplyOperation["status"],
  overrides: Partial<ReplyOperation> = {},
): ReplyOperation => ({
  operation_id,
  status,
  account: "employee@example.test",
  where: "mail provider",
  case_id: "case",
  case_version: 1,
  mode: "send",
  message_id: `${operation_id}@example.test`,
  created_at: "2026-09-25T00:00:00Z",
  ...overrides,
});

test("recovery retains the attempted terminal receipt after a lost response and keeps pending requests fenced", () => {
  const submitted = operation("attempted", "submitted", {
    follow_up_recorded: false,
  });
  const unrelated = operation("other", "draft");
  const recovered = selectReplyOperations([unrelated, submitted], "attempted");
  assert.equal(recovered.pending, null);
  assert.equal(recovered.recent, submitted);
  assert.equal(canRetryResponseTracking(recovered.recent!), true);
  const pending = operation("pending", "unknown");
  assert.equal(
    selectReplyOperations([unrelated, submitted, pending], "attempted").pending,
    pending,
  );
  assert.equal(selectReplyOperations([], "missing").recent, null);
});

test("partial recipient rejection remains visible and cannot be retried as automatic waiting", () => {
  const partial = operation("partial", "submitted", {
    follow_up_recorded: false,
    accepted_recipients: ["accepted@example.test"],
    rejected_recipients: ["rejected@example.test"],
    message: "Some recipients were rejected.",
  });
  const selected = selectReplyOperations([partial], "partial").recent!;
  assert.deepEqual(selected.rejected_recipients, ["rejected@example.test"]);
  assert.deepEqual(selected.accepted_recipients, ["accepted@example.test"]);
  assert.equal(canRetryResponseTracking(selected), false);
  for (const status of ["unknown", "sending", "draft", "cancelled"] as const)
    assert.equal(
      canRetryResponseTracking(
        operation(status, status, { follow_up_recorded: false }),
      ),
      false,
    );
});

test("employee confirmation without a provider receipt requires deliberate follow-up recording", () => {
  const manual = operation("manual", "submitted", {
    follow_up_recorded: false,
    confirmation_source: "employee",
  });
  assert.equal(canRetryResponseTracking(manual), false);
});
