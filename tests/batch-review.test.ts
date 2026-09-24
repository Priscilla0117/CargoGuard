import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import { saveCases } from "../lib/storage";
import { parseDocument } from "../lib/parsers";
import { analyze } from "../lib/compare";
import {
  batchCandidates,
  batchReviewBlocker,
  batchReviewInput,
  completeBatch,
} from "../lib/batch-review";
import { listFollowUps, saveFollowUp } from "../lib/follow-up-storage";
import type { CaseResult } from "../lib/types";

const fields =
  "Shipper: Atlas Export\nConsignee: Buyer Two\nNotify party: SAME AS CONSIGNEE\nPort of loading: Port Klang\nPort of discharge: Singapore\nContainer count: 2\nGross weight (KG): 42000\nVessel: EXAMPLE";
async function sample(id = "batch-one", body = fields): Promise<CaseResult> {
  return {
    ...analyze(
      {
        email_id: id,
        from: "test@example.test",
        subject: "Verify draft BL against SI",
        body: "Please compare attached SI and draft BL",
        attachments: ["si.txt", "bl.txt"],
      },
      await Promise.all([
        parseDocument(
          "si.txt",
          new TextEncoder().encode(`SHIPPING INSTRUCTION\n${fields}`),
        ),
        parseDocument(
          "bl.txt",
          new TextEncoder().encode(`DRAFT BILL OF LADING\n${body}`),
        ),
      ]),
    ),
    version: 1,
  };
}
async function fixture() {
  const client = createClient({ url: ":memory:" });
  for (const name of (await fs.readdir("drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await client.executeMultiple(await fs.readFile(`drizzle/${name}`, "utf8"));
  const { DB } = createNodeBindings(client),
    result = await sample();
  await saveCases(
    "w",
    [
      {
        result,
        expected: 0,
        action: "PROCESSED",
        actor: "Test",
        detail: "Synthetic",
      },
    ],
    DB,
  );
  return { client, DB, result };
}
const request = () =>
  batchReviewInput.parse({
    items: [{ id: "batch-one", case_version: 1, follow_up_version: 0 }],
    actor: "Test Reviewer",
    note: "Reviewed the document-check evidence and scope.",
    confirmed_document_check_only: true,
  });

test("batch requires current strict source-backed matches and excludes reviewed evidence", async () => {
  const result = await sample();
  assert.equal(batchReviewBlocker(result), null);
  for (const mutation of [
    (r: CaseResult) => {
      r.pipeline_version = "old";
    },
    (r: CaseResult) => {
      r.reviewed = true;
    },
    (r: CaseResult) => {
      r.source_replaced = true;
    },
    (r: CaseResult) => {
      r.comparison[0].si.raw = "Different Company";
    },
    (r: CaseResult) => {
      r.documents[0].sha256 = undefined;
    },
    (r: CaseResult) => {
      r.documents[0].label_rules = {
        source_sha256: r.documents[0].sha256!,
        template_signature: "x",
        aliases: [],
      };
    },
    (r: CaseResult) => {
      r.comparison[0].bl.method = "Human correction";
    },
    (r: CaseResult) => {
      r.classification.needs_review = true;
    },
  ]) {
    const changed = structuredClone(result);
    mutation(changed);
    assert.ok(batchReviewBlocker(changed));
  }
});
test("independent invalid container identifier blocks batch even when seven fields match", async () => {
  const result = await sample(
    "batch-one",
    `${fields}\nContainer number: MSCU1234560`,
  );
  assert.equal(result.workflow, "verified");
  assert.match(batchReviewBlocker(result)!, /integrity/);
});
test("a port code contradicting its stated country blocks batch even when SI and BL agree", async () => {
  const contradictory = fields.replace(
    "Port of discharge: Singapore",
    "Port of discharge: TUTICORIN, INDIA (KEMBA)",
  );
  const result = await analyzeTexts(contradictory, contradictory);
  assert.equal(result.workflow, "verified");
  assert.match(batchReviewBlocker(result)!, /UN\/LOCODE/);
  // A reference-data advisory (code absent from the snapshot) does not block batch.
  const unknown = fields.replace(
    "Port of discharge: Singapore",
    "Port of discharge: AQABA, JORDAN (JOAQB)",
  );
  assert.equal(batchReviewBlocker(await analyzeTexts(unknown, unknown)), null);
});
async function analyzeTexts(si: string, bl: string): Promise<CaseResult> {
  return {
    ...analyze(
      {
        email_id: "batch-port",
        from: "test@example.test",
        subject: "Verify draft BL against SI",
        body: "Please compare attached SI and draft BL",
        attachments: ["si.txt", "bl.txt"],
      },
      await Promise.all([
        parseDocument(
          "si.txt",
          new TextEncoder().encode(`SHIPPING INSTRUCTION\n${si}`),
        ),
        parseDocument(
          "bl.txt",
          new TextEncoder().encode(`DRAFT BILL OF LADING\n${bl}`),
        ),
      ]),
    ),
    version: 1,
  };
}
test("batch input limits, duplicates and required scope cannot be bypassed", () => {
  assert.equal(
    batchReviewInput.safeParse({
      ...request(),
      confirmed_document_check_only: false,
    }).success,
    false,
  );
  assert.equal(
    batchReviewInput.safeParse({ ...request(), items: [] }).success,
    false,
  );
  assert.equal(
    batchReviewInput.safeParse({
      ...request(),
      items: [request().items[0], request().items[0]],
    }).success,
    false,
  );
  assert.equal(
    batchReviewInput.safeParse({
      ...request(),
      items: Array.from({ length: 26 }, (_, index) => ({
        id: String(index),
        case_version: 1,
        follow_up_version: 0,
      })),
    }).success,
    false,
  );
});
test("completion records real audit evidence, is idempotent after success and does not alter comparison", async () => {
  const f = await fixture();
  try {
    const candidates = await batchCandidates("w", f.DB);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].values.length, 7);
    assert.ok(candidates[0].not_checked > 0);
    assert.equal(
      (await completeBatch("w", request(), f.DB))[0].status,
      "completed",
    );
    const followups = await listFollowUps("w", f.DB);
    assert.equal(followups[0].state, "completed");
    assert.match(followups[0].note, /not cargo release/);
    assert.equal((await batchCandidates("w", f.DB)).length, 0);
    assert.equal(
      (await completeBatch("w", request(), f.DB))[0].status,
      "already_completed",
    );
    assert.equal(
      (await f.client.execute("SELECT * FROM follow_up_revisions")).rows.length,
      1,
    );
    assert.equal(
      (await f.client.execute("SELECT version FROM cases")).rows[0].version,
      1,
    );
  } finally {
    f.client.close();
  }
});
test("batch reports row-specific partial success, stale conflicts and workspace isolation", async () => {
  const f = await fixture();
  try {
    const mismatch = await sample(
      "batch-two",
      fields.replace("42000", "43000"),
    );
    await saveCases(
      "w",
      [
        {
          result: mismatch,
          expected: 0,
          action: "PROCESSED",
          actor: "Test",
          detail: "Synthetic mismatch",
        },
      ],
      f.DB,
    );
    const input = request();
    input.items.push(
      { id: "batch-two", case_version: 1, follow_up_version: 0 },
      { id: "missing", case_version: 1, follow_up_version: 0 },
    );
    assert.deepEqual(
      (await completeBatch("w", input, f.DB)).map((row) => row.status),
      ["completed", "blocked", "blocked"],
    );
    assert.deepEqual(await batchCandidates("other", f.DB), []);
    assert.equal(
      (await completeBatch("other", request(), f.DB))[0].status,
      "blocked",
    );
    await f.client.execute(
      "UPDATE cases SET version=2 WHERE email_id='batch-one'",
    );
    assert.equal(
      (await completeBatch("w", request(), f.DB))[0].status,
      "conflict",
    );
  } finally {
    f.client.close();
  }
});
test("refreshing after a follow-up conflict preserves the current owner and shipment deadline", async () => {
  const f = await fixture();
  try {
    const prior = await saveFollowUp(
      "w",
      {
        id: "batch-one",
        case_version: 1,
        version: 0,
        owner: "Shipment Owner",
        shipment_reference: "BOOKING-EXAMPLE",
        due_at: "2026-09-25T14:00:00+08:00",
        state: "open",
        actor: "Operations Reviewer",
        note: "Original source checks complete; awaiting sign-off.",
      },
      f.DB,
    );
    assert.equal(
      (await completeBatch("w", request(), f.DB))[0].status,
      "conflict",
    );
    assert.deepEqual(await listFollowUps("w", f.DB), [prior]);

    const candidates = await batchCandidates("w", f.DB);
    assert.equal(candidates[0].owner, "Shipment Owner");
    assert.equal(candidates[0].follow_up_version, prior.version);
    const fresh = request();
    fresh.items[0].follow_up_version = candidates[0].follow_up_version;
    assert.equal(
      (await completeBatch("w", fresh, f.DB))[0].status,
      "completed",
    );
    const [saved] = await listFollowUps("w", f.DB);
    assert.equal(saved.owner, prior.owner);
    assert.equal(saved.shipment_reference, prior.shipment_reference);
    assert.equal(saved.due_at, prior.due_at);
    assert.equal(saved.version, prior.version + 1);
    assert.equal(saved.actor, fresh.actor);
  } finally {
    f.client.close();
  }
});

test("case changes between eligibility read and completion commit cannot be signed off", async () => {
  const f = await fixture();
  try {
    const db = Object.create(f.DB) as D1Database;
    db.batch = async <T>(statements: D1PreparedStatement[]) => {
      await f.client.execute("UPDATE cases SET version=version+1");
      return f.DB.batch<T>(statements);
    };
    assert.equal(
      (await completeBatch("w", request(), db))[0].status,
      "conflict",
    );
    assert.deepEqual(await listFollowUps("w", f.DB), []);
    assert.equal(
      (await f.client.execute("SELECT * FROM follow_up_revisions")).rows.length,
      0,
    );
  } finally {
    f.client.close();
  }
});
test("a follow-up audit failure yields failed row and no unaudited completion", async () => {
  const f = await fixture();
  try {
    await f.client.execute(
      "CREATE TRIGGER fail_batch_audit BEFORE INSERT ON events WHEN NEW.action='FOLLOW_UP_UPDATED' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END",
    );
    assert.equal(
      (await completeBatch("w", request(), f.DB))[0].status,
      "failed",
    );
    assert.deepEqual(await listFollowUps("w", f.DB), []);
  } finally {
    f.client.close();
  }
});
