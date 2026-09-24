// Synthetic, bounded HTTP acceptance. Never targets a hosted or team workspace.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import type { CaseResult } from "../lib/types";
import type { Shipment } from "../lib/shipments";

const target = new URL(process.argv[2] ?? "http://127.0.0.1:3066");
assert.ok(
  ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) &&
    ["http:", "https:"].includes(target.protocol) &&
    !target.username &&
    !target.password &&
    target.pathname === "/" &&
    !target.search &&
    !target.hash,
  "Only an isolated local synthetic test server is allowed.",
);
const origin = target.origin;
const actor = "Synthetic amendment reviewer";
const checks: string[] = [];
let requests = 0;
const started = Date.now();
function check(condition: unknown, label: string): asserts condition {
  assert.ok(condition, label);
  checks.push(label);
}
async function request<T>(path: string, body?: unknown, cookie?: string) {
  assert.ok(++requests < 80, "Bounded acceptance request budget");
  const multipart = body instanceof FormData;
  const response = await fetch(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: origin,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined && !multipart
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body:
      body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  return {
    status: response.status,
    data: (await response.json()) as T & { error?: string },
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
function document(
  role: string,
  consignee = "Harbour Buyer Ltd",
  discharge = "Singapore",
  note = "",
) {
  return `${role}\nShipper: Meridian Export Ltd\nConsignee: ${consignee}\nNotify party: SAME AS CONSIGNEE\nPort of loading: Port Klang\nPort of discharge: ${discharge}\nContainer count: 2\nGross weight (kg): 42000${note}`;
}

try {
  check(
    (await request<{ mode: string }>("/api/auth")).data.mode === "demo",
    "target is an isolated demo workspace",
  );
  const cookie = (await request("/api/inbox")).cookie!;
  const other = (await request("/api/inbox")).cookie!;
  assert.ok(cookie && other && cookie !== other);
  const cases: CaseResult[] = [];
  async function upload(
    subject: string,
    body: string,
    si?: string,
    bl?: string,
  ) {
    const form = new FormData();
    form.set("subject", subject);
    form.set("body", body);
    if (si !== undefined) form.append("files", new File([si], "si.txt"));
    if (bl !== undefined) form.append("files", new File([bl], "bl.txt"));
    const response = await request<{ result: CaseResult }>(
      "/api/upload",
      form,
      cookie,
    );
    assert.equal(response.status, 200, JSON.stringify(response.data));
    const result = response.data.result;
    cases.push(result);
    return result;
  }
  const source = await upload(
    "Synthetic — verify draft BL against SI",
    "Please compare the draft BL against the SI. Booking: CREATIVE-20260924",
    document("SHIPPING INSTRUCTION"),
    document("DRAFT BILL OF LADING"),
  );
  check(
    source.workflow === "verified",
    "original SI and BL agree before the later instruction",
  );
  let instruction = await upload(
    "Synthetic shipment instruction",
    "Booking: CREATIVE-20260924\nPlease change consignee to Harbour Distribution Ltd",
  );
  const confirmed = await request<{ result: CaseResult }>(
    "/api/cases",
    {
      action: "route",
      id: instruction.email.email_id,
      version: instruction.version,
      category: "GENERAL",
      actor,
      reason: "Reviewed the later instruction and its shipment scope",
    },
    cookie,
  );
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  instruction = confirmed.data.result;
  cases[cases.length - 1] = instruction;
  const created = await request<{ shipment: Shipment }>(
    "/api/shipments",
    {
      action: "create",
      title: "Instruction reconciliation — synthetic acceptance",
      customer: "Synthetic customer",
      carrier: "Synthetic carrier",
      references: ["CREATIVE-20260924"],
      actor,
    },
    cookie,
  );
  assert.equal(created.status, 200, JSON.stringify(created.data));
  let shipment = created.data.shipment;
  async function action(input: Record<string, unknown>, expected = 200) {
    const response = await request<{ shipment: Shipment }>(
      "/api/shipments",
      { id: shipment.id, version: shipment.version, actor, ...input },
      cookie,
    );
    assert.equal(response.status, expected, JSON.stringify(response.data));
    if (response.status === 200) shipment = response.data.shipment;
    return response;
  }
  async function link(result: CaseResult, select = false) {
    await action({
      action: "link",
      case_id: result.email.email_id,
      case_version: result.version,
      reason: "Confirmed shipment reference and source relationship",
    });
    if (select)
      await action({
        action: "select_comparison",
        case_id: result.email.email_id,
        case_version: result.version,
        reason: "Selected latest authoritative SI and draft BL",
      });
  }
  await link(source, true);
  await link(instruction);
  await action({
    action: "propose_amendment",
    case_id: instruction.email.email_id,
    case_version: instruction.version,
    field: "consignee",
    value: "Harbour Distribution Ltd",
    quote: "Please change consignee to Harbour Distribution Ltd",
  });
  const amendmentId = shipment.amendments[0].id;
  await action({
    action: "decide_amendment",
    amendment_id: amendmentId,
    approve: true,
    reason: "Customer authority and exact instruction confirmed",
  });
  await action({
    action: "task",
    kind: "revised_si",
    case_id: source.email.email_id,
    case_version: source.version,
  });
  check(
    shipment.tasks[0].body.includes("Harbour Distribution Ltd") &&
      shipment.tasks[0].body.includes(instruction.email.email_id),
    "draft request cites the approved change and source email",
  );
  check(
    shipment.tasks[0].state === "draft" &&
      shipment.tasks[0].body.includes("Nothing has been sent"),
    "request is a reviewable unsent draft",
  );
  const reconcile = (result: CaseResult, expected = 200) =>
    action(
      {
        action: "reconcile_amendment",
        amendment_id: amendmentId,
        case_id: result.email.email_id,
        case_version: result.version,
        reason: "Compared the instruction against the revised SI source",
      },
      expected,
    );
  const originalAttempt = await reconcile(source, 409);
  check(
    originalAttempt.data.error?.includes("original"),
    "original SI cannot be reused as revised-SI evidence",
  );
  let editedProbe = await upload(
    "Synthetic — verify BL against SI correction probe",
    "Please compare the draft BL against the SI. Booking: CREATIVE-20260924",
    document("SHIPPING INSTRUCTION"),
    document("DRAFT BILL OF LADING", "Harbour Distribution Ltd"),
  );
  await link(editedProbe, true);
  const edited = await request<{ result: CaseResult }>(
    "/api/cases",
    {
      action: "review",
      id: editedProbe.email.email_id,
      version: editedProbe.version,
      actor,
      reason: "Synthetic negative test: edit field without a revised source",
      field: "consignee",
      side: "si",
      value: "Harbour Distribution Ltd",
    },
    cookie,
  );
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  editedProbe = edited.data.result;
  cases[cases.length - 1] = editedProbe;
  check(
    editedProbe.workflow === "verified",
    "negative probe creates matching comparison fields while the SI source remains unchanged",
  );
  const editBypass = await action(
    {
      action: "complete",
      cases: Object.fromEntries(
        cases.map((result) => [result.email.email_id, result.version]),
      ),
      acknowledge_advisories: true,
      reason:
        "Synthetic attempt to replace revised SI evidence with a field edit",
    },
    409,
  );
  check(
    editBypass.data.error?.includes("not established by the original SI"),
    "editing original SI comparison fields cannot bypass the real source-evidence completion gate",
  );
  const wrong = await upload(
    "Synthetic — verify revised BL against SI",
    "Please compare the revised draft BL against the SI. Booking: CREATIVE-20260924",
    document(
      "SHIPPING INSTRUCTION",
      undefined,
      undefined,
      "\nBooking: REVISION-WRONG",
    ),
    document("DRAFT BILL OF LADING"),
  );
  await link(wrong, true);
  const wrongAttempt = await reconcile(wrong, 409);
  check(
    wrongAttempt.data.error?.includes("does not yet establish"),
    "changed document bytes with the wrong consignee do not satisfy the instruction",
  );
  const regression = await upload(
    "Synthetic — verify revised BL against SI",
    "Please compare the revised draft BL against the SI. Booking: CREATIVE-20260924",
    document("SHIPPING INSTRUCTION", "Harbour Distribution Ltd"),
    document("DRAFT BILL OF LADING", "Harbour Distribution Ltd", "Rotterdam"),
  );
  await link(regression, true);
  check(
    regression.defect_fields.includes("port_of_discharge"),
    "revised draft introduces a detected discharge-port error",
  );
  await reconcile(regression);
  check(
    shipment.amendments[0].incorporation?.case_id ===
      regression.email.email_id &&
      shipment.amendments[0].incorporation?.si_value ===
        "Harbour Distribution Ltd",
    "reviewer records the amended consignee from the real revised SI",
  );
  const complete = () => ({
    action: "complete",
    cases: Object.fromEntries(
      cases.map((result) => [result.email.email_id, result.version]),
    ),
    acknowledge_advisories: true,
    reason:
      "Checked current document revisions, instructions and operational tasks",
  });
  const blocked = await action(complete(), 409);
  check(
    blocked.data.error?.includes("discrepancy"),
    "an incorporated amendment cannot hide a new BL error or bypass completion",
  );
  const final = await upload(
    "Synthetic — verify final BL against SI",
    "Please compare the final draft BL against the SI. Booking: CREATIVE-20260924",
    document("SHIPPING INSTRUCTION", "Harbour Distribution Ltd"),
    document("DRAFT BILL OF LADING", "Harbour Distribution Ltd"),
  );
  await link(final, true);
  await action(complete(), 409);
  check(
    shipment.amendments[0].incorporation?.case_id === regression.email.email_id,
    "selecting another case retains the earlier proof until explicitly reconfirmed",
  );
  await reconcile(final);
  const task = shipment.tasks[0];
  await action({
    action: "update_task",
    task_id: task.id,
    owner: actor,
    body: task.body,
    state: "done",
    reason: "Requested sources received and reviewed in the final comparison",
  });
  check(
    final.workflow === "verified",
    "final SI and draft BL pass the unchanged strict comparison",
  );
  const oldVersion = shipment.version;
  await action(complete());
  check(
    shipment.state === "completed",
    "shipment completes only after strict match, incorporation and closed tasks",
  );
  await action(
    {
      action: "reconcile_amendment",
      version: oldVersion,
      amendment_id: amendmentId,
      case_id: final.email.email_id,
      case_version: final.version,
      reason: "Stale client probe",
    },
    409,
  );
  check(true, "stale shipment writes are rejected");
  const privateRead = await request(
    "/api/shipments?id=" + shipment.id,
    undefined,
    other,
  );
  check(
    privateRead.status === 404,
    "other workspace cannot read the shipment or instruction history",
  );
  const detail = await request<{
    shipment: Shipment;
    history: { action: string; payload: string }[];
  }>("/api/shipments?id=" + shipment.id, undefined, cookie);
  check(
    detail.status === 200 &&
      detail.data.history.filter(
        (item) => item.action === "reconcile_amendment",
      ).length === 2,
    "both incorporation decisions persist as separate shipment revisions",
  );
  const original = await request<{ result: CaseResult }>(
    "/api/cases?id=" + source.email.email_id,
    undefined,
    cookie,
  );
  check(
    original.data.result.comparison.find((row) => row.field === "consignee")?.si
      .raw === "Harbour Buyer Ltd",
    "original SI evidence is unchanged after reconciliation",
  );
  await fs.mkdir("work/validation", { recursive: true });
  await fs.writeFile(
    "work/validation/amendment-api.json",
    JSON.stringify(
      {
        checked_at: new Date().toISOString(),
        origin,
        scope:
          "Synthetic local demo workspace; no external accounts or messages",
        passed: true,
        assertions: checks.length,
        requests,
        duration_ms: Date.now() - started,
        checks,
      },
      null,
      2,
    ) + "\n",
  );
  await fs.writeFile(
    "work/validation/amendment-browser-fixture.json",
    JSON.stringify(
      {
        origin,
        cookie,
        shipment_id: shipment.id,
        amendment_id: amendmentId,
        source_case: source.email.email_id,
        instruction_case: instruction.email.email_id,
        wrong_case: wrong.email.email_id,
        regression_case: regression.email.email_id,
        final_case: final.email.email_id,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: true,
      assertions: checks.length,
      requests,
      report: "work/validation/amendment-api.json",
    }),
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Local amendment acceptance failed",
  );
  process.exitCode = 1;
}
