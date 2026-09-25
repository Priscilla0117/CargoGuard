import assert from "node:assert/strict";
import fs from "node:fs/promises";

const target = new URL(process.argv[2] ?? "http://127.0.0.1:3066");
assert.ok(
  ["http:", "https:"].includes(target.protocol) &&
    !target.username &&
    !target.password &&
    target.pathname === "/" &&
    !target.search &&
    !target.hash,
);
const origin = target.origin;
const checks = [];
let requests = 0;
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}
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
async function request(path, body, cookie = owner, suppliedOrigin = origin) {
  assert.ok(++requests < 45, "Bounded synthetic acceptance suite");
  const multipart = body instanceof FormData;
  const r = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      Origin: suppliedOrigin,
      ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90000),
  });
  return {
    status: r.status,
    data: r.headers.get("content-type")?.includes("application/json")
      ? await r.json()
      : await r.text(),
  };
}
function document(role, weight = 42000, port = "ROTTERDAM") {
  return `${role}\nShipper: ALPHA EXPORTS LTD\nConsignee: BETA IMPORTS LTD\nNotify party: SAME AS CONSIGNEE\nPort of loading: SINGAPORE\nPort of discharge: ${port}\nContainer count: 2\nGross weight: ${weight} KG`;
}
const form = new FormData();
form.set("subject", "Synthetic final-round follow-up acceptance");
form.set("body", "Please compare the draft BL against the attached SI.");
form.append("files", new File([document("SHIPPING INSTRUCTION")], "si.txt"));
form.append(
  "files",
  new File([document("DRAFT BILL OF LADING", 43000)], "bl.txt"),
);
const started = performance.now();
try {
  const upload = await request("/api/upload", form);
  assert.equal(upload.status, 200, JSON.stringify(upload.data));
  check(
    upload.status === 200 && upload.data.result.workflow === "discrepancy",
    "fresh source pair identifies real weight discrepancy",
  );
  let current = upload.data.result;
  const id = current.email.email_id;
  const siHash = current.documents.find((d) => d.type === "SI").sha256;
  let input = {
    id,
    case_version: current.version,
    version: 0,
    owner: "Synthetic operator",
    shipment_reference: "DEMO-BOOKING-27",
    due_at: "2026-09-27T10:00:00+08:00",
    state: "waiting",
    note: "Issuer asked externally for a corrected draft BL.",
    actor: "Synthetic reviewer",
  };
  const saved = await request("/api/follow-ups", input);
  check(
    saved.status === 200 && saved.data.followup.version === 1,
    "waiting follow-up persisted",
  );
  check(
    saved.data.followup.due_at === "2026-09-27T02:00:00.000Z",
    "explicit timezone normalized to UTC",
  );
  check(
    (await request("/api/follow-ups", input)).status === 409,
    "duplicate/stale follow-up rejected",
  );
  check(
    (
      await request("/api/follow-ups", {
        ...input,
        version: 1,
        state: "completed",
      })
    ).status === 409,
    "premature completion blocked on discrepancy",
  );
  check(
    (await request("/api/follow-ups", { ...input, version: 1 }, other))
      .status === 404,
    "foreign workspace cannot change follow-up",
  );
  check(
    (
      await request(
        "/api/follow-ups",
        { ...input, version: 1 },
        owner,
        "https://untrusted.example",
      )
    ).status === 403,
    "cross-origin follow-up mutation rejected",
  );
  const races = await Promise.all(
    ["First update", "Second update"].map((note) =>
      request("/api/follow-ups", { ...input, version: 1, note }),
    ),
  );
  check(
    races.filter((r) => r.status === 200).length === 1 &&
      races.filter((r) => r.status === 409).length === 1,
    "simultaneous follow-up edits have one winner",
  );
  let f = races.find((r) => r.status === 200).data.followup;
  const replace = async (port) => {
    const fd = new FormData();
    fd.set("mode", "replace_bl");
    fd.set("id", id);
    fd.set("version", String(current.version));
    fd.set("actor", "Synthetic reviewer");
    fd.set(
      "reason",
      "Received synthetic issuer correction; retain SI reference.",
    );
    fd.set(
      "bl",
      new File(
        [document("DRAFT BILL OF LADING", 42000, port)],
        "issuer-revised-bl.txt",
      ),
    );
    return request("/api/upload", fd);
  };
  const partial = await replace("SHANGHAI");
  check(partial.status === 200, "BL-only reply accepted");
  current = partial.data.result;
  check(
    current.documents.find((d) => d.type === "SI").sha256 === siHash,
    "SI reference fingerprint retained",
  );
  check(
    current.workflow === "discrepancy" &&
      current.defect_fields.includes("port_of_discharge") &&
      !current.defect_fields.includes("gross_weight_kg"),
    "revised BL fixes weight but new port mismatch remains visible",
  );
  const retained = await request("/api/follow-ups");
  f = retained.data.followups.find((row) => row.email_id === id);
  check(
    f.state === "waiting" && f.case_version !== current.version,
    "prior waiting record stays revision-bound for reopened display",
  );
  check(
    (
      await request("/api/follow-ups", {
        ...input,
        version: f.version,
        case_version: current.version,
        state: "completed",
      })
    ).status === 409,
    "new discrepancy prevents completion",
  );
  const final = await replace("ROTTERDAM");
  check(
    final.status === 200 && final.data.result.workflow === "verified",
    "fully corrected BL passes all seven checks",
  );
  current = final.data.result;
  const complete = await request("/api/follow-ups", {
    ...input,
    version: f.version,
    case_version: current.version,
    state: "completed",
    note: "Read all seven current source fields before handover.",
  });
  check(
    complete.status === 200 && complete.data.followup.completed_at,
    "completion saved only against matching current revision",
  );
  f = complete.data.followup;
  const detail = await request(`/api/cases?id=${id}`);
  check(
    detail.data.audit.some((event) => event.action === "FOLLOW_UP_UPDATED"),
    "case audit includes operational updates",
  );
  check(
    detail.data.result.version === current.version,
    "follow-up never alters comparison revision",
  );
  const handover = await request("/api/follow-ups?export=1");
  check(
    handover.status === 200 &&
      handover.data.includes("DEMO-BOOKING-27") &&
      handover.data.includes("state: completed"),
    "handover includes reference and current completion",
  );
  const reprocessed = await request("/api/cases", {
    action: "process",
    ids: [id],
    skipSaved: false,
  });
  check(
    reprocessed.status === 200 &&
      reprocessed.data.results[0].version > f.case_version,
    "new source-based decision creates later revision",
  );
  const reopened = await request("/api/follow-ups?export=1");
  check(
    reopened.data.includes("state: reopened"),
    "handover reopens prior completion after later decision",
  );
  check(
    (
      await request("/api/follow-ups", {
        ...input,
        version: f.version,
        case_version: current.version,
        state: "completed",
      })
    ).status === 409,
    "stale case cannot be completed after reprocessing",
  );
  check(
    (await request("/api/follow-ups", undefined, other)).data.followups
      .length === 0,
    "follow-up list remains workspace-isolated",
  );
  await fs.mkdir("work/validation/final-round", { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    origin,
    passed: checks.length,
    requests,
    duration_ms: Math.round(performance.now() - started),
    checks,
  };
  await fs.writeFile(
    "work/validation/final-round/follow-up-api.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`Failed after ${checks.length} successful checks:`, error);
  process.exitCode = 1;
}
