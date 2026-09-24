import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import { saveCases } from "../lib/storage";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { summaryOf, type CaseResult } from "../lib/types";
import {
  completionBlocker,
  effectiveFollowUp,
  followUpBrief,
  followUpInput,
  followUpOverdue,
  type FollowUp,
  type FollowUpInput,
} from "../lib/follow-up";
import { listFollowUps, saveFollowUp } from "../lib/follow-up-storage";
import { POST } from "../app/api/follow-ups/route";

const fields =
  "Shipper: Atlas Export\nConsignee: Buyer Two\nNotify party: SAME AS CONSIGNEE\nPort of loading: Port Klang\nPort of discharge: Singapore\nContainer count: 2\nGross weight (KG): 42000";
async function result(bl = fields): Promise<CaseResult> {
  return {
    ...analyze(
      {
        email_id: "followup",
        from: "desk@example.test",
        subject: "Verify draft BL against SI",
        body: "Please compare the attached SI and draft BL and report differences.",
        attachments: ["source.txt", "draft.txt"],
      },
      await Promise.all([
        parseDocument(
          "source.txt",
          new TextEncoder().encode(`SHIPPING INSTRUCTION\n${fields}`),
        ),
        parseDocument(
          "draft.txt",
          new TextEncoder().encode(`DRAFT BILL OF LADING\n${bl}`),
        ),
      ]),
    ),
    version: 1,
  };
}
const input: FollowUpInput = {
  id: "followup",
  case_version: 1,
  version: 0,
  owner: "Demo operator",
  shipment_reference: "BOOKING-DEMO-01",
  due_at: "2026-09-27T10:00:00+08:00",
  state: "open",
  note: "Review issuer response before handover.",
  actor: "Demo reviewer",
};
function record(): FollowUp {
  return {
    email_id: input.id,
    ...input,
    version: 1,
    created_at: "2026-09-23T00:00:00Z",
    updated_at: "2026-09-23T00:00:00Z",
    completed_at: null,
  };
}
async function fixture() {
  const client = createClient({ url: ":memory:" });
  for (const file of (await fs.readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await client.executeMultiple(await fs.readFile(`drizzle/${file}`, "utf8"));
  const { DB } = createNodeBindings(client);
  const current = await result();
  await saveCases(
    "w",
    [
      {
        result: current,
        expected: 0,
        action: "PROCESSED",
        actor: "CargoGuard",
        detail: "fixture",
      },
    ],
    DB,
  );
  return { client, DB, current };
}

test("follow-up completion independently requires seven valid source-backed matching fields", async () => {
  const r = await result();
  assert.equal(completionBlocker(r), null);
  for (const change of [
    (v: CaseResult) => {
      v.pipeline_version = "old";
    },
    (v: CaseResult) => {
      v.category = "GENERAL";
    },
    (v: CaseResult) => {
      v.classification.needs_review = true;
    },
    (v: CaseResult) => {
      v.review_reason = "missing_value";
    },
    (v: CaseResult) => {
      v.comparison.pop();
    },
    (v: CaseResult) => {
      v.comparison[1] = v.comparison[0];
    },
    (v: CaseResult) => {
      v.comparison[0].si.raw = "TBD";
    },
    (v: CaseResult) => {
      v.comparison[6].bl.raw = "43 MT";
    },
    (v: CaseResult) => {
      v.comparison[0].si.source = "";
    },
    (v: CaseResult) => {
      v.comparison[0].si.extraction_issue = "Conflicting source names";
    },
  ]) {
    const altered = structuredClone(r);
    change(altered);
    assert.ok(completionBlocker(altered));
  }
});
test("waiting and completed reopen on new evidence, missing case or old engine", async () => {
  const r = await result();
  for (const state of ["waiting", "completed"] as const) {
    const f = { ...record(), state };
    assert.equal(effectiveFollowUp(f, r), state);
    assert.equal(effectiveFollowUp(f, summaryOf(r)), state);
    assert.equal(effectiveFollowUp(f, { ...r, version: 2 }), "reopened");
    assert.equal(
      effectiveFollowUp(f, { ...r, pipeline_version: "old" }),
      "reopened",
    );
    assert.equal(effectiveFollowUp(f, null), "reopened");
  }
  assert.equal(effectiveFollowUp(record(), { ...r, version: 2 }), "open");
});
test("deadline offsets, overdue boundary, completed exclusions and handover are explicit", async () => {
  const r = await result();
  const f = record();
  const deadline = Date.parse(input.due_at!);
  assert.equal(followUpOverdue(f, r, deadline), false);
  assert.equal(followUpOverdue(f, r, deadline + 1), true);
  assert.equal(followUpOverdue({ ...f, due_at: null }, r, deadline + 1), false);
  assert.equal(
    followUpOverdue({ ...f, state: "completed" }, r, deadline + 1),
    false,
  );
  assert.equal(
    followUpOverdue(
      { ...f, state: "completed" },
      { ...r, version: 2 },
      deadline + 1,
    ),
    true,
  );
  const brief = followUpBrief(
    [{ ...f, state: "completed" }],
    [summaryOf({ ...r, version: 2 })],
    new Date(deadline + 1).toISOString(),
  );
  assert.match(brief, /reopened \(OVERDUE\)/);
  assert.match(brief, /latest: 2/);
  assert.match(brief, /not proof of sending/);
});
test("follow-up validation rejects absent timezone, impossible dates, unsafe versions and empty accountability", () => {
  for (const patch of [
    { due_at: "2026-09-27T10:00" },
    { due_at: "2026-02-30T10:00:00Z" },
    { version: -1 },
    { case_version: 9007199254740992 },
    { owner: " " },
    { actor: " " },
    { note: " " },
    { shipment_reference: "line\nforged" },
    { state: "released" },
  ])
    assert.equal(
      followUpInput.safeParse({ ...input, ...patch }).success,
      false,
    );
  assert.equal(followUpInput.safeParse(input).success, true);
});
test("follow-up saves persist without changing the comparison or baseline; history is immutable", async () => {
  const f = await fixture();
  try {
    const before = (await f.client.execute("SELECT payload FROM cases")).rows[0]
      .payload;
    const first = await saveFollowUp("w", input, f.DB);
    assert.equal(first.due_at, "2026-09-27T02:00:00.000Z");
    const completed = await saveFollowUp(
      "w",
      { ...input, version: 1, state: "completed" },
      f.DB,
    );
    assert.ok(completed.completed_at);
    assert.equal(completed.created_at, first.created_at);
    assert.deepEqual(await listFollowUps("w", f.DB), [completed]);
    assert.deepEqual(await listFollowUps("other", f.DB), []);
    assert.equal(
      (await f.client.execute("SELECT payload FROM cases")).rows[0].payload,
      before,
    );
    assert.equal(
      (await f.client.execute("SELECT count(*) n FROM result_revisions"))
        .rows[0].n,
      1,
    );
    assert.equal(
      (await f.client.execute("SELECT count(*) n FROM follow_up_revisions"))
        .rows[0].n,
      2,
    );
    await assert.rejects(
      () => f.client.execute("UPDATE follow_up_revisions SET payload='{}'"),
      /immutable/,
    );
    await assert.rejects(
      () => f.client.execute("DELETE FROM follow_up_revisions"),
      /immutable/,
    );
  } finally {
    f.client.close();
  }
});
test("stale follow-up/case versions, unprocessed IDs and another workspace cannot write", async () => {
  const f = await fixture();
  try {
    await saveFollowUp("w", input, f.DB);
    for (const [ws, patch] of [
      ["w", {}],
      ["w", { version: 1, case_version: 2 }],
      ["w", { id: "missing" }],
      ["other", {}],
    ] as const)
      await assert.rejects(() =>
        saveFollowUp(ws, { ...input, ...patch }, f.DB),
      );
    assert.equal(
      (await f.client.execute("SELECT count(*) n FROM follow_up_revisions"))
        .rows[0].n,
      1,
    );
    assert.equal(
      (await f.client.execute("SELECT count(*) n FROM events")).rows[0].n,
      2,
    );
  } finally {
    f.client.close();
  }
});
test("completion rejects a mismatch and cannot be substituted for fixing source evidence", async () => {
  const f = await fixture();
  try {
    const mismatch = await result(fields.replace("42000", "43000"));
    await saveCases(
      "w",
      [
        {
          result: mismatch,
          expected: 1,
          action: "REPLACED",
          actor: "Tester",
          detail: "New BL",
        },
      ],
      f.DB,
    );
    await assert.rejects(
      () =>
        saveFollowUp(
          "w",
          { ...input, case_version: 2, state: "completed" },
          f.DB,
        ),
      /Resolve every discrepancy/,
    );
    assert.deepEqual(await listFollowUps("w", f.DB), []);
  } finally {
    f.client.close();
  }
});
test("a concurrent case write between read and commit invalidates completion atomically", async () => {
  const f = await fixture();
  try {
    const proxy = {
      ...f.DB,
      prepare: f.DB.prepare.bind(f.DB),
      batch: async (statements: D1PreparedStatement[]) => {
        await f.client.execute("UPDATE cases SET version=version+1");
        return f.DB.batch(statements);
      },
    } as D1Database;
    await assert.rejects(
      () => saveFollowUp("w", { ...input, state: "completed" }, proxy),
      /changed while saving/,
    );
    assert.deepEqual(await listFollowUps("w", f.DB), []);
    assert.equal(
      (await f.client.execute("SELECT count(*) n FROM follow_up_revisions"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await f.client.execute("SELECT count(*) n FROM events")).rows[0].n,
      1,
    );
  } finally {
    f.client.close();
  }
});
test("audit failure rolls back the follow-up and immutable history", async () => {
  const f = await fixture();
  try {
    await f.client.execute(
      "CREATE TRIGGER fail_followup BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END",
    );
    await assert.rejects(
      () => saveFollowUp("w", input, f.DB),
      /audit unavailable/,
    );
    assert.deepEqual(await listFollowUps("w", f.DB), []);
    assert.equal(
      (await f.client.execute("SELECT count(*) n FROM follow_up_revisions"))
        .rows[0].n,
      0,
    );
  } finally {
    f.client.close();
  }
});
test("cross-origin and expired-session follow-up mutations reject before reading input", async () => {
  const headersList: Record<string, string>[] = [
    {
      origin: "https://untrusted.example",
      cookie: "cargo_workspace=12345678-1234-1234-1234-123456789abc",
    },
    {},
  ];
  for (const headers of headersList) {
    const response = await POST(
      new Request("https://cargoguard.example/api/follow-ups", {
        method: "POST",
        headers,
        body: "invalid",
      }),
    );
    assert.ok([400, 403].includes(response.status));
    assert.match(
      ((await response.json()) as { error: string }).error,
      /origin|expired/,
    );
  }
});
