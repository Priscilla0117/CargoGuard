import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const origin = process.argv[2] ?? "http://127.0.0.1:3000";
const auth = process.env.CARGO_SITE_AUTH
  ? { "OAI-Sites-Authorization": `Bearer ${process.env.CARGO_SITE_AUTH}` }
  : {};
const checks = [],
  latencies = [],
  started = performance.now();
function check(value, name) {
  assert.ok(value, name);
  checks.push(name);
}
async function request(path, body, cookie, extra = {}) {
  const t = performance.now(),
    json = body && !(body instanceof FormData) && typeof body !== "string";
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...auth,
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...extra,
    },
    body: json ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(45000),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: text.slice(0, 200) };
  }
  latencies.push(performance.now() - t);
  return { status: response.status, data, headers: response.headers };
}
async function session() {
  const r = await request("/api/inbox");
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
const cookie = await session(),
  other = await session();
const call = (body, ws = cookie) => request("/api/cases", body, ws);
const get = (id) =>
  request(`/api/cases?id=${encodeURIComponent(id)}`, undefined, cookie);
const processIds = (ids, skipSaved = true) =>
  call({ action: "process", ids, skipSaved });
check(
  (await processIds(["email_001", "unknown-id"])).status === 400,
  "unknown ID rejects whole batch",
);
check(
  (await get("email_001")).status === 404,
  "invalid batch makes no partial writes",
);
check(
  (await processIds(["email_001", "email_001"])).status === 400,
  "duplicate IDs rejected",
);
check(
  (
    await processIds(
      Array.from(
        { length: 11 },
        (_, i) => `email_${String(i + 1).padStart(3, "0")}`,
      ),
    )
  ).status === 400,
  "oversized batch rejected",
);
const same = await Promise.all([
  processIds(["email_001"]),
  processIds(["email_001"]),
]);
check(
  same.every(
    (r) =>
      r.status === 200 && r.data.results.length === 1 && !r.data.errors.length,
  ),
  "concurrent idempotent processing succeeds",
);
let saved = await get("email_001");
check(
  saved.data.result.version === 1 && saved.data.audit.length === 1,
  "one revision and event after concurrent resume",
);
await processIds(["email_001"]);
check(
  (await get("email_001")).data.audit.length === 1,
  "completed resume adds no duplicate event",
);
check(
  (
    await request(
      "/api/cases",
      { action: "process", ids: ["email_002"] },
      cookie,
      { Origin: "https://invalid.example" },
    )
  ).status === 403,
  "cross-origin writes refused",
);
check(
  (
    await request("/api/cases", "x".repeat(21000), cookie, {
      "Content-Type": "application/json",
    })
  ).status === 413,
  "JSON stream limit enforced",
);
const base =
  "Shipper: QA EXPORT LTD\nConsignee: QA IMPORT LTD\nNotify Party: SAME AS CONSIGNEE\nPort of Loading: SINGAPORE\nPort of Discharge: PORT KLANG\nContainer Count: 2 x 40HC + 1 x 20GP\nGross Weight (KG): 42000";
const content = (role) =>
  `${role === "SI" ? "SHIPPING INSTRUCTION" : "BILL OF LADING"}\n${base}`;
function form(bl = content("BL")) {
  const fd = new FormData();
  fd.set("subject", "Reminder: SI needed");
  fd.set(
    "body",
    "Please compare the SI and draft BL against all seven required fields.",
  );
  fd.append("files", new File([content("SI")], "qa-si.txt"));
  fd.append("files", new File([bl], "qa-bl.txt"));
  return fd;
}
const upload = (fd, ws = cookie) => request("/api/upload", fd, ws);
let u = await upload(form());
assert.equal(u.status, 200, JSON.stringify(u.data));
let r = u.data.result,
  id = r.email.email_id;
check(
  r.workflow === "verified",
  "misleading subject and compound counts verify correctly",
);
const doc = r.documents[0],
  url = `/api/document?id=${id}&name=${encodeURIComponent(doc.name)}`;
const original = await fetch(origin + url, {
  headers: { ...auth, Cookie: cookie },
});
check(
  createHash("sha256")
    .update(Buffer.from(await original.arrayBuffer()))
    .digest("hex") === doc.sha256,
  "source hash matches actual stored bytes",
);
check(
  (await request(url, undefined, other)).status === 404,
  "stored source isolated across workspaces",
);
const review = (field, value, version = r.version) =>
  call({
    action: "review",
    id,
    version,
    field,
    side: "bl",
    value,
    actor: "QA reviewer",
    reason: "Synthetic integration regression; not a real shipping decision",
  });
let response = await review("notify_party", "SAME AS CONSIGNEE");
r = response.data.result;
check(
  response.status === 200 && r.workflow === "verified",
  "same-value notify confirmation stays verified",
);
response = await review("consignee", "NEW IMPORT LTD");
r = response.data.result;
check(
  r.defect_fields.includes("consignee") &&
    r.defect_fields.includes("notify_party"),
  "consignee edit recomputes dependent notify party",
);
const route = await call({
  action: "route",
  id,
  version: r.version,
  category: "BL_COMPARISON",
  actor: "QA reviewer",
  reason: "Confirm current routing without discarding field corrections",
});
r = route.data.result;
check(
  r.defect_fields.includes("consignee") &&
    r.category_override === "BL_COMPARISON",
  "same-category confirmation preserves corrections",
);
const before = (await get(id)).data.audit.length;
const race = await Promise.all([
  review("gross_weight_kg", "43000 KG"),
  review("gross_weight_kg", "44000 KG"),
]);
check(
  race
    .map((x) => x.status)
    .sort()
    .join() === "200,409",
  "exactly one simultaneous reviewer wins",
);
saved = await get(id);
r = saved.data.result;
check(
  saved.data.audit.length === before + 1,
  "conflicting save creates no false audit record",
);
check(
  (await review("container_count", "3 total 7")).status === 422,
  "contradictory human count refused",
);
check(
  (await review("gross_weight_kg", "TBD")).status === 422,
  "missing human value refused",
);
const rerun = await processIds([id], false);
r = rerun.data.results[0];
check(
  r.workflow === "verified" && r.category_override === "BL_COMPARISON",
  "explicit reprocess resets edits but retains routing",
);
const replace = () => {
  const fd = form(content("BL").replace("42000", "43000"));
  fd.set("id", id);
  fd.set("version", String(r.version));
  fd.set("actor", "QA reviewer");
  fd.set("reason", "Synthetic revised documents for concurrency testing");
  return fd;
};
const replacements = await Promise.all([upload(replace()), upload(replace())]);
check(
  replacements
    .map((x) => x.status)
    .sort()
    .join() === "200,409",
  "concurrent replacement is version-checked",
);
r = (await get(id)).data.result;
check(
  r.workflow === "discrepancy" && r.documents.every((d) => d.sha256),
  "winning replacement persists with hashes",
);
check(
  (await processIds([id], false)).data.results[0].defect_fields.includes(
    "gross_weight_kg",
  ),
  "reprocess reads winning stored replacement",
);
const oneFile = replace();
oneFile.delete("files");
oneFile.append("files", new File(["test"], "one.txt"));
oneFile.set("version", String((await get(id)).data.result.version));
check(
  (await upload(oneFile)).status === 400,
  "replacement requires both sources",
);
const invalidFile = form();
invalidFile.append("files", "not a file");
check(
  (await upload(invalidFile)).status === 400,
  "non-file attachment field rejected",
);
const malformed = await request("/api/upload", "bad multipart", cookie, {
  "Content-Type": "multipart/form-data; boundary=broken",
});
check(
  malformed.status === 400,
  "malformed multipart returns a controlled error",
);
const uncertain = new FormData();
uncertain.set("subject", "Unclear");
uncertain.set("body", "Zyx quux florp");
const unknown = await upload(uncertain);
check(
  unknown.data.result.review_reason === "uncertain_category",
  "unknown intent enters human review",
);
const classified = await call({
  action: "route",
  id: unknown.data.result.email.email_id,
  version: 1,
  category: "GENERAL",
  actor: "QA reviewer",
  reason: "Read original request and confirmed operations category",
});
check(
  classified.data.result.workflow === "routed" &&
    classified.data.audit.some((e) => e.action === "CATEGORY_CONFIRMED"),
  "human category review resolves and audits unknown intent",
);
const scan = (await processIds(["email_512"])).data.results[0];
const fields = Object.fromEntries(
  [
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
  ].map((f, i) => [
    f,
    {
      value: [
        "QA EXPORT",
        "QA IMPORT",
        "SAME AS CONSIGNEE",
        "SINGAPORE",
        "PORT KLANG",
        "3",
        "42000 KG",
      ][i],
      page: 1,
      confirmed: true,
    },
  ]),
);
const transcript = {
  action: "transcribe",
  id: "email_512",
  version: scan.version,
  name: scan.documents[0].name,
  sha256: scan.documents[0].sha256,
  role: "SI",
  fields,
  actor: "QA synthetic test",
  reason:
    "Test-only supplied values; not an accuracy evaluation or real source confirmation",
};
check(
  (
    await call({
      ...transcript,
      fields: { ...fields, shipper: { ...fields.shipper, confirmed: false } },
    })
  ).status === 400,
  "unconfirmed OCR field cannot be submitted",
);
check(
  (await call({ ...transcript, sha256: "b".repeat(64) })).status === 409,
  "stale scan fingerprint refused",
);
const confirmed = await call(transcript);
check(
  confirmed.status === 200 && confirmed.data.result.workflow === "review",
  "one confirmed scan cannot clear unreadable counterpart",
);
check(
  confirmed.data.audit.some((e) => e.action === "SCAN_TRANSCRIPTION_CONFIRMED"),
  "scan confirmation has an audit record",
);
const scanRerun = await processIds(["email_512"], false);
check(
  scanRerun.data.results[0].documents[0].transcription?.actor ===
    "QA synthetic test",
  "confirmed scan transcript survives source-identical reprocess",
);
const quotaSession = await session();
for (let i = 0; i < 29; i++) {
  const fd = new FormData();
  fd.set("subject", "Operations update");
  fd.set("body", "Office closure for the holiday");
  assert.equal((await upload(fd, quotaSession)).status, 200);
}
const quotaForm = () => {
  const fd = new FormData();
  fd.set("subject", "Operations update");
  fd.set("body", "Office closure for the holiday");
  return fd;
};
const quotaRace = await Promise.all([
  upload(quotaForm(), quotaSession),
  upload(quotaForm(), quotaSession),
]);
check(
  quotaRace
    .map((x) => x.status)
    .sort()
    .join() === "200,429",
  "30-case upload quota is atomic under concurrency",
);
check(
  (await request("/api/inbox", undefined, quotaSession)).data.cases.filter(
    (c) => c.email.email_id.startsWith("upload_"),
  ).length === 30,
  "concurrent uploads cannot exceed quota",
);
latencies.sort((a, b) => a - b);
const report = {
  passed: true,
  checks: checks.length,
  journeys: checks,
  requests: latencies.length,
  duration_ms: Math.round(performance.now() - started),
  median_request_ms: Math.round(latencies[Math.floor(latencies.length / 2)]),
  p95_request_ms: Math.round(latencies[Math.ceil(latencies.length * 0.95) - 1]),
  origin,
  generated_at: new Date().toISOString(),
  scope:
    "Synthetic isolated-workspace HTTP hardening checks against the supplied origin; not production load certification",
};
await fs.mkdir("work/validation", { recursive: true });
await fs.writeFile(
  `work/validation/${new URL(origin).hostname === "127.0.0.1" ? "local" : "hosted"}-hardening-api.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
