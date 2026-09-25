import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";
import { FIELD_TEST, renderEml } from "../lib/field-test";
import {
  base64url,
  mailConfiguration,
  openSecret,
  sealSecret,
} from "../lib/mail-connector";

const ORIGIN = "https://cargo.example";
// Route responses are checked field by field below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const json = async (response: Response): Promise<Json> => response.json();

test("mailbox credentials are encrypted and bound to one workspace user", async () => {
  const configuration = await mailConfiguration({
    CARGO_MAIL_TOKEN_KEY: btoa(
      String.fromCharCode(...new Uint8Array(32).fill(7)),
    ),
    CARGO_AUTH_MODE: "team",
  });
  assert.equal(configuration.configured, true);
  const config = configuration.config!;
  const sealed = await sealSecret(config, "app-password", "mail:w1:u1");
  assert.ok(!sealed.includes("app-password"));
  assert.equal(await openSecret(config, sealed, "mail:w1:u1"), "app-password");
  await assert.rejects(
    () => openSecret(config, sealed, "mail:w1:u2"),
    /cannot be read/,
  );
  const missing = await mailConfiguration({ CARGO_AUTH_MODE: "team" });
  assert.equal(missing.configured, false);
  assert.match(missing.missing[0], /CARGO_MAIL_TOKEN_KEY/);
  assert.equal(
    (
      await mailConfiguration({
        CARGO_MAIL_TOKEN_KEY: "short",
        CARGO_AUTH_MODE: "team",
      })
    ).configured,
    false,
  );
});

