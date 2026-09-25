import assert from "node:assert/strict";
import fs from "node:fs/promises";
const origin = process.argv[2] ?? "http://127.0.0.1:3000",
  checks = [];
const check = (value, name) => {
  assert.ok(value, name);
  checks.push(name);
};
async function session() {
  const r = await fetch(origin + "/api/inbox", {
    signal: AbortSignal.timeout(90000),
  });
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
}
const cookie = await session(),
  other = await session();
async function call(path, body, ws = cookie) {
  const multipart = body instanceof FormData;
  const r = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: ws,
      Origin: origin,
      ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  return { status: r.status, data: await r.json() };
}
function form(weight = "1010") {
  const f = new FormData();
  f.set("subject", "Compare SI and draft BL");
  f.set("body", "Please verify the SI and draft BL.");
  const base =
    "Shipper: ALPHA\nConsignee: BETA\nNotify Party: SAME AS CONSIGNEE\nPort of Loading: SINGAPORE (SGSIN)\nPort of Discharge: PORT KLANG\nContainer Count: 2 x 20GP\nGross Weight (KG): ";
  f.append(
    "files",
    new File(["SHIPPING INSTRUCTION\n" + base + "1000"], "si.txt"),
  );
  f.append(
    "files",
    new File(["DRAFT BILL OF LADING\n" + base + weight], "bl.txt"),
  );
  return f;
}
const upload = await call("/api/upload", form());
check(upload.status === 200, "new document workflow succeeds");
let current = upload.data.result;
const id = current.email.email_id,
  originalName = current.documents[0].name;
const initial = await call(`/api/cases?id=${id}`);
check(
  initial.data.revisions.length === 1 &&
    initial.data.revisions[0].origin === "automatic",
  "initial immutable automatic snapshot",
);
const rules = { weightToleranceKg: 20, weightTolerancePercent: 0 };
let preview = await call("/api/policies", { action: "preview", rules });
check(
  preview.status === 200 && preview.data.impact[0].covered,
  "policy preview calculates exception",
);
check(
  (await call("/api/policies")).data.policy.version === 0,
  "preview does not activate",
);
check(
  (
    await call(
      "/api/policies",
      {
        action: "activate",
        token: preview.data.token,
        actor: "Tester",
        reason: "Cross workspace attempt",
      },
      other,
    )
  ).status === 409,
  "preview token isolated by workspace",
);
const edit = {
  action: "review",
  id,
  version: current.version,
  field: "gross_weight_kg",
  side: "bl",
  value: "1008",
  actor: "Tester",
  reason: "Test unsupported typed weight; original BL still states 1010 KG",
};
const edited = await call("/api/cases", edit);
check(
  edited.status === 200,
  "unsupported human reading is saved for source review",
);
current = edited.data.result;
const editedWeight = current.comparison.find(
  (row) => row.field === "gross_weight_kg",
);
const originalWeightSource = initial.data.result.documents.find(
  (doc) => doc.name === editedWeight.bl.source,
);
check(
  current.status === "NEEDS_REVIEW" &&
    current.workflow === "review" &&
    editedWeight.result === "uncertain" &&
    editedWeight.bl.raw === "1008" &&
    editedWeight.bl.normalized === null &&
    editedWeight.bl.correction?.state === "unresolved" &&
    editedWeight.bl.correction.source_sha256 === originalWeightSource.sha256 &&
    !!editedWeight.bl.extraction_issue &&
    current.policy_assessment.covered === false,
  "unsupported weight stays source-bound and unresolved, with no policy coverage",
);
assert.deepEqual(current.documents, initial.data.result.documents);
check(
  (
    await call("/api/policies", {
      action: "activate",
      token: preview.data.token,
      actor: "Tester",
      reason: "Stale preview attempt",
    })
  ).status === 409,
  "case change invalidates policy preview atomically",
);
check(
  (await call("/api/cases", edit)).status === 409,
  "stale edit cannot create a revision",
);
preview = await call("/api/policies", { action: "preview", rules });
check(
  preview.status === 200 &&
    preview.data.impact[0].strictStatus === "NEEDS_REVIEW" &&
    preview.data.impact[0].covered === false &&
    preview.data.impact[0].differenceKg === null,
  "policy preview cannot assign tolerance to an unresolved typed weight",
);
const activation = {
  action: "activate",
  token: preview.data.token,
  actor: "Tester",
  reason: "Recorded weight tolerance for this test",
};
const race = await Promise.all([
  call("/api/policies", activation),
  call("/api/policies", activation),
]);
check(
  race
    .map((r) => r.status)
    .sort()
    .join() === "200,409",
  "concurrent policy activation commits once",
);
check(
  (await call(`/api/cases?id=${id}`)).data.result.policy.version === 0,
  "activation does not rewrite existing result policy",
);
const pinned = await call("/api/cases", {
  action: "process",
  ids: [id],
  policyVersion: 0,
});
check(
  pinned.data.results[0].policy.version === 0,
  "processing uses pinned historical policy",
);
const processed = await call("/api/cases", { action: "process", ids: [id] });
current = processed.data.results[0];
check(
  current.policy.version === 1 &&
    current.policy_assessment.covered &&
    current.status === "MISMATCH",
  "active policy annotates but never hides strict mismatch",
);
const corrected = await call("/api/cases", {
  ...edit,
  version: current.version,
});
check(
  corrected.status === 200,
  "unsupported edit under active policy is saved for review",
);
current = corrected.data.result;
const policyEditedWeight = current.comparison.find(
  (row) => row.field === "gross_weight_kg",
);
check(
  current.policy.version === 1 &&
    current.status === "NEEDS_REVIEW" &&
    current.workflow === "review" &&
    current.policy_assessment.covered === false &&
    current.policy_assessment.differenceKg === null &&
    policyEditedWeight.result === "uncertain" &&
    policyEditedWeight.bl.normalized === null &&
    policyEditedWeight.bl.correction?.state === "unresolved" &&
    policyEditedWeight.bl.correction.source_sha256 ===
      originalWeightSource.sha256 &&
    !!policyEditedWeight.bl.extraction_issue,
  "human edit preserves policy but unsupported evidence cannot receive a tolerance exception",
);
assert.deepEqual(current.policy, processed.data.results[0].policy);
assert.deepEqual(current.documents, initial.data.result.documents);
const replacement = form("1000");
replacement.set("id", id);
replacement.set("version", String(current.version));
replacement.set("actor", "Tester");
replacement.set("reason", "New documents received and inspected");
const replaced = await call("/api/upload", replacement);
check(
  replaced.status === 200 &&
    replaced.data.result.source_replaced &&
    replaced.data.result.reviewed,
  "replacement records source intervention",
);
const historical = await call(`/api/cases?id=${id}&revision=1`);
assert.deepEqual(historical.data.result, initial.data.result);
check(
  historical.data.result.comparison[6].bl.raw === "1010 KG" &&
    historical.data.result.comparison[6].bl.normalized === 1010,
  "original full result survives corrections and replacement",
);
check(
  (await call(`/api/cases?id=${id}&revision=1`, undefined, other)).status ===
    404,
  "historical result isolated by workspace",
);
const sourceUrl =
  origin +
  `/api/document?id=${id}&revision=1&name=${encodeURIComponent(originalName)}`;
