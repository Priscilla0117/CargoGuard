import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import {
  authenticatedActor,
  digest,
  permitted,
  requireCapability,
  tokenFromRequest,
} from "../lib/auth";
import { hashPassword, verifyPassword } from "../lib/auth-password";
import {
  bootstrapTeam,
  changePassword,
  createMember,
  listTeam,
  loginTeam,
  logoutTeam,
  reserveLoginAttempt,
  updateMember,
} from "../lib/team-storage";
import { GET as authStatus, POST as authAction } from "../app/api/auth/route";
import { GET as inbox } from "../app/api/inbox/route";
import { GET as cases, POST as mutateCase } from "../app/api/cases/route";
import { GET as document } from "../app/api/document/route";
import {
  GET as followUps,
  POST as followUpAction,
} from "../app/api/follow-ups/route";
import { GET as policy, POST as policyAction } from "../app/api/policies/route";
import {
  GET as recovery,
  POST as recoveryAction,
} from "../app/api/recovery/route";
import {
  GET as assistant,
  POST as assistantAction,
} from "../app/api/assistant/route";
import { POST as upload } from "../app/api/upload/route";
import { GET as team, POST as teamAction } from "../app/api/team/route";
import {
  GET as shipments,
  POST as shipmentAction,
} from "../app/api/shipments/route";
import {
  GET as labelRules,
  POST as labelRuleAction,
} from "../app/api/label-rules/route";
import { GET as insights } from "../app/api/insights/route";
import {
  GET as batchReview,
  POST as batchReviewAction,
} from "../app/api/batch-review/route";
import {
  GET as notifications,
  POST as notificationAction,
} from "../app/api/notifications/route";
import {
  GET as siTemplates,
  POST as siTemplateAction,
} from "../app/api/si-templates/route";