test("import, Gmail sign-in, automatic sync and reply drafts work through the real routes", async (t) => {
  const workRoot = path.resolve("work");
  await fs.mkdir(workRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(workRoot, "mail-connector-test-"));
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  for (const name of [
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "RENDER",
    "RENDER_EXTERNAL_URL",
  ])
    delete process.env[name];
  Object.assign(process.env, {
    CARGO_LOCAL_DB: path.join(dir, "test.db"),
    CARGO_AUTH_MODE: "demo",
    CARGO_INCLUDE_SAMPLE_DATA: "true",
    CARGO_PUBLIC_ORIGIN: ORIGIN,
    CARGO_MAIL_TOKEN_KEY: btoa(
      String.fromCharCode(...new Uint8Array(32).fill(3)),
    ),
    CARGO_GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    CARGO_GOOGLE_CLIENT_SECRET: "client-secret-value",
  });
  const client = createClient({ url: `file:${process.env.CARGO_LOCAL_DB}` });
  try {
    for (const file of (await fs.readdir("drizzle"))
      .filter((n) => n.endsWith(".sql"))
      .sort())
      await client.executeMultiple(
        await fs.readFile(`drizzle/${file}`, "utf8"),
      );
    const { POST: upload } = await import("../app/api/upload/route");
    const { GET: mailStatus, POST: mailAction } = await import(
      "../app/api/mail/route"
    );
    const { POST: callback } = await import("../app/api/mail/callback/route");
    const { POST: sync } = await import("../app/api/mail/sync/route");
    const { POST: reply } = await import("../app/api/mail/reply/route");
    const { POST: practice } = await import(
      "../app/api/practice-mailbox/route"
    );
    const { GET: inbox } = await import("../app/api/inbox/route");
    const workspace = crypto.randomUUID();
    const headers = { Cookie: `cargo_workspace=${workspace}`, Origin: ORIGIN };
    const post = (
      handler: (r: Request) => Promise<Response>,
      url: string,
      body: unknown,
    ) =>
      handler(
        new Request(`${ORIGIN}${url}`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const eml = (id: string) =>
      renderEml(
        FIELD_TEST.find((s) => s.id === id)!,
        new Date("2026-09-21T00:00:00Z"),
      );

    await t.test(
      ".eml upload creates one case with mailbox metadata, and a repeat opens it",
      async () => {
        const send = () => {
          const form = new FormData();
          form.set(
            "eml",
            new File([eml("ft_02")], "ft_02.eml", { type: "message/rfc822" }),
          );
          return upload(
            new Request(`${ORIGIN}/api/upload`, {
              method: "POST",
              headers,
              body: form,
            }),
          );
        };
        const first = await send();
        assert.equal(first.status, 200);
        const value = await json(first);
        assert.equal(value.duplicate, undefined);
        assert.equal(value.result.status, "MISMATCH");
        assert.equal(
          value.result.email.received_at,
          "2026-09-15T06:30:00.000Z",
        );
        assert.equal(
          value.result.email.message_id,
          "ft_02.fieldtest@cargoguard-demo.invalid",
        );
        assert.equal(value.result.email.source, "eml");
        assert.equal(value.result.documents.length, 2);
        const again = await json(await send());
        assert.equal(again.duplicate, true);
        assert.equal(again.result.email.email_id, value.result.email.email_id);
        const mixed = new FormData();
        mixed.set("eml", new File([eml("ft_02")], "x.eml"));
        mixed.set("subject", "forged");
        assert.equal(
          (
            await upload(
              new Request(`${ORIGIN}/api/upload`, {
                method: "POST",
                headers,
                body: mixed,
              }),
            )
          ).status,
          400,
        );
        const manual = new FormData();
        manual.set("from", "ops@example.test");
        manual.set("subject", "Manual entry");
        manual.set("body", "Please check.");
        manual.set("received_at", "2026-09-20T08:30:00+08:00");
        manual.set("message_id", "has space");
        assert.equal(
          (
            await upload(
              new Request(`${ORIGIN}/api/upload`, {
                method: "POST",
                headers,
                body: manual,
              }),
            )
          ).status,
          400,
        );
        manual.set("message_id", "manual-1@example.test");
        const saved = await json(
          await upload(
            new Request(`${ORIGIN}/api/upload`, {
              method: "POST",
              headers,
              body: manual,
            }),
          ),
        );
        assert.equal(
          saved.result.email.received_at,
          "2026-09-20T00:30:00.000Z",
        );
        for (const [source, date] of [
          ["gmail", "invalid-date"],
          ["eml", "2026-09-20T00:30:00Z"],
        ]) {
          const form = new FormData();
          form.set("eml", new File([eml("ft_02")], "mail.eml"));
          form.set("source", source);
          form.set("provider_received_at", date);
          assert.equal(
            (
              await upload(
                new Request(`${ORIGIN}/api/upload`, {
                  method: "POST",
                  headers,
                  body: form,
                }),
              )
            ).status,
            400,
          );
        }
      },
    );

    const gmailIds = ["18c0a1b2c3d4e5f6", "18c0a1b2c3d4e5f7"];
    const rawOverrides = new Map<string, string>();
    const calls: string[] = [];
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = new URL(String(input));
      calls.push(`${init?.method ?? "GET"} ${url.origin}${url.pathname}`);
      if (url.href === "https://oauth2.googleapis.com/token") {
        const form = new URLSearchParams(String(init?.body));
        assert.equal(form.get("client_secret"), "client-secret-value");
        if (form.get("grant_type") === "authorization_code")
          assert.ok(form.get("code_verifier"));
        return Response.json({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
        });
      }
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer access-token",
      );
      if (url.pathname === "/gmail/v1/users/me/profile")
        return Response.json({ emailAddress: "Najiha@Gmail.com" });
      if (url.pathname === "/gmail/v1/users/me/messages") {
        if (url.searchParams.get("q")?.startsWith("in:anywhere rfc822msgid:"))
          return Response.json({
            messages: [{ id: gmailIds[0], threadId: "thread-abc" }],
          });
        assert.match(
          url.searchParams.get("q") ?? "",
          /^in:inbox newer_than:7d/,
        );
        return Response.json({
          messages: gmailIds.map((id) => ({ id, threadId: "thread-abc" })),
        });
      }
      if (
        url.pathname.startsWith("/gmail/v1/users/me/messages/") &&
        !url.pathname.endsWith("/send")
      ) {
        const id = url.pathname.split("/").pop()!;
        const source =
          rawOverrides.get(id) ??
          (id === gmailIds[0] ? eml("ft_06") : eml("ft_07"));
        return Response.json({
          id,
          threadId: "thread-abc",
          raw: base64url(new TextEncoder().encode(source)),
          internalDate: String(Date.parse("2026-09-21T00:00:00Z")),
        });
      }
      if (url.pathname === "/gmail/v1/users/me/drafts") {
        const body = JSON.parse(String(init?.body));
        assert.equal(body.message.threadId, "thread-abc");
        const raw = new TextDecoder().decode(
          Uint8Array.from(
            atob(body.message.raw.replace(/-/g, "+").replace(/_/g, "/")),
            (c) => c.charCodeAt(0),
          ),
        );
        assert.match(raw, /^From: najiha@gmail\.com\r\n/);
        assert.match(
          raw,
          /In-Reply-To: <ft_06\.fieldtest@cargoguard-demo\.invalid>/,
        );
        return Response.json({ id: "draft-1" });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    await t.test(
      "Google sign-in uses single-use state bound to the browser session",
      async () => {
        const status = await json(
          await mailStatus(new Request(`${ORIGIN}/api/mail`, { headers })),
        );
        assert.equal(status.google_available, true);
        assert.equal(status.connected, false);
        const start = await json(
          await post(mailAction, "/api/mail", { action: "connect_google" }),
        );
        const authorize = new URL(start.authorize_url);
        assert.equal(authorize.origin, "https://accounts.google.com");
        assert.equal(
          authorize.searchParams.get("redirect_uri"),
          `${ORIGIN}/api/mail/callback`,
        );
        assert.equal(
          authorize.searchParams.get("code_challenge_method"),
          "S256",
        );
        assert.match(authorize.searchParams.get("scope")!, /gmail\.readonly/);
        const state = authorize.searchParams.get("state")!;
        const other = {
          Cookie: `cargo_workspace=${crypto.randomUUID()}`,
          Origin: ORIGIN,
        };
        const stolen = await callback(
          new Request(`${ORIGIN}/api/mail/callback`, {
            method: "POST",
            headers: { ...other, "Content-Type": "application/json" },
            body: JSON.stringify({ code: "auth-code", state }),
          }),
        );
        assert.equal(stolen.status, 409);
        const done = await json(
          await post(callback, "/api/mail/callback", {
            code: "auth-code",
            state,
          }),
        );
        assert.equal(done.connected, true);
        assert.equal(done.account, "najiha@gmail.com");
        assert.equal(
          (
            await post(callback, "/api/mail/callback", {
              code: "auth-code",
              state,
            })
          ).status,
          409,
        );
        const stored = await client.execute(
          "SELECT encrypted_secret FROM mail_connections",
        );
        assert.ok(
          !String(stored.rows[0].encrypted_secret).includes("refresh-token"),
        );
      },
    );

    await t.test(
      "sync imports new Gmail messages once, with thread and date",
      async () => {
        const first = await json(await post(sync, "/api/mail/sync", {}));
        assert.equal(first.imported.length, 2, JSON.stringify(first));
        const second = await json(await post(sync, "/api/mail/sync", {}));
        assert.equal(second.imported.length, 0);
        const rows = await client.execute(
          "SELECT json_extract(payload,'$.email.source') AS source, json_extract(payload,'$.email.thread_hint') AS thread, json_extract(payload,'$.email.received_at') AS received, json_extract(payload,'$.email.sent_at') AS sent FROM cases WHERE json_extract(payload,'$.email.source')='gmail'",
        );
        assert.equal(rows.rows.length, 2);
        assert.equal(rows.rows[0].thread, "gmail:thread-abc");
        assert.equal(rows.rows[0].received, "2026-09-21T00:00:00.000Z");
        assert.ok(
          rows.rows[0].sent,
          "Retain the sender Date header separately",
        );
      },
    );

    await t.test(
      "a reviewed reply is saved to Gmail drafts in the same thread and logged",
      async () => {
        const row = await client.execute(
          "SELECT email_id,version FROM cases WHERE json_extract(payload,'$.email.message_id')='ft_06.fieldtest@cargoguard-demo.invalid'",
        );
        const caseId = String(row.rows[0].email_id);
        const bad = await post(reply, "/api/mail/reply", {
          case_id: caseId,
          mode: "draft",
          to: ["ahmed@orientlinks-demo.gn"],
          cc: [],
          subject: "RE: SI",
          body: "Hello",
        });
        assert.equal(bad.status, 400, "explicit confirmation is required");
        const saved = await json(
          await post(reply, "/api/mail/reply", {
            case_id: caseId,
            case_version: Number(row.rows[0].version),
            operation_id: crypto.randomUUID(),
            mode: "draft",
            confirmed: true,
            to: ["ahmed@orientlinks-demo.gn"],
            cc: [],
            subject: "RE: URGENT - SI NEEDED",
            body: "Dear Ahmed,\n\nThe SI will follow today.",
          }),
        );
        assert.equal(saved.where, "Gmail Drafts");
        const events = await client.execute({
          sql: "SELECT action FROM events WHERE email_id=? AND action='REPLY_DRAFT_SAVED'",
          args: [caseId],
        });
        assert.equal(events.rows.length, 1);
      },
    );

    await t.test(
      "expired import reservations recover without duplicating cases even when Message-ID is missing",
      async () => {
        const id = "18c0a1b2c3d4efff";
        gmailIds.push(id);
        rawOverrides.set(
          id,
          eml("ft_07").replace(/^Message-ID:[^\r\n]*\r?\n/im, ""),
        );
        const first = await json(await post(sync, "/api/mail/sync", {}));
        assert.equal(first.imported.length, 1, JSON.stringify(first));
        const caseId = first.imported[0];
        const before = await client.execute({
          sql: "SELECT payload,version FROM cases WHERE workspace=? AND email_id=?",
          args: [workspace, caseId],
        });
        assert.equal(
          JSON.parse(String(before.rows[0].payload)).email.message_id,
          undefined,
        );
        assert.ok(JSON.parse(String(before.rows[0].payload)).email.import_key);
        await client.execute({
          sql: "UPDATE mail_imports SET status='importing',case_id=NULL,lease_token='crashed-worker',lease_until='2000-01-01T00:00:00Z' WHERE workspace=? AND message_key LIKE ?",
          args: [workspace, `%:gmail:${id}`],
        });
        const repeat = await json(await post(sync, "/api/mail/sync", {}));
        assert.equal(repeat.imported.length, 0);
        assert.equal(repeat.duplicates, 1);
        const ledger = await client.execute({
          sql: "SELECT status,case_id,lease_token FROM mail_imports WHERE workspace=? AND message_key LIKE ?",
          args: [workspace, `%:gmail:${id}`],
        });
        assert.equal(ledger.rows[0].status, "imported");
        assert.equal(ledger.rows[0].case_id, caseId);
        assert.equal(ledger.rows[0].lease_token, null);
        assert.equal(
          (
            await client.execute({
              sql: "SELECT version FROM cases WHERE workspace=? AND email_id=?",
              args: [workspace, caseId],
            })
          ).rows[0].version,
          before.rows[0].version,
        );
      },
    );

    await t.test("disconnect deletes stored credentials", async () => {
      const value = await json(
        await post(mailAction, "/api/mail", { action: "disconnect" }),
      );
      assert.equal(value.connected, false);
      assert.equal(
        (await client.execute("SELECT COUNT(*) AS n FROM mail_connections"))
          .rows[0].n,
        0,
      );
      assert.ok(
        calls.some(
          (call) => call === "POST https://oauth2.googleapis.com/revoke",
        ),
      );
    });
    await t.test(
      "practice mailbox loads once and keeps conversations",
      async () => {
        const first = await json(
          await post(practice, "/api/practice-mailbox", {}),
        );
        // ft_02, ft_06 and ft_07 were already imported (file and Gmail): never duplicated.
        assert.equal(first.imported, FIELD_TEST.length - 3);
        const second = await json(
          await post(practice, "/api/practice-mailbox", {}),
        );
        assert.equal(second.imported, 0);
        assert.equal(second.skipped, FIELD_TEST.length);
        const listed = await json(
          await inbox(new Request(`${ORIGIN}/api/inbox`, { headers })),
        );
        const practiceCase = listed.cases.find(
          (row: { email: { email_id: string } }) =>
            row.email.email_id === "practice_ft_03",
        );
        assert.equal(
          practiceCase.email.in_reply_to,
          "ft_02.fieldtest@cargoguard-demo.invalid",
        );
        assert.deepEqual(practiceCase.email.insight.refs.shipment, [
          "5RFR-36541",
        ]);
        assert.ok(!("body" in practiceCase.email));
      },
    );
  } finally {
    globalThis.fetch = oldFetch;
    client.close();
    for (const name of Object.keys(process.env))
      if (!(name in oldEnv)) delete process.env[name];
    Object.assign(process.env, oldEnv);
  }
});
