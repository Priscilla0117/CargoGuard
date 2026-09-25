import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import {
  completionBlocker,
  finishBlocker,
  type FollowUp,
} from "../lib/follow-up";
import { saveFollowUp, recordSentFollowUp } from "../lib/follow-up-storage";
import {
  planAll,
  planContexts,
  sameShipment,
  shipmentWorkContexts,
  threadsFor,
} from "../lib/conversation";
import { buildOrders } from "../lib/orders";
import { planFor } from "../lib/priority";
import { listCaseSummaries, saveCases } from "../lib/storage";
import { summaryOf, type CaseResult } from "../lib/types";
import type { Shipment } from "../lib/shipments";

const text =
  "Shipper: Atlas Export\nConsignee: Buyer Two\nNotify party: SAME AS CONSIGNEE\nPort of loading: Port Klang\nPort of discharge: Singapore\nContainer count: 2\nGross weight (KG): 42000";
const now = Date.parse("2026-09-25T10:00:00Z");
async function check(
  id = "case",
  weight = "42000",
  invoice = false,
): Promise<CaseResult> {
  const documents = await Promise.all([
    parseDocument(
      "si.txt",
      new TextEncoder().encode(`SHIPPING INSTRUCTION\n${text}`),
    ),
    parseDocument(
      "bl.txt",
      new TextEncoder().encode(
        `DRAFT BILL OF LADING\n${text.replace("42000", weight)}`,
      ),
    ),
    ...(invoice
      ? [
          parseDocument(
            "invoice.txt",
            new TextEncoder().encode(
              "COMMERCIAL INVOICE\nInvoice number: INV-345\nTotal payable: USD 100",
            ),
          ),
        ]
      : []),
  ]);
  return {
    ...analyze(
      {
        email_id: id,
        from: "desk@example.test",
        subject: "Compare SI and draft BL 5RFR-36541",
        body: "Please compare the attached SI and draft BL.",
        attachments: documents.map((d) => d.name),
        received_at: "2026-09-23T01:00:00Z",
        message_id: `${id}@example.test`,
      },
      documents,
    ),
    version: 1,
  };
}
const followup = (r: CaseResult): FollowUp => ({
  email_id: r.email.email_id,
  version: 1,
  case_version: r.version,
  state: "waiting",
  owner: "Reviewer",
  actor: "Reviewer",
  shipment_reference: "5RFR-36541",
  due_at: "2026-09-27T10:00:00Z",
  note: "Please return the revised draft BL.",
  created_at: "2026-09-23T02:00:00Z",
  updated_at: "2026-09-25T08:00:00Z",
  completed_at: null,
  request: {
    id: "request-1",
    case_version: r.version,
    at: "2026-09-23T02:00:00Z",
    channel: "mail",
    provider_message_id: "sent-1",
    note: "Please return the revised draft BL.",
  },
});
async function fixture() {
  const client = createClient({ url: ":memory:" });
  for (const file of (await fs.readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await client.executeMultiple(await fs.readFile(`drizzle/${file}`, "utf8"));
  const { DB } = createNodeBindings(client);
  const current = await check();
  await saveCases(
    "w",
    [
      {
        result: current,
        expected: 0,
        action: "PROCESSED",
        actor: "Tester",
        detail: "fixture",
      },
    ],
    DB,
  );
  return { client, DB, current };
}
const input = {
  id: "case",
  case_version: 1,
  version: 0,
  owner: "Confirmed owner",
  actor: "Reviewer",
  shipment_reference: "BOOK-123",
  due_at: "2026-09-27T10:00:00+08:00",
  state: "open" as const,
  note: "Existing confirmed deadline and owner.",
};

test("the authoritative SI/BL pair can finish with a retained unrelated invoice", async () => {
  const r = await check("invoice", "42000", true);
  assert.equal(r.workflow, "verified");
  assert.equal(r.documents.length, 3);
  assert.equal(completionBlocker(r), null);
  assert.equal(completionBlocker(summaryOf(r).result!), null);
  const ambiguous = structuredClone(r);
  ambiguous.documents.push({ ...r.documents[1], name: "other-bl.txt" });
  assert.ok(completionBlocker(ambiguous));
});

test("a newer match cannot close an older discrepancy with stale, missing or uncertain evidence", async () => {
  const old = await check("old", "43000");
  const good = await check("new");
  good.email.received_at = "2026-09-24T01:00:00Z";
  const changes: ((r: CaseResult) => void)[] = [
    (r) => {
      r.pipeline_version = "old";
    },
    (r) => {
      r.comparison.pop();
    },
    (r) => {
      r.comparison[0].si.extraction_issue = "Unsupported reading correction";
    },
    (r) => {
      r.documents[0].sha256 = undefined;
    },
    (r) => {
      r.comparison[0].si.correction = {
        state: "unresolved",
        source_sha256: r.documents[0].sha256!,
      };
    },
    (r) => {
      r.classification.needs_review = true;
    },
    (r) => {
      r.documents[1].lines.push({
        text: "Container number: MSKU1234567",
        location: "line 20",
      });
    },
  ];
  for (const change of changes) {
    const unsafe = structuredClone(good);
    change(unsafe);
    assert.ok(finishBlocker(unsafe));
    const plans = planAll([summaryOf(old), summaryOf(unsafe)], {}, now);
    assert.equal(plans.get("old")!.bucket, "todo");
    assert.equal(plans.get("new")!.bucket, "todo");
  }
  assert.equal(
    planAll([summaryOf(old), summaryOf(good)], {}, now).get("old")!.bucket,
    "done",
  );
});

test("same-subject mail cannot resume waiting; a related reply uses request time, not later note edits", async () => {
  const first = await check("first", "43000");
  first.email.subject = "Draft BL for review";
  const other = await check("other", "43000");
  other.email.subject = first.email.subject;
  other.email.received_at = "2026-09-24T01:00:00Z";
  const rows = [summaryOf(first), summaryOf(other)];
  const waiting = { first: followup(first) };
  assert.equal(planAll(rows, waiting, now).get("first")!.bucket, "waiting");
  other.email.in_reply_to = first.email.message_id;
  const linked = [summaryOf(first), summaryOf(other)];
  const context = planContexts(linked, threadsFor(linked), waiting).get(
    "first",
  )!;
  assert.equal(context.response_case_id, "other");
  assert.equal(context.response_case_version, 1);
  assert.equal(planAll(linked, waiting, now).get("first")!.bucket, "todo");
  first.email.subject = "Draft BL 5RFR-36541";
  other.email.subject = "Draft BL 5RFR-36542";
  assert.equal(sameShipment(summaryOf(first), summaryOf(other)), false);
});

test("legacy waits without request evidence reopen without losing the confirmed deadline", async () => {
  const r = await check("legacy", "43000");
  const legacy = followup(r);
  delete legacy.request;
  const original = structuredClone(legacy);
  const plan = planFor(summaryOf(r), legacy, now);
  assert.equal(plan.bucket, "todo");
  assert.match(plan.note!, /no request record/);
  assert.equal(plan.deadline, legacy.due_at);
  assert.deepEqual(legacy, original);
});

test("latest unreadable draft cannot inherit an earlier matching order check", async () => {
  const original = await check("original", "43000");
  original.email.received_at = "2026-09-22T01:00:00Z";
  const before = await check("before");
  const after = await check("after");
  after.email.received_at = "2026-09-24T01:00:00Z";
  after.workflow = "review";
  after.status = "NEEDS_REVIEW";
  after.review_reason = "unreadable";
  const order = buildOrders([summaryOf(before), summaryOf(after)], {}, now)[0];
  assert.equal(order.steps.find((s) => s.key === "final")!.state, "problem");
  assert.equal(order.status, "todo");
  assert.equal(
    planAll(
      [summaryOf(original), summaryOf(before), summaryOf(after)],
      {},
      now,
    ).get("original")!.bucket,
    "todo",
  );
});

test("a received draft is not proof that an SI preparation request was fulfilled", async () => {
  const request = {
    ...analyze(
      {
        email_id: "request",
        from: "customer@example.test",
        subject: "New SI request 5RFR-36541",
        body: "Please prepare new shipping instructions for this shipment.",
        attachments: [],
        received_at: "2026-09-22T01:00:00Z",
      },
      [],
    ),
    version: 1,
  };
  assert.equal(request.category, "SI_REQUEST");
  const reply = await check("reply");
  const plan = planAll([summaryOf(request), summaryOf(reply)], {}, now).get(
    "request",
  )!;
  assert.equal(plan.bucket, "todo");
  assert.match(plan.note!, /confirm whether this SI request has been handled/);
});

test("linked unfinished shipment task keeps a matching inbox case actionable", async () => {
  const r = await check();
  const shipment: Shipment = {
    id: "s",
    version: 1,
    title: "Shipment 1",
    customer: "Buyer",
    carrier: "Carrier",
    references: [],
    case_ids: ["case"],
    comparison_case_id: "case",
    owner: "Reviewer",
    owner_id: null,
    state: "open",
    completed_cases: {},
    deadlines: [],
    amendments: [],
    tasks: [
      {
        id: "task",
        case_id: "case",
        kind: "handover",
        title: "Prepare shift handover",
        body: "Outstanding work",
        owner: "Reviewer",
        state: "draft",
        created_at: "2026-09-23T00:00:00Z",
        updated_at: "2026-09-23T00:00:00Z",
        actor: "Reviewer",
      },
    ],
    notes: "",
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
    actor: "Reviewer",
  };
  const context = shipmentWorkContexts([shipment], [r]);
  const plan = planAll([summaryOf(r)], {}, now, undefined, context).get(
    "case",
  )!;
  assert.equal(r.status, "OK");
  assert.equal(plan.bucket, "todo");
  assert.equal(plan.reason, "shipment_work");
  assert.match(plan.note!, /Prepare shift handover/);
});

test("waiting requires a recorded request; confirmed delivery preserves deadlines and is idempotent", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () => saveFollowUp("w", { ...input, state: "waiting" }, f.DB),
      /Record the request/,
    );
    const open = await saveFollowUp("w", input, f.DB);
    const sent = {
      id: "case",
      case_version: 1,
      request_id: "operation-123",
      provider_message_id: "provider-123",
      requested_at: new Date(Date.parse(open.updated_at) + 1).toISOString(),
      actor: "Sender",
      purpose: "documents_or_correction",
      note: "Please return the missing SI document.",
    };
    const waiting = await recordSentFollowUp("w", sent, f.DB);
    assert.equal(waiting.state, "waiting");
    assert.equal(waiting.owner, open.owner);
    assert.equal(waiting.due_at, open.due_at);
    assert.equal(waiting.shipment_reference, open.shipment_reference);
    assert.equal(waiting.request?.provider_message_id, "provider-123");
    assert.equal(
      (await recordSentFollowUp("w", sent, f.DB)).version,
      waiting.version,
    );
    const done = await saveFollowUp(
      "w",
      { ...input, version: waiting.version, state: "completed" },
      f.DB,
    );
    assert.equal(
      (await recordSentFollowUp("w", sent, f.DB)).state,
      "completed",
    );
    assert.equal(
      (await recordSentFollowUp("w", sent, f.DB)).version,
      done.version,
    );
    assert.equal(
      (await f.client.execute("SELECT count(*) n FROM follow_up_revisions"))
        .rows[0].n,
      3,
    );
  } finally {
    f.client.close();
  }
});

