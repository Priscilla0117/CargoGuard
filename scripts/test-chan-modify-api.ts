import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { CaseResult, CaseSummary } from "../lib/types";

const origin = new URL(process.argv[2] ?? "http://127.0.0.1:5187").origin;
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
  throw new Error("Use an isolated local QA server for these mutation tests.");
const initial = await fetch(`${origin}/api/inbox`);
assert.equal(initial.status, 200);
const cookie = initial.headers.get("set-cookie")!.split(";")[0];
const checks: string[] = [];
async function request(path: string, body?: FormData | object) {
  const r = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(body && !(body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: body
      ? body instanceof FormData
        ? body
        : JSON.stringify(body)
      : undefined,
    signal: AbortSignal.timeout(90000),
  });
  return {
    status: r.status,
    data: (await r.json()) as {
      result: CaseResult;
      cases: CaseSummary[];
      error?: string;
      enabled?: boolean;
    },
  };
}
function check(ok: unknown, message: string) {
  assert.ok(ok, message);
  checks.push(message);
}
const txt = (role: string, weight = 42000, shipper = "EXPORT LTD") =>
  `${role}\nShipper: ${shipper}\nConsignee: IMPORT LTD\nNotify Party: SAME AS CONSIGNEE\nPort of Loading: PORT KLANG\nPort of Discharge: SINGAPORE\nContainer Count: 2\nGross Weight: ${weight} KG`;
function upload(shipper = "EXPORT LTD") {
  const f = new FormData();
  f.set("from", "qa@example.test");
  f.set("subject", "Please compare SI and draft BL");
  f.set("body", "Check all shipment fields against the SI.");
  f.append(
    "files",
    new File([txt("SHIPPING INSTRUCTION", 42000, shipper)], "si.txt"),
  );
  f.append(
    "files",
    new File([txt("BILL OF LADING", 43000, shipper)], "bl.txt"),
  );
  return f;
}
const intake = await request("/api/upload", upload());
check(
  intake.status === 200 && intake.data.result.status === "MISMATCH",
  "initial two-file comparison retains real discrepancy",
);
const before: CaseResult = intake.data.result;
check(
  !!before.email.imported_at && !before.email.received_at,
  "manual intake records import time without inventing reception date",
);
function replace(version: number, hash = before.documents[1].sha256!) {
  const f = new FormData();
  for (const [key, value] of Object.entries({
    id: before.email.email_id,
    version: String(version),
    actor: "QA Reviewer",
    reason: "Issuer returned a corrected BL",
    mode: "replace_one",
    targetName: before.documents[1].name,
    targetSha256: hash,
  }))
    f.set(key, value);
  f.append("files", new File([txt("BILL OF LADING")], "corrected-bl.txt"));
  return f;
}
const wrong = await request(
  "/api/upload",
  replace(before.version, "incorrect"),
);
check(wrong.status === 409, "replacement rejects stale source fingerprints");
const replacement = await request("/api/upload", replace(before.version));
check(
  replacement.status === 200,
  `single replacement succeeds: ${replacement.data.error ?? ""}`,
);
const after: CaseResult = replacement.data.result;
check(
  after.email.email_id === before.email.email_id &&
    after.version === before.version + 1,
  "replacement keeps case ID and appends revision",
);
check(
  after.status === "OK" &&
    after.documents[0].sha256 === before.documents[0].sha256,
  "only BL is replaced; SI retained and comparison rerun",
);
check(
  after.email.imported_at === before.email.imported_at,
  "replacement preserves first import time",
);
const historical = await fetch(
  `${origin}/api/document?id=${encodeURIComponent(before.email.email_id)}&name=${encodeURIComponent(before.documents[1].name)}&revision=${before.version}`,
  { headers: { Cookie: cookie } },
);
check(
  historical.status === 200 && (await historical.text()).includes("43000"),
  "original discrepant BL remains downloadable from history",
);
check(
  (await request("/api/upload", replace(before.version))).status === 409,
  "stale case replacement does not overwrite new revision",
);
const placeholders = await request("/api/upload", upload("TBA / TBC"));
check(
  placeholders.status === 200 &&
    placeholders.data.result.status !== "OK" &&
    placeholders.data.result.comparison.find(
      (r: { field: string }) => r.field === "shipper",
    )?.result === "uncertain",
  "compound placeholders remain uncertain through upload API",
);
const metadata = {
  id: before.email.email_id,
  version: 0,
  due_at: "2026-09-24T08:00:00Z",
  follow_up_at: "2026-09-24T09:00:00Z",
  priority: "urgent",
  actor: "QA Reviewer",
};
check((await request("/api/case-metadata", { ...metadata, due_at: "2026-09-24T08:00:00+99:99" })).status === 400,
  "invalid timezone offsets are rejected before schedule persistence");
check(
  (await request("/api/case-metadata", metadata)).status === 200,
  "schedule saved separately from verdict",
);
check(
  (await request("/api/case-metadata", metadata)).status === 409,
  "stale schedule rejected",
);
const inbox = await request("/api/inbox");
const scheduled = inbox.data.cases.find(
  (r: { email: { email_id: string } }) =>
    r.email.email_id === before.email.email_id,
);
check(
  scheduled?.scheduling?.priority === "urgent" &&
    scheduled.result?.version === after.version &&
    scheduled.result?.status === "OK",
  "priority appears in inbox without changing comparison revision",
);
const other = await fetch(`${origin}/api/case-metadata`);
check(
  !Object.keys(((await other.json()) as { metadata: object }).metadata).length,
  "scheduling isolated across workspaces",
);
const fixtureInbox = (await initial.json()) as { cases: CaseSummary[] };
const unrelated = fixtureInbox.cases.find((r: { email: { subject: string } }) =>
  /invoice/i.test(r.email.subject),
);
assert.ok(unrelated);
const deferred = new FormData();
deferred.set("from", "qa@example.test");
deferred.set("subject", "Invoice payment status");
deferred.set("body", "Please confirm the invoice payment status.");
deferred.append("files", new File(["not a PDF"], "invoice.pdf"));
const routed = await request("/api/upload", deferred);
check(
  routed.status === 200 &&
    routed.data.result.documents[0].deferred &&
    routed.data.result.workflow === "routed",
  "irrelevant upload is retained without invoking PDF parser",
);
const rerouted = await request("/api/cases", {
  action: "route",
  id: routed.data.result.email.email_id,
  version: routed.data.result.version,
  category: "BL_COMPARISON",
  actor: "QA Reviewer",
  reason: "Confirmed comparison is needed",
});
check(
  rerouted.status === 200 &&
    !rerouted.data.result.documents[0].deferred &&
    rerouted.data.result.status === "NEEDS_REVIEW",
  "manual rerouting inspects deferred originals and detects unreadable evidence",
);
const gmail = await request("/api/gmail");
check(
  gmail.status === 200 && !gmail.data.enabled,
  "Gmail reports unconfigured state without external requests",
);
await fs.mkdir("work/validation", { recursive: true });
await fs.writeFile(
  "work/validation/chan-modify-api.json",
  JSON.stringify(
    { generated_at: new Date().toISOString(), origin, checks },
    null,
    2,
  ),
);
console.log(`${checks.length} local API checks passed`);
