import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import { saveCases } from "../lib/storage";
import { analyze } from "../lib/compare";

async function fixture() {
  const client = createClient({ url: ":memory:" });
  for (const file of (await fs.readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await client.executeMultiple(await fs.readFile(`drizzle/${file}`, "utf8"));
  return { client, ...createNodeBindings(client) };
}
test("case + snapshot + audit commit together; stale CAS writes none", async () => {
  const f = await fixture();
  try {
    const result = analyze(
      {
        email_id: "unit",
        from: "unit@example.test",
        subject: "Weekly team meeting",
        body: "Operations update for information",
        attachments: [],
      },
      [],
    );
    const write = {
      result,
      expected: 0,
      action: "PROCESSED",
      actor: "CargoGuard",
      detail: "unit",
    };
    assert.equal((await saveCases("w", [write], f.DB)).results.length, 1);
    assert.equal((await saveCases("w", [write], f.DB)).conflicts.length, 1);
    const updated = await saveCases(
      "w",
      [
        {
          ...write,
          expected: 1,
          result: { ...result, reviewed: true },
          action: "CATEGORY_CONFIRMED",
        },
      ],
      f.DB,
    );
    assert.equal(updated.results[0].version, 2);
    const revisions = await f.client.execute(
      "SELECT version,origin FROM result_revisions ORDER BY version",
    );
    assert.deepEqual(
      revisions.rows.map((r) => [r.version, r.origin]),
      [
        [1, "automatic"],
        [2, "reviewed"],
      ],
    );
    assert.equal(
      (await f.client.execute("SELECT count(*) AS n FROM events")).rows[0].n,
      2,
    );
    await assert.rejects(
      () => f.client.execute("UPDATE result_revisions SET origin='automatic'"),
      /immutable/,
    );
    await assert.rejects(
      () => f.client.execute("DELETE FROM result_revisions"),
      /immutable/,
    );
    // Force an event failure to prove that its case and revision roll back too.
    await f.client.execute(
      "CREATE TRIGGER test_fail BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'forced event failure'); END",
    );
    await assert.rejects(
      () => saveCases("w", [{ ...write, expected: 2 }], f.DB),
      /forced event failure/,
    );
    assert.equal(
      (await f.client.execute("SELECT version FROM cases")).rows[0].version,
      2,
    );
    assert.equal(
      (await f.client.execute("SELECT count(*) AS n FROM result_revisions"))
        .rows[0].n,
      2,
    );
  } finally {
    f.client.close();
  }
});
test("migration imports only the retained legacy state", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(
      await fs.readFile("drizzle/0000_crazy_quasimodo.sql", "utf8"),
    );
    await client.execute(
      "INSERT INTO cases VALUES('w','legacy','{}',7,'2026-09-19')",
    );
    await client.executeMultiple(
      await fs.readFile("drizzle/0001_decision_history.sql", "utf8"),
    );
    const rows = (
      await client.execute("SELECT version,origin FROM result_revisions")
    ).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].version, 7);
    assert.equal(rows[0].origin, "legacy");
    await client.execute("INSERT INTO policies VALUES('w',1,'{}')");
    await assert.rejects(
      () => client.execute("UPDATE policies SET payload='null'"),
      /immutable/,
    );
    await assert.rejects(
      () => client.execute("DELETE FROM policies"),
      /immutable/,
    );
  } finally {
    client.close();
  }
});
test("source bytes round-trip exactly and cannot be overwritten", async () => {
  const f = await fixture();
  try {
    const bytes = new Uint8Array([0, 1, 17, 128, 255]);
    await f.BUCKET.put("workspace/id/source", bytes);
    const doc = await f.BUCKET.get("workspace/id/source");
    assert.deepEqual(new Uint8Array(await doc!.arrayBuffer()), bytes);
    assert.equal(await f.BUCKET.get("other/id/source"), null);
    await assert.rejects(
      () => f.BUCKET.put("workspace/id/source", bytes),
      /UNIQUE/,
    );
    await assert.rejects(
      () => f.BUCKET.put("too-big", new Uint8Array(5 * 1024 * 1024 + 1)),
      /5 MB/,
    );
    await f.BUCKET.delete("workspace/id/source");
    assert.equal(await f.BUCKET.get("workspace/id/source"), null);
  } finally {
    f.client.close();
  }
});
