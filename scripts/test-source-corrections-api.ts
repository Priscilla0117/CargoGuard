import assert from "node:assert/strict";
import type { CaseResult, CaseSummary } from "../lib/types";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:5187").origin;
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
  throw new Error("Use an isolated local QA server for mutation tests.");
const initial = await fetch(`${origin}/api/inbox`);
assert.equal(initial.status, 200);
const cookie = initial.headers.get("set-cookie")!.split(";")[0];
async function request(path: string, body?: FormData | object) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  const data = (await response.json()) as {
    result: CaseResult;
    cases: CaseSummary[];
    results: CaseResult[];
    errors: unknown[];
    error?: string;
  };
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(data)}`);
  return data;
}
const source = (role: string) =>
  `${role}\nShipper: EXPORT LTD\nConsignee: IMPORT LTD\nNotify Party: SAME AS CONSIGNEE\nPort of Loading: PORT KLANG\nPort of Discharge: SINGAPORE\nContainer Count: 2\nGross Weight: 42000 KG`;
const intake = new FormData();
intake.set("from", "qa@example.test");
intake.set("subject", "Please compare SI and draft BL");
intake.set("body", "Compare all shipment fields against the SI.");
intake.append("files", new File([source("SHIPPING INSTRUCTION")], "si.txt"));
intake.append("files", new File([source("BILL OF LADING")], "bl.txt"));
let result = (await request("/api/upload", intake)).result;
assert.equal(result.status, "OK");
const originalSI = result.documents.find((d) => d.type === "SI")!;
const originalBL = result.documents.find((d) => d.type === "BL")!;
result = (
  await request("/api/cases", {
    action: "review",
    id: result.email.email_id,
    version: result.version,
    actor: "Synthetic reviewer",
    reason: "Independent source review found a different SI weight",
    field: "gross_weight_kg",
    side: "si",
    value: "42500 KG",
  })
).result;
assert.equal(result.status, "MISMATCH");
const correctionVersion = result.version;
const added = new FormData();
for (const [key, value] of Object.entries({
  id: result.email.email_id,
  version: String(result.version),
  actor: "Synthetic reviewer",
  reason: "Additional draft supplied for review",
  mode: "append",
}))
  added.set(key, value);
added.append("files", new File([source("BILL OF LADING")], "other-bl.txt"));
result = (await request("/api/upload", added)).result;
assert.equal(result.status, "NEEDS_REVIEW");
assert.equal(result.comparison.length, 0);
assert.equal(result.retained_corrections?.length, 1);
result = (await request(`/api/cases?id=${result.email.email_id}`)).result;
assert.equal(result.retained_corrections?.[0].sha256, originalSI.sha256);
const summary = (await request("/api/inbox")).cases.find(
  (c) => c.email.email_id === result.email.email_id,
)!;
assert.equal(Object.hasOwn(summary.result!, "retained_corrections"), false);
result = (
  await request("/api/cases", {
    action: "select_documents",
    id: result.email.email_id,
    version: result.version,
    actor: "Synthetic reviewer",
    reason: "Retain the original source pair after inspecting the added draft",
    si: originalSI.name,
    bl: originalBL.name,
  })
).result;
assert.equal(result.status, "MISMATCH");
assert.equal(
  result.comparison.find((r) => r.field === "gross_weight_kg")?.si.normalized,
  42500,
);
assert.match(result.summary, /other attachment is retained but not verified/);
const historical = (
  await request(
    `/api/cases?id=${result.email.email_id}&revision=${correctionVersion}`,
  )
).result;
assert.equal(
  historical.comparison.find((r) => r.field === "gross_weight_kg")?.si
    .normalized,
  42500,
);
const reset = await request("/api/cases", {
  action: "process",
  ids: [result.email.email_id],
  skipSaved: false,
});
assert.deepEqual(reset.errors, []);
assert.equal(reset.results[0].status, "OK");
assert.equal(reset.results[0].retained_corrections, undefined);
assert.equal(
  reset.results[0].comparison.find((r) => r.field === "gross_weight_kg")?.si
    .normalized,
  42000,
);
console.log(
  "Source-correction API regression passed: append → persisted review → select original pair retains mismatch; summary privacy, historical evidence, and explicit reset verified.",
);
