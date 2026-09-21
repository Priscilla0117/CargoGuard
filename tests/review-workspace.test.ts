import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import { listCaseSummaries, saveCases } from "../lib/storage";
import { analyze } from "../lib/compare";
import { normalizeValue } from "../lib/normalization";
import { correctField, previewCorrection } from "../lib/corrections";
import {
  selectedDocuments,
  selectionStillMatches,
} from "../lib/document-selection";
import { parseDocument } from "../lib/parsers";
import { processEmail } from "../lib/processing";
import { classify } from "../lib/classifier";
import { assistantContext } from "../lib/assistant";
import { answerCase } from "../lib/case-guide";
import { revisionDiff } from "../lib/revision-diff";
import { requestInbox, requestJson, RequestError } from "../lib/client-api";
import { summaryOf, type DocumentSelection, type Email } from "../lib/types";

const email: Email = {
  email_id: "independent-review-scenario",
  from: "desk@example.test",
  subject: "Check draft BL",
  body: "Please compare the SI and draft BL and report discrepancies.",
  attachments: ["si.txt", "bl.txt"],
};
function text(
  role: "SI" | "BL",
  party = "BETA IMPORTS LTD",
  shipper = "ALPHA EXPORTS LTD",
  weight = "42000 KG",
) {
  return `${role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING"}\nShipper: ${shipper}\nConsignee: ${party}\nNotify Party: SAME AS CONSIGNEE\nPort of Loading: SINGAPORE\nPort of Discharge: ROTTERDAM\nContainer Count: 2\nGross Weight: ${weight}`;
}
async function fixture() {
  const bytes = new Map([
    ["si.txt", new TextEncoder().encode(text("SI"))],
    ["bl.txt", new TextEncoder().encode(text("BL"))],
    ["old-bl.txt", new TextEncoder().encode(text("BL", "GAMMA IMPORTS LTD"))],
    [
      "invoice.txt",
      new TextEncoder().encode(
        "COMMERCIAL INVOICE\nInvoice number: SYNTHETIC-1\nTotal: USD 100",
      ),
    ],
  ]);
  const documents = await Promise.all(
    [...bytes].map(([name, data]) => parseDocument(name, data)),
  );
  const selection: DocumentSelection = {
    si: { name: documents[0].name, sha256: documents[0].sha256! },
    bl: { name: documents[1].name, sha256: documents[1].sha256! },
    actor: "Synthetic reviewer",
    reason: "Latest BL confirmed against SI",
    selected_at: "2026-09-21T12:00:00Z",
  };
  return {
    bytes,
    documents,
    selection,
    result: analyze(email, documents.slice(0, 2)),
  };
}

