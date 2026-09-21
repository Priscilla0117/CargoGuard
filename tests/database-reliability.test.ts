import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { createClient, type TransactionMode } from "@libsql/client";
import { databaseFetch } from "../lib/database-fetch";
import { createReadinessCheck } from "../lib/readiness";
import { migrateNode } from "../lib/migrations-node";
import { requestJson, RequestError } from "../lib/client-api";

async function migrationFixture() {
  await fs.mkdir("work/validation/migration-reliability", { recursive: true });
  // libSQL's interactive transaction opens a separate connection; an anonymous
  // :memory: database would not be shared. Keep isolated QA files outside Git.
  return createClient({
    url: `file:work/validation/migration-reliability/${randomUUID()}.db`,
  });
}

test("database transport preserves method, authorization and body without replay", async () => {
  let calls = 0;
  const send = databaseFetch(1000, async (input, init) => {
    calls++;
    const request = new Request(input, init);
    assert.equal(request.method, "POST");
    assert.equal(
      request.headers.get("authorization"),
      "Bearer synthetic-test-only",
    );
    assert.equal(await request.text(), "synthetic-query");
    assert.equal(request.cache, "no-store");
    return Response.json({ ok: true });
  });
  const response = await send(
    new Request("https://database.example.test", {
      method: "POST",
      headers: { authorization: "Bearer synthetic-test-only" },
      body: "synthetic-query",
    }),
  );
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls, 1);
});

test("transport propagates abort from the original request", async () => {
  const controller = new AbortController();
  controller.abort();
  let observed = false;
  await databaseFetch(1000, async (_input, init) => {
    observed = init!.signal!.aborted;
    return Response.json({});
  })(
    new Request("https://database.example.test", { signal: controller.signal }),
  );
  assert.equal(observed, true);
});

test("transport propagates explicit caller abort", async () => {
  const controller = new AbortController();
  controller.abort();
  await databaseFetch(1000, async (_input, init) => {
    assert.equal(init!.signal!.aborted, true);
    return Response.json({});
  })("https://database.example.test", { signal: controller.signal });
});

for (const stage of ["headers", "body"] as const) {
  test(`real HTTP ${stage} stall is cancelled and never replayed`, async () => {
    let calls = 0;
    const server = createServer((_request, response) => {
      calls++;
      if (stage === "body") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.write('{"incomplete":');
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const started = Date.now();
      await assert.rejects(async () => {
        const result = await databaseFetch(250)(
          `http://127.0.0.1:${address.port}`,
          { method: "POST", body: "synthetic" },
        );
        await result.json();
      }, /abort|timeout/i);
      assert.ok(
        Date.now() - started < 3000,
        "network deadline must be bounded",
      );
      assert.equal(calls, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
}

test("readiness succeeds and briefly caches one successful query", async () => {
  let calls = 0;
  const check = createReadinessCheck(async () => {
    calls++;
  });
  assert.equal(await check(), true);
  assert.equal(await check(), true);
  assert.equal(calls, 1);
});

test("provider capacity errors are unavailable, never healthy", async () => {
  const check = createReadinessCheck(async () => {
    throw new Error("Server database capacity temporarily exceeded");
  });
  assert.equal(await check(), false);
});

test("a hung probe returns by deadline and concurrent checks cannot pile up", async () => {
  let calls = 0;
  const check = createReadinessCheck(
    () => {
      calls++;
      return new Promise(() => {});
    },
    { timeoutMs: 20, cacheMs: 0 },
  );
  assert.deepEqual(
    await Promise.all(Array.from({ length: 20 }, () => check())),
    Array(20).fill(false),
  );
  assert.equal(await check(), false);
  assert.equal(calls, 1);
});

test("late probe completion cannot turn a timed-out check into a success", async () => {
  let finish!: () => void;
  let calls = 0;
  const check = createReadinessCheck(
    () => {
      calls++;
      return calls === 1
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve();
    },
    { timeoutMs: 10, cacheMs: 20 },
  );
  assert.equal(await check(), false);
  finish();
  assert.equal(await check(), false);
  await delay(25);
  assert.equal(await check(), true);
  assert.equal(calls, 2);
});

test("readiness recovers after the provider becomes available", async () => {
  let failing = true;
  const check = createReadinessCheck(
    async () => {
      if (failing) throw new Error("capacity");
    },
    { cacheMs: 0 },
  );
  assert.equal(await check(), false);
  failing = false;
  assert.equal(await check(), true);
});

test("first migration is atomic and an ordinary restart opens no write transaction", async () => {
  const client = await migrationFixture();
  try {
    const migrations = [
      {
        name: "0000_test.sql",
        sql: "CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES('retained');",
      },
    ];
    await migrateNode(client, migrations);
    const originalTransaction = client.transaction.bind(client);
    let writes = 0;
    client.transaction = async (mode?: TransactionMode) => {
      writes++;
      return originalTransaction(mode);
    };
    await migrateNode(client, migrations);
    assert.equal(writes, 0);
    assert.equal(
      (await client.execute("SELECT value FROM sample")).rows[0].value,
      "retained",
    );
    assert.equal(
      (await client.execute("SELECT count(*) AS n FROM cargo_migrations"))
        .rows[0].n,
      1,
    );
  } finally {
    client.close();
  }
});

test("a failed migration rolls back and is not marked applied", async () => {
  const client = await migrationFixture();
  try {
    await assert.rejects(
      migrateNode(client, [
        {
          name: "0000_bad.sql",
          sql: "CREATE TABLE transient(value TEXT); INSERT INTO absent VALUES(1);",
        },
      ]),
    );
    assert.equal(
      (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE name='transient'",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (await client.execute("SELECT name FROM cargo_migrations")).rows.length,
      0,
    );
  } finally {
    client.close();
  }
});

for (const method of ["GET", "POST"]) {
  test(`${method} gateway failure is actionable and never automatically replayed`, async () => {
    let calls = 0;
    await assert.rejects(
      requestJson("/api/cases", { method }, async () => {
        calls++;
        return new Response("<html>gateway failure</html>", { status: 502 });
      }),
      (error: unknown) =>
        error instanceof RequestError &&
        error.status === 502 &&
        /check saved progress/.test(error.message),
    );
    assert.equal(calls, 1);
  });
}

test("a non-gateway malformed response retains its distinct error", async () => {
  await assert.rejects(
    requestJson("/api", {}, async () => new Response("bad json")),
    /unexpected response/,
  );
});
