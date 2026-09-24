import test from "node:test";
import assert from "node:assert/strict";
import { workspaceConfiguration } from "../lib/workspace-mode";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import { saveCases } from "../lib/storage";
import { analyze } from "../lib/compare";
import fs from "node:fs/promises";

test("company workspace excludes organiser fixtures unless explicitly enabled", () => {
  assert.deepEqual(workspaceConfiguration({ CARGO_AUTH_MODE: "team" }), {
    mode: "team",
    sample_data: false,
    upload_limit: 1000,
  });
  assert.equal(workspaceConfiguration({}).sample_data, true);
  assert.equal(
    workspaceConfiguration({
      CARGO_AUTH_MODE: "team",
      CARGO_INCLUDE_SAMPLE_DATA: "true",
    }).sample_data,
    true,
  );
  assert.equal(
    workspaceConfiguration({ CARGO_INCLUDE_SAMPLE_DATA: "false" }).sample_data,
    false,
  );
  assert.equal(
    workspaceConfiguration({ CARGO_MAX_WORKSPACE_UPLOADS: "75" }).upload_limit,
    75,
  );
});

test("invalid workspace policy fails closed instead of silently enabling samples or unlimited imports", () => {
  for (const value of ["", "yes", "TRUE", "0"])
    assert.throws(() =>
      workspaceConfiguration({ CARGO_INCLUDE_SAMPLE_DATA: value }),
    );
  for (const value of ["", "0", "-1", "NaN", "10001", "1.5", "1e3", " 30"])
    assert.throws(() =>
      workspaceConfiguration({ CARGO_MAX_WORKSPACE_UPLOADS: value }),
    );
  assert.throws(() =>
    workspaceConfiguration({ CARGO_AUTH_MODE: "production" }),
  );
});

test("configured import quota is enforced atomically while retained cases can still be updated", async () => {
  const prior = process.env.CARGO_MAX_WORKSPACE_UPLOADS;
  process.env.CARGO_MAX_WORKSPACE_UPLOADS = "1";
  const client = createClient({ url: ":memory:" });
  try {
    for (const file of (await fs.readdir("drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await client.executeMultiple(
        await fs.readFile(`drizzle/${file}`, "utf8"),
      );
    const { DB } = createNodeBindings(client);
    const result = analyze(
      {
        email_id: "upload_one",
        from: "unit@example.test",
        subject: "Weekly operations update",
        body: "Operations meeting on Friday.",
        attachments: [],
      },
      [],
    );
    const write = {
      result,
      expected: 0,
      action: "UPLOADED",
      actor: "Unit reviewer",
      detail: "Quota regression",
    };
    const saved = await saveCases(
      "quota",
      [
        write,
        {
          ...write,
          result: {
            ...result,
            email: { ...result.email, email_id: "upload_two" },
          },
        },
      ],
      DB,
    );
    assert.equal(saved.results.length, 1);
    assert.deepEqual(saved.conflicts, ["upload_two"]);
    assert.equal(
      (await client.execute("SELECT count(*) AS n FROM cases")).rows[0].n,
      1,
    );
    assert.equal(
      (await client.execute("SELECT count(*) AS n FROM events")).rows[0].n,
      1,
    );
    assert.equal(
      (
        await saveCases(
          "quota",
          [{ ...write, expected: 1, action: "REPROCESSED" }],
          DB,
        )
      ).results[0].version,
      2,
    );
    assert.equal(
      (await saveCases("another-workspace", [write], DB)).results.length,
      1,
    );
  } finally {
    client.close();
    if (prior === undefined) delete process.env.CARGO_MAX_WORKSPACE_UPLOADS;
    else process.env.CARGO_MAX_WORKSPACE_UPLOADS = prior;
  }
});
