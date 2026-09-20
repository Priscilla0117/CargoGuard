import assert from "node:assert/strict";
import fs from "node:fs/promises";
const fetch = (url, options = {}) =>
  globalThis.fetch(url, {
    ...options,
    headers: {
      ...(process.env.CARGO_SITE_AUTH
        ? { "OAI-Sites-Authorization": `Bearer ${process.env.CARGO_SITE_AUTH}` }
        : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(45000),
  });
const origin = process.argv[2] ?? "http://127.0.0.1:3000";
const start = performance.now();
let checks = 0;
async function session() {
  const r = await fetch(origin + "/api/inbox");
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
const cookie = await session(),
  other = await session();
async function call(path, body, ws = cookie, extra = {}) {
  const r = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: ws,
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw };
  }
  return { r, data };
}
function check(ok, msg) {
  assert.ok(ok, msg);
  checks++;
}
check(
  (await call("/api/cases?export=1")).r.status === 409,
  "incomplete export blocked",
);
check(
  (await call("/api/cases", { action: "process", ids: ["email_001"] }, "")).r
    .status === 400,
  "missing session blocked",
);
check(
  [400, 403].includes(
    (
      await call(
        "/api/cases",
        { action: "process", ids: ["email_001"] },
        cookie,
        { Origin: "https://other.example" },
      )
    ).r.status,
  ),
  "cross-origin mutation blocked",
);
const inbox = (await call("/api/inbox")).data;
check(inbox.cases.length === 520, "all 520 records load");
for (let i = 0; i < 520; i += 10) {
  const { r, data } = await call("/api/cases", {
    action: "process",
    ids: inbox.cases.slice(i, i + 10).map((c) => c.email.email_id),
  });
  assert.equal(r.status, 200, JSON.stringify(data));
  assert.equal(data.results.length, 10);
}
checks += 52;
const exported = await call("/api/cases?export=1"),
  expected = JSON.parse(
    await fs.readFile("work/validation/v3/original/submission.json", "utf8"),
  );
check(exported.r.status === 200, "complete export allowed");
assert.deepEqual(exported.data, expected);
checks++;
check(
  (await call("/api/inbox", null, other)).data.cases.every(
    (c) => c.result === null,
  ),
  "separate session sees no saved decisions",
);
const one = await call("/api/cases?id=email_001");
check(one.data.audit.length === 1, "processing audit recorded atomically");
const correction = {
  action: "review",
  id: "email_001",
  version: one.data.result.version,
  field: "gross_weight_kg",
  side: "bl",
  value: "1 KG",
  actor: "Integration tester",
  reason: "Deliberately altered extraction for regression testing",
};
const corrected = await call("/api/cases", correction);
check(
  corrected.r.status === 200 &&
    corrected.data.result.defect_fields.includes("gross_weight_kg"),
  "correction recomputes",
);
check(
  (await call("/api/cases", correction)).r.status === 409,
  "stale correction rejected",
);
check(
  (await call("/api/cases?id=email_001")).data.audit.length === 2,
  "failed stale write leaves no false audit event",
);
assert.deepEqual(
  (await call("/api/cases?export=1&mode=baseline")).data,
  expected,
);
checks++;
check(
  (await call("/api/cases?export=1&mode=reviewed")).data.cases.find(
    (r) => r.email.email_id === "email_001",
  ).reviewed === true,
  "reviewed export discloses human intervention",
);
check(
  (await call("/api/cases", { action: "process", ids: ["email_001"] })).data
    .results[0].status === expected.email_001.status,
  "reprocess uses original evidence",
);
const base =
  "Shipper: NEW EXPORT LTD\nConsignee: NEW IMPORT LTD\nNotify Party: SAME AS CONSIGNEE\nPort of Loading: SINGAPORE\nPort of Discharge: PORT KLANG\nContainer Count: 2 x 20FCL\nGross Weight (KG): 42000";
function form(replace) {
  const f = new FormData();
  f.set("subject", "Compare the attached SI and draft BL");
  f.set("body", "Please verify the SI and draft BL.");
  f.append("files", new File(["SHIPPING INSTRUCTION\n" + base], "new-si.txt"));
  f.append(
    "files",
    new File(
      ["BILL OF LADING\n" + base.replace("42000", replace ? "42000" : "42001")],
      "new-bl.txt",
    ),
  );
  return f;
}
async function upload(fd) {
  const r = await fetch(origin + "/api/upload", {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
    body: fd,
  });
  return { r, data: await r.json() };
}
const u = await upload(form(false));
check(
  u.r.status === 200 && u.data.result.has_defect,
  "fresh upload is processed from bytes",
);
const id = u.data.result.email.email_id,
  name = u.data.result.documents[0].name;
check(
  (
    await fetch(origin + `/api/document?id=${id}&name=${name}`, {
      headers: { Cookie: cookie },
    })
  ).status === 200,
  "uploaded original is retrievable",
);
check(
  (
    await fetch(origin + `/api/document?id=${id}&name=${name}`, {
      headers: { Cookie: other },
    })
  ).status === 404,
  "cross-session original access blocked",
);
const replacement = form(true);
replacement.set("id", id);
replacement.set("version", "1");
replacement.set("actor", "Integration tester");
replacement.set("reason", "New readable revised source provided");
const replaced = await upload(replacement);
check(
  replaced.r.status === 200 && replaced.data.result.workflow === "verified",
  "same-case document replacement recomputes",
);
check(
  (await call("/api/cases", { action: "process", ids: [id] })).data.results[0]
    .workflow === "verified",
  "replacement persists on reprocess",
);
const bad = form(false);
bad.append("files", new File(["x"], "extra.exe"));
check((await upload(bad)).r.status === 400, "invalid upload blocked");
const report = {
  checks,
  duration_ms: Math.round(performance.now() - start),
  passed: true,
  scope:
    "HTTP integration against the supplied origin; isolated synthetic workspace",
  origin,
  generated_at: new Date().toISOString(),
};
await fs.mkdir("work", { recursive: true });
await fs.writeFile(
  new URL(origin).hostname === "127.0.0.1" ||
    new URL(origin).hostname === "localhost"
    ? "work/api-test-report.json"
    : "work/validation/hosted-baseline-api.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
