import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import { analyze } from "../lib/compare";
import {
  mailConfiguration,
  sealSecret,
  sha256,
  DEFAULT_MAIL_SETTINGS,
} from "../lib/mail-connector";
import {
  deliverReply,
  checkMailOperation,
  resolveMailOperation,
  replyInput,
} from "../lib/mail-delivery";
import { syncMailbox, type MailContext } from "../lib/mail-storage";
import { gmailUnseen } from "../lib/gmail";
import { readImapMailbox } from "../lib/imap-adapter";

async function setup(fetcher: typeof fetch) {
  const client = createClient({ url: ":memory:" });
  for (const file of (await readdir(new URL("../drizzle/", import.meta.url)))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await client.executeMultiple(
      await readFile(new URL(`../drizzle/${file}`, import.meta.url), "utf8"),
    );
  const config = (
    await mailConfiguration({
      CARGO_AUTH_MODE: "team",
      CARGO_MAIL_TOKEN_KEY: btoa("01234567890123456789012345678901"),
    })
  ).config!;
  const context: MailContext = {
    workspace: "workspace",
    userId: "staff",
    actor: "Test employee",
    sessionToken: "synthetic",
    db: createNodeBindings(client).DB,
    config,
    request: new Request("https://cargo.example.test/api/mail/sync"),
    fetcher,
  };
  const encrypted = await sealSecret(
    config,
    JSON.stringify({
      access_token: "synthetic",
      refresh_token: "synthetic",
      expires_at: Date.now() + 3600000,
    }),
    "mail:workspace:staff",
  );
  await client.execute({
    sql: "INSERT INTO mail_connections(workspace,user_id,provider,account,encrypted_secret,settings,version,updated_at) VALUES(?,?,'gmail',?,?,?,1,?)",
    args: [
      context.workspace,
      context.userId,
      "staff@example.test",
      encrypted,
      JSON.stringify(DEFAULT_MAIL_SETTINGS),
      new Date().toISOString(),
    ],
  });
  const source = analyze(
    {
      email_id: "case",
      from: "client@example.test",
      subject: "Documents",
      body: "Please check",
      attachments: [],
    },
    [],
  );
  source.version = 1;
  await client.execute({
    sql: "INSERT INTO cases(workspace,email_id,version,payload,updated_at) VALUES(?,?,?,?,?)",
    args: [
      context.workspace,
      "case",
      1,
      JSON.stringify(source),
      new Date().toISOString(),
    ],
  });
  const input = replyInput.parse({
    operation_id: crypto.randomUUID(),
    case_id: "case",
    case_version: 1,
    mode: "send",
    intent: "request_documents",
    confirmed: true,
    to: ["client@example.test"],
    cc: [],
    subject: "RE: Documents",
    body: "Please provide the current SI and draft BL.",
  });
  return { client, context, source, input };
}

test("concurrent and repeated sends use one durable provider submission and receipt", async () => {
  let sends = 0;
  const raw: string[] = [];
  const f = await setup(async (_url, init) => {
    sends++;
    raw.push(JSON.parse(String(init?.body)).raw);
    await new Promise((r) => setTimeout(r, 15));
    return Response.json({ id: "receipt1" });
  });
  try {
    const result = await Promise.all([
      deliverReply(f.context, f.input, f.source),
      deliverReply(f.context, f.input, f.source),
    ]);
    assert.equal(sends, 1);
    assert.ok(result.some((r) => r.status === "submitted"));
    const repeat = await deliverReply(
      f.context,
      { ...f.input, operation_id: crypto.randomUUID() },
      f.source,
    );
    assert.equal(repeat.status, "submitted");
    assert.equal(repeat.provider_id, "receipt1");
    assert.equal(sends, 1);
    assert.match(
      Buffer.from(raw[0], "base64url").toString(),
      new RegExp(`Message-ID: <${f.input.operation_id}@example.test>`),
    );
    assert.equal(
      (
        await f.client.execute(
          "SELECT COUNT(*) AS n FROM events WHERE action='REPLY_SENT'",
        )
      ).rows[0].n,
      1,
    );
  } finally {
    f.client.close();
  }
});

test("shared-case replies resolve a thread in the replying employee's own Gmail mailbox", async () => {
  for (const found of [
    [{ id: "parent001", threadId: "replying-staff-thread" }],
    [],
    [
      { id: "parent001", threadId: "first-thread" },
      { id: "parent002", threadId: "second-thread" },
    ],
  ]) {
    const submissions: { raw: string; threadId?: string }[] = [];
    const f = await setup(async (url, init) => {
      if (init?.method === "POST") {
        submissions.push(JSON.parse(String(init.body)));
        return Response.json({ id: "reply001" });
      }
      assert.equal(
        new URL(String(url)).searchParams.get("q"),
        "in:anywhere rfc822msgid:parent@customer.test",
      );
      assert.equal(
        new Headers(init?.headers).get("Authorization"),
        "Bearer synthetic",
      );
      return Response.json({ messages: found });
    });
    try {
      f.source.email.message_id = "parent@customer.test";
      f.source.email.thread_hint = "gmail:importing-colleague-private-thread";
      f.source.email.to = ["importing-colleague@example.test"];
      await f.client.execute({
        sql: "UPDATE cases SET payload=?",
        args: [JSON.stringify(f.source)],
      });
      assert.equal(
        (await deliverReply(f.context, f.input, f.source)).status,
        "submitted",
      );
      assert.equal(submissions.length, 1);
      assert.equal(
        submissions[0].threadId,
        found.length === 1 ? "replying-staff-thread" : undefined,
      );
      assert.match(
        Buffer.from(submissions[0].raw, "base64url").toString(),
        /In-Reply-To: <parent@customer.test>/,
      );
      assert.match(
        Buffer.from(submissions[0].raw, "base64url").toString(),
        /References: <parent@customer.test>/,
      );
    } finally {
      f.client.close();
    }
  }
});

test("mailbox thread lookup failure occurs before any outbound operation or submission", async () => {
  let submissions = 0;
  const f = await setup(async (_url, init) => {
    if (init?.method === "POST") submissions++;
    throw Error("Read-only Gmail lookup unavailable");
  });
  try {
    f.source.email.message_id = "parent@customer.test";
    await assert.rejects(
      deliverReply(f.context, f.input, f.source),
      /Gmail could not be reached/,
    );
    assert.equal(submissions, 0);
    assert.equal(
      (await f.client.execute("SELECT COUNT(*) AS n FROM mail_operations"))
        .rows[0].n,
      0,
    );
  } finally {
    f.client.close();
  }
});

test("unknown Gmail submission is fenced across changed content and reconciles by stable Message-ID", async () => {
  let sends = 0,
    found = false;
  const queries: string[] = [];
  const f = await setup(async (url, init) => {
    if (init?.method === "POST") {
      sends++;
      throw Error("Connection lost after acceptance");
    }
    queries.push(new URL(String(url)).searchParams.get("q")!);
    return Response.json({
      messages: found ? [{ id: "sent001", threadId: "thread1" }] : [],
    });
  });
  try {
    assert.equal(
      (await deliverReply(f.context, f.input, f.source)).status,
      "unknown",
    );
    assert.equal(
      (await deliverReply(f.context, f.input, f.source)).status,
      "unknown",
    );
    await assert.rejects(
      deliverReply(
        f.context,
        {
          ...f.input,
          operation_id: crypto.randomUUID(),
          body: "Changed request",
        },
        f.source,
      ),
      /uncertain/,
    );
    assert.equal(sends, 1);
    found = true;
    const checked = await checkMailOperation(
      f.context,
      f.input.operation_id,
      "case",
    );
    assert.equal(checked.status, "submitted");
    assert.equal(checked.provider_id, "sent001");
    assert.equal(sends, 1);
    assert.ok(
      queries.every(
        (q) => q === `in:sent rfc822msgid:${f.input.operation_id}@example.test`,
      ),
    );
  } finally {
    f.client.close();
  }
});

test("provider success followed by database failure remains fenced and recovers receipt", async () => {
  let sends = 0;
  const f = await setup(async (_url, init) =>
    init?.method === "POST"
      ? (sends++, Response.json({ id: "sent002" }))
      : Response.json({ messages: [{ id: "sent002", threadId: "t" }] }),
  );
  try {
    await f.client.executeMultiple(
      "CREATE TRIGGER test_fail_sent BEFORE INSERT ON events WHEN NEW.action='REPLY_SENT' BEGIN SELECT RAISE(ABORT,'simulated write failure'); END;",
    );
    assert.equal(
      (await deliverReply(f.context, f.input, f.source)).status,
      "unknown",
    );
    await f.client.execute("DROP TRIGGER test_fail_sent");
    assert.equal(
      (await deliverReply(f.context, f.input, f.source)).status,
      "submitted",
    );
    assert.equal(sends, 1);
  } finally {
    f.client.close();
  }
});

test("SMTP timeout never resends, and explicit mailbox reconciliation records the request outcome", async () => {
  let sends = 0;
  const f = await setup(async () => {
    throw Error("No Gmail traffic expected");
  });
  try {
    f.input.follow_up = true;
    const secret = await sealSecret(
      f.context.config,
      JSON.stringify({
        preset: "gmail",
        email: "staff@example.test",
        password: "synthetic",
      }),
      "mail:workspace:staff",
    );
    await f.client.execute({
      sql: "UPDATE mail_connections SET provider='imap',encrypted_secret=?",
      args: [secret],
    });
    const transport: NonNullable<Parameters<typeof deliverReply>[3]> = {
      imapServer: () => ({
        imap: { host: "unused", port: 993, secure: true },
        smtp: { host: "unused", port: 465, secure: true },
      }),
      imapSaveDraft: async () => {
        throw Error("No draft expected");
      },
      smtpSend: async () => {
        sends++;
        throw Error("SMTP accepted DATA then connection closed");
      },
    };
    assert.equal(
      (await deliverReply(f.context, f.input, f.source, transport)).status,
      "unknown",
    );
    assert.equal(
      (await deliverReply(f.context, f.input, f.source, transport)).status,
      "unknown",
    );
    assert.equal(sends, 1);
    const confirmed = await resolveMailOperation(f.context, {
      action: "resolve",
      operation_id: f.input.operation_id,
      case_id: "case",
      decision: "confirmed_sent",
      confirmed: true,
      note: "Confirmed with the recipient and checked the original mailbox.",
    });
    assert.equal(confirmed.status, "submitted");
    assert.equal(confirmed.provider_id, null);
    assert.equal(confirmed.confirmation_source, "employee");
    assert.equal(confirmed.follow_up_recorded, false);
    assert.match(confirmed.message, /employee recorded submission/i);
    assert.equal(
      (await f.client.execute("SELECT COUNT(*) AS n FROM case_follow_ups"))
        .rows[0].n,
      0,
    );
    assert.equal(
      (await deliverReply(f.context, f.input, f.source, transport)).status,
      "submitted",
    );
    assert.equal(sends, 1);
  } finally {
    f.client.close();
  }
});

test("SMTP acceptance response is a provider receipt even without a separate provider identifier", async () => {
  const f = await setup(async () => {
    throw Error("No Gmail traffic expected");
  });
  try {
    const encrypted = await sealSecret(
      f.context.config,
      JSON.stringify({
        preset: "gmail",
        email: "staff@example.test",
        password: "synthetic",
      }),
      "mail:workspace:staff",
    );
    await f.client.execute({
      sql: "UPDATE mail_connections SET provider='imap',encrypted_secret=?",
      args: [encrypted],
    });
    const transport: NonNullable<Parameters<typeof deliverReply>[3]> = {
      imapServer: () => ({
        imap: { host: "unused", port: 993, secure: true },
        smtp: { host: "unused", port: 465, secure: true },
      }),
      imapSaveDraft: async () => {
        throw Error("No draft expected");
      },
      smtpSend: async () => ({
        provider_id: "",
        receipt: {
          accepted: ["client@example.test"],
          rejected: [],
          response: "250 Accepted",
        },
      }),
    };
    const sent = await deliverReply(
      f.context,
      { ...f.input, follow_up: true },
      f.source,
      transport,
    );
    assert.equal(sent.status, "submitted");
    assert.equal(sent.confirmation_source, "provider");
    assert.equal(sent.follow_up_recorded, true);
  } finally {
    f.client.close();
  }
});

test("partial SMTP acceptance is held for review and does not start waiting", async () => {
  const f = await setup(async () => {
    throw Error("No Gmail traffic expected");
  });
  try {
    const secret = await sealSecret(
      f.context.config,
      JSON.stringify({
        preset: "gmail",
        email: "staff@example.test",
        password: "synthetic",
      }),
      "mail:workspace:staff",
    );
    await f.client.execute({
      sql: "UPDATE mail_connections SET provider='imap',encrypted_secret=?",
      args: [secret],
    });
    const transport: NonNullable<Parameters<typeof deliverReply>[3]> = {
      imapServer: () => ({
        imap: { host: "unused", port: 993, secure: true },
        smtp: { host: "unused", port: 465, secure: true },
      }),
      imapSaveDraft: async () => {
        throw Error("No draft expected");
      },
      smtpSend: async () => ({
        provider_id: "smtp-receipt",
        receipt: {
          accepted: ["cc@example.test"],
          rejected: ["client@example.test"],
          response: "partial",
        },
      }),
    };
    const result = await deliverReply(
      f.context,
      { ...f.input, follow_up: true, cc: ["cc@example.test"] },
      f.source,
      transport,
    );
    assert.equal(result.status, "unknown");
    assert.equal(result.follow_up_recorded, false);
    assert.deepEqual(result.rejected_recipients, ["client@example.test"]);
    assert.equal(
      (await f.client.execute("SELECT COUNT(*) AS n FROM case_follow_ups"))
        .rows[0].n,
      0,
    );
    await assert.rejects(
      resolveMailOperation(f.context, {
        action: "resolve",
        operation_id: f.input.operation_id,
        case_id: "case",
        decision: "confirmed_not_sent",
        confirmed: true,
        note: "The primary recipient did not get it.",
      }),
      /acceptance receipt/,
    );
    const resolved = await resolveMailOperation(f.context, {
      action: "resolve",
      operation_id: f.input.operation_id,
      case_id: "case",
      decision: "confirmed_sent",
      confirmed: true,
      note: "Confirmed only the CC recipient accepted it; the client address was rejected.",
    });
    assert.equal(resolved.status, "submitted");
    assert.deepEqual(resolved.accepted_recipients, ["cc@example.test"]);
    assert.deepEqual(resolved.rejected_recipients, ["client@example.test"]);
    assert.equal(resolved.follow_up_recorded, false);
    assert.equal(
      (await f.client.execute("SELECT COUNT(*) AS n FROM case_follow_ups"))
        .rows[0].n,
      0,
    );
  } finally {
    f.client.close();
  }
});

test("response tracking only follows a confirmed send", async () => {
  let sends = 0;
  const f = await setup(async () => {
    sends++;
    return Response.json({ id: "request001" });
  });
  try {
    const input = { ...f.input, follow_up: true };
    const sent = await deliverReply(f.context, input, f.source);
    assert.equal(sent.status, "submitted");
    assert.equal(sent.follow_up_recorded, true);
    assert.equal(
      (await deliverReply(f.context, input, f.source)).follow_up_recorded,
      true,
    );
    assert.equal(sends, 1);
    const tracked = JSON.parse(
      String(
        (await f.client.execute("SELECT payload FROM case_follow_ups")).rows[0]
          .payload,
      ),
    );
    assert.equal(tracked.request.id, input.operation_id);
    await assert.rejects(
      deliverReply(
        f.context,
        { ...input, operation_id: crypto.randomUUID(), mode: "draft" },
        f.source,
      ),
      /Only a sent request/,
    );
  } finally {
    f.client.close();
  }
});

test("tracking persistence failure can be retried without a second provider submission", async () => {
  let sends = 0;
  const f = await setup(async () => {
    sends++;
    return Response.json({ id: "request002" });
  });
  try {
    await f.client.executeMultiple(
      "CREATE TRIGGER test_fail_tracking BEFORE INSERT ON case_follow_ups BEGIN SELECT RAISE(ABORT,'simulated tracking failure'); END;",
    );
    const input = { ...f.input, follow_up: true };
    const sent = await deliverReply(f.context, input, f.source);
    assert.equal(sent.status, "submitted");
    assert.equal(sent.follow_up_recorded, false);
    await f.client.execute("DROP TRIGGER test_fail_tracking");
    assert.equal(
      (await checkMailOperation(f.context, input.operation_id, "case"))
        .follow_up_recorded,
      true,
    );
    assert.equal(sends, 1);
  } finally {
    f.client.close();
  }
});

test("mail operation receipts cannot be read or resolved across users or workspaces", async () => {
  const f = await setup(async () => Response.json({ id: "private-receipt" }));
  try {
    await deliverReply(f.context, f.input, f.source);
    await assert.rejects(
      checkMailOperation(
        { ...f.context, userId: "other-staff" },
        f.input.operation_id,
        "case",
      ),
      /not found/,
    );
    await assert.rejects(
      checkMailOperation(
        { ...f.context, workspace: "other-workspace" },
        f.input.operation_id,
        "case",
      ),
      /not found/,
    );
  } finally {
    f.client.close();
  }
});

test("stale source and unsupported match confirmation cannot submit remotely", async () => {
  let sends = 0;
  const f = await setup(async () => {
    sends++;
    return Response.json({ id: "wrong" });
  });
  try {
    await f.client.execute("UPDATE cases SET version=2");
    await assert.rejects(deliverReply(f.context, f.input, f.source), /changed/);
    await f.client.execute("UPDATE cases SET version=1");
    await assert.rejects(
      deliverReply(
        f.context,
        { ...f.input, intent: "confirm_match" },
        f.source,
      ),
    );
    assert.equal(sends, 0);
  } finally {
    f.client.close();
  }
});

test("abandoned outbound reservations require explicit reconciliation, never automatic resend", async () => {
  let sends = 0;
  const f = await setup(async (_url, init) => {
    if (init?.method === "POST") sends++;
    return Response.json({ messages: [] });
  });
  try {
    // A request died after durable reservation and before a provider receipt.
    await f.client.execute({
      sql: "INSERT INTO mail_operations(workspace,user_id,id,case_id,case_version,provider,account,mode,payload_hash,message_id,status,created_at,updated_at) VALUES('workspace','staff',?,'case',1,'imap','staff@example.test','send','hash','stable@example.test','sending','2000-01-01T00:00:00Z','2000-01-01T00:00:00Z')",
      args: [f.input.operation_id],
    });
    assert.equal(
      (await checkMailOperation(f.context, f.input.operation_id, "case"))
        .status,
      "unknown",
    );
    await assert.rejects(
      deliverReply(
        f.context,
        { ...f.input, operation_id: crypto.randomUUID() },
        f.source,
      ),
      /uncertain/,
    );
    const resolved = await resolveMailOperation(f.context, {
      action: "resolve",
      operation_id: f.input.operation_id,
      case_id: "case",
      decision: "confirmed_not_sent",
      confirmed: true,
      note: "Checked the mailbox and confirmed nothing was submitted.",
    });
    assert.equal(resolved.status, "cancelled");
    assert.equal(sends, 0);
  } finally {
    f.client.close();
  }
});

test("Gmail bounded scans persist progress beyond 1000 known messages across restarts", async () => {
  const ids = Array.from(
    { length: 1250 },
    (_, i) => `msg${String(i).padStart(5, "0")}`,
  );
  const pages: string[] = [];
  const f = await setup(async (url) => {
    const u = new URL(String(url)),
      start = Number(u.searchParams.get("pageToken") ?? 0);
    pages.push(String(start));
    return Response.json({
      messages: ids
        .slice(start, start + 100)
        .map((id) => ({ id, threadId: "thread" })),
      ...(start + 100 < ids.length
        ? { nextPageToken: String(start + 100) }
        : {}),
    });
  });
  try {
    const scope = await sha256("gmail:staff@example.test:INBOX");
    await f.client.batch(
      ids.map((id) => ({
        sql: "INSERT INTO mail_imports(workspace,user_id,message_key,status,created_at) VALUES('workspace','staff',?,'imported','2000-01-01')",
        args: [`${scope}:gmail:${id}`],
      })),
      "write",
    );
    const first = await syncMailbox(f.context);
    assert.equal(first.more, true);
    assert.equal(pages.at(-1), "900");
    assert.match(
      String(
        (await f.client.execute("SELECT sync_cursor FROM mail_connections"))
          .rows[0].sync_cursor,
      ),
      /1000/,
    );
    pages.length = 0;
    const second = await syncMailbox({ ...f.context });
    assert.equal(pages[0], "1000");
    assert.equal(second.more, false);
    assert.equal(
      (await f.client.execute("SELECT sync_cursor FROM mail_connections"))
        .rows[0].sync_cursor,
      null,
    );
  } finally {
    f.client.close();
  }
});

test("Gmail continuation does not skip the unconsumed part of a page", async () => {
  const ids = Array.from({ length: 25 }, (_, i) => `message${i}`);
  const known = new Set<string>();
  const fetcher: typeof fetch = async () =>
    Response.json({ messages: ids.map((id) => ({ id, threadId: "thread" })) });
  let cursor: string | undefined;
  const counts: number[] = [];
  for (let n = 0; n < 3; n++) {
    const result = await gmailUnseen(
      "t",
      "q",
      10,
      async (keys) => new Set(keys.filter((k) => known.has(k))),
      fetcher,
      10,
      cursor,
    );
    counts.push(result.messages.length);
    for (const m of result.messages) known.add(`gmail:${m.id}`);
    cursor = result.nextPageToken ?? undefined;
  }
  assert.deepEqual(counts, [10, 10, 5]);
});

test("IMAP restarts continue before the saved UID and reset after UIDVALIDITY changes", async () => {
  const uids = Array.from({ length: 1250 }, (_, i) => i + 1);
  const scanned: number[][] = [];
  const fake = {
    mailbox: { uidValidity: BigInt(1) },
    getMailboxLock: async () => ({ release() {} }),
    search: async () => uids,
    async *fetch(sequence: string) {
      const selected = sequence.split(",").map(Number);
      scanned.push(selected);
      for (const uid of selected)
        yield { uid, envelope: { messageId: `m${uid}@test` }, size: 1 };
    },
    fetchOne: async () => false,
  };
  const known = async (keys: string[]) => new Set(keys);
  const first = await readImapMailbox(
    fake as unknown as Parameters<typeof readImapMailbox>[0],
    { mailbox: "INBOX", days: 7, max: 10 },
    known,
  );
  assert.equal(first.more, true);
  assert.equal(first.cursor?.beforeUid, 250);
  scanned.length = 0;
  const second = await readImapMailbox(
    fake as unknown as Parameters<typeof readImapMailbox>[0],
    { mailbox: "INBOX", days: 7, max: 10, cursor: first.cursor! },
    known,
  );
  assert.equal(scanned[0][0], 250);
  assert.equal(second.more, false);
  fake.mailbox.uidValidity = BigInt(2);
  scanned.length = 0;
  await readImapMailbox(
    fake as unknown as Parameters<typeof readImapMailbox>[0],
    { mailbox: "INBOX", days: 7, max: 10, cursor: first.cursor! },
    known,
  );
  assert.equal(scanned[0][0], 1250);
});
