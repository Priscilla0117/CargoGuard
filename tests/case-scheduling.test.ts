import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import {
  dayKey,
  dailyCaseCounts,
  compareSchedule,
  DEFAULT_SCHEDULING,
  matchesSchedule,
} from "../lib/case-scheduling";
import { saveScheduling, schedulingMetadata } from "../lib/scheduling-storage";
import { mergeCaseSummaries } from "../lib/case-state";
import type { CaseSummary } from "../lib/types";
const row = (id: string, received?: string): CaseSummary => ({
  email: {
    email_id: id,
    from: "x@example.test",
    subject: "shipment",
    attachments: [],
    received_at: received,
  },
  result: null,
});
test("calendar counts one case per arrival, respects office midnight and leaves missing dates unknown", () => {
  const first = row("A", "2026-09-24T16:10:00Z"),
    old = row("B");
  assert.equal(dayKey(first.email.received_at), "2026-09-25");
  assert.deepEqual(dailyCaseCounts([first, first, old]).days["2026-09-25"], {
    received: 1,
    imported: 0,
    due: 0,
    follow_up: 0,
  });
  assert.equal(dailyCaseCounts([first, old]).undated, 1);
  assert.equal(
    matchesSchedule(first, "received_today", new Date("2026-09-24T17:00:00Z")),
    true,
  );
});
test("priority and deadlines order cases independently of ID", () => {
  const a = row("A"),
    b = row("B");
  a.scheduling = { ...DEFAULT_SCHEDULING, due_at: "2026-09-24T10:00:00Z" };
  b.scheduling = { ...DEFAULT_SCHEDULING, priority: "urgent" };
  assert.ok(compareSchedule(b, a) < 0);
  assert.equal(
    matchesSchedule(a, "overdue", new Date("2026-09-24T11:00:00Z")),
    true,
  );
});
test("case refresh never erases a newer independently saved schedule", () => {
  const previous = {
    ...row("A"),
    scheduling: {
      ...DEFAULT_SCHEDULING,
      version: 3,
      priority: "high" as const,
    },
  };
  assert.equal(
    mergeCaseSummaries([previous], [row("A")])[0].scheduling?.version,
    3,
  );
});
test("schedule CAS saves audit atomically and isolates workspaces", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    for (const file of (await fs.readdir("drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await client.executeMultiple(
        await fs.readFile(`drizzle/${file}`, "utf8"),
      );
    const { DB } = createNodeBindings(client);
    const next = await saveScheduling(
      "one",
      "case",
      DEFAULT_SCHEDULING,
      "Reviewer",
      DB,
    );
    assert.equal(next.version, 1);
    await assert.rejects(
      () => saveScheduling("one", "case", DEFAULT_SCHEDULING, "Reviewer", DB),
      /changed/,
    );
    assert.deepEqual(await schedulingMetadata("two", DB), {});
    assert.equal((await schedulingMetadata("one", DB)).case.version, 1);
    assert.equal(
      (await client.execute("SELECT COUNT(*) AS n FROM events")).rows[0].n,
      1,
    );
  } finally {
    client.close();
  }
});