for (const field of ["shipper", "consignee", "notify_party"] as const) {
  test(`${field}: two different unexplained companies are uncertain, not a match`, () => {
    assert.equal(
      normalizeValue(field, "ALPHA EXPORTS LTD\nANOTHER COMPANY LTD").value,
      null,
    );
    assert.equal(
      normalizeValue(field, "ALPHA EXPORTS LTD; ANOTHER COMPANY LTD").value,
      null,
    );
    assert.equal(
      normalizeValue(field, "ALPHA EXPORTS LTD ANOTHER COMPANY LTD").value,
      null,
    );
    assert.equal(
      normalizeValue(field, "3S PAPER PRODUCTS SDN BHD\nANOTHER COMPANY LTD")
        .value,
      null,
    );
    assert.equal(
      normalizeValue(field, "ALPHA EXPORTS\nLIMITED\nANOTHER COMPANY LTD")
        .value,
      null,
    );
  });
}
test("wrapped names, suffix-only lines, repeated names and agency blocks stay usable", () => {
  for (const raw of [
    "ALPHA EXPORTS\nLIMITED",
    "ALPHA\nPHONE SYSTEMS LTD",
    "ALPHA EXPORTS LTD\n12 MAIN STREET",
    "ALPHA EXPORTS LTD\nALPHA EXPORTS LTD",
    "ALPHA EXPORTS LTD\nAS AGENT FOR BETA IMPORTS LTD",
  ])
    assert.notEqual(normalizeValue("shipper", raw).value, null, raw);
});
test("identical ambiguous party blocks in SI and BL require human review", async () => {
  const docs = await Promise.all(
    (["SI", "BL"] as const).map((role) =>
      parseDocument(
        `${role}.txt`,
        new TextEncoder().encode(
          text(
            role,
            "BETA IMPORTS LTD",
            "ALPHA EXPORTS LTD\nANOTHER COMPANY LTD",
          ),
        ),
      ),
    ),
  );
  const r = analyze(email, docs);
  assert.equal(r.status, "NEEDS_REVIEW");
  assert.equal(r.comparison[0].result, "uncertain");
});
test("security incident reporting is GENERAL; an actual credential demand remains SPAM", () => {
  assert.equal(
    classify({
      ...email,
      subject: "Security incident report",
      body: "I am reporting phishing. The suspicious message says your mailbox is full. Please investigate.",
    }).category,
    "GENERAL",
  );
  assert.equal(
    classify({
      ...email,
      subject: "Urgent mailbox verification",
      body: "Your mailbox is full and will be disabled. Enter your password at the verification page immediately.",
    }).category,
    "SPAM",
  );
});
test("preview is non-mutating and exposes the notify-party dependency", async () => {
  const { result } = await fixture();
  const before = structuredClone(result);
  const edit = {
    field: "consignee",
    side: "bl",
    value: "GAMMA IMPORTS LTD",
  } as const;
  const preview = previewCorrection(result, edit);
  assert.deepEqual(result, before);
  assert.equal(preview.result?.status, "MISMATCH");
  assert.deepEqual(
    preview.changes.filter((r) => r.changed).map((r) => r.field),
    ["consignee", "notify_party"],
  );
  const saved = correctField(result, edit, "Test reviewer");
  assert.deepEqual(
    saved.comparison.map((r) => [
      r.field,
      r.result,
      r.si.normalized,
      r.bl.normalized,
    ]),
    preview.result!.comparison.map((r) => [
      r.field,
      r.result,
      r.si.normalized,
      r.bl.normalized,
    ]),
  );
});
test("fixing a consignee resolves both dependent fields", async () => {
  const { result } = await fixture();
  const wrong = correctField(
    result,
    { field: "consignee", side: "bl", value: "GAMMA IMPORTS LTD" },
    "Test",
  );
  const preview = previewCorrection(wrong, {
    field: "consignee",
    side: "bl",
    value: "BETA IMPORTS LTD",
  });
  assert.equal(preview.result?.status, "OK");
  assert.equal(
    preview.changes.filter((c) => c.before !== "match" && c.after === "match")
      .length,
    2,
  );
});
test("preview and saving reject ambiguity, missing values and unsupported weights", async () => {
  const { result } = await fixture();
  for (const edit of [
    { field: "shipper", side: "bl", value: "ALPHA LTD\nBETA LTD" },
    { field: "consignee", side: "si", value: "TBD" },
    { field: "gross_weight_kg", side: "bl", value: "42.000" },
  ] as const) {
    assert.ok(previewCorrection(result, edit).error);
    assert.throws(() => correctField(result, edit, "Test"), { status: 422 });
  }
});
test("a policy exception never changes strict preview differences into a match", async () => {
  const { result } = await fixture();
  result.policy!.rules.weightToleranceKg = 100;
  const preview = previewCorrection(result, {
    field: "gross_weight_kg",
    side: "bl",
    value: "42001 KG",
  });
  assert.equal(preview.result?.status, "MISMATCH");
  assert.equal(preview.result?.policy_assessment?.covered, true);
});
test("multi-attachment email stays in review until a human selects a known, readable pair", async () => {
  const { documents, selection } = await fixture();
  assert.equal(analyze(email, documents).status, "NEEDS_REVIEW");
  const r = analyze(email, documents, 0, undefined, undefined, selection);
  assert.equal(r.status, "OK");
  assert.equal(r.reviewed, true);
  assert.equal(r.documents.length, 4);
  assert.match(r.summary, /2 other attachments are retained but not verified/);
  assert.match(
    answerCase(r, "readiness").paragraphs.join(" "),
    /2 other attachments are NOT verified/,
  );
  const context = await assistantContext(r);
  assert.match(
    context.facts.find((f) => f.id === "coverage")!.text,
    /NOT verified/,
  );
});
test("pair selection rejects wrong roles, damaged files, unknown names and changed fingerprints", async () => {
  const { documents, selection } = await fixture();
  for (const invalid of [
    { ...selection, si: selection.bl },
    { ...selection, bl: { name: "absent.txt", sha256: "a".repeat(64) } },
    { ...selection, bl: { ...selection.bl, sha256: "b".repeat(64) } },
  ])
    assert.throws(() => selectedDocuments(documents, invalid));
  const damaged = structuredClone(documents);
  damaged[1].error = "Unreadable";
  assert.throws(() => selectedDocuments(damaged, selection), { status: 422 });
  assert.equal(
    analyze(email, damaged, 0, undefined, undefined, selection).status,
    "NEEDS_REVIEW",
  );
  assert.equal(selectionStillMatches(damaged, selection), undefined);
});
test("pair selection cannot override an uncertain email route", async () => {
  const { documents, selection } = await fixture();
  const r = analyze(
    { ...email, subject: "zxv", body: "qqq" },
    documents,
    0,
    undefined,
    undefined,
    selection,
  );
  assert.equal(r.status, "NEEDS_REVIEW");
  assert.equal(r.comparison.length, 0);
});
test("reprocessing retains selection and manual corrections only for unchanged sources", async () => {
  const { documents, selection, bytes } = await fixture();
  const mail = { ...email, attachments: [...bytes.keys()] };
  let r = analyze(mail, documents, 0, undefined, undefined, selection);
  r = correctField(
    r,
    { field: "gross_weight_kg", side: "bl", value: "43000" },
    "Test",
  );
  const next = await processEmail(mail, async (p) => bytes.get(p)!, r, true);
  assert.deepEqual(next.document_selection, selection);
  assert.equal(next.comparison.at(-1)?.bl.normalized, 43000);
  bytes.set("bl.txt", new TextEncoder().encode(text("BL", "OTHER IMPORT LTD")));
  const changed = await processEmail(mail, async (p) => bytes.get(p)!, r, true);
  assert.equal(changed.document_selection, undefined);
  assert.equal(changed.status, "NEEDS_REVIEW");
});
test("a selected pair is never counted as an untouched automatic baseline", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    for (const f of (await fs.readdir("drizzle"))
      .filter((f) => f.endsWith(".sql"))
      .sort())
      await client.executeMultiple(await fs.readFile(`drizzle/${f}`, "utf8"));
    const { documents, selection } = await fixture();
    const result = analyze(
      email,
      documents,
      0,
      undefined,
      undefined,
      selection,
    );
    result.reviewed = false; // Defense in depth: the selection itself excludes it.
    const { DB } = createNodeBindings(client);
    await saveCases(
      "workspace-a",
      [
        {
          result,
          expected: 0,
          action: "PROCESSED",
          actor: "Test",
          detail: "test",
        },
      ],
      DB,
    );
    assert.equal(
      (await client.execute("SELECT origin FROM result_revisions")).rows[0]
        .origin,
      "reviewed",
    );
  } finally {
    client.close();
  }
});
test("lightweight inbox preserves all summary fields and isolation without transferring source payloads", async () => {
  const client = createClient({ url: ":memory:" });
  try {
    await client.execute(
      "CREATE TABLE cases (workspace TEXT, email_id TEXT, payload TEXT, version INTEGER)",
    );
    const { result } = await fixture();
    result.documents[0].lines.push({
      text: "Synthetic source ".repeat(3000),
      location: "test",
    });
    const rows = Array.from({ length: 520 }, (_, i) => ({
      ...result,
      email: {
        ...result.email,
        email_id: `email_${String(i).padStart(3, "0")}`,
      },
      version: 3,
    }));
    await client.batch(
      rows.map((r) => ({
        sql: "INSERT INTO cases VALUES(?,?,?,?)",
        args: ["workspace-a", r.email.email_id, JSON.stringify(r), 3],
      })),
      "write",
    );
    await client.execute({
      sql: "INSERT INTO cases VALUES(?,?,?,?)",
      args: ["workspace-b", "private", JSON.stringify(result), 1],
    });
    const summaries = await listCaseSummaries(
      "workspace-a",
      createNodeBindings(client).DB,
    );
    assert.equal(summaries.length, rows.length);
    for (let i = 0; i < rows.length; i++)
      assert.deepEqual(
        summaries[i],
        JSON.parse(JSON.stringify(summaryOf(rows[i]))),
      );
    assert.ok(
      JSON.stringify(summaries).length < JSON.stringify(rows).length / 5,
    );
    assert.equal(
      (await listCaseSummaries("workspace-b", createNodeBindings(client).DB))
        .length,
      1,
    );
  } finally {
    client.close();
  }
});
test("inbox retries a transient read once, then returns the successful payload", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () =>
    ++calls === 1
      ? new Response("Service temporarily unavailable", { status: 503 })
      : Response.json({ cases: [] });
  assert.deepEqual(await requestInbox(undefined, fetcher), { cases: [] });
  assert.equal(calls, 2);
});
test("read retries are bounded; validation failures and cancelled refreshes are not retried", async () => {
  let calls = 0;
  const unavailable: typeof fetch = async () => {
    calls++;
    return new Response("Restarting", { status: 502 });
  };
  await assert.rejects(requestInbox(undefined, unavailable), { status: 502 });
  assert.equal(calls, 2);
  calls = 0;
  const invalid: typeof fetch = async () => {
    calls++;
    return Response.json({ error: "Invalid workspace" }, { status: 400 });
  };
  await assert.rejects(requestInbox(undefined, invalid), { status: 400 });
  assert.equal(calls, 1);
  calls = 0;
  const controller = new AbortController();
  const cancelled: typeof fetch = async () => {
    calls++;
    controller.abort();
    throw new DOMException("Cancelled", "AbortError");
  };
  await assert.rejects(
    requestInbox(controller.signal, cancelled),
    RequestError,
  );
  assert.equal(calls, 1);
});
test("a failed save is never replayed automatically", async () => {
  let calls = 0;
  const failed: typeof fetch = async () => {
    calls++;
    return new Response("Gateway failed", { status: 503 });
  };
  await assert.rejects(
    requestJson("/api/cases", { method: "POST", body: "{}" }, failed),
    RequestError,
  );
  assert.equal(calls, 1);
});
test("revision comparison flags a different selected pair even when all values match", async () => {
  const { result, selection } = await fixture();
  const before = { ...result, document_selection: selection, version: 1 };
  const after = {
    ...before,
    version: 2,
    document_selection: {
      ...selection,
      bl: { ...selection.bl, name: "another-identical-draft.txt" },
    },
  };
  const diff = revisionDiff(before, after);
  assert.equal(diff.documentPairChanged, true);
  assert.equal(diff.counts.unchanged, 7);
});
