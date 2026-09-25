import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createClient } from "@libsql/client";
import {
  base64url,
  mailConfiguration,
  sealSecret,
  DEFAULT_MAIL_SETTINGS,
} from "../lib/mail-connector";
import { runMailWorkerPass, runMailWorkerLoop } from "../lib/mail-worker";
import { mailWorkerEnabled, mailWorkerStatus } from "../lib/mail-worker-config";
import { requireMailboxIntake } from "../lib/mail-intake-auth";

test("background intake is opt-in and unavailable to anonymous workspaces", () => {
  assert.equal(
    mailWorkerEnabled({
      CARGO_AUTH_MODE: "demo",
      CARGO_MAIL_WORKER_ENABLED: "true",
    }),
    false,
  );
  assert.equal(mailWorkerEnabled({ CARGO_AUTH_MODE: "team" }), false);
  assert.equal(
    mailWorkerEnabled({
      CARGO_AUTH_MODE: "team",
      CARGO_MAIL_WORKER_ENABLED: "true",
    }),
    true,
  );
});

test("persistent intake imports without browser sessions, resumes safely and reports failure separately", async (t) => {
  const oldEnv = { ...process.env };
  await fs.mkdir("work", { recursive: true });
  const dir = await fs.mkdtemp(path.resolve("work/mail-worker-test-"));
  for (const key of [
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "RENDER",
    "RENDER_EXTERNAL_URL",
  ])
    delete process.env[key];
  Object.assign(process.env, {
    CARGO_AUTH_MODE: "team",
    CARGO_MAIL_WORKER_ENABLED: "true",
    CARGO_LOCAL_DB: path.join(dir, "worker.db"),
    CARGO_PUBLIC_ORIGIN: "https://cargo.example.test",
    CARGO_MAIL_TOKEN_KEY: btoa("01234567890123456789012345678901"),
    CARGO_GOOGLE_CLIENT_ID: "synthetic",
    CARGO_GOOGLE_CLIENT_SECRET: "synthetic",
  });
  const client = createClient({ url: `file:${process.env.CARGO_LOCAL_DB}` });
  try {
    for (const file of (await fs.readdir("drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await client.executeMultiple(
        await fs.readFile(`drizzle/${file}`, "utf8"),
      );
    await client.execute(
      "INSERT INTO team_users(id,email,display_name,password_hash,created_at) VALUES('employee','staff@example.test','Employee','not-a-login','2026-01-01')",
    );
    await client.execute(
      "INSERT INTO team_memberships(workspace,user_id,role,active,version) VALUES('team','employee','operator',1,1)",
    );
    const config = (await mailConfiguration()).config!;
    const secret = await sealSecret(
      config,
      JSON.stringify({
        access_token: "synthetic",
        refresh_token: "synthetic",
        expires_at: Date.now() + 3600000,
      }),
      "mail:team:employee",
    );
    await client.execute({
      sql: "INSERT INTO mail_connections(workspace,user_id,provider,account,encrypted_secret,settings,version,updated_at) VALUES('team','employee','gmail','staff@example.test',?,?,1,'2026-01-01')",
      args: [secret, JSON.stringify(DEFAULT_MAIL_SETTINGS)],
    });
    const { runtimeBindings } = await import("../lib/runtime-node");
    const { DB: db } = runtimeBindings();
    const ids = ["abc123"];
    let calls = 0,
      writes = 0,
      fail = false,
      revokeOnRead = false;
    const fetcher: typeof fetch = async (input, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("cookie"), null);
      if (init?.method && init.method !== "GET") writes++;
      if (fail) throw new Error("Synthetic connection failure");
      const url = new URL(String(input));
      if (url.pathname.endsWith("/messages"))
        return Response.json({
          messages: ids.map((id) => ({ id, threadId: "thread1" })),
        });
      const id = url.pathname.split("/").pop()!;
      assert.ok(
        ids.includes(id),
        "only read-list/raw provider operations are allowed",
      );
      if (revokeOnRead) {
        revokeOnRead = false;
        await client.execute(
          "UPDATE team_memberships SET active=0,version=version+1",
        );
      }
      const raw = [
        `Message-ID: <${id}@example.test>`,
        "From: carrier@example.test",
        "To: staff@example.test",
        "Date: Fri, 25 Sep 2026 10:00:00 +0000",
        "Subject: Please check draft BL and shipping instruction",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Please compare the draft BL against the SI. Documents will follow.",
      ].join("\r\n");
      return Response.json({
        id,
        threadId: "thread1",
        internalDate: "1790330400000",
        raw: base64url(new TextEncoder().encode(raw)),
      });
    };
    const expireAttempt = () =>
      client.execute(
        "UPDATE mail_connections SET last_sync_at='2000-01-01T00:00:00Z'",
      );
    const cases = async () =>
      Number(
        (await client.execute("SELECT COUNT(*) AS n FROM cases")).rows[0].n,
      );
    const runUntil = async (want: number) => {
      const controller = new AbortController();
      const loop = runMailWorkerLoop({
        db,
        configuration: async () => ({ config }),
        signal: controller.signal,
        fetcher,
        pollIntervalMs: 10,
      });
      try {
        const until = Date.now() + 5000;
        while ((await cases()) < want && Date.now() < until) await delay(10);
        assert.equal(await cases(), want);
      } finally {
        controller.abort();
        await loop;
      }
    };
    await t.test(
      "loop imports with zero browser sessions and resumes on a new loop",
      async () => {
        assert.equal(
          (await client.execute("SELECT COUNT(*) AS n FROM team_sessions"))
            .rows[0].n,
          0,
        );
        await runUntil(1);
        assert.equal((await mailWorkerStatus(db)).state, "stopped");
        const first = await client.execute("SELECT payload FROM cases");
        assert.equal(
          JSON.parse(String(first.rows[0].payload)).email.source,
          "gmail",
        );
        ids.push("abc124");
        await expireAttempt();
        await runUntil(2);
        await expireAttempt();
        await runMailWorkerPass({ db, config, fetcher });
        assert.equal(
          await cases(),
          2,
          "restart and duplicate messages do not duplicate cases",
        );
        assert.equal(
          writes,
          0,
          "background intake does not submit drafts or email",
        );
      },
    );
    await t.test(
      "last success survives a connection failure and clears its error after recovery",
      async () => {
        const success = (
          await client.execute("SELECT last_success_at FROM mail_connections")
        ).rows[0].last_success_at;
        assert.ok(success);
        fail = true;
        await expireAttempt();
        assert.equal(
          (await runMailWorkerPass({ db, config, fetcher })).failed,
          1,
        );
        const failed = (
          await client.execute(
            "SELECT last_success_at,last_sync_error,last_sync_at FROM mail_connections",
          )
        ).rows[0];
        assert.equal(failed.last_success_at, success);
        assert.ok(failed.last_sync_error);
        assert.notEqual(failed.last_sync_at, "2000-01-01T00:00:00Z");
        fail = false;
        await expireAttempt();
        await runMailWorkerPass({ db, config, fetcher });
        assert.equal(
          (await client.execute("SELECT last_sync_error FROM mail_connections"))
            .rows[0].last_sync_error,
          null,
        );
      },
    );
    await t.test(
      "revocation during provider reading blocks the case write",
      async () => {
        ids.push("abc125");
        revokeOnRead = true;
        await expireAttempt();
        assert.equal(
          (await runMailWorkerPass({ db, config, fetcher })).failed,
          1,
        );
        assert.equal(await cases(), 2);
        const before = calls;
        await expireAttempt();
        await runMailWorkerPass({ db, config, fetcher });
        assert.equal(
          calls,
          before,
          "inactive members cannot trigger provider calls",
        );
        await client.execute(
          "UPDATE team_memberships SET active=1,version=version+1",
        );
      },
    );
    await t.test(
      "public upload cannot impersonate the worker and intake authority cannot send",
      async () => {
        const { POST: upload } = await import("../app/api/upload/route");
        const form = new FormData();
        form.set(
          "eml",
          new File(["From: carrier@example.test\r\n\r\nHello"], "mail.eml"),
        );
        const response = await upload(
          new Request("https://cargo.example.test/api/upload", {
            method: "POST",
            headers: {
              Origin: "https://cargo.example.test",
              "X-CargoGuard-Worker": "true",
            },
            body: form,
          }),
        );
        assert.equal(response.status, 401);
        const { deliverReply } = await import("../lib/mail-delivery");
        const source = JSON.parse(
          String(
            (await client.execute("SELECT payload FROM cases LIMIT 1")).rows[0]
              .payload,
          ),
        );
        await assert.rejects(
          () =>
            deliverReply(
              {
                workspace: "team",
                userId: "employee",
                actor: "Background import",
                sessionToken: "",
                request: new Request("http://mail-worker.internal/sync"),
                db,
                config,
                fetcher,
                background: {
                  workspace: "team",
                  userId: "employee",
                  account: "staff@example.test",
                  provider: "gmail",
                  connectionVersion: 1,
                  membershipVersion: 3,
                },
              },
              {
                operation_id: crypto.randomUUID(),
                case_id: source.email.email_id,
                case_version: source.version,
                mode: "send",
                intent: "request_documents",
                confirmed: true,
                follow_up: false,
                to: ["carrier@example.test"],
                cc: [],
                subject: "Documents needed",
                body: "Please provide the SI and draft BL.",
              },
              source,
            ),
          /cannot draft or send/,
        );
        assert.equal(writes, 0);
      },
    );
    await t.test(
      "stale connection authority and disabled automatic import are rejected",
      async () => {
        await assert.rejects(
          () =>
            requireMailboxIntake(db, {
              workspace: "team",
              userId: "employee",
              account: "someoneelse@example.test",
              provider: "gmail",
              connectionVersion: 1,
              membershipVersion: 3,
            }),
          /access changed/,
        );
        await client.execute({
          sql: "UPDATE mail_connections SET settings=?,version=version+1",
          args: [
            JSON.stringify({ ...DEFAULT_MAIL_SETTINGS, auto_sync: false }),
          ],
        });
        const before = calls;
        await expireAttempt();
        await runMailWorkerPass({ db, config, fetcher });
        assert.equal(calls, before);
        assert.equal(await cases(), 2);
      },
    );
    await t.test(
      "invalid early accounts cannot starve a valid mailbox beyond a full candidate page",
      async () => {
        const invalidSettings = JSON.stringify({
          ...DEFAULT_MAIL_SETTINGS,
          interval_minutes: "invalid",
        });
        for (let i = 0; i < 105; i++) {
          const id = `invalid-${String(i).padStart(3, "0")}`;
          await client.batch(
            [
              {
                sql: "INSERT INTO team_users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,'not-a-login','2026-01-01')",
                args: [id, `${id}@example.test`, id],
              },
              {
                sql: "INSERT INTO team_memberships(workspace,user_id,role,active,version) VALUES('aaa',?,'operator',1,1)",
                args: [id],
              },
              {
                sql: "INSERT INTO mail_connections(workspace,user_id,provider,account,encrypted_secret,settings,version,updated_at) VALUES('aaa',?,'gmail',?,'unreadable',?,1,'2026-01-01')",
                args: [id, `${id}@example.test`, invalidSettings],
              },
            ],
            "write",
          );
        }
        await client.execute({
          sql: "UPDATE mail_connections SET settings=?,version=version+1,last_sync_at=NULL WHERE workspace='team'",
          args: [JSON.stringify(DEFAULT_MAIL_SETTINGS)],
        });
        const result = await runMailWorkerPass({ db, config, fetcher });
        assert.equal(
          result.checked,
          1,
          "the later eligible mailbox is reached",
        );
        assert.equal(result.failed, 0);
        assert.equal(
          await cases(),
          3,
          "the previously withheld message imports after membership is restored",
        );
        assert.equal(writes, 0);
      },
    );
    await t.test(
      "later mailboxes get the next pass even when the first hundred remain due",
      async () => {
        await client.execute({
          sql: "UPDATE mail_connections SET settings=? WHERE workspace='team'",
          args: [
            JSON.stringify({ ...DEFAULT_MAIL_SETTINGS, auto_sync: false }),
          ],
        });
        for (let i = 0; i < 101; i++) {
          const id = `fair-${String(i).padStart(3, "0")}`;
          const encrypted = await sealSecret(
            config,
            JSON.stringify({
              access_token: id,
              refresh_token: "synthetic",
              expires_at: Date.now() + 10 * 86400000,
            }),
            `mail:fair:${id}`,
          );
          await client.batch(
            [
              {
                sql: "INSERT INTO team_users(id,email,display_name,password_hash,created_at) VALUES(?,?,?,'not-a-login','2026-01-01')",
                args: [id, `${id}@example.test`, id],
              },
              {
                sql: "INSERT INTO team_memberships(workspace,user_id,role,active,version) VALUES('fair',?,'operator',1,1)",
                args: [id],
              },
              {
                sql: "INSERT INTO mail_connections(workspace,user_id,provider,account,encrypted_secret,settings,version,updated_at) VALUES('fair',?,'gmail',?,?,?,1,'2026-01-01')",
                args: [
                  id,
                  `${id}@example.test`,
                  encrypted,
                  JSON.stringify(DEFAULT_MAIL_SETTINGS),
                ],
              },
            ],
            "write",
          );
        }
        const observed: string[] = [];
        const emptyMailbox: typeof fetch = async (_input, init) => {
          observed.push(
            new Headers(init?.headers).get("authorization") ?? "missing",
          );
          assert.ok(!init?.method || init.method === "GET");
          return Response.json({ messages: [] });
        };
        const realNow = Date.now;
        // Eligibility stays true even immediately after an attempt. Persisted
        // timestamps still use real Date construction, as in a slow production pass.
        Date.now = () => realNow() + 86400000;
        try {
          assert.equal(
            (await runMailWorkerPass({ db, config, fetcher: emptyMailbox }))
              .checked,
            100,
          );
          assert.equal(observed.length, 100);
          assert.equal(
            new Set(observed).size,
            100,
            "no account repeats within a pass",
          );
          assert.ok(!observed.includes("Bearer fair-100"));
          observed.length = 0;
          assert.equal(
            (await runMailWorkerPass({ db, config, fetcher: emptyMailbox }))
              .checked,
            100,
          );
          assert.equal(
            observed[0],
            "Bearer fair-100",
            "the never-attempted account goes before still-due earlier accounts",
          );
          assert.equal(
            new Set(observed).size,
            100,
            "updated timestamps cannot cause same-pass revisits",
          );
        } finally {
          Date.now = realNow;
        }
      },
    );
  } finally {
    client.close();
    for (const name of Object.keys(process.env))
      if (!(name in oldEnv)) delete process.env[name];
    Object.assign(process.env, oldEnv);
  }
});
