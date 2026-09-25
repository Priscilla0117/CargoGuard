// Production HTTP acceptance against a new local database only. No cloud
// credentials, customer data, Microsoft actions or outbound email are used.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = fileURLToPath(new URL("../", import.meta.url));
await fs.access(join(root, ".next/BUILD_ID"));
const directory = join(root, "work/validation");
await fs.mkdir(directory, { recursive: true });
const fixture = await fs.mkdtemp(join(directory, "team-runtime-"));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const password = randomBytes(24).toString("hex");
const bootstrapSecret = randomBytes(32).toString("hex");
const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  HOST: "127.0.0.1",
  PORT: String(port),
  TURSO_DATABASE_URL: "",
  TURSO_AUTH_TOKEN: "",
  RENDER: "",
  RENDER_EXTERNAL_URL: "",
  CARGO_LOCAL_DB: join(fixture, "team.db").replaceAll("\\", "/"),
  CARGO_AUTH_MODE: "team",
  CARGO_PUBLIC_ORIGIN: origin,
  CARGO_INCLUDE_SAMPLE_DATA: "false",
  CARGO_MAX_WORKSPACE_UPLOADS: "1000",
  CARGO_BOOTSTRAP_SECRET: bootstrapSecret,
  CARGO_AI_PROVIDER: "",
  CARGO_AI_API_KEY: "",
  OPENAI_API_KEY: "",
  GEMINI_API_KEY: "",
  CARGO_MS_TENANT_ID: "",
  CARGO_MS_CLIENT_ID: "",
  CARGO_MS_CLIENT_SECRET: "",
  CARGO_MS_REDIRECT_URI: "",
  CARGO_MS_TOKEN_KEY: "",
  CARGO_MS_ALLOW_SEND: "false",
  CARGO_MS_ADDIN_ENABLED: "false",
  CARGO_MS_ADDIN_ID: "",
  CARGO_MS_ALERTS_ENABLED: "false",
  CARGO_MS_ALERT_RECIPIENTS: "",
};
let child;
let childClosed;
let startupFailure = false;
let requests = 0;
const checks = [];
const started = Date.now();
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}
async function startServer() {
  startupFailure = false;
  // Deliberately start outside the repository: scripts, secrets and local DB
  // resolution must remain tied to this checkout rather than the caller's cwd.
  child = spawn(process.execPath, [join(root, "scripts/start-node.mjs")], {
    cwd: tmpdir(),
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.on("error", () => {
    startupFailure = true;
  });
  childClosed = new Promise((resolve) => child.once("close", resolve));
  child.stdout.resume();
  child.stderr.resume();
  for (let attempt = 0; attempt < 160; attempt++) {
    if (startupFailure || child.exitCode !== null || child.signalCode !== null)
      throw new Error(
        "Isolated production server could not start; run npm run build and the deployment unit tests.",
      );
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.status === 200) return;
    } catch {
      /* bounded startup polling */
    }
    await delay(250);
  }
  throw new Error(
    "Local team readiness did not succeed within its startup deadline.",
  );
}
async function stopServer() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const running = child;
  if (running.connected) running.send({ type: "shutdown" });
  else running.kill("SIGTERM");
  const timer = setTimeout(() => running.kill("SIGKILL"), 15000);
  timer.unref();
  await childClosed;
  clearTimeout(timer);
}
async function request(path, { body, cookie, suppliedOrigin = origin } = {}) {
  assert.ok(++requests <= 90, "Local acceptance request budget exceeded");
  const multipart = body instanceof FormData;
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(suppliedOrigin ? { Origin: suppliedOrigin } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined && !multipart
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  const data = response.headers
    .get("content-type")
    ?.includes("application/json")
    ? JSON.parse(text)
    : null;
  return {
    status: response.status,
    headers: response.headers,
    data,
    bytes,
    text,
  };
}
const post = (path, body, cookie, suppliedOrigin) =>
  request(path, { body, cookie, suppliedOrigin });
async function login(email) {
  const result = await post("/api/auth", { action: "login", email, password });
  check(
    result.status === 200,
    `${email.split("@")[0]} signs in through production HTTP`,
  );
  const header = result.headers.get("set-cookie");
  check(
    /HttpOnly/i.test(header ?? "") && /SameSite=Strict/i.test(header ?? ""),
    "Session cookie is HttpOnly and SameSite Strict",
  );
  return header.split(";")[0];
}
const document = (role) =>
  `${role}\nShipper: Runtime Export Ltd\nConsignee: Runtime Buyer Ltd\nNotify party: SAME AS CONSIGNEE\nPort of loading: Singapore\nPort of discharge: Jakarta\nContainer count: 2\nGross weight (kg): 42500`;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

let failure;
try {
  await startServer();
  const health = await request("/api/health");
  check(
    health.status === 200 && health.data.status === "ready",
    "Production readiness includes the migrated database",
  );
  const live = await request("/api/live");
  check(
    live.status === 200 && live.data.database_checked === false,
    "Process liveness stays independent of database readiness",
  );
  check(
    (await request("/api/inbox")).status === 401,
    "Anonymous callers cannot read team work",
  );
  check(
    (
      await request("/api/inbox", {
        cookie: "cargo_workspace=11111111-1111-1111-1111-111111111111",
      })
    ).status === 401,
    "Forged demo workspace cookie cannot select a team",
  );
  check(
    (await request("/api/auth")).data.setup_available === true,
    "New installation exposes bootstrap only with configured secret",
  );
  const bootstrap = {
    action: "bootstrap",
    secret: bootstrapSecret,
    email: "admin@example.test",
    display_name: "Runtime Admin",
    password,
  };
  check(
    (
      await post("/api/auth", {
        ...bootstrap,
        secret: "wrong-synthetic-secret",
      })
    ).status === 403,
    "Wrong bootstrap secret is rejected",
  );
  check(
    (await post("/api/auth", bootstrap)).status === 201,
    "First administrator is created once",
  );
  check(
    (await post("/api/auth", bootstrap)).status === 409,
    "A second bootstrap cannot replace the existing team",
  );
  check(
    (
      await post("/api/auth", {
        action: "login",
        email: "admin@example.test",
        password: "wrong-synthetic-password",
      })
    ).status === 401,
    "Wrong password is rejected",
  );
  const admin = await login("admin@example.test");
  const firstInbox = await request("/api/inbox", { cookie: admin });
  check(
    firstInbox.status === 200 &&
      firstInbox.data.cases.length === 0 &&
      firstInbox.data.workspace.sample_data === false,
    "Team workspace starts empty with sample data disabled",
  );
  const bundle = JSON.parse(
    await fs.readFile(join(root, "data/bundle.json"), "utf8"),
  );
  const sample = bundle.emails.find((email) => email.attachments.length);
  check(
    (
      await post(
        "/api/cases",
        { action: "process", ids: [sample.email_id] },
        admin,
      )
    ).status === 400,
    "Team users cannot process hidden organiser samples",
  );
  check(
    (await request("/api/cases?export=1&mode=baseline", { cookie: admin }))
      .status === 409,
    "Organiser baseline export is disabled for employee workspaces",
  );
  const sampleName = sample.attachments[0].split("/").pop();
  check(
    (
      await request(
        `/api/document?id=${encodeURIComponent(sample.email_id)}&name=${encodeURIComponent(sampleName)}`,
        { cookie: admin },
      )
    ).status === 404,
    "Hidden organiser source documents cannot be downloaded through the team API",
  );
  let directoryResult;
  for (const role of ["operator", "reviewer"]) {
    directoryResult = await post(
      "/api/team",
      {
        action: "create",
        email: `${role}@example.test`,
        display_name: `Runtime ${role}`,
        password,
        role,
      },
      admin,
    );
    check(
      directoryResult.status === 200,
      `Administrator creates a ${role} account`,
    );
  }
  const operator = await login("operator@example.test");
  const reviewer = await login("reviewer@example.test");
  check(
    (await post("/api/team", {}, operator)).status === 403,
    "Operator cannot administer team membership",
  );
  check(
    (await post("/api/policies", {}, operator)).status === 403,
    "Operator cannot change review policy",
  );
  check(
    (await post("/api/team", {}, admin, "https://untrusted.example.test"))
      .status === 403,
    "Cross-origin authenticated writes are rejected",
  );
  check(
    (await post("/api/team", {}, admin, null)).status === 403,
    "Origin-less authenticated writes are rejected",
  );
  const form = new FormData();
  form.set("from", "synthetic@example.test");
  form.set("subject", "Draft BL verification for booking RT20260924001");
  form.set(
    "body",
    "Please compare the attached draft bill of lading with the shipping instruction before approval. Booking RT20260924001.",
  );
  form.append("files", new File([document("SHIPPING INSTRUCTION")], "si.txt"));
  form.append("files", new File([document("DRAFT BILL OF LADING")], "bl.txt"));
  const uploaded = await post("/api/upload", form, operator);
  check(
    uploaded.status === 200 && !!uploaded.data.result?.email.email_id,
    "Operator imports and processes a real multipart document pair",
  );
  const result = uploaded.data.result;
  const id = result.email.email_id;
  check(
    result.pipeline_version === health.data.engine &&
      result.documents.length === 2,
    "Uploaded result uses the running engine and retains both documents",
  );
  check(
    (await request("/api/inbox", { cookie: reviewer })).data.cases.some(
      (entry) => entry.email.email_id === id,
    ),
    "Reviewer sees the operator's shared workspace case",
  );
  const docName = result.documents.find((doc) => doc.type === "SI").name;
  const path = `/api/document?id=${encodeURIComponent(id)}&name=${encodeURIComponent(docName)}`;
  const original = await request(path, { cookie: reviewer });
  check(
    original.status === 200 &&
      original.text === document("SHIPPING INSTRUCTION"),
    "Original uploaded bytes round-trip exactly",
  );
  check(
    (await request(path)).status === 401,
    "Uploaded source bytes require team authentication",
  );
  const followup = {
    id,
    case_version: result.version,
    version: 0,
    owner: "Runtime operator",
    shipment_reference: "RT20260924001",
    due_at: null,
    state: "open",
    note: "Synthetic handover saved before a production restart.",
    actor: "Forged Caller Name",
  };
  const saved = await post("/api/follow-ups", followup, operator);
  check(
    saved.status === 200 &&
      saved.data.followup.actor.startsWith("Runtime operator [") &&
      !saved.data.followup.actor.includes("Forged"),
    "Audit actor comes from the authenticated identity rather than caller text",
  );
  check(
    (
      await post(
        "/api/follow-ups",
        {
          ...followup,
          version: saved.data.followup.version,
          state: "completed",
        },
        operator,
      )
    ).status === 403,
    "Operator cannot perform reviewer completion",
  );
  const shipment = await post(
    "/api/shipments",
    {
      action: "create",
      title: "Runtime persistence shipment",
      references: ["RT20260924001"],
      actor: "Forged Caller Name",
    },
    operator,
  );
  check(
    shipment.status === 200,
    "Operator creates a durable shipment workspace",
  );
  const incorporationProbe = {
    action: "reconcile_amendment",
    id: shipment.data.shipment.id,
    version: shipment.data.shipment.version,
    amendment_id: "nonexistent-instruction",
    case_id: id,
    case_version: result.version,
    reason: "Synthetic capability boundary probe",
    actor: "Forged Caller Name",
  };
  check(
    (await post("/api/shipments", incorporationProbe, operator)).status === 403,
    "Operator cannot certify instruction incorporation",
  );
  check(
    (await post("/api/shipments", incorporationProbe, reviewer)).status === 409,
    "Reviewer reaches incorporation validation while nonexistent evidence is rejected",
  );
  const exported = await request("/api/cases?export=1&mode=reviewed", {
    cookie: reviewer,
  });
  check(
    exported.status === 200 &&
      exported.data.cases.some((entry) => entry.email.email_id === id),
    "Reviewed evidence export works for imported team records",
  );
  const before = await request(`/api/cases?id=${encodeURIComponent(id)}`, {
    cookie: reviewer,
  });
  check(
    before.data.revisions.length > 0 && before.data.audit.length > 0,
    "Uploaded case has durable revisions and audit events",
  );
  await stopServer();
  env.CARGO_BOOTSTRAP_SECRET = "";
  await startServer();
  check(
    (await request("/api/auth")).data.setup_available === false,
    "Initialized team restarts with bootstrap secret removed",
  );
  const after = await request(`/api/cases?id=${encodeURIComponent(id)}`, {
    cookie: reviewer,
  });
  check(
    after.status === 200 && after.data.result.version === result.version,
    "Session and saved case survive a full server restart",
  );
  check(
    JSON.stringify(after.data.revisions) ===
      JSON.stringify(before.data.revisions) &&
      JSON.stringify(after.data.audit) === JSON.stringify(before.data.audit),
    "Case revisions and audit history survive restart unchanged",
  );
  const restored = await request(path, { cookie: operator });
  check(
    restored.status === 200 &&
      sha256(restored.bytes) === sha256(original.bytes),
    "Original source content hash survives restart",
  );
  const followups = await request("/api/follow-ups", { cookie: reviewer });
  check(
    followups.data.followups.some(
      (entry) => entry.email_id === id && entry.note === followup.note,
    ),
    "Follow-up ownership and handover notes survive restart",
  );
  check(
    (
      await request(`/api/shipments?id=${shipment.data.shipment.id}`, {
        cookie: reviewer,
      })
    ).status === 200,
    "Shipment workspace survives restart",
  );
  const member = directoryResult.data.members.find(
    (entry) => entry.role === "operator",
  );
  check(
    (
      await post(
        "/api/team",
        {
          action: "update",
          id: member.id,
          version: member.version,
          role: "operator",
          active: false,
        },
        admin,
      )
    ).status === 200,
    "Administrator can revoke operator membership",
  );
  check(
    (await request("/api/inbox", { cookie: operator })).status === 401,
    "Revocation invalidates the previously issued session immediately",
  );
  const security = await request("/api/team", { cookie: admin });
  check(
    security.data.audit.length >= 4,
    "Team security audit is durable and visible to administrators",
  );
  const own = security.data.members.find((entry) => entry.role === "admin");
  check(
    (
      await post(
        "/api/team",
        {
          action: "update",
          id: own.id,
          version: own.version,
          role: "operator",
          active: false,
        },
        admin,
      )
    ).status === 409,
    "The last administrator cannot disable their own recovery path",
  );
  check(
    (await post("/api/auth", { action: "logout" }, reviewer)).status === 200,
    "Reviewer can sign out",
  );
  check(
    (await request("/api/inbox", { cookie: reviewer })).status === 401,
    "Sign-out revokes the server session",
  );
} catch (error) {
  failure = error instanceof Error ? error.message : "Local acceptance failed";
  process.exitCode = 1;
} finally {
  await stopServer();
  const report = {
    suite: "production-team-runtime",
    target: "isolated loopback production server",
    passed: !failure,
    checks,
    requests,
    duration_ms: Date.now() - started,
    node: process.version,
    ...(failure ? { failure } : {}),
  };
  await fs.writeFile(
    join(directory, "team-runtime.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    `${checks.length} team runtime checks passed; ${requests} requests; ${Math.round((Date.now() - started) / 1000)}s. Report: work/validation/team-runtime.json`,
  );
  if (failure) console.error(failure);
}
