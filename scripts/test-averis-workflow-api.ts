import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { CaseResult, CaseSummary } from "../lib/types";
import type { FollowUp } from "../lib/follow-up";

// Run against an already-started, isolated local demo server. No external
// accounts, AI, outbound email, owner cookies, or source-file edits are used.
const target = new URL(process.argv[2] ?? "http://127.0.0.1:3066");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
    ["http:", "https:"].includes(target.protocol) &&
    !target.username &&
    !target.password &&
    target.pathname === "/" &&
    !target.search &&
    !target.hash,
  "Use a local HTTP(S) origin with no credentials, path, query or fragment.",
);
const origin = target.origin;
const actor = "Synthetic Averis workflow reviewer";
const checks: string[] = [];
let requests = 0;
let cookie = "";
const started = Date.now();
function check(condition: unknown, label: string): asserts condition {
  assert.ok(condition, label);
  checks.push(label);
}
async function raw(path: string, body?: object | FormData, session = cookie) {
  assert.ok(++requests <= 45, "At most 45 local HTTP requests are permitted");
  const multipart = body instanceof FormData;
  return fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      ...(session ? { Cookie: session } : {}),
      ...(body !== undefined && !multipart
        ? { "Content-Type": "application/json" }
        : {}),
    },
    ...(body !== undefined
      ? { body: multipart ? body : JSON.stringify(body) }
      : {}),
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
}
async function json<T>(
  path: string,
  body?: object | FormData,
  expected = 200,
  session = cookie,
): Promise<T> {
  const response = await raw(path, body, session);
  const data = await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data as T;
}
function source(role: "SI" | "BL", weight = 42000) {
  return [
    role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
    "Shipper: ALPHA LTD",
    "Consignee: BETA LTD",
    "Notify Party: SAME AS CONSIGNEE",
    "Port of Loading: SINGAPORE",
    "Port of Discharge: ROTTERDAM",
    "Container Count: 2",
    `Gross Weight: ${weight} KG`,
  ];
}
function pdf(lines: string[]) {
  const content = lines
    .map(
      (text, index) =>
        `BT /F1 10 Tf 1 0 0 1 40 ${800 - index * 28} Tm (${text.replace(/[\\()]/g, "\\$&")}) Tj ET`,
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 800 850] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
const siBytes = pdf(source("SI"));
const wrongBlBytes = pdf(source("BL", 43000));
const revisedBlBytes = pdf(source("BL"));
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function intake(
  options: {
    weight?: number;
    extra?: boolean;
    subject?: string;
    body?: string;
    invoiceNames?: boolean;
    importKey?: string;
  } = {},
) {
  const form = new FormData();
  form.set("from", "synthetic-averis@example.test");
  form.set("subject", options.subject ?? "Synthetic workflow — check draft BL");
  form.set(
    "body",
    options.body ??
      "Please compare the attached SI and draft BL and report discrepancies.",
  );
  if (options.importKey) form.set("import_key", options.importKey);
  form.append(
    "files",
    new File(
      [siBytes.slice().buffer],
      options.invoiceNames ? "invoice-one.pdf" : "si.pdf",
      { type: "application/pdf" },
    ),
  );
  form.append(
    "files",
    new File(
      [pdf(source("BL", options.weight ?? 42000)).slice().buffer],
      options.invoiceNames ? "invoice-two.pdf" : "bl.pdf",
      { type: "application/pdf" },
    ),
  );
  if (options.extra)
    form.append(
      "files",
      new File(["COMMERCIAL INVOICE\nInvoice: SYNTHETIC-ONLY"], "invoice.txt", {
        type: "text/plain",
      }),
    );
  return form;
}
async function upload(form: FormData) {
  return (await json<{ result: CaseResult }>("/api/upload", form)).result;
}
async function action(result: CaseResult, fields: Record<string, unknown>) {
  return (
    await json<{ result: CaseResult }>("/api/cases", {
      id: result.email.email_id,
      version: result.version,
      actor,
      reason: "Checked the synthetic original source and intended workflow",
      ...fields,
    })
  ).result;
}
async function original(
  result: CaseResult,
  name: string,
  revision = result.version,
) {
  const response = await raw(
    `/api/document?${new URLSearchParams({ id: result.email.email_id, name, revision: String(revision) })}`,
  );
  assert.equal(response.status, 200, "Original document download succeeds");
  return new Uint8Array(await response.arrayBuffer());
}
function followup(
  result: CaseResult,
  version: number,
  state: FollowUp["state"],
  due: string | null,
) {
  return {
    id: result.email.email_id,
    case_version: result.version,
    version,
    owner: "Synthetic assigned operator",
    shipment_reference: "SYNTHETIC-WORKFLOW",
    due_at: due,
    state,
    actor,
    note: "Synthetic document check only; no cargo-release approval",
  };
}

try {
  const mode = await json<{ mode: string }>("/api/auth");
  assert.equal(
    mode.mode,
    "demo",
    "Use an isolated demo-mode server, not an employee account",
  );
  const session = await raw("/api/inbox", undefined, "");
  assert.equal(session.status, 200);
  cookie = session.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.ok(
    cookie.startsWith("cargo_workspace="),
    "Server must mint a fresh demo workspace cookie",
  );
  await session.arrayBuffer();

  let result = await upload(intake({ weight: 43000 }));
  check(
    result.status === "MISMATCH",
    "Original SI/BL weight discrepancy is detected",
  );
  const initial = structuredClone(result);
  const si = result.documents.find((doc) => doc.type === "SI")!;
  const bl = result.documents.find((doc) => doc.type === "BL")!;
  assert.ok(si?.sha256 && bl?.sha256);
  const originalSi = await original(result, si.name);
  const originalBl = await original(result, bl.name);
  check(
    hash(originalSi) === si.sha256 &&
      hash(originalBl) === bl.sha256 &&
      hash(originalBl) === hash(wrongBlBytes),
    "Downloaded PDF bytes match their recorded source fingerprints",
  );

  result = await action(result, {
    action: "review",
    field: "gross_weight_kg",
    side: "bl",
    value: "42000 KG",
  });
  check(
    result.status === "NEEDS_REVIEW" &&
      result.comparison[6].bl.correction?.state === "unresolved",
    "Copying SI weight into a genuinely different BL cannot turn the check green",
  );
  check(
    hash(await original(result, bl.name)) === hash(originalBl),
    "Unsupported reading correction leaves the original PDF byte-for-byte unchanged",
  );
  result = await action(result, {
    action: "review",
    field: "gross_weight_kg",
    side: "si",
    value: "42 MT",
  });
  check(
    result.comparison[6].si.correction?.state === "confirmed",
    "Equivalent SI reading is bound to actual source evidence",
  );
  result = await action(result, {
    action: "select_documents",
    si: si.name,
    bl: bl.name,
  });
  check(
    result.status === "NEEDS_REVIEW" &&
      result.retained_corrections?.length === 2 &&
      result.comparison[6].bl.correction?.state === "unresolved",
    "First explicit pair selection retains both source-bound corrections",
  );
  await json("/api/follow-ups", followup(result, 0, "completed", null), 409);
  check(
    true,
    "Unresolved correction is rejected by the actual completion endpoint",
  );

  const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  let recorded = (
    await json<{ followup: FollowUp }>(
      "/api/follow-ups",
      followup(result, 0, "open", due),
    )
  ).followup;
  await json(
    "/api/follow-ups",
    followup(result, recorded.version, "waiting", due),
    409,
  );
  check(true, "Waiting without a confirmed sent request is rejected");
  recorded = (
    await json<{ followup: FollowUp }>("/api/follow-ups", {
      ...followup(result, recorded.version, "waiting", due),
      request_confirmed: true,
      note: "Confirmed synthetic request already sent outside CargoGuard; no message is sent by this test",
    })
  ).followup;
  const savedFollowup = (
    await json<{ followups: FollowUp[] }>("/api/follow-ups")
  ).followups.find((entry) => entry.email_id === result.email.email_id);
  check(
    savedFollowup?.state === "waiting" &&
      savedFollowup.due_at === due &&
      savedFollowup.owner === "Synthetic assigned operator" &&
      savedFollowup.request?.channel === "external" &&
      savedFollowup.request.case_version === result.version,
    "Confirmed request, assigned owner and existing deadline persist with Waiting",
  );

  const replacement = new FormData();
  for (const [key, value] of Object.entries({
    mode: "replace_bl",
    id: result.email.email_id,
    version: String(result.version),
    actor,
    reason: "Issuer supplied the revised synthetic draft BL",
  }))
    replacement.set(key, value);
  replacement.set(
    "bl",
    new File([revisedBlBytes.slice().buffer], "issuer-revised-bl.pdf", {
      type: "application/pdf",
    }),
  );
  result = await upload(replacement);
  check(
    result.status === "OK" &&
      result.workflow === "verified" &&
      result.comparison[6].si.raw === "42 MT" &&
      result.comparison[6].si.correction?.state === "confirmed" &&
      !result.comparison[6].bl.correction &&
      result.retained_corrections?.every((entry) => entry.side === "si"),
    "Issuer BL replacement drops only changed-source edits and retains the unchanged SI correction",
  );
  const revisedBl = result.documents.find((doc) => doc.type === "BL")!;
  check(
    revisedBl.name !== bl.name &&
      revisedBl.sha256 !== bl.sha256 &&
      result.documents.find((doc) => doc.type === "SI")?.sha256 === si.sha256,
    "Replacement has a new immutable source identity while SI fingerprint is unchanged",
  );
  check(
    hash(await original(initial, bl.name)) === hash(originalBl) &&
      hash(await original(result, revisedBl.name)) === hash(revisedBlBytes),
    "Original historical PDF and revised issuer PDF are independently downloadable",
  );
  recorded = (
    await json<{ followup: FollowUp }>(
      "/api/follow-ups",
      followup(result, recorded.version, "completed", due),
    )
  ).followup;
  check(
    recorded.state === "completed" && recorded.case_version === result.version,
    "Only the source-corrected current document revision can complete",
  );

  const extra = await upload(intake({ extra: true }));
  check(
    extra.status === "OK" &&
      extra.documents.length === 3 &&
      !extra.document_selection,
    "Unique matching SI/BL pair is recognized alongside a retained unrelated invoice",
  );
  const extraDone = (
    await json<{ followup: FollowUp }>(
      "/api/follow-ups",
      followup(extra, 0, "completed", null),
    )
  ).followup;
  check(
    extraDone.state === "completed",
    "Unrelated recognized invoice does not prevent completing the verified pair",
  );

  for (const route of ["invoice", "spam"] as const) {
    let deferred = await upload(
      intake({
        invoiceNames: true,
        subject:
          route === "invoice"
            ? "Invoice INV-001 payment status"
            : "Urgent mailbox verification",
        body:
          route === "invoice"
            ? "Please send the payment status for invoice INV-001."
            : "Your mailbox is full and will be disabled. Enter your password at the verification page immediately.",
      }),
    );
    check(
      deferred.category === (route === "invoice" ? "INVOICE_QUERY" : "SPAM") &&
        deferred.documents.every(
          (doc) => doc.deferred && !doc.sha256 && !doc.lines.length,
        ),
      `${route} intake retains attachments without parsing or pretending to verify them`,
    );
    deferred = await action(deferred, {
      action: "route",
      category: "BL_COMPARISON",
    });
    check(
      deferred.status === "OK" &&
        deferred.category_override === "BL_COMPARISON" &&
        deferred.documents.every(
          (doc) => !doc.deferred && !!doc.sha256 && doc.lines.length > 0,
        ),
      `${route} changed to BL comparison reparses stored originals through the real API`,
    );
    const parsedSi = deferred.documents.find((doc) => doc.type === "SI")!;
    check(
      hash(await original(deferred, parsedSi.name)) === hash(siBytes),
      `${route} deferral and rerouting preserve original bytes`,
    );
  }

  const importKey = `synthetic-workflow:${crypto.randomUUID()}`;
  const firstImport = await upload(intake({ importKey }));
  const retry = await json<{ result: CaseResult; duplicate?: boolean }>(
    "/api/upload",
    intake({
      importKey,
      weight: 99000,
      subject: "Different retry envelope for the same provider identity",
    }),
  );
  check(
    retry.duplicate === true &&
      retry.result.email.email_id === firstImport.email.email_id &&
      retry.result.version === firstImport.version &&
      retry.result.documents[1].sha256 === firstImport.documents[1].sha256,
    "Import-key retry returns the original case despite different retry content",
  );
  const summaries = await json<{ cases: CaseSummary[] }>("/api/inbox");
  check(
    summaries.cases.filter(
      (item) => item.email.email_id === firstImport.email.email_id,
    ).length === 1,
    "Idempotent intake produces one case in the workspace",
  );
  const mainSummary = summaries.cases.find(
    (item) => item.email.email_id === result.email.email_id,
  );
  check(
    !!mainSummary?.result &&
      !Object.hasOwn(mainSummary.result, "retained_corrections") &&
      !Object.hasOwn(mainSummary.result, "documents"),
    "Inbox summaries omit private correction snapshots and source text",
  );

  console.log(
    JSON.stringify(
      {
        passed: true,
        origin,
        assertions: checks.length,
        requests,
        duration_ms: Date.now() - started,
        scope:
          "Isolated synthetic demo workspace; original sources preserved; no external calls or outgoing messages",
        checks,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        passed: false,
        origin,
        assertions_passed: checks.length,
        requests,
        error: error instanceof Error ? error.message : String(error),
        checks,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
