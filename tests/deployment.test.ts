import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import {
  deploymentConfiguration,
  requireBootstrapConfiguration,
} from "../lib/deployment-config";
import { RUNTIME_SCHEMA_PROBE, RUNTIME_TABLES } from "../lib/runtime-schema";
import { migrateNode } from "../lib/migrations-node";
import { nodeClient } from "../lib/runtime-node";

const local = { CARGO_LOCAL_DB: "work/synthetic.db" };
test("empty remote environment values select the explicit local database", async () => {
  const keys = [
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "RENDER",
    "CARGO_LOCAL_DB",
  ] as const;
  const before = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  await fs.mkdir("work/validation/deployment", { recursive: true });
  try {
    process.env.TURSO_AUTH_TOKEN = "";
    process.env.RENDER = "";
    process.env.CARGO_LOCAL_DB = `work/validation/deployment/${randomUUID()}.db`;
    for (const value of ["", "   "]) {
      process.env.TURSO_DATABASE_URL = value;
      assert.equal(
        deploymentConfiguration({ ...local, TURSO_DATABASE_URL: value }).remote,
        false,
      );
      const client = nodeClient();
      try {
        assert.equal(
          (await client.execute("SELECT 1 AS ready")).rows[0].ready,
          1,
        );
      } finally {
        client.close();
      }
    }
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});
test("startup defaults to synthetic demo only when team access is not selected", () => {
  assert.deepEqual(deploymentConfiguration(local), {
    mode: "demo",
    sample_data: true,
    upload_limit: 30,
    origin: null,
    remote: false,
  });
  assert.deepEqual(
    deploymentConfiguration({
      ...local,
      CARGO_AUTH_MODE: "team",
      CARGO_PUBLIC_ORIGIN: "https://operations.example.test",
    }),
    {
      mode: "team",
      sample_data: false,
      upload_limit: 1000,
      origin: "https://operations.example.test",
      remote: false,
    },
  );
});
test("persistent storage configuration rejects ephemeral, missing and secret-bearing endpoints", () => {
  for (const env of [
    {},
    { ...local, RENDER: "true" },
    { CARGO_LOCAL_DB: ":memory:" },
    { CARGO_LOCAL_DB: "work/test.db?mode=memory" },
    { TURSO_DATABASE_URL: "libsql://database.example.test" },
    {
      TURSO_DATABASE_URL: "http://database.example.test",
      TURSO_AUTH_TOKEN: "synthetic",
    },
    {
      TURSO_DATABASE_URL: "libsql://user:synthetic-secret@example.test",
      TURSO_AUTH_TOKEN: "synthetic",
    },
  ])
    assert.throws(() => deploymentConfiguration(env));
  assert.equal(
    deploymentConfiguration({
      TURSO_DATABASE_URL: "libsql://database.example.test",
      TURSO_AUTH_TOKEN: "synthetic",
      RENDER: "true",
    }).remote,
    true,
  );
});
test("team startup requires a trustworthy origin and rejects malformed workspace settings", () => {
  for (const origin of [
    undefined,
    "http://operations.example.test",
    "https://example.test/app",
    "https://example.test/?secret=x",
    "https://user:secret@example.test",
    "file:///tmp/test",
  ]) {
    assert.throws(() =>
      deploymentConfiguration({
        ...local,
        CARGO_AUTH_MODE: "team",
        CARGO_PUBLIC_ORIGIN: origin,
      }),
    );
  }
  for (const port of ["0", "65536", "NaN", "3000abc"])
    assert.throws(() => deploymentConfiguration({ ...local, PORT: port }));
  for (const env of [
    { CARGO_AUTH_MODE: "TEAM" },
    { CARGO_INCLUDE_SAMPLE_DATA: "yes" },
    { CARGO_MAX_WORKSPACE_UPLOADS: "0" },
  ])
    assert.throws(() => deploymentConfiguration({ ...local, ...env }));
  assert.equal(
    deploymentConfiguration({
      ...local,
      CARGO_AUTH_MODE: "team",
      RENDER_EXTERNAL_URL: "https://service.onrender.com",
    }).origin,
    "https://service.onrender.com",
  );
  assert.equal(
    deploymentConfiguration({
      ...local,
      CARGO_AUTH_MODE: "team",
      CARGO_PUBLIC_ORIGIN: "http://127.0.0.1:3067",
    }).origin,
    "http://127.0.0.1:3067",
  );
});
test("only the initial team setup needs a bootstrap secret; restarting initialized teams does not", () => {
  assert.throws(() =>
    requireBootstrapConfiguration(false, { CARGO_AUTH_MODE: "team" }),
  );
  assert.throws(() =>
    requireBootstrapConfiguration(false, {
      CARGO_AUTH_MODE: "team",
      CARGO_BOOTSTRAP_SECRET: "too-short",
    }),
  );
  assert.doesNotThrow(() =>
    requireBootstrapConfiguration(false, {
      CARGO_AUTH_MODE: "team",
      CARGO_BOOTSTRAP_SECRET: "a".repeat(32),
    }),
  );
  assert.doesNotThrow(() =>
    requireBootstrapConfiguration(true, { CARGO_AUTH_MODE: "team" }),
  );
  assert.doesNotThrow(() =>
    requireBootstrapConfiguration(false, { CARGO_AUTH_MODE: "demo" }),
  );
});
test("readiness covers every migrated table and fails on a partial release schema", async () => {
  await fs.mkdir("work/validation/deployment", { recursive: true });
  const client = createClient({
    url: `file:work/validation/deployment/${randomUUID()}.db`,
  });
  try {
    const migrations = await Promise.all(
      (await fs.readdir("drizzle"))
        .filter((name) => /^\d+.*\.sql$/.test(name))
        .sort()
        .map(async (name) => ({
          name,
          sql: await fs.readFile(`drizzle/${name}`, "utf8"),
        })),
    );
    await migrateNode(client, migrations);
    const actual = (
      await client.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
      )
    ).rows
      .map((row) => row.name)
      .sort();
    assert.deepEqual(
      [...RUNTIME_TABLES].sort(),
      actual,
      "Keep the readiness contract current when migrations add features.",
    );
    assert.equal((await client.execute(RUNTIME_SCHEMA_PROBE)).rows.length, 0);
    await client.execute("DROP TABLE microsoft_notification_outbox");
    await assert.rejects(
      () => client.execute(RUNTIME_SCHEMA_PROBE),
      /no such table/i,
    );
  } finally {
    client.close();
  }
});