const password = "Synthetic rehearsal password 27!";
const previousEnv = { ...process.env };
before(() => {
  process.env.CARGO_AUTH_MODE = "team";
  process.env.CARGO_BOOTSTRAP_SECRET =
    "synthetic-test-setup-secret-000000000000000000";
});
after(() => {
  process.env = previousEnv;
});
async function fixture() {
  const client = createClient({ url: ":memory:" });
  for (const file of (await fs.readdir("drizzle"))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await client.executeMultiple(await fs.readFile(`drizzle/${file}`, "utf8"));
  const { DB } = createNodeBindings(client);
  const setup = await bootstrapTeam(
    {
      email: "admin@example.test",
      display_name: "Test Admin",
      password,
      secret: process.env.CARGO_BOOTSTRAP_SECRET!,
    },
    DB,
  );
  const login = await loginTeam("admin@example.test", password, DB);
  const request = req("/api/team", undefined, login.token);
  const admin = (await requireCapability(request, "admin", DB)).user!;
  return { client, DB, ...setup, token: login.token, admin };
}
function req(
  route: string,
  body?: unknown,
  token?: string,
  extra: Record<string, string> = {},
) {
  return new Request(`https://cargo.example${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body === undefined
        ? {}
        : {
            "Content-Type": "application/json",
            Origin: "https://cargo.example",
          }),
      ...(token ? { Cookie: `cargo_team_session=${token}` } : {}),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
test("passwords are salted, expensive derived hashes and never plaintext", async () => {
  const a = await hashPassword(password),
    b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.match(a, /^pbkdf2-sha256\$600000\$/);
  assert.ok(!a.includes(password));
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword("wrong password", a), false);
  assert.equal(await verifyPassword(password, null), false);
  await assert.rejects(() => hashPassword("short"), { status: 400 });
});
test("team bootstrap is one time, requires a configured secret and reserves the administrator atomically", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () =>
        bootstrapTeam(
          {
            email: "other@example.test",
            display_name: "Other Admin",
            password,
            secret: "incorrect",
          },
          f.DB,
        ),
      { status: 403 },
    );
    await assert.rejects(
      () =>
        bootstrapTeam(
          {
            email: "other@example.test",
            display_name: "Other Admin",
            password,
            secret: process.env.CARGO_BOOTSTRAP_SECRET!,
          },
          f.DB,
        ),
      { status: 409 },
    );
    assert.equal((await listTeam(f.workspace, f.DB)).length, 1);
    assert.equal(
      (await f.client.execute("SELECT * FROM team_installation")).rows.length,
      1,
    );
  } finally {
    f.client.close();
  }
});
test("opaque sessions ignore forged workspace/actor claims and revoked membership immediately fails", async () => {
  const f = await fixture();
  try {
    const request = req("/api/cases", undefined, f.token, {
      Cookie: `cargo_team_session=${f.token}; cargo_workspace=00000000-0000-0000-0000-000000000000`,
    });
    const s = await requireCapability(request, "read", f.DB);
    assert.equal(s.id, f.workspace);
    assert.match(
      authenticatedActor(request, "Forged Admin"),
      new RegExp(f.admin.id),
    );
    assert.ok(!authenticatedActor(request, "Forged Admin").includes("Forged"));
    const stored = (
      await f.client.execute("SELECT token_hash FROM team_sessions")
    ).rows[0].token_hash;
    assert.equal(stored, await digest(f.token));
    assert.notEqual(stored, f.token);
    await f.client.execute({
      sql: "UPDATE team_memberships SET active=0 WHERE user_id=?",
      args: [f.admin.id],
    });
    await assert.rejects(
      () =>
        requireCapability(req("/api/cases", undefined, f.token), "read", f.DB),
      { status: 401 },
    );
  } finally {
    f.client.close();
  }
});
test("role capabilities distinguish operation from human review and administration", async () => {
  const f = await fixture();
  try {
    assert.equal(permitted("operator", "operate"), true);
    assert.equal(permitted("operator", "review"), false);
    assert.equal(permitted("reviewer", "review"), true);
    assert.equal(permitted("reviewer", "admin"), false);
    await createMember(
      f.admin,
      {
        email: "operator@example.test",
        display_name: "Test Operator",
        password,
        role: "operator",
      },
      f.DB,
    );
    const login = await loginTeam("operator@example.test", password, f.DB);
    await requireCapability(
      req("/api/cases", undefined, login.token),
      "operate",
      f.DB,
    );
    await assert.rejects(
      () =>
        requireCapability(
          req("/api/cases", undefined, login.token),
          "review",
          f.DB,
        ),
      { status: 403 },
    );
    const operator = (
      await requireCapability(
        req("/api/team", undefined, login.token),
        "read",
        f.DB,
      )
    ).user!;
    await assert.rejects(
      () =>
        createMember(
          operator,
          {
            email: "attack@example.test",
            display_name: "Injected Admin",
            password,
            role: "admin",
          },
          f.DB,
        ),
      { status: 409 },
    );
  } finally {
    f.client.close();
  }
});
test("membership updates are version checked, workspace scoped and retain a final active admin", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      () =>
        updateMember(
          f.admin,
          { id: f.admin.id, version: 1, role: "operator", active: true },
          f.DB,
        ),
      { status: 409 },
    );
    const id = await createMember(
      f.admin,
      {
        email: "reviewer@example.test",
        display_name: "Test Reviewer",
        password,
        role: "reviewer",
      },
      f.DB,
    );
    const login = await loginTeam("reviewer@example.test", password, f.DB);
    await assert.rejects(
      () =>
        updateMember(
          { ...f.admin, workspace: "another-workspace" },
          { id, version: 1, role: "admin", active: true },
          f.DB,
        ),
      { status: 409 },
    );
    await updateMember(
      f.admin,
      { id, version: 1, role: "operator", active: true },
      f.DB,
    );
    await assert.rejects(
      () =>
        requireCapability(
          req("/api/team", undefined, login.token),
          "read",
          f.DB,
        ),
      { status: 401 },
    );
    await assert.rejects(
      () =>
        updateMember(
          f.admin,
          { id, version: 1, role: "admin", active: true },
          f.DB,
        ),
      { status: 409 },
    );
    assert.equal(
      (await listTeam(f.workspace, f.DB)).find((member) => member.id === id)
        ?.role,
      "operator",
    );
    await assert.rejects(() =>
      f.client.execute("UPDATE team_events SET detail='tampered'"),
    );
    await assert.rejects(() => f.client.execute("DELETE FROM team_events"));
  } finally {
    f.client.close();
  }
});
test("logout, idle expiration and password changes invalidate sessions", async () => {
  const f = await fixture();
  try {
    await logoutTeam(f.token, f.DB);
    await assert.rejects(
      () =>
        requireCapability(req("/api/team", undefined, f.token), "read", f.DB),
      { status: 401 },
    );
    const expired = await loginTeam("admin@example.test", password, f.DB);
    await f.client.execute({
      sql: "UPDATE team_sessions SET last_seen_at=?",
      args: [new Date(Date.now() - 31 * 60000).toISOString()],
    });
    await assert.rejects(
      () =>
        requireCapability(
          req("/api/team", undefined, expired.token),
          "read",
          f.DB,
        ),
      { status: 401 },
    );
    const active = await loginTeam("admin@example.test", password, f.DB);
    await changePassword(
      f.admin,
      password,
      "Changed synthetic password 0001",
      f.DB,
    );
    await assert.rejects(
      () =>
        requireCapability(
          req("/api/team", undefined, active.token),
          "read",
          f.DB,
        ),
      { status: 401 },
    );
    await assert.rejects(
      () => loginTeam("admin@example.test", password, f.DB),
      { status: 401 },
    );
    assert.ok(
      (
        await loginTeam(
          "admin@example.test",
          "Changed synthetic password 0001",
          f.DB,
        )
      ).token,
    );
  } finally {
    f.client.close();
  }
});
test("concurrent login attempts use persistent bounded reservations", async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        reserveLoginAttempt("one@example.test", f.DB),
      ),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 6);
    assert.equal(
      results.filter((r) => r.status === "rejected" && r.reason.status === 429)
        .length,
      4,
    );
    const keys = (
      await f.client.execute("SELECT key FROM team_login_limits")
    ).rows.map((r) => r.key);
    assert.ok(keys.every((key) => !String(key).includes("@")));
  } finally {
    f.client.close();
  }
});
test("all sensitive API routes enforce team sessions, roles and request origin; login cookies are HttpOnly and secure", async () => {
  const root = path.resolve("work");
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, "auth-api-test-"));
  process.env.CARGO_LOCAL_DB = path.join(directory, "test.db");
  process.env.CARGO_PUBLIC_ORIGIN = "https://cargo.example";
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.RENDER;
  const client = createClient({ url: `file:${process.env.CARGO_LOCAL_DB}` });
  try {
    for (const file of (await fs.readdir("drizzle"))
      .filter((file) => file.endsWith(".sql"))
      .sort())
      await client.executeMultiple(
        await fs.readFile(`drizzle/${file}`, "utf8"),
      );
    for (const [name, handler] of Object.entries({
      inbox,
      cases,
      document,
      followUps,
      policy,
      recovery,
      assistant,
      team,
      shipments,
      labelRules,
      insights,
      batchReview,
      notifications,
      siTemplates,
    })) {
      const response = await handler(
        req(`/api/${name}?export=1&id=synthetic&name=source.pdf`),
      );
      assert.equal(response.status, 401, `${name} unauthenticated read`);
      assert.equal(response.headers.get("set-cookie"), null);
    }
    for (const [name, handler] of Object.entries({
      mutateCase,
      followUpAction,
      policyAction,
      recoveryAction,
      assistantAction,
      upload,
      teamAction,
      shipmentAction,
      labelRuleAction,
      batchReviewAction,
      notificationAction,
      siTemplateAction,
    }))
      assert.equal(
        (await handler(req(`/api/${name}`, {}))).status,
        401,
        `${name} unauthenticated write`,
      );
    const setup = await authAction(
      req("/api/auth", {
        action: "bootstrap",
        email: "api-admin@example.test",
        display_name: "API Admin",
        password,
        secret: process.env.CARGO_BOOTSTRAP_SECRET,
      }),
    );
    assert.equal(setup.status, 201);
    const wrong = await authAction(
      req("/api/auth", {
        action: "login",
        email: "absent@example.test",
        password,
      }),
    );
    assert.equal(wrong.status, 401);
    const signIn = await authAction(
      req("/api/auth", {
        action: "login",
        email: "api-admin@example.test",
        password,
      }),
    );
    assert.equal(signIn.status, 200);
    const cookie = signIn.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=strict/i);
    const token = tokenFromRequest(
      new Request("https://cargo.example", { headers: { Cookie: cookie } }),
    )!;
    assert.ok(token);
    assert.equal(
      (await authStatus(req("/api/auth", undefined, token))).status,
      200,
    );
    assert.equal(
      (
        await mutateCase(
          req("/api/cases", {}, token, { Origin: "https://attacker.example" }),
        )
      ).status,
      403,
    );
    const noOrigin = req("/api/cases", {}, token);
    noOrigin.headers.delete("origin");
    assert.equal((await mutateCase(noOrigin)).status, 403);
    assert.equal(
      (
        await teamAction(
          req(
            "/api/team",
            {
              action: "create",
              email: "api-op@example.test",
              display_name: "API Operator",
              password,
              role: "operator",
            },
            token,
          ),
        )
      ).status,
      200,
    );
    const opSignIn = await authAction(
      req("/api/auth", {
        action: "login",
        email: "api-op@example.test",
        password,
      }),
    );
    const op = tokenFromRequest(
      new Request("https://cargo.example", {
        headers: { Cookie: opSignIn.headers.get("set-cookie")! },
      }),
    )!;
    const detail = await team(req("/api/team", undefined, op));
    assert.equal(detail.status, 200);
    const data = (await detail.json()) as {
      members: Record<string, unknown>[];
      audit: unknown[];
    };
    assert.ok(
      data.members.every(
        (member: Record<string, unknown>) => !("email" in member),
      ),
    );
    assert.deepEqual(data.audit, []);
    assert.equal(
      (await policyAction(req("/api/policies", {}, op))).status,
      403,
    );
    assert.equal(
      (await recoveryAction(req("/api/recovery", {}, op))).status,
      403,
    );
    assert.equal((await teamAction(req("/api/team", {}, op))).status, 403);
    assert.equal(
      (await batchReviewAction(req("/api/batch-review", {}, op))).status,
      403,
    );
    assert.equal(
      (
        await siTemplateAction(
          req(
            "/api/si-templates",
            {
              action: "approve",
              id: crypto.randomUUID(),
              version: 1,
              confirmed: true,
              actor: "Spoofed Reviewer",
            },
            op,
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await labelRuleAction(
          req(
            "/api/label-rules",
            {
              action: "approve",
              rule_id: crypto.randomUUID(),
              version: 1,
              actor: "Spoofed Reviewer",
            },
            op,
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await shipmentAction(
          req(
            "/api/shipments",
            {
              action: "complete",
              id: "test-shipment",
              version: 1,
              cases: {},
              acknowledge_advisories: true,
              reason: "Completion probe",
              actor: "Spoofed Reviewer",
            },
            op,
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await shipmentAction(
          req(
            "/api/shipments",
            {
              action: "assign",
              id: "test-shipment",
              version: 1,
              owner: "Someone else",
              owner_id: crypto.randomUUID(),
              claim: false,
              reason: "Assignment probe",
              actor: "Spoofed Reviewer",
            },
            op,
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await mutateCase(
          req(
            "/api/cases",
            {
              action: "review",
              id: "synthetic",
              version: 1,
              actor: "Forged Reviewer",
              reason: "Please review original",
              field: "shipper",
              side: "bl",
              value: "X",
            },
            op,
          ),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await followUpAction(
          req(
            "/api/follow-ups",
            {
              id: "synthetic",
              version: 0,
              case_version: 1,
              owner: "Operator",
              shipment_reference: "",
              due_at: null,
              state: "completed",
              note: "Claiming completion",
              actor: "Forged Reviewer",
            },
            op,
          ),
        )
      ).status,
      403,
    );
    const logout = await authAction(
      req("/api/auth", { action: "logout" }, token),
    );
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("set-cookie")!, /Max-Age=0/);
    assert.equal(
      (await cases(req("/api/cases", undefined, token))).status,
      401,
    );
  } finally {
    client.close();
  }
});
