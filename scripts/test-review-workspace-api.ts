import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { previewCorrection } from "../lib/corrections";
import type { CaseResult, CaseSummary } from "../lib/types";

// Isolated synthetic workspaces; no owner cookies, external AI calls or real data.
const target = new URL(process.argv[2] ?? "http://127.0.0.1:3055");
assert.ok(
  ["http:", "https:"].includes(target.protocol) &&
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
let requests = 0;
async function session() {
  const r = await fetch(`${origin}/api/inbox`, {
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
  assert.ok(++requests <= 50, "Keep acceptance testing bounded");
  const multipart = body instanceof FormData;
  const r = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(body && !multipart ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90000),
  });
  return {
    status: r.status,
    data: (await r.json()) as {
      result: CaseResult;
      results: CaseResult[];
      cases: CaseSummary[];
      loaded_at: string;
      error?: string;
    },
  };
}
function doc(role: string, consignee = "BETA IMPORTS LTD") {
  return `${role}\nShipper: ALPHA EXPORTS LTD\nConsignee: ${consignee}\nNotify party: SAME AS CONSIGNEE\nPort of loading: SINGAPORE\nPort of discharge: ROTTERDAM\nContainer count: 2\nGross weight: 42000 KG`;
}
function form(extra = true) {
  const fd = new FormData();
  fd.set("from", "synthetic-intake@example.test");
  fd.set("subject", "Synthetic email: check draft BL");
  fd.set(
    "body",
    "Please compare the attached SI and draft BL and report discrepancies.",
  );
  fd.append("files", new File([doc("SHIPPING INSTRUCTION")], "si.txt"));
  fd.append("files", new File([doc("DRAFT BILL OF LADING")], "latest-bl.txt"));
  if (extra) {
    fd.append(
      "files",
      new File(
        [doc("DRAFT BILL OF LADING", "GAMMA IMPORTS LTD")],
        "earlier-bl.txt",
      ),
    );
    fd.append(
      "files",
      new File(["COMMERCIAL INVOICE\nSynthetic billing record"], "invoice.txt"),
    );
  }
  return fd;
}
const started = performance.now();
try {
  const imported = await request("/api/upload", form());
  check(imported.status === 200, "multi-attachment intake succeeds");
  let r = imported.data.result as CaseResult;
  check(
    r.email.from === "synthetic-intake@example.test",
    "sender email retained",
  );
  check(
    r.documents.length === 4 && r.email.attachments.length === 4,
    "all four attachments retained",
  );
  check(
    r.status === "NEEDS_REVIEW" && !r.comparison.length,
    "extra attachments never silently verified",
  );
  const initial = structuredClone(r);
  const si = r.documents.find((d) => d.type === "SI")!.name;
  const bl = r.documents.find((d) => d.name.endsWith("latest-bl.txt"))!.name;
  const old = r.documents.find((d) => d.name.endsWith("earlier-bl.txt"))!.name;
  const action = (extra: object) => ({
    id: r.email.email_id,
    version: r.version,
    actor: "Synthetic acceptance reviewer",
    reason: "Explicitly checked the synthetic source revision",
    ...extra,
  });
  check(
    (await request(`/api/cases?id=${r.email.email_id}`, undefined, other))
      .status === 404,
    "foreign workspace cannot open case",
  );
  check(
    (
      await request(
        "/api/cases",
        action({ action: "select_documents", si, bl }),
        other,
      )
    ).status === 409,
    "foreign workspace cannot select pair",
  );
  check(
    (
      await request(
        "/api/cases",
        action({ action: "select_documents", si: bl, bl: si }),
      )
    ).status === 422,
    "wrong roles rejected",
  );
  check(
    (
      await request(
        "/api/cases",
        action({ action: "select_documents", si, bl: "missing.txt" }),
      )
    ).status === 409,
    "missing source rejected",
  );
  const selectedOld = await request(
    "/api/cases",
    action({ action: "select_documents", si, bl: old }),
  );
  check(
    selectedOld.status === 200 && selectedOld.data.result.status === "MISMATCH",
    "choosing an earlier BL reveals its discrepancies",
  );
  check(
    (
      await request(
        "/api/cases",
        action({ action: "select_documents", si, bl }),
      )
    ).status === 409,
    "stale pair selection rejected",
  );
  r = selectedOld.data.result;
  const selectedLatest = await request(
    "/api/cases",
    action({ action: "select_documents", si, bl }),
  );
  check(
    selectedLatest.status === 200 && selectedLatest.data.result.status === "OK",
    "latest matching pair completes seven-field check",
  );
  r = selectedLatest.data.result;
  check(
    r.reviewed &&
      r.documents.length === 4 &&
      r.document_selection?.bl.name === bl,
    "human selection and all sources retained",
  );
  check(
    (
      await request(
        "/api/cases",
        action({ action: "select_documents", si, bl }),
      )
    ).status === 422,
    "same-pair reselection cannot erase corrections",
  );
  const summaries = await request("/api/inbox");
  const summary = summaries.data.cases.find(
    (c: { email: { email_id: string } }) =>
      c.email.email_id === r.email.email_id,
  );
  check(
    summary?.result?.version === r.version &&
      !Object.hasOwn(summary.result, "documents") &&
      !Object.hasOwn(summary.email, "body") &&
      !Object.hasOwn(summary.result, "comparison"),
    "inbox returns current compact summary only",
  );
  check(
    typeof summaries.data.loaded_at === "string",
    "inbox exposes last complete read time",
  );
  check(
    (
      await request(
        "/api/cases",
        action({
          action: "review",
          field: "shipper",
          side: "bl",
          value: "ALPHA LTD\nBETA LTD",
        }),
      )
    ).status === 422,
    "ambiguous manual correction rejected",
  );
  const edit = {
    field: "consignee",
    side: "bl",
    value: "GAMMA IMPORTS LTD",
  } as const;
  const preview = previewCorrection(r, edit);
  const corrected = await request(
    "/api/cases",
    action({ action: "review", ...edit }),
  );
  check(corrected.status === 200, "valid reviewed correction saved");
  r = corrected.data.result;
  check(
    JSON.stringify(r.defect_fields) ===
      JSON.stringify(preview.result!.defect_fields),
    "saved result matches preview including linked notify party",
  );
  check(
    r.document_selection?.bl.name === bl,
    "correction retains selected pair",
  );
  const history = await request(
    `/api/cases?id=${r.email.email_id}&revision=${initial.version}`,
  );
  check(
    history.status === 200 &&
      history.data.result.documents.length === 4 &&
      !history.data.result.document_selection,
    "original unselected revision remains immutable",
  );
  const reprocessed = await request("/api/cases", {
    action: "process",
    ids: [r.email.email_id],
    skipSaved: true,
  });
  check(
    reprocessed.status === 200 &&
      reprocessed.data.results[0].document_selection?.bl.name === bl,
    "safe resume retains selection and review",
  );
  const duplicate = form(false);
  duplicate.append("from", "another@example.test");
  check(
    (await request("/api/upload", duplicate)).status === 400,
    "duplicate sender controls rejected",
  );
  const invalid = form(false);
  invalid.set("from", "not-an-email");
  check(
    (await request("/api/upload", invalid)).status === 400,
    "malformed sender rejected",
  );
  const many = form(false);
  for (let i = 0; i < 9; i++)
    many.append("files", new File(["Synthetic extra"], `extra-${i}.txt`));
  check(
    (await request("/api/upload", many)).status === 400,
    "eleven attachments rejected before persistence",
  );
  const large = new FormData();
  large.set("subject", "Synthetic size-limit test");
  large.set("body", "Please compare SI and BL.");
  for (let i = 0; i < 5; i++)
    large.append(
      "files",
      new File(
        [new Uint8Array(4 * 1024 * 1024 + 1)],
        `oversize-total-${i}.txt`,
      ),
    );
  check(
    (await request("/api/upload", large)).status === 413,
    "combined attachments over 20 MiB rejected before persistence",
  );
  const emailOnly = new FormData();
  emailOnly.set("subject", "Operations update");
  emailOnly.set("body", "Our office will be closed for the public holiday.");
  const emailResponse = await request("/api/upload", emailOnly);
  check(
    emailResponse.status === 200 &&
      emailResponse.data.result.category === "GENERAL",
    "email-only intake uses learned routing",
  );
  const changedRoute = await request(
    "/api/cases",
    action({ action: "route", category: "GENERAL" }),
  );
  check(
    changedRoute.status === 200 &&
      changedRoute.data.result.comparison.length === 0,
    "changing category removes active verification",
  );
  r = changedRoute.data.result;
  check(
    (
      await request(
        "/api/cases",
        action({ action: "select_documents", si, bl }),
      )
    ).status === 422,
    "pair selection cannot override a non-comparison category",
  );
  console.log({
    passed: checks.length,
    requests,
    duration_ms: Math.round(performance.now() - started),
  });
} finally {
  await fs.mkdir("work/validation/v32", { recursive: true });
  await fs.writeFile(
    "work/validation/v32/review-workspace-api.json",
    JSON.stringify(
      {
        origin,
        generated_at: new Date().toISOString(),
        checks,
        requests,
        duration_ms: Math.round(performance.now() - started),
        scope:
          "Synthetic isolated workspaces; no external LLM calls. No cookies or source payloads included.",
      },
      null,
      2,
    ),
  );
}
