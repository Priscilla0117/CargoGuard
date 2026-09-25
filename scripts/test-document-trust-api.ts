import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { FIELDS, type CaseResult } from "../lib/types";

// Synthetic data in a fresh local demo workspace only. No outbound operations.
const target = new URL(process.argv[2] ?? "http://127.0.0.1:5200");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
    ["http:", "https:"].includes(target.protocol) &&
    !target.username &&
    !target.password &&
    target.pathname === "/" &&
    !target.search &&
    !target.hash,
);
const origin = target.origin;
let cookie = "";
let requests = 0;
const checks: string[] = [];
const record = (condition: unknown, label: string) => {
  assert.ok(condition, label);
  checks.push(label);
};
async function raw(path: string, body?: object | FormData) {
  assert.ok(++requests <= 25);
  const form = body instanceof FormData;
  return fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body && !form ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: form ? body : JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
}
async function json<T>(
  path: string,
  body?: object | FormData,
  status = 200,
): Promise<T> {
  const response = await raw(path, body);
  const data = await response.json();
  assert.equal(response.status, status, `${path}: ${JSON.stringify(data)}`);
  return data as T;
}
const values = [
  "ALPHA EXPORTS LTD",
  "BETA IMPORTS LTD",
  "SAME AS CONSIGNEE",
  "SINGAPORE",
  "PORT KLANG, MALAYSIA",
  "2 x 40HC",
  "42,000 KG",
];
const labels = [
  "Shipper",
  "Consignee",
  "Notify Party",
  "Port of Loading",
  "Port of Discharge",
  "Container Count",
  "Gross Weight",
];
const original = await readFile(
  new URL("../tests/fixtures/pdf-coverage/bl-mixed.pdf", import.meta.url),
);
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
assert.equal(
  (await json<{ mode: string }>("/api/auth")).mode,
  "demo",
  "Requires an isolated demo server",
);
const session = await raw("/api/inbox");
assert.equal(session.status, 200);
cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
assert.ok(cookie.startsWith("cargo_workspace="));
await session.arrayBuffer();
const form = new FormData();
form.set("from", "synthetic-document-trust@example.test");
form.set("subject", "Synthetic PDF amendment — compare SI and draft BL");
form.set(
  "body",
  "Please compare the attached shipping instruction and draft BL for discrepancies.",
);
form.append(
  "files",
  new File(
    [
      "SHIPPING INSTRUCTION\n" +
        values.map((value, i) => `${labels[i]}: ${value}`).join("\n"),
    ],
    "si.txt",
  ),
);
form.append(
  "files",
  new File([new Uint8Array(original).buffer], "bl-mixed.pdf", {
    type: "application/pdf",
  }),
);
const result = (await json<{ result: CaseResult }>("/api/upload", form)).result;
record(
  result.status === "NEEDS_REVIEW" && result.review_reason === "unreadable",
  "A scanned amendment blocks clearance despite matching readable fields",
);
record(
  result.comparison.length === 7 &&
    result.comparison.every((row) => row.result === "match"),
  "Readable page-one values remain available for review",
);
const bl = result.documents.find((doc) => doc.type === "BL")!;
assert.equal(bl.sha256, hash(original));
const action = {
  action: "transcribe",
  id: result.email.email_id,
  version: result.version,
  name: bl.name,
  sha256: bl.sha256,
  role: "BL",
  reviewed_pages: [2],
  actor: "Synthetic PDF reviewer",
  reason: "Inspected page 2 amendment: 43,000 KG supersedes the page 1 weight",
  fields: Object.fromEntries(
    FIELDS.map((field, index) => [
      field,
      {
        value: field === "gross_weight_kg" ? "43,000 KG" : values[index],
        page: field === "gross_weight_kg" ? 2 : 1,
        confirmed: true,
      },
    ]),
  ),
};
await json("/api/cases", { ...action, reviewed_pages: undefined }, 400);
await json("/api/cases", { ...action, reviewed_pages: [1] }, 422);
await json(
  "/api/cases",
  {
    ...action,
    fields: {
      ...action.fields,
      gross_weight_kg: { ...action.fields.gross_weight_kg, confirmed: false },
    },
  },
  400,
);
record(
  true,
  "Missing page inspection or field confirmation is rejected without saving",
);
await json(
  "/api/follow-ups",
  {
    id: result.email.email_id,
    case_version: result.version,
    version: 0,
    owner: "Synthetic reviewer",
    shipment_reference: "SYNTHETIC-PDF",
    due_at: null,
    state: "completed",
    actor: "Synthetic reviewer",
    note: "Attempt to complete unread PDF",
    integrity_confirmed: true,
  },
  409,
);
record(true, "Completion cannot bypass unresolved PDF content");
const saved = await json<{ result: CaseResult; audit: unknown[] }>(
  "/api/cases",
  action,
);
record(
  saved.result.status === "MISMATCH" &&
    JSON.stringify(saved.result.defect_fields) ===
      JSON.stringify(["gross_weight_kg"]),
  "Confirming the 43,000 KG amendment produces the weight mismatch",
);
const confirmed = saved.result.documents.find((doc) => doc.name === bl.name)!;
assert.deepEqual(confirmed.lines, bl.lines);
assert.deepEqual(confirmed.transcription?.reviewed_pages, [2]);
assert.equal(confirmed.transcription?.source_sha256, bl.sha256);
record(
  saved.audit.some(
    (event) =>
      JSON.stringify(event).includes("SCAN_TRANSCRIPTION_CONFIRMED") &&
      JSON.stringify(event).includes("43,000 KG"),
  ),
  "Audit retains the reviewer and amendment decision",
);
const download = await raw(
  `/api/document?${new URLSearchParams({
    id: result.email.email_id,
    name: bl.name,
    revision: String(saved.result.version),
  })}`,
);
assert.equal(download.status, 200);
record(
  hash(new Uint8Array(await download.arrayBuffer())) === hash(original),
  "The retained original PDF is byte-for-byte unchanged",
);
const old = await json<{ result: CaseResult }>(
  `/api/cases?${new URLSearchParams({
    id: result.email.email_id,
    revision: String(result.version),
  })}`,
);
record(
  old.result.status === "NEEDS_REVIEW" &&
    !old.result.documents[1].transcription,
  "History preserves the original unread-page decision",
);
console.log(JSON.stringify({ passed: true, checks, requests }, null, 2));
