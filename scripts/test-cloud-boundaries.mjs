import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:3000").origin;
const verifyOnly = process.argv.includes("--verify");
const folder = "work/validation/v3/cloud";
const bookmark = `${folder}/private-restart-probe.json`;
const checks = [], durations = [];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const check = (value, label) => { assert.ok(value, label); checks.push(label); };
async function request(route, cookie, body) {
  const start = performance.now();
  const response = await fetch(origin + route, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? body instanceof FormData ? body : JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  durations.push(Math.round(performance.now() - start));
  return { response, bytes, json: () => JSON.parse(bytes.toString("utf8")) };
}
async function session() {
  const r = await request("/api/inbox");
  assert.equal(r.response.status, 200, "Workspace creation must succeed");
  const cookie = r.response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "Workspace cookie must be present");
  return cookie;
}
await fs.mkdir(folder, { recursive: true });
let state;
if (verifyOnly) {
  state = JSON.parse(await fs.readFile(bookmark, "utf8"));
  assert.equal(state.origin, origin, "Do not send a saved QA cookie to a different host");
} else {
  const cookie = await session();
  const size = 5 * 1024 * 1024;
  const sources = ["SHIPPING INSTRUCTION", "DRAFT BILL OF LADING"].map((title) => {
    const bytes = Buffer.alloc(size, 32);
    bytes.write(`${title}\nShipper: ALPHA\nConsignee: BETA\nNotify Party: SAME AS CONSIGNEE\nPort of Loading: SINGAPORE\nPort of Discharge: PORT KLANG\nContainer Count: 2\nGross Weight (KG): 1000\n`);
    return bytes;
  });
  const form = new FormData();
  form.set("subject", "Compare SI and draft BL — maximum-size synthetic QA");
  form.set("body", "Please compare the SI and draft BL. Synthetic deployment test.");
  sources.forEach((bytes, index) => form.append("files", new File([bytes], `${index ? "bl" : "si"}-boundary.txt`, { type: "text/plain" })));
  const upload = await request("/api/upload", cookie, form);
  check(upload.response.status === 200, "Two 5 MiB files can be uploaded in one request");
  const result = upload.json().result;
  check(result.status === "NEEDS_REVIEW", "The extracted-text safety limit does not create a false clearance");
  const id = result.email.email_id;
  const preview = await request("/api/policies", cookie, { action: "preview", rules: { weightToleranceKg: 10, weightTolerancePercent: 0 } });
  assert.equal(preview.response.status, 200);
  const activated = await request("/api/policies", cookie, { action: "activate", token: preview.json().token, actor: "Deployment QA", reason: "Synthetic persistence check across restart; not a business approval" });
  assert.equal(activated.response.status, 200);
  const current = await request(`/api/cases?id=${encodeURIComponent(id)}`, cookie);
  const policy = await request("/api/policies", cookie);
  state = {
    origin, cookie, id, version: result.version,
    resultHash: hash(Buffer.from(JSON.stringify(current.json().result))),
    policyHash: hash(Buffer.from(JSON.stringify(policy.json().policy))),
    sources: result.documents.map((doc, i) => ({ name: doc.name, hash: hash(sources[i]), size })),
  };
  const oversized = new FormData();
  oversized.set("subject", "Compare documents"); oversized.set("body", "Please compare the SI and BL.");
  oversized.append("files", new File([Buffer.alloc(size + 1, 32)], "oversized.txt"));
  const rejected = await request("/api/upload", cookie, oversized);
  check([400, 413].includes(rejected.response.status), "A file over 5 MiB is rejected");
  // This contains a synthetic workspace cookie. It stays in ignored work/, never Git or console.
  await fs.writeFile(bookmark, JSON.stringify(state, null, 2), { flag: "wx" });
}
const current = await request(`/api/cases?id=${encodeURIComponent(state.id)}`, state.cookie);
check(current.response.status === 200 && hash(Buffer.from(JSON.stringify(current.json().result))) === state.resultHash, "Saved case is unchanged");
const history = await request(`/api/cases?id=${encodeURIComponent(state.id)}&revision=${state.version}`, state.cookie);
check(history.response.status === 200, "Historical revision remains available");
const policy = await request("/api/policies", state.cookie);
check(policy.response.status === 200 && hash(Buffer.from(JSON.stringify(policy.json().policy))) === state.policyHash, "Saved policy is unchanged");
const outsider = await session();
for (const source of state.sources) {
  const route = `/api/document?id=${encodeURIComponent(state.id)}&name=${encodeURIComponent(source.name)}&revision=${state.version}`;
  const bytes = await request(route, state.cookie);
  check(bytes.response.status === 200 && bytes.bytes.length === source.size && hash(bytes.bytes) === source.hash, `Exact 5 MiB source survives: ${source.name}`);
  check((await request(route, outsider)).response.status === 404, `Other workspace cannot read source: ${source.name}`);
}
const sorted = [...durations].sort((a, b) => a - b);
const report = { origin, generated_at: new Date().toISOString(), mode: verifyOnly ? "persistence-recheck" : "initial-boundary-check", passed: true, checks, requests: durations.length, p95_request_ms: sorted[Math.ceil(sorted.length * .95) - 1], limitation: "Synthetic low-volume boundary test, not sustained production capacity or an uptime guarantee. Only a recheck actually performed after restart/idle is evidence for that event." };
await fs.writeFile(`${folder}/${verifyOnly ? "persistence-recheck" : "boundaries"}-${Date.now()}.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