test("external request is explicitly recorded and an old delivery cannot overwrite newer work", async () => {
  const f = await fixture();
  try {
    const waiting = await saveFollowUp(
      "w",
      { ...input, state: "waiting", request_confirmed: true },
      f.DB,
    );
    assert.equal(waiting.request?.channel, "external");
    await assert.rejects(
      () =>
        recordSentFollowUp(
          "w",
          {
            id: "case",
            case_version: 1,
            request_id: "old",
            provider_message_id: "old-provider",
            requested_at: "2026-01-01T00:00:00Z",
            actor: "Sender",
            purpose: "documents_or_correction",
            note: "Old request sent.",
          },
          f.DB,
        ),
      /changed after/,
    );
    await saveCases(
      "w",
      [
        {
          result: f.current,
          expected: 1,
          action: "PROCESSED",
          actor: "Tester",
          detail: "Recheck",
        },
      ],
      f.DB,
    );
    await assert.rejects(
      () =>
        recordSentFollowUp(
          "w",
          {
            id: "case",
            case_version: 1,
            request_id: "stale",
            provider_message_id: "stale-provider",
            requested_at: new Date().toISOString(),
            actor: "Sender",
            purpose: "documents_or_correction",
            note: "Request on old evidence.",
          },
          f.DB,
        ),
      /case changed/,
    );
  } finally {
    f.client.close();
  }
});

test("summary completion proof is recomputed from stored evidence and absent proof fails closed", async () => {
  const f = await fixture();
  try {
    let row = (await listCaseSummaries("w", f.DB))[0];
    assert.equal(row.result?.completion_blocker, null);
    assert.equal("documents" in row.result!, false);
    assert.equal("comparison" in row.result!, false);
    const unsafe = structuredClone(f.current);
    unsafe.completion_blocker = null;
    unsafe.comparison.pop();
    await saveCases(
      "w",
      [
        {
          result: unsafe,
          expected: 1,
          action: "PROCESSED",
          actor: "Tester",
          detail: "Incomplete evidence fixture",
        },
      ],
      f.DB,
    );
    row = (await listCaseSummaries("w", f.DB))[0];
    assert.ok(row.result?.completion_blocker);
    assert.equal(planFor(row, undefined, now).bucket, "todo");
    const legacy = summaryOf(f.current);
    delete legacy.result!.completion_blocker;
    assert.equal(planFor(legacy, undefined, now).bucket, "todo");
  } finally {
    f.client.close();
  }
});