check(
  (await fetch(sourceUrl, { headers: { Cookie: cookie } })).status === 200,
  "historical original bytes still downloadable",
);
check(
  (await fetch(sourceUrl, { headers: { Cookie: other } })).status === 404,
  "historical source isolated by workspace",
);
const latest = await call(`/api/cases?id=${id}`);
check(
  latest.data.revisions.length === 6,
  "only successful case writes have snapshots",
);
const evidence = await call("/api/cases?export=1&mode=reviewed");
check(
  evidence.status === 200 &&
    evidence.data.format === "cargoguard-reviewed-evidence-v3" &&
    evidence.data.cases[0].reviewed,
  "reviewed export is explicitly labelled and supports partial workspaces",
);
check(
  (await call("/api/cases?export=1&mode=baseline")).status === 409,
  "partial baseline cannot masquerade as complete benchmark",
);
check(
  (
    await call("/api/policies", {
      action: "preview",
      rules: { weightToleranceKg: -1, weightTolerancePercent: 0 },
    })
  ).status === 400,
  "unsafe policy values rejected",
);
check(
  (
    await call("/api/cases", {
      action: "process",
      ids: [id],
      policyVersion: 999,
    })
  ).status === 404,
  "unknown policy pin rejected",
);
const report = {
  passed: true,
  checks: checks.length,
  journeys: checks,
  origin,
  generated_at: new Date().toISOString(),
  scope:
    "Governance HTTP integration; synthetic isolated workspaces. Does not certify remote cloud persistence.",
};
await fs.mkdir("work/validation/v3", { recursive: true });
await fs.writeFile(
  "work/validation/v3/governance-api.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
