import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { revisionDiff, revisionSourceUrl } from "../lib/revision-diff";
import type { CaseResult } from "../lib/types";

const target = new URL(process.argv[2] ?? "http://127.0.0.1:3053");
assert.ok(
  ["https:", "http:"].includes(target.protocol) &&
    !target.username &&
    !target.password &&
    target.pathname === "/" &&
    !target.search &&
    !target.hash,
);
const origin = target.origin;
const checks: string[] = [];
const check = (condition: unknown, label: string) => {
  assert.ok(condition, label);
  checks.push(label);
};
async function session() {
  const r = await fetch(origin + "/api/inbox", {
    signal: AbortSignal.timeout(90000),
  });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}
const owner = await session(),
  other = await session();
async function request(path: string, body?: object | FormData, cookie = owner) {
  const multipart = body instanceof FormData;
  return fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90000),
  });
}
async function call(path: string, body?: object | FormData) {
  const response = await request(path, body);
  assert.equal(response.status, 200);
  return (await response.json()) as {
    result: CaseResult;
    revisions: unknown[];
  };
}
function sources(count: string, weight: string, port = "Singapore") {
  const form = new FormData();
  form.set("subject", "Synthetic revision acceptance: verify draft BL");
  form.set(
    "body",
    "Please compare the attached shipping instruction and draft bill of lading.",
  );
  const base = (c: string, w: string, p: string) =>
    `Shipper: Atlas Export\nConsignee: Buyer Two\nNotify party: SAME AS CONSIGNEE\nPort of loading: Port Klang\nPort of discharge: ${p}\nContainer count: ${c}\nGross weight (KG): ${w}`;
  form.append(
    "files",
    new File(
      [`SHIPPING INSTRUCTION\n${base("2", "42000", "Singapore")}`],
      "revision-si.txt",
    ),
  );
  form.append(
    "files",
    new File(
      [`DRAFT BILL OF LADING\n${base(count, weight, port)}`],
      "revision-bl.txt",
    ),
  );
  return form;
}
const first: CaseResult = (await call("/api/upload", sources("4", "unknown")))
  .result;
const id = encodeURIComponent(first.email.email_id);
check(
  first.version === 1 && first.status === "NEEDS_REVIEW",
  "initial synthetic case retains known difference and missing-weight blocker",
);
async function replace(
  previous: CaseResult,
  form: FormData,
): Promise<CaseResult> {
  form.set("id", previous.email.email_id);
  form.set("version", String(previous.version));
  form.set("actor", "Revision QA");
  form.set(
    "reason",
    "Synthetic issuer correction for revision comparison acceptance",
  );
  return (await call("/api/upload", form)).result;
}
const second = await replace(first, sources("2", "unknown", "Hamburg"));
const before: CaseResult = (await call(`/api/cases?id=${id}&revision=1`))
  .result;
const after: CaseResult = (
  await call(`/api/cases?id=${id}&revision=${second.version}`)
).result;
check(
  before.comparison.find((r) => r.field === "container_count")?.bl
    .normalized === 4,
  "earlier result remains immutable after replacement",
);
const diff = revisionDiff(before, after);
check(
  diff.counts.fixed === 1,
  "saved replacement shows container issue now matches",
);
check(
  diff.counts.new_issue === 1,
  "saved replacement flags newly changed discharge port",
);
check(
  diff.counts.unresolved === 1 && diff.remaining === 2,
  "missing weight stays unresolved alongside new issue",
);
check(
  after.status === "NEEDS_REVIEW",
  "partial correction does not silently clear the case",
);
const oldBl = before.documents.find((d) => d.type === "BL")!,
  newBl = after.documents.find((d) => d.type === "BL")!;
const oldUrl = revisionSourceUrl(before, oldBl.name)!,
  newUrl = revisionSourceUrl(after, newBl.name)!;
const oldResponse = await request(oldUrl),
  newResponse = await request(newUrl);
const oldBytes = await oldResponse.text(),
  newBytes = await newResponse.text();
check(
  oldResponse.status === 200 &&
    oldBytes.includes("Container count: 4") &&
    oldBytes.includes("Singapore"),
  "before link returns original BL bytes",
);
check(
  newResponse.status === 200 &&
    newBytes.includes("Container count: 2") &&
    newBytes.includes("Hamburg"),
  "after link returns replacement BL bytes",
);
check(
  oldBl.sha256 !== newBl.sha256,
  "replacement fingerprint differs from original",
);
check(
  (await request(oldUrl, undefined, other)).status === 404,
  "historical source remains workspace isolated",
);
check(
  (await request(`/api/cases?id=${id}&revision=1`, undefined, other)).status ===
    404,
  "historical decision remains workspace isolated",
);
const third = await replace(second, sources("2", "42000"));
const diff3 = revisionDiff(second, third);
check(
  diff3.counts.fixed === 2 && diff3.remaining === 0 && third.status === "OK",
  "complete corrected sources resolve both remaining field issues",
);
const routed: CaseResult = (
  await call("/api/cases", {
    action: "route",
    id: third.email.email_id,
    version: third.version,
    category: "GENERAL",
    actor: "Revision QA",
    reason: "Synthetic category-change regression check",
  })
).result;
const routeDiff = revisionDiff(third, routed);
check(
  routeDiff.categoryChanged &&
    routeDiff.counts.not_compared === 7 &&
    routeDiff.counts.fixed === 0,
  "routing away shows removed comparison, not seven fixed fields",
);
const final = await call(`/api/cases?id=${id}`);
check(
  final.revisions.length === 4 && final.result.version === 4,
  "read-only comparisons and source reads create no extra revisions",
);
check(
  (await request(`/api/cases?id=${id}&revision=9999`)).status === 404,
  "missing snapshot fails explicitly",
);
const report = {
  passed: true,
  checks: checks.length,
  journeys: checks,
  origin,
  generated_at: new Date().toISOString(),
  provider_calls: 0,
  scope:
    "Synthetic isolated-workspace upload → replace → compare saved revisions → source isolation → route-change regression. No production accuracy claim.",
};
await fs.mkdir("work/validation/v3", { recursive: true });
await fs.writeFile(
  "work/validation/v3/revision-api.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
