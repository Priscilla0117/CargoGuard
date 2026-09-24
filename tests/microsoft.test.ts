import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { XMLParser } from "fast-xml-parser";
import { createNodeBindings } from "../lib/runtime-node";
import {
  decryptMicrosoftSecret,
  encryptMicrosoftSecret,
  graphMessagePath,
  microsoftConfiguration,
  microsoftGraph,
  microsoftHash,
  type MicrosoftConfig,
  type MicrosoftFetch,
} from "../lib/microsoft";
import {
  createMicrosoftDraft,
  finishMicrosoftConnect,
  microsoftAccessToken,
  sendMicrosoftDraft,
  startMicrosoftConnect,
  type MicrosoftContext,
} from "../lib/microsoft-storage";
import {
  microsoftImportForm,
  readMicrosoftMessage,
} from "../lib/microsoft-message";
import { outlookFraming, outlookManifest } from "../lib/microsoft-manifest";
import type { Shipment } from "../lib/shipments";
import {
  deliverMicrosoftAlert,
  microsoftAlertConfiguration,
  previewMicrosoftAlerts,
} from "../lib/microsoft-notifications";
import { dueNotifications } from "../lib/operational-notifications";
import type { CaseResult } from "../lib/types";

const config: MicrosoftConfig = {
  tenant: "11111111-1111-4111-8111-111111111111",
  client: "22222222-2222-4222-8222-222222222222",
  secret: "synthetic-test-client-secret",
  redirect: "https://cargo.example.test/api/microsoft/callback",
  origin: "https://cargo.example.test",
  key: btoa("01234567890123456789012345678901"),
  allowSend: true,
};
const env = {
  CARGO_MS_TENANT_ID: config.tenant,
  CARGO_MS_CLIENT_ID: config.client,
  CARGO_MS_CLIENT_SECRET: config.secret,
  CARGO_MS_REDIRECT_URI: config.redirect,
  CARGO_PUBLIC_ORIGIN: config.origin,
  CARGO_MS_TOKEN_KEY: config.key,
};
const user = {
  id: "reviewer-1",
  email: "reviewer@example.test",
  display_name: "Reviewer",
  role: "reviewer" as const,
  workspace: "team",
  membership_version: 1,
};
async function setup(fetcher?: MicrosoftFetch) {
  const client = createClient({ url: ":memory:" });
  await client.executeMultiple(
    await readFile(
      new URL("../drizzle/0009_microsoft_connector.sql", import.meta.url),
      "utf8",
    ),
  );
  await client.executeMultiple(
    await readFile(
      new URL("../drizzle/0011_microsoft_notifications.sql", import.meta.url),
      "utf8",
    ),
  );
  await client.executeMultiple(
    "CREATE TABLE shipments(workspace TEXT,id TEXT,version INTEGER,payload TEXT,PRIMARY KEY(workspace,id)); CREATE TABLE cases(workspace TEXT,email_id TEXT,version INTEGER,payload TEXT,PRIMARY KEY(workspace,email_id));",
  );
  const context: MicrosoftContext = {
    config,
    user,
    sessionToken: "a".repeat(64),
    workspace: "team",
    db: createNodeBindings(client).DB,
    fetcher,
  };
  return { client, context };
}
async function connect(
  context: MicrosoftContext,
  expires = Date.now() + 3600000,
) {
  const cipher = await encryptMicrosoftSecret(
    config,
    JSON.stringify({
      access_token: "synthetic-access-token",
      refresh_token: "synthetic-refresh-token",
      expires_at: expires,
      scope: "Mail.ReadWrite Mail.Send",
    }),
    "team:reviewer-1",
  );
  await context.db
    .prepare(
      "INSERT INTO microsoft_connections(workspace,user_id,version,graph_user_id,account_label,encrypted_tokens,updated_at) VALUES(?,?,1,?,?,?,?)",
    )
    .bind(
      context.workspace,
      context.user.id,
      "graph-user-1",
      "reviewer@example.test",
      cipher,
      new Date().toISOString(),
    )
    .run();
}
async function source(context: MicrosoftContext) {
  const at = new Date().toISOString();
  const shipment: Shipment = {
    id: "shipment-1",
    version: 2,
    title: "Synthetic shipment",
    customer: "",
    carrier: "",
    references: ["BOOK123456"],
    case_ids: ["case-1"],
    comparison_case_id: "case-1",
    owner: "Reviewer",
    owner_id: "reviewer-1",
    state: "open",
    completed_cases: {},
    deadlines: [],
    amendments: [],
    tasks: [
      {
        id: "task-1",
        kind: "missing_documents",
        case_id: "case-1",
        title: "Documents requested",
        body: "Please provide the current SI and draft BL for BOOK123456.",
        owner: "Reviewer",
        state: "draft",
        created_at: at,
        updated_at: at,
        actor: "Reviewer",
      },
    ],
    notes: "",
    created_at: at,
    updated_at: at,
    actor: "Reviewer",
  };
  await context.db
    .prepare("INSERT INTO shipments VALUES(?,?,?,?)")
    .bind(
      context.workspace,
      shipment.id,
      shipment.version,
      JSON.stringify(shipment),
    )
    .run();
  await context.db
    .prepare("INSERT INTO cases VALUES(?,?,?,?)")
    .bind(context.workspace, "case-1", 3, "{}")
    .run();
  return shipment;
}
const draftInput = {
  shipment_id: "shipment-1",
  shipment_version: 2,
  task_id: "task-1",
  case_version: 3,
  recipient: "issuer@example.test",
  reviewed: true as const,
};
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("connector configuration fails closed and never returns secret settings when incomplete", () => {
  assert.equal(microsoftConfiguration({}).configured, false);
  assert.equal(microsoftConfiguration(env).configured, true);
  assert.equal(microsoftConfiguration(env).config!.allowSend, false);
  for (const override of [
    { CARGO_MS_TENANT_ID: "common" },
    { CARGO_MS_CLIENT_ID: "not-guid" },
    { CARGO_PUBLIC_ORIGIN: "http://cargo.example.test" },
    { CARGO_MS_REDIRECT_URI: "https://attacker.example/callback" },
    { CARGO_MS_TOKEN_KEY: btoa("short") },
  ])
    assert.equal(
      microsoftConfiguration({ ...env, ...override }).configured,
      false,
    );
  assert.equal(
    microsoftConfiguration({ ...env, CARGO_MS_ALLOW_SEND: "true" }).config!
      .allowSend,
    true,
  );
});
test("OAuth credentials are authenticated-encrypted and bound to workspace and user", async () => {
  const ciphertext = await encryptMicrosoftSecret(
    config,
    "sensitive refresh value",
    "workspace:user",
  );
  assert.ok(!ciphertext.includes("sensitive"));
  assert.equal(
    await decryptMicrosoftSecret(config, ciphertext, "workspace:user"),
    "sensitive refresh value",
  );
  await assert.rejects(
    decryptMicrosoftSecret(config, ciphertext, "different:user"),
    /cannot be read/,
  );
  await assert.rejects(
    decryptMicrosoftSecret(
      config,
      ciphertext.slice(0, -2) + "AA",
      "workspace:user",
    ),
    /cannot be read/,
  );
});
test("Graph transport restricts destination, endpoint and redirect behavior", async () => {
  let count = 0;
  const fetcher: MicrosoftFetch = async (url, init) => {
    count++;
    assert.equal(new URL(String(url)).origin, "https://graph.microsoft.com");
    assert.equal(init?.redirect, "error");
    return json({ id: "safe" });
  };
  for (const path of [
    "https://evil.example/",
    "/users/other/messages",
    "/me/messages/foo/send/extra",
    "/me/messages/../users",
    "/me/messages/foo?$expand=attachments",
    "/me/messages/foo#fragment",
    "/me/messages/%2e%2e",
  ])
    await assert.rejects(microsoftGraph("token", path, {}, fetcher));
  await microsoftGraph("token", graphMessagePath("AA+/=_-"), {}, fetcher);
  assert.equal(count, 1);
});
test("provider errors and oversized responses do not reveal tokens or response bodies", async () => {
  await assert.rejects(
    microsoftGraph(
      "secret",
      "/me",
      {},
      async () =>
        new Response("secret diagnostic patient@example.test", { status: 500 }),
    ),
    (error: Error) =>
      !error.message.includes("patient") && !error.message.includes("secret"),
  );
  await assert.rejects(
    microsoftGraph("secret", "/me", { limit: 10 }, async () =>
      json({ content: "x".repeat(200) }),
    ),
    /did not confirm/,
  );
});
test("OAuth state is expiring, PKCE-protected, exact-session-bound and single use", async () => {
  let calls = 0;
  const fixture = await setup(async (url, init) => {
    calls++;
    if (String(url).includes("/token")) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code_verifier")!.length, 43);
      return json({
        access_token: "oauth-access",
        refresh_token: "oauth-refresh",
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    return json({ id: "graph-user", mail: "connected@example.test" });
  });
  try {
    const start = await startMicrosoftConnect(fixture.context),
      url = new URL(start.authorize_url),
      state = url.searchParams.get("state")!;
    assert.equal(url.hostname, "login.microsoftonline.com");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge")!.length, 43);
    const stored = await fixture.context.db
      .prepare(
        "SELECT state_hash,encrypted_verifier FROM microsoft_oauth_states",
      )
      .first<{ state_hash: string; encrypted_verifier: string }>();
    assert.notEqual(stored!.state_hash, state);
    assert.ok(stored!.encrypted_verifier.startsWith("v1."));
    await assert.rejects(
      finishMicrosoftConnect(
        { ...fixture.context, sessionToken: "b".repeat(64) },
        state,
        "code",
      ),
      /another session/,
    );
    assert.equal(calls, 0);
    const status = await finishMicrosoftConnect(fixture.context, state, "code");
    assert.equal(status.connected, true);
    await assert.rejects(
      finishMicrosoftConnect(fixture.context, state, "code"),
      /already used/,
    );
    assert.equal(calls, 2);
    const database = await fixture.client.execute(
      "SELECT encrypted_tokens FROM microsoft_connections",
    );
    assert.ok(
      !String(database.rows[0].encrypted_tokens).includes("oauth-access"),
    );
    await assert.rejects(
      fixture.client.execute("UPDATE microsoft_audit SET action='tampered'"),
      /immutable/,
    );
  } finally {
    fixture.client.close();
  }
});
test("expired OAuth state never reaches Microsoft", async () => {
  const fixture = await setup(async () => {
    throw new Error("must not call");
  });
  try {
    const start = await startMicrosoftConnect(fixture.context),
      state = new URL(start.authorize_url).searchParams.get("state")!;
    await fixture.client.execute(
      "UPDATE microsoft_oauth_states SET expires_at='2000-01-01T00:00:00.000Z'",
    );
    await assert.rejects(
      finishMicrosoftConnect(fixture.context, state, "code"),
      /expired/,
    );
  } finally {
    fixture.client.close();
  }
});
test("refresh credentials are encrypted and refreshed only against configured tenant", async () => {
  let calls = 0;
  const fixture = await setup(async (url, init) => {
    calls++;
    assert.match(
      String(url),
      new RegExp(`/${config.tenant}/oauth2/v2.0/token$`),
    );
    assert.equal(
      new URLSearchParams(String(init?.body)).get("refresh_token"),
      "synthetic-refresh-token",
    );
    return json({
      access_token: "new-access",
      expires_in: 3600,
      token_type: "Bearer",
    });
  });
  try {
    await connect(fixture.context, Date.now() - 1);
    assert.equal(await microsoftAccessToken(fixture.context), "new-access");
    assert.equal(await microsoftAccessToken(fixture.context), "new-access");
    assert.equal(calls, 1);
  } finally {
    fixture.client.close();
  }
});
test("reviewed draft creation is source-bound and repeated requests deduplicate", async () => {
  let posts = 0;
  const fixture = await setup(async (url, init) => {
    assert.equal(String(url), "https://graph.microsoft.com/v1.0/me/messages");
    assert.equal(init?.method, "POST");
    posts++;
    const body = JSON.parse(String(init?.body));
    assert.equal(
      body.toRecipients[0].emailAddress.address,
      "issuer@example.test",
    );
    assert.equal(body.body.contentType, "Text");
    assert.match(
      body.singleValueExtendedProperties[0].value,
      /^[a-f0-9-]{36}$/,
    );
    return json({ id: "graph-draft-1" }, 201);
  });
  try {
    await connect(fixture.context);
    await source(fixture.context);
    await assert.rejects(
      createMicrosoftDraft(fixture.context, { ...draftInput, case_version: 2 }),
      /Source case changed/,
    );
    await assert.rejects(
      createMicrosoftDraft(fixture.context, {
        ...draftInput,
        reviewed: false as true,
      }),
    );
    const first = await createMicrosoftDraft(fixture.context, draftInput);
    assert.equal(first.dispatch!.status, "draft");
    const second = await createMicrosoftDraft(fixture.context, draftInput);
    assert.equal(second.duplicate, true);
    assert.equal(first.dispatch!.id, second.dispatch!.id);
    assert.equal(posts, 1);
    await assert.rejects(
      createMicrosoftDraft(
        { ...fixture.context, workspace: "other" },
        draftInput,
      ),
      /Shipment changed/,
    );
  } finally {
    fixture.client.close();
  }
});
test("ambiguous draft creation is durable and not retried on repeated click", async () => {
  let calls = 0;
  const fixture = await setup(async () => {
    calls++;
    throw new Error("Network timeout with sensitive response");
  });
  try {
    await connect(fixture.context);
    await source(fixture.context);
    await assert.rejects(
      createMicrosoftDraft(fixture.context, draftInput),
      /did not confirm/,
    );
    const next = await createMicrosoftDraft(fixture.context, draftInput);
    assert.equal(next.dispatch!.status, "unknown");
    assert.equal(calls, 1);
  } finally {
    fixture.client.close();
  }
});
test("concurrent draft creates produce at most one provider write", async () => {
  let calls = 0;
  const fixture = await setup(async () => {
    calls++;
    return json({ id: "draft-race" }, 201);
  });
  try {
    await connect(fixture.context);
    await source(fixture.context);
    const results = await Promise.allSettled([
      createMicrosoftDraft(fixture.context, draftInput),
      createMicrosoftDraft(fixture.context, draftInput),
    ]);
    assert.ok(results.some((result) => result.status === "fulfilled"));
    assert.equal(calls, 1);
  } finally {
    fixture.client.close();
  }
});
function providerForSend(
  onSend: () => Promise<Response> = async () =>
    new Response(null, { status: 202 }),
  edit = false,
): MicrosoftFetch {
  return async (url, init) => {
    if (String(url).endsWith("/send")) return onSend();
    if (init?.method === "POST") return json({ id: "sendable-draft" }, 201);
    return json({
      isDraft: true,
      subject: "Documents requested",
      body: {
        contentType: "text",
        content: edit
          ? "Changed by somebody else"
          : "Please provide the current SI and draft BL for BOOK123456.",
      },
      toRecipients: [{ emailAddress: { address: "issuer@example.test" } }],
      ccRecipients: [],
      bccRecipients: [],
      hasAttachments: false,
    });
  };
}
test("send is disabled by default, reviewer-only, explicit and deduplicated", async () => {
  let sends = 0;
  const fixture = await setup(
    providerForSend(async () => {
      sends++;
      return new Response(null, { status: 202 });
    }),
  );
  try {
    await connect(fixture.context);
    await source(fixture.context);
    const created = (await createMicrosoftDraft(fixture.context, draftInput))
      .dispatch!;
    const input = {
      id: created.id,
      version: created.version,
      confirmed: true as const,
    };
    await assert.rejects(
      sendMicrosoftDraft(
        { ...fixture.context, config: { ...config, allowSend: false } },
        input,
      ),
      /disabled/,
    );
    await assert.rejects(
      sendMicrosoftDraft(
        { ...fixture.context, user: { ...user, role: "operator" } },
        input,
      ),
      /reviewer/,
    );
    assert.equal(
      (await sendMicrosoftDraft(fixture.context, input)).dispatch!.status,
      "submitted",
    );
    assert.equal(
      (await sendMicrosoftDraft(fixture.context, input)).duplicate,
      true,
    );
    assert.equal(sends, 1);
  } finally {
    fixture.client.close();
  }
});
test("edited Outlook drafts and stale local sources block sending", async () => {
  const fixture = await setup(providerForSend(undefined, true));
  try {
    await connect(fixture.context);
    await source(fixture.context);
    const created = (await createMicrosoftDraft(fixture.context, draftInput))
      .dispatch!;
    const input = {
      id: created.id,
      version: created.version,
      confirmed: true as const,
    };
    await assert.rejects(
      sendMicrosoftDraft(fixture.context, input),
      /changed outside/,
    );
    await fixture.client.execute("UPDATE cases SET version=4");
    await assert.rejects(
      sendMicrosoftDraft(fixture.context, input),
      /Source case changed/,
    );
  } finally {
    fixture.client.close();
  }
});
test("a source change during the remote preflight prevents the send reservation", async () => {
  let sends = 0;
  const fixture = await setup();
  fixture.context.fetcher = async (url, init) => {
    if (init?.method !== "POST")
      await fixture.client.execute("UPDATE cases SET version=4");
    return providerForSend(async () => {
      sends++;
      return new Response(null, { status: 202 });
    })(url, init);
  };
  try {
    await connect(fixture.context);
    await source(fixture.context);
    const created = (await createMicrosoftDraft(fixture.context, draftInput))
      .dispatch!;
    await assert.rejects(
      sendMicrosoftDraft(fixture.context, {
        id: created.id,
        version: created.version,
        confirmed: true,
      }),
      /changed concurrently/,
    );
    assert.equal(sends, 0);
  } finally {
    fixture.client.close();
  }
});
test("ambiguous send outcome cannot be automatically or explicitly resent", async () => {
  let sends = 0;
  const fixture = await setup(
    providerForSend(async () => {
      sends++;
      throw new Error("transport lost");
    }),
  );
  try {
    await connect(fixture.context);
    await source(fixture.context);
    const created = (await createMicrosoftDraft(fixture.context, draftInput))
      .dispatch!;
    const input = {
      id: created.id,
      version: created.version,
      confirmed: true as const,
    };
    await assert.rejects(
      sendMicrosoftDraft(fixture.context, input),
      /did not confirm/,
    );
    await assert.rejects(
      sendMicrosoftDraft(fixture.context, input),
      /no longer sendable/,
    );
    assert.equal(sends, 1);
    const record = await fixture.client.execute(
      "SELECT status FROM microsoft_dispatches",
    );
    assert.equal(record.rows[0].status, "unknown");
  } finally {
    fixture.client.close();
  }
});
test("message preview and file import are bounded, text-only and source-linked", async () => {
  const content = "SHIPPING INSTRUCTION\nContainer count: 1";
  const fixture = await setup(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/attachments/file-1"))
      return json({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: "si.txt",
        contentBytes: btoa(content),
      });
    if (path.endsWith("/attachments"))
      return json({
        value: [
          {
            id: "file-1",
            name: "si.txt",
            size: content.length,
            isInline: false,
            "@odata.type": "#microsoft.graph.fileAttachment",
          },
        ],
      });
    return json({
      id: "message-1",
      internetMessageId: "synthetic@example.test",
      subject: "SI",
      lastModifiedDateTime: "2026-09-24T01:00:00Z",
      from: { emailAddress: { address: "sender@example.test" } },
      body: { contentType: "text", content: "Please compare the attached SI" },
      hasAttachments: true,
    });
  });
  try {
    await connect(fixture.context);
    const preview = await readMicrosoftMessage(fixture.context, "message-1");
    assert.equal(preview.attachments[0].supported, true);
    assert.equal(
      preview.message_key,
      await microsoftHash("synthetic@example.test"),
    );
    const form = await microsoftImportForm(fixture.context, preview);
    assert.equal(await (form.get("files") as File).text(), content);
    assert.equal(form.get("from"), "sender@example.test");
    await assert.rejects(
      microsoftImportForm(fixture.context, {
        ...preview,
        attachments: [
          { ...preview.attachments[0], supported: false, reason: "unsafe" },
        ],
      }),
      /nothing is silently discarded/,
    );
  } finally {
    fixture.client.close();
  }
});
test("manifest uses verified HTTPS origin and ReadItem; framing is opt-in and restricted", async () => {
  const template = await readFile(
    new URL("../public/outlook/manifest.template.xml", import.meta.url),
    "utf8",
  );
  const manifest = outlookManifest(
    template,
    "https://cargo.example.test",
    config.client,
  );
  assert.ok(!manifest.includes("__ORIGIN__"));
  assert.ok(manifest.includes("https://cargo.example.test/outlook"));
  const parsed = new XMLParser().parse(manifest);
  assert.equal(parsed.OfficeApp.Permissions, "ReadItem");
  assert.throws(() =>
    outlookManifest(template, "http://cargo.example.test", config.client),
  );
  assert.throws(() =>
    outlookManifest(
      template,
      "https://cargo.example.test/other",
      config.client,
    ),
  );
  assert.equal(outlookFraming(false)[0].value, "DENY");
  assert.match(
    outlookFraming(true)[0].value,
    /frame-ancestors 'self' https:\/\/outlook.office.com/,
  );
  assert.ok(!outlookFraming(true)[0].value.includes("*"));
});

async function alertSource(context: MicrosoftContext) {
  const shipment = await source(context);
  const at = new Date(Date.now() + 3600000).toISOString();
  shipment.deadlines = [
    {
      id: "deadline-1",
      type: "BL confirmation",
      at,
      zone: "UTC",
      quote: `BL deadline ${at}`,
      source_case: "case-1",
      source_version: 3,
      confirmed_by: "Reviewer",
      confirmed_at: new Date().toISOString(),
    },
  ];
  const current = { email: { email_id: "case-1" }, version: 3 } as CaseResult;
  await context.db
    .prepare("UPDATE shipments SET payload=? WHERE workspace=? AND id=?")
    .bind(JSON.stringify(shipment), context.workspace, shipment.id)
    .run();
  await context.db
    .prepare(
      "UPDATE cases SET payload=? WHERE workspace=? AND email_id='case-1'",
    )
    .bind(JSON.stringify(current), context.workspace)
    .run();
  await context.db
    .prepare(
      "CREATE TABLE operational_notifications(workspace TEXT,id TEXT,shipment_id TEXT,shipment_version INTEGER,payload TEXT,created_at TEXT,acknowledged_at TEXT,PRIMARY KEY(workspace,id))",
    )
    .run();
  const notification = dueNotifications([shipment], [current])[0];
  await context.db
    .prepare("INSERT INTO operational_notifications VALUES(?,?,?,?,?,?,NULL)")
    .bind(
      context.workspace,
      notification.id,
      shipment.id,
      shipment.version,
      JSON.stringify(notification),
      notification.created_at,
    )
    .run();
  return notification;
}
const alertSettings = { enabled: true, recipients: ["desk@example.test"] };
test("deadline email delivery is opt-in with a bounded recipient allowlist", () => {
  assert.equal(microsoftAlertConfiguration({}).enabled, false);
  assert.equal(
    microsoftAlertConfiguration({
      CARGO_MS_ALERTS_ENABLED: "true",
      CARGO_MS_ALERT_RECIPIENTS: "bad\r\nTo:other@example.test",
    }).enabled,
    false,
  );
  assert.deepEqual(
    microsoftAlertConfiguration({
      CARGO_MS_ALERTS_ENABLED: "true",
      CARGO_MS_ALERT_RECIPIENTS: "Desk@example.test, desk@example.test",
    }),
    alertSettings,
  );
});
test("reviewed deadline delivery creates one draft/send and deduplicates across repeated requests", async () => {
  let calls = 0;
  const fixture = await setup(async (url) => {
    calls++;
    return String(url).endsWith("/send")
      ? new Response(null, { status: 202 })
      : json({ id: "alert-draft" }, 201);
  });
  try {
    await connect(fixture.context);
    const alert = await alertSource(fixture.context);
    const previews = await previewMicrosoftAlerts(fixture.context);
    assert.equal(previews.previews.length, 1);
    const input = {
      alert_id: alert.id,
      shipment_version: 2,
      recipient: "desk@example.test",
      reviewed: true as const,
    };
    await assert.rejects(
      deliverMicrosoftAlert(
        fixture.context,
        { ...input, recipient: "unapproved@example.test" },
        alertSettings,
      ),
      /not approved/,
    );
    await assert.rejects(
      deliverMicrosoftAlert(
        { ...fixture.context, user: { ...user, role: "operator" } },
        input,
        alertSettings,
      ),
      /reviewer/,
    );
    assert.equal(
      (await deliverMicrosoftAlert(fixture.context, input, alertSettings))
        .delivery.status,
      "submitted",
    );
    assert.equal(
      (await deliverMicrosoftAlert(fixture.context, input, alertSettings))
        .duplicate,
      true,
    );
    assert.equal(calls, 2);
  } finally {
    fixture.client.close();
  }
});
test("stale or acknowledged deadline reminder cannot dispatch", async () => {
  let calls = 0;
  const fixture = await setup(async () => {
    calls++;
    return json({ id: "not-expected" });
  });
  try {
    await connect(fixture.context);
    const alert = await alertSource(fixture.context);
    const input = {
      alert_id: alert.id,
      shipment_version: 2,
      recipient: "desk@example.test",
      reviewed: true as const,
    };
    await fixture.client.execute("UPDATE cases SET version=4");
    await assert.rejects(
      deliverMicrosoftAlert(fixture.context, input, alertSettings),
      /no longer current/,
    );
    await fixture.client.execute("UPDATE cases SET version=3");
    await fixture.client.execute(
      "UPDATE operational_notifications SET acknowledged_at='2026-09-24T01:00:00Z'",
    );
    await assert.rejects(
      deliverMicrosoftAlert(fixture.context, input, alertSettings),
      /acknowledged/,
    );
    assert.equal(calls, 0);
  } finally {
    fixture.client.close();
  }
});
test("deadline changes during draft creation cancel before sending", async () => {
  let sends = 0;
  const fixture = await setup();
  fixture.context.fetcher = async (url) => {
    if (String(url).endsWith("/send")) {
      sends++;
      return new Response(null, { status: 202 });
    }
    await fixture.client.execute("UPDATE cases SET version=4");
    return json({ id: "held-alert" }, 201);
  };
  try {
    await connect(fixture.context);
    const alert = await alertSource(fixture.context);
    await assert.rejects(
      deliverMicrosoftAlert(
        fixture.context,
        {
          alert_id: alert.id,
          shipment_version: 2,
          recipient: "desk@example.test",
          reviewed: true,
        },
        alertSettings,
      ),
      /no longer current/,
    );
    assert.equal(sends, 0);
    assert.equal(
      (
        await fixture.client.execute(
          "SELECT status FROM microsoft_notification_outbox",
        )
      ).rows[0].status,
      "cancelled",
    );
  } finally {
    fixture.client.close();
  }
});
test("ambiguous deadline submission remains unknown and is never resent", async () => {
  let sends = 0;
  const fixture = await setup(async (url) => {
    if (String(url).endsWith("/send")) {
      sends++;
      throw new Error("Connection lost");
    }
    return json({ id: "unknown-alert" }, 201);
  });
  try {
    await connect(fixture.context);
    const alert = await alertSource(fixture.context);
    const input = {
      alert_id: alert.id,
      shipment_version: 2,
      recipient: "desk@example.test",
      reviewed: true as const,
    };
    await assert.rejects(
      deliverMicrosoftAlert(fixture.context, input, alertSettings),
      /did not confirm/,
    );
    const next = await deliverMicrosoftAlert(
      fixture.context,
      input,
      alertSettings,
    );
    assert.equal(next.delivery.status, "unknown");
    assert.equal(next.duplicate, true);
    assert.equal(sends, 1);
  } finally {
    fixture.client.close();
  }
});
