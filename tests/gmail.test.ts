import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import {
  gmailConfig,
  requireGmailOwner,
  sealGmail,
  openGmail,
  GMAIL_SCOPES,
} from "../lib/gmail-config";
import {
  parseGmailMessage,
  storeGmailMessage,
  storedMessage,
  syncGmail,
  gmailConnection,
  gmailAttachment,
  type GmailMessage,
} from "../lib/gmail-storage";
import {
  saveReplyDraft,
  sendReply,
  reconcileReply,
  recipientList,
  replyMime,
  linkMessage,
  draftById,
} from "../lib/correspondence";
import { beginGmailConnect, finishGmailConnect } from "../lib/gmail-oauth";
import { importGmailMessage } from "../lib/gmail-import";
import { saveCases } from "../lib/storage";
import { DEFAULT_POLICY } from "../lib/policy";
import type { CaseResult } from "../lib/types";

const workspace = "11111111-1111-1111-1111-111111111111",
  email = "pilot@example.test",
  key = Buffer.alloc(32, 7).toString("base64");
process.env.CARGO_GMAIL_ENCRYPTION_KEY = key;
Object.assign(process.env, {
  CARGO_GMAIL_ENABLED: "true",
  CARGO_GMAIL_PILOT_WORKSPACE: workspace,
  CARGO_GMAIL_PILOT_EMAIL: email,
  GOOGLE_CLIENT_ID: "mock-client",
  GOOGLE_CLIENT_SECRET: "mock-secret",
  CARGO_PUBLIC_ORIGIN: "https://cargo.example.test",
});
const raw = (id = "gmail-1", threadId = "thread-1") => ({
  id,
  threadId,
  internalDate: "1750000000000",
  labelIds: ["INBOX"],
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "Example Sender <sender@example.test>" },
      { name: "Reply-To", value: "reply@example.test" },
      { name: "Subject", value: "Booking ABC – revised documents" },
      { name: "Message-ID", value: `<${id}@example.test>` },
      { name: "References", value: "<earlier@example.test>" },
    ],
    parts: [
      {
        partId: "0",
        mimeType: "text/plain",
        body: {
          data: Buffer.from("Please review the revised draft BL.").toString(
            "base64url",
          ),
        },
      },
      {
        partId: "1",
        mimeType: "text/plain",
        filename: "revised-bl.txt",
        body: { attachmentId: "attachment-1", size: 3 },
      },
    ],
  },
});
async function fixture() {
  const client = createClient({ url: ":memory:" });
  for (const file of (await fs.readdir("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await client.executeMultiple(await fs.readFile(`drizzle/${file}`, "utf8"));
  const { DB, BUCKET } = createNodeBindings(client);
  await client.execute({
    sql: "INSERT INTO cases VALUES(?,?,?,?,?)",
    args: [
      workspace,
      "case-a",
      JSON.stringify({ email: { email_id: "case-a" } }),
      1,
      new Date().toISOString(),
    ],
  });
  await client.execute({
    sql: "INSERT INTO gmail_connections(workspace,account_email,credentials,connected_at) VALUES(?,?,?,?)",
    args: [
      workspace,
      email,
      sealGmail(
        {
          access_token: "mock-access",
          refresh_token: "mock-refresh",
          expires_at: Date.now() + 3600000,
        },
        workspace,
      ),
      new Date().toISOString(),
    ],
  });
  const message = parseGmailMessage(raw(), email);
  await storeGmailMessage(DB, workspace, message);
  await linkMessage(DB, workspace, message.id, "case-a", 1);
  return { client, DB, BUCKET, message };
}
const draftInput = (message: GmailMessage) => ({
  caseId: "case-a",
  version: 1,
  replyToMessageId: message.id,
  to: message.replyTo,
  cc: "",
  body: "Please amend the BL gross weight to match the SI.\nThank you.",
});

test("OAuth nonce mismatch and replay cannot dispatch a token exchange", async () => {
  const f = await fixture();
  try {
    const begun = await beginGmailConnect(f.DB, workspace),
      url = new URL(begun.authorizeUrl),
      state = url.searchParams.get("state")!;
    let calls = 0;
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("scope"), GMAIL_SCOPES.join(" "));
    const fetcher: typeof fetch = async (url, init) => {
      calls++;
      if (String(url).includes("oauth2.googleapis.com/token")) {
        const body = new URLSearchParams(String(init?.body));
        assert.ok(body.get("code_verifier"));
        assert.equal(body.get("code"), "mock-code");
        return Response.json({
          access_token: "new-access",
          refresh_token: "new-refresh",
          expires_in: 3600,
          scope: GMAIL_SCOPES.join(" "),
        });
      }
      return Response.json({ emailAddress: email, historyId: "123" });
    };
    await assert.rejects(
      () =>
        finishGmailConnect(f.DB, state, "wrong-browser", "mock-code", fetcher),
      /state expired/,
    );
    assert.equal(calls, 0);
    assert.equal(
      await finishGmailConnect(f.DB, state, begun.nonce, "mock-code", fetcher),
      workspace,
    );
    assert.equal(calls, 2);
    await assert.rejects(
      () => finishGmailConnect(f.DB, state, begun.nonce, "mock-code", fetcher),
      /state expired/,
    );
    assert.equal(calls, 2);
  } finally {
    f.client.close();
  }
});
test("expired OAuth state and an unapproved Google account cannot replace mailbox credentials", async () => {
  const f = await fixture();
  try {
    const expired = await beginGmailConnect(f.DB, workspace);
    await f.client.execute(
      "UPDATE gmail_oauth_states SET expires_at='2000-01-01'",
    );
    await assert.rejects(
      () =>
        finishGmailConnect(
          f.DB,
          new URL(expired.authorizeUrl).searchParams.get("state")!,
          expired.nonce,
          "code",
          async () => {
            throw new Error("Must not call network");
          },
        ),
      /state expired/,
    );
    const fresh = await beginGmailConnect(f.DB, workspace),
      before = (await gmailConnection(f.DB, workspace))!.credentials;
    await assert.rejects(
      () =>
        finishGmailConnect(
          f.DB,
          new URL(fresh.authorizeUrl).searchParams.get("state")!,
          fresh.nonce,
          "code",
          async (url) =>
            Response.json(
              String(url).includes("oauth2.googleapis.com")
                ? {
                    access_token: "token",
                    refresh_token: "refresh",
                    expires_in: 3600,
                    scope: GMAIL_SCOPES.join(" "),
                  }
                : { emailAddress: "other@example.test" },
            ),
        ),
      /not approved/,
    );
    assert.equal((await gmailConnection(f.DB, workspace))!.credentials, before);
  } finally {
    f.client.close();
  }
});
test("mailbox import classifies before parsing and retains exact source bytes and original chronology", async () => {
  const f = await fixture();
  try {
    const source = raw("invoice-message", "invoice-thread");
    source.payload.headers = source.payload.headers.map((h) =>
      h.name === "Subject"
        ? { ...h, value: "Invoice query: please resend our invoice" }
        : h,
    );
    source.payload.parts[0].body.data = Buffer.from(
      "Please send a copy of the invoice and confirm the outstanding billing amount.",
    ).toString("base64url");
    source.payload.parts[1].filename = "invoice.pdf";
    const message = parseGmailMessage(source, email);
    await storeGmailMessage(f.DB, workspace, message);
    const services = {
      storage: () => ({ DB: f.DB, BUCKET: f.BUCKET }),
      getPolicy: async () => structuredClone(DEFAULT_POLICY),
      getCase: async (ws: string, id: string) => {
        const row = await f.DB.prepare(
          "SELECT payload,version FROM cases WHERE workspace=? AND email_id=?",
        )
          .bind(ws, id)
          .first<{ payload: string; version: number }>();
        return row
          ? ({ ...JSON.parse(row.payload), version: row.version } as CaseResult)
          : null;
      },
      saveCase: async (
        ws: string,
        result: CaseResult,
        expected: number,
        action: string,
        actor: string,
        detail: string,
      ) => {
        const saved = await saveCases(
          ws,
          [{ result, expected, action, actor, detail }],
          f.DB,
        );
        return saved.results[0];
      },
    };
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return Response.json({
        data: Buffer.from("ABC").toString("base64url"),
        size: 3,
      });
    };
    const imported = await importGmailMessage(
      workspace,
      message.id,
      fetcher,
      services,
    );
    assert.equal(imported.category, "INVOICE_QUERY");
    assert.equal(imported.documents[0].deferred, true);
    assert.equal(imported.documents[0].error, undefined);
    assert.equal(imported.documents[0].size_bytes, 3);
    assert.equal(imported.email.received_at, message.receivedAt);
    assert.ok(imported.email.imported_at);
    const name = imported.email.attachments[0].split("/").pop();
    assert.equal(
      Buffer.from(
        await (await f.BUCKET.get(
          `${workspace}/${imported.email.email_id}/${name}`,
        ))!.arrayBuffer(),
      ).toString(),
      "ABC",
    );
    const repeated = await importGmailMessage(
      workspace,
      message.id,
      fetcher,
      services,
    );
    assert.equal(repeated.email.email_id, imported.email.email_id);
    assert.equal(calls, 1);
  } finally {
    f.client.close();
  }
});

test("Gmail is disabled until both single-workspace and single-mailbox pilot bindings exist", () => {
  const env = {
    CARGO_GMAIL_ENABLED: "true",
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
    CARGO_PUBLIC_ORIGIN: "https://cargo.example.test",
    CARGO_GMAIL_ENCRYPTION_KEY: key,
  };
  assert.equal(gmailConfig(env).enabled, false);
  const complete = {
    ...env,
    CARGO_GMAIL_PILOT_WORKSPACE: workspace,
    CARGO_GMAIL_PILOT_EMAIL: email,
  };
  assert.equal(gmailConfig(complete).enabled, true);
  assert.throws(() => requireGmailOwner("another", complete), /not enabled/);
  assert.deepEqual(GMAIL_SCOPES, [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
  ]);
});
test("credentials authenticate their workspace and reject ciphertext changes", () => {
  const encrypted = sealGmail(
    { refresh_token: "private-value" },
    workspace,
    key,
  );
  assert.ok(!encrypted.includes("private-value"));
  assert.deepEqual(openGmail(encrypted, workspace, key), {
    refresh_token: "private-value",
  });
  assert.throws(() => openGmail(encrypted, "other", key));
  assert.throws(() =>
    openGmail(encrypted.slice(0, -4) + "AAAA", workspace, key),
  );
});
test("message parsing preserves independent IDs, actual received time and attachment identity", () => {
  const message = parseGmailMessage(raw(), email);
  assert.notEqual(message.id, message.providerId);
  assert.equal(message.caseId, null);
  assert.equal(message.from, "sender@example.test");
  assert.equal(message.replyTo, "reply@example.test");
  assert.equal(message.receivedAt, new Date(1750000000000).toISOString());
  assert.equal(message.attachments[0].id, "1");
  assert.match(message.body, /revised draft/);
});
test("missing or invalid received dates remain unknown rather than becoming today's date", () => {
  assert.equal(
    parseGmailMessage({ ...raw(), internalDate: undefined }, email).receivedAt,
    null,
  );
  assert.equal(
    parseGmailMessage({ ...raw(), internalDate: "invalid" }, email).receivedAt,
    null,
  );
});
test("duplicate imports remain one mailbox message and cross-workspace lookups fail", async () => {
  const f = await fixture();
  try {
    assert.equal(
      await storeGmailMessage(f.DB, workspace, parseGmailMessage(raw(), email)),
      false,
    );
    assert.equal(
      (await f.client.execute("SELECT COUNT(*) n FROM gmail_messages")).rows[0]
        .n,
      1,
    );
    await assert.rejects(
      () => storedMessage(f.DB, "other", f.message.id),
      /not found/,
    );
  } finally {
    f.client.close();
  }
});
test("new messages in one known thread keep the case; ambiguous threads remain unlinked", async () => {
  const f = await fixture();
  try {
    const next = parseGmailMessage(raw("gmail-2"), email);
    await storeGmailMessage(f.DB, workspace, next);
    assert.equal(
      (await storedMessage(f.DB, workspace, next.id)).caseId,
      "case-a",
    );
    await f.client.execute({
      sql: "UPDATE gmail_messages SET case_id='case-b' WHERE id=?",
      args: [next.id],
    });
    const ambiguous = parseGmailMessage(raw("gmail-3"), email);
    await storeGmailMessage(f.DB, workspace, ambiguous);
    assert.equal(
      (await storedMessage(f.DB, workspace, ambiguous.id)).caseId,
      null,
    );
  } finally {
    f.client.close();
  }
});
test("link requires the current case revision and never moves an already linked message", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () => linkMessage(f.DB, workspace, f.message.id, "case-a", 2),
      /changed/,
    );
    await assert.rejects(
      () => linkMessage(f.DB, workspace, f.message.id, "case-b", 1),
      /another case/,
    );
  } finally {
    f.client.close();
  }
});
test("draft editing is version checked and reply MIME retains original thread headers", async () => {
  const f = await fixture();
  try {
    const draft = await saveReplyDraft(f.DB, workspace, draftInput(f.message));
    assert.equal(draft.subject, "Re: Booking ABC – revised documents");
    const mime = Buffer.from(replyMime(draft, "operation"), "base64url")
      .toString()
      .replace(/\r\n[ \t]+/g, " ");
    assert.match(mime, /In-Reply-To: <gmail-1@example.test>/);
    assert.match(
      mime,
      /References: <earlier@example.test> <gmail-1@example.test>/,
    );
    assert.match(mime, /To: reply@example.test/);
    assert.match(mime, /Message-ID: <operation@cargoguard.local>/);
    const edited = await saveReplyDraft(f.DB, workspace, {
      ...draftInput(f.message),
      body: "Reviewed updated wording",
      draftId: draft.id,
      draftVersion: draft.version,
    });
    assert.equal(edited.version, 2);
    await assert.rejects(
      () =>
        saveReplyDraft(f.DB, workspace, {
          ...draftInput(f.message),
          draftId: draft.id,
          draftVersion: 1,
        }),
      /changed/,
    );
  } finally {
    f.client.close();
  }
});
test("recipient and body handling prevents header injection", () => {
  assert.throws(
    () => recipientList("a@example.test\r\nBcc: attacker@example.test", true),
    /line breaks/,
  );
  assert.throws(
    () => recipientList("Person <a@example.test>", true),
    /without display names/,
  );
  assert.equal(
    recipientList("A@example.test, a@example.test", true),
    "a@example.test",
  );
});
test("a source revision change blocks send before any Gmail network call", async () => {
  const f = await fixture();
  try {
    const draft = await saveReplyDraft(f.DB, workspace, draftInput(f.message));
    await f.client.execute("UPDATE cases SET version=2");
    let calls = 0;
    await assert.rejects(
      () =>
        sendReply(f.DB, workspace, draft.id, 1, async () => {
          calls++;
          throw new Error("Unexpected network");
        }),
      /case changed/,
    );
    assert.equal(calls, 0);
  } finally {
    f.client.close();
  }
});
test("duplicate sends reuse a durable receipt and do not alter case comparison version", async () => {
  const f = await fixture();
  try {
    const draft = await saveReplyDraft(f.DB, workspace, draftInput(f.message));
    let calls = 0;
    const fetcher: typeof fetch = async (url, init) => {
      calls++;
      assert.match(String(url), /messages\/send$/);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.threadId, "thread-1");
      return Response.json({ id: "sent-1", threadId: "thread-1" });
    };
    assert.equal(
      (await sendReply(f.DB, workspace, draft.id, 1, fetcher)).status,
      "sent",
    );
    assert.equal(
      (await sendReply(f.DB, workspace, draft.id, 1, fetcher)).status,
      "sent",
    );
    assert.equal(calls, 1);
    assert.equal(
      (await f.client.execute("SELECT version FROM cases")).rows[0].version,
      1,
    );
  } finally {
    f.client.close();
  }
});
test("unknown delivery never retries; reconciliation requires the exact sent message ID and thread", async () => {
  const f = await fixture();
  try {
    const draft = await saveReplyDraft(f.DB, workspace, draftInput(f.message));
    let calls = 0;
    const lost: typeof fetch = async () => {
      calls++;
      throw new Error("Socket closed after accepting mail");
    };
    const uncertain = await sendReply(f.DB, workspace, draft.id, 1, lost);
    assert.equal(uncertain.status, "uncertain");
    assert.equal(
      (await sendReply(f.DB, workspace, draft.id, 1, lost)).status,
      "uncertain",
    );
    assert.equal(calls, 1);
    const reconciled = await reconcileReply(
      f.DB,
      workspace,
      draft.id,
      async (url) => {
        if (String(url).includes("messages?"))
          return Response.json({
            messages: [{ id: "receipt", threadId: "thread-1" }],
          });
        return Response.json({
          id: "receipt",
          threadId: "thread-1",
          payload: {
            headers: [
              {
                name: "Message-ID",
                value: `<${uncertain.operationId}@cargoguard.local>`,
              },
            ],
          },
        });
      },
    );
    assert.equal(reconciled.status, "sent");
    assert.equal(reconciled.providerMessageId, "receipt");
  } finally {
    f.client.close();
  }
});
test("simultaneous human send requests dispatch at most one Gmail message", async () => {
  const f = await fixture();
  try {
    const draft = await saveReplyDraft(f.DB, workspace, draftInput(f.message));
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return Response.json({ id: "one-receipt", threadId: "thread-1" });
    };
    const outcomes = await Promise.allSettled([
      sendReply(f.DB, workspace, draft.id, 1, fetcher),
      sendReply(f.DB, workspace, draft.id, 1, fetcher),
    ]);
    assert.ok(outcomes.some((r) => r.status === "fulfilled"));
    assert.equal(calls, 1);
    assert.equal((await draftById(f.DB, workspace, draft.id)).status, "sent");
  } finally {
    f.client.close();
  }
});
test("Gmail rejection is distinct from uncertain delivery and needs an explicit draft save", async () => {
  const f = await fixture();
  try {
    const draft = await saveReplyDraft(f.DB, workspace, draftInput(f.message));
    assert.equal(
      (
        await sendReply(
          f.DB,
          workspace,
          draft.id,
          1,
          async () => new Response("denied", { status: 403 }),
        )
      ).status,
      "failed",
    );
    await assert.rejects(
      () => sendReply(f.DB, workspace, draft.id, 1),
      /Save and review/,
    );
    assert.equal((await draftById(f.DB, workspace, draft.id)).status, "failed");
  } finally {
    f.client.close();
  }
});
test("incremental history expiry restarts recent inbox sync without duplicating messages", async () => {
  const f = await fixture();
  try {
    await f.client.execute(
      "UPDATE gmail_connections SET sync_mode='history',history_id='old'",
    );
    const result = await syncGmail(f.DB, workspace, async (url) => {
      const path = String(url);
      if (path.includes("history?"))
        return new Response("expired", { status: 404 });
      if (path.endsWith("profile"))
        return Response.json({ emailAddress: email, historyId: "new-cursor" });
      if (path.includes("messages?"))
        return Response.json({
          messages: [{ id: "gmail-1", threadId: "thread-1" }],
        });
      throw new Error("Unexpected request");
    });
    assert.equal(result.imported, 0);
    assert.equal(result.more, true);
    assert.equal(
      (await gmailConnection(f.DB, workspace))?.sync_mode,
      "recovery",
    );
    assert.equal(
      (await gmailConnection(f.DB, workspace))?.history_id,
      "new-cursor",
    );
  } finally {
    f.client.close();
  }
});
test("expired history recovers archived replies across durable thread and message cursors", async () => {
  const f = await fixture();
  try {
    const other = parseGmailMessage(raw("original-2", "thread-2"), email);
    await storeGmailMessage(f.DB, workspace, other);
    await linkMessage(f.DB, workspace, other.id, "case-a", 1);
    await f.client.execute(
      "UPDATE gmail_connections SET sync_mode='history',history_id='expired'",
    );
    const missed = Array.from(
      { length: 23 },
      (_, i) => `missed-${String(i).padStart(2, "0")}`,
    );
    let fullRequests = 0;
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/history"))
        return new Response("expired", { status: 404 });
      if (url.pathname.endsWith("/profile"))
        return Response.json({
          emailAddress: email,
          historyId: "snapshot-before-recovery",
        });
      if (url.pathname.endsWith("/messages")) return Response.json({});
      if (url.pathname.endsWith("/threads/thread-1"))
        return Response.json({
          id: "thread-1",
          messages: ["gmail-1", ...missed].map((id) => ({ id })),
        });
      if (url.pathname.endsWith("/threads/thread-2"))
        return Response.json({
          id: "thread-2",
          messages: [{ id: "original-2" }, { id: "reply-2" }],
        });
      const id = url.pathname.split("/").pop()!;
      fullRequests++;
      return Response.json({
        ...raw(id, id === "reply-2" ? "thread-2" : "thread-1"),
        labelIds: [],
      });
    };
    assert.deepEqual(await syncGmail(f.DB, workspace, fetcher), {
      imported: 0,
      more: true,
    });
    assert.equal(
      (await gmailConnection(f.DB, workspace))?.sync_mode,
      "recovery",
    );
    assert.deepEqual(await syncGmail(f.DB, workspace, fetcher), {
      imported: 19,
      more: true,
    });
    assert.equal(fullRequests, 19);
    const cursor = JSON.parse(
      (await gmailConnection(f.DB, workspace))!.page_token!,
    );
    assert.equal(cursor.threadId, "thread-1");
    assert.equal(cursor.afterMessage, "missed-18");
    // A fresh binding resumes entirely from persisted state, as after a restart.
    const restarted = createNodeBindings(f.client).DB;
    assert.deepEqual(await syncGmail(restarted, workspace, fetcher), {
      imported: 4,
      more: true,
    });
    assert.deepEqual(
      JSON.parse((await gmailConnection(restarted, workspace))!.page_token!),
      { afterThread: "thread-1" },
    );
    assert.deepEqual(await syncGmail(restarted, workspace, fetcher), {
      imported: 1,
      more: false,
    });
    assert.equal(fullRequests, 24);
    const state = await gmailConnection(restarted, workspace);
    assert.equal(state?.sync_mode, "history");
    assert.equal(state?.history_id, "snapshot-before-recovery");
    assert.equal(state?.page_token, null);
    const recovered = await f.client.execute(
      "SELECT payload,case_id FROM gmail_messages WHERE provider_id='missed-22'",
    );
    assert.equal(recovered.rows[0].case_id, "case-a");
    assert.equal(
      JSON.parse(String(recovered.rows[0].payload)).attachments[0].name,
      "revised-bl.txt",
    );
    assert.equal(
      (await f.client.execute("SELECT COUNT(*) n FROM gmail_messages")).rows[0]
        .n,
      26,
    );
  } finally {
    f.client.close();
  }
});
test("a failed recovery page keeps its durable position for an idempotent retry", async () => {
  const f = await fixture();
  try {
    await f.client.execute(
      "UPDATE gmail_connections SET sync_mode='recovery',history_id='100'",
    );
    let unavailable = true;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).includes("/threads/"))
        return Response.json({
          id: "thread-1",
          messages: [{ id: "gmail-1" }, { id: "missed" }],
        });
      if (unavailable)
        return new Response("temporarily unavailable", { status: 503 });
      return Response.json({ ...raw("missed"), labelIds: [] });
    };
    await assert.rejects(
      () => syncGmail(f.DB, workspace, fetcher),
      /temporarily unavailable/,
    );
    const state = await gmailConnection(f.DB, workspace);
    assert.equal(state?.sync_mode, "recovery");
    assert.equal(state?.page_token, null);
    assert.equal(state?.sync_until, null);
    unavailable = false;
    assert.deepEqual(await syncGmail(f.DB, workspace, fetcher), {
      imported: 1,
      more: false,
    });
    assert.equal(
      (await f.client.execute("SELECT COUNT(*) n FROM gmail_messages")).rows[0]
        .n,
      2,
    );
  } finally {
    f.client.close();
  }
});
test("returned attachment bytes require mailbox message membership", async () => {
  const f = await fixture();
  try {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return Response.json({
        data: Buffer.from("ABC").toString("base64url"),
        size: 3,
      });
    };
    assert.equal(
      Buffer.from(
        (await gmailAttachment(f.DB, workspace, f.message.id, "1", fetcher))
          .bytes,
      ).toString(),
      "ABC",
    );
    await assert.rejects(
      () => gmailAttachment(f.DB, workspace, f.message.id, "wrong", fetcher),
      /not found/,
    );
    assert.equal(calls, 1);
  } finally {
    f.client.close();
  }
});
test("history follows archived known-thread replies but skips unrelated messages outside the intake label", async () => {
  const f = await fixture();
  try {
    await f.client.execute(
      "UPDATE gmail_connections SET sync_mode='history',history_id='100'",
    );
    const result = await syncGmail(f.DB, workspace, async (url) => {
      const path = String(url);
      if (path.includes("history?"))
        return Response.json({
          historyId: "200",
          history: [
            {
              messagesAdded: [
                { message: { id: "archived-reply" } },
                { message: { id: "unrelated" } },
              ],
            },
          ],
        });
      if (path.includes("archived-reply"))
        return Response.json({ ...raw("archived-reply"), labelIds: [] });
      return Response.json({
        ...raw("unrelated", "another-thread"),
        labelIds: [],
      });
    });
    assert.equal(result.imported, 1);
    assert.equal(
      (
        await f.client.execute(
          "SELECT COUNT(*) n FROM gmail_messages WHERE case_id='case-a'",
        )
      ).rows[0].n,
      2,
    );
    assert.equal((await gmailConnection(f.DB, workspace))?.history_id, "200");
  } finally {
    f.client.close();
  }
});
