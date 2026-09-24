import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@libsql/client";
import { analyze } from "../lib/compare";
import { correctField } from "../lib/corrections";
import { parseDocument } from "../lib/parsers";
import { processEmail } from "../lib/processing";
import { analyzeReplacement } from "../lib/source-replacement";
import { preserveSourceCorrections } from "../lib/source-corrections";
import { applyTranscript, type Transcript } from "../lib/transcription";
import { applyRecovery } from "../lib/recovery";
import {
  sourceTextHash,
  validateProviderProposal,
} from "../lib/recovery-schema";
import { listCaseSummaries } from "../lib/storage";
import { createNodeBindings } from "../lib/runtime-node";
import {
  FIELDS,
  summaryOf,
  type CaseResult,
  type ParsedDocument,
} from "../lib/types";

const values = [
  "EXPORT LTD",
  "IMPORT LTD",
  "SAME AS CONSIGNEE",
  "PORT KLANG",
  "SINGAPORE",
  "2",
  "42000 KG",
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
const bytes = (role: string, weight = 42000) =>
  new TextEncoder().encode(
    `${role}\n${labels.map((label, i) => `${label}: ${i === 6 ? `${weight} KG` : values[i]}`).join("\n")}`,
  );
async function fixture() {
  const docs = await Promise.all([
    parseDocument("si.txt", bytes("SHIPPING INSTRUCTION")),
    parseDocument("bl.txt", bytes("BILL OF LADING")),
  ]);
  const initial = analyze(
    {
      email_id: "correction-test",
      from: "qa@example.test",
      subject: "Please compare SI and draft BL",
      body: "Check all fields",
      attachments: docs.map((d) => d.name),
    },
    docs,
    0,
    "BL_COMPARISON",
  );
  return correctField(
    initial,
    { field: "gross_weight_kg", side: "si", value: "42500 KG" },
    "Synthetic reviewer",
  );
}
function select(previous: CaseResult, si = "si.txt", bl = "bl.txt") {
  const reference = (name: string) => ({
    name,
    sha256: previous.documents.find((d) => d.name === name)!.sha256!,
  });
  return preserveSourceCorrections(
    previous,
    analyze(
      previous.email,
      previous.documents,
      0,
      previous.category_override,
      previous.policy,
      {
        si: reference(si),
        bl: reference(bl),
        actor: "Synthetic reviewer",
        reason: "Checked original source identities",
        selected_at: new Date().toISOString(),
      },
    ),
  );
}
const weight = (result: CaseResult) =>
  result.comparison.find((row) => row.field === "gross_weight_kg")!;
async function append(previous: CaseResult) {
  const extra = await parseDocument("extra-bl.txt", bytes("BILL OF LADING"));
  return analyzeReplacement(
    previous,
    [...previous.documents, extra],
    [...previous.email.attachments, extra.name],
  );
}

test("append review survives persistence and original-pair selection without false clearance", async () => {
  const previous = await fixture(),
    original = structuredClone(previous);
  assert.equal(previous.status, "MISMATCH");
  const pending = await append(previous);
  assert.equal(pending.status, "NEEDS_REVIEW");
  assert.equal(pending.comparison.length, 0);
  assert.equal(pending.retained_corrections?.length, 1);
  const selected = select(JSON.parse(JSON.stringify(pending)));
  assert.equal(selected.status, "MISMATCH");
  assert.equal(weight(selected).si.normalized, 42500);
  assert.equal(weight(selected).bl.normalized, 42000);
  assert.match(weight(selected).si.method, /^Human correction/);
  assert.match(
    selected.summary,
    /1 other attachment is retained but not verified/,
  );
  assert.deepEqual(previous, original);
});

test("selecting another BL retains SI edits and stores edits for the excluded original BL", async () => {
  const previous = correctField(
    await fixture(),
    { field: "gross_weight_kg", side: "bl", value: "42500 KG" },
    "Synthetic reviewer",
  );
  const pending = await append(previous);
  const other = select(pending, "si.txt", "extra-bl.txt");
  assert.equal(other.status, "MISMATCH");
  assert.equal(weight(other).bl.normalized, 42000);
  assert.equal(other.retained_corrections?.length, 2);
  const returned = select(other);
  assert.equal(returned.status, "OK");
  assert.equal(weight(returned).si.normalized, 42500);
  assert.equal(weight(returned).bl.normalized, 42500);
});

test("latest field edit supersedes its older saved snapshot", async () => {
  const selected = select(await append(await fixture()));
  const edited = correctField(
    selected,
    { field: "gross_weight_kg", side: "si", value: "43000 KG" },
    "Second synthetic reviewer",
  );
  const other = select(edited, "si.txt", "extra-bl.txt");
  assert.equal(weight(other).si.normalized, 43000);
  assert.equal(
    other.retained_corrections?.find((c) => c.side === "si")?.value.raw,
    "43000 KG",
  );
});

test("changed, renamed, missing, or ambiguous source identities cannot inherit corrections", async () => {
  const previous = await fixture();
  for (const changed of [
    await parseDocument("si.txt", bytes("SHIPPING INSTRUCTION", 42001)),
    { ...previous.documents[0], name: "renamed-si.txt" },
    { ...previous.documents[0], sha256: undefined },
  ]) {
    const next = analyzeReplacement(
      previous,
      [changed, previous.documents[1]],
      [changed.name, "bl.txt"],
    );
    assert.equal(next.retained_corrections, undefined);
    assert.notEqual(weight(next).si.method, weight(previous).si.method);
  }
  const duplicate = analyzeReplacement(
    previous,
    [...previous.documents, previous.documents[0]],
    ["si.txt", "bl.txt", "si.txt"],
  );
  assert.equal(duplicate.retained_corrections, undefined);
});

test("resume preserves pending corrections but explicit reprocessing resets them", async () => {
  const pending = await append(await fixture());
  const read = async (path: string) =>
    bytes(path === "si.txt" ? "SHIPPING INSTRUCTION" : "BILL OF LADING");
  const resumed = await processEmail(pending.email, read, pending, true);
  assert.equal(resumed.comparison.length, 0);
  assert.equal(resumed.retained_corrections?.length, 1);
  assert.equal(select(resumed).status, "MISMATCH");
  const reset = await processEmail(pending.email, read, pending, false);
  assert.equal(reset.retained_corrections, undefined);
  assert.equal(select(reset).status, "OK");
});

test("routing away and back retains corrections without comparing an unrelated category", async () => {
  const previous = await fixture();
  const routed = preserveSourceCorrections(
    previous,
    analyze(previous.email, previous.documents, 0, "GENERAL"),
  );
  assert.equal(routed.workflow, "routed");
  assert.equal(routed.comparison.length, 0);
  assert.equal(routed.retained_corrections?.length, 1);
  const returned = preserveSourceCorrections(
    routed,
    analyze(routed.email, routed.documents, 0, "BL_COMPARISON"),
  );
  assert.equal(returned.status, "MISMATCH");
  assert.equal(weight(returned).si.normalized, 42500);
});

test("replacing an unreadable BL then confirming it retains untouched SI corrections", async () => {
  const previous = await fixture();
  const scan: ParsedDocument = {
    name: "scan.pdf",
    format: "pdf",
    type: "UNKNOWN",
    lines: [],
    error: "Image-only scan: no text layer.",
    method: "PDF text and layout",
    sha256: "a".repeat(64),
    page_count: 1,
  };
  const pending = analyzeReplacement(
    previous,
    [previous.documents[0], scan],
    ["si.txt", scan.name],
  );
  assert.equal(pending.comparison.length, 0);
  const transcript: Transcript = {
    role: "BL",
    fields: Object.fromEntries(
      FIELDS.map((field, i) => [field, { value: values[i], page: 1 }]),
    ) as Transcript["fields"],
    actor: "Synthetic reviewer",
    reason: "Checked synthetic scan",
    confirmed_at: new Date().toISOString(),
  };
  const confirmed = applyTranscript(
    pending,
    scan.name,
    scan.sha256!,
    transcript,
  );
  assert.equal(confirmed.status, "MISMATCH");
  assert.equal(weight(confirmed).si.normalized, 42500);
  const corrected = correctField(
    confirmed,
    { field: "gross_weight_kg", side: "bl", value: "42500 KG" },
    "Synthetic reviewer",
  );
  const reconfirmed = applyTranscript(corrected, scan.name, scan.sha256!, {
    ...transcript,
    fields: {
      ...transcript.fields,
      gross_weight_kg: { value: "43000 KG", page: 1 },
    },
  });
  assert.equal(weight(reconfirmed).bl.normalized, 43000);
  assert.equal(weight(reconfirmed).si.normalized, 42500);
  assert.ok(
    reconfirmed.retained_corrections?.every((c) => c.name === "si.txt"),
  );
});

test("confirmed readable-source recovery retains pending corrections on the other source", async () => {
  const previous = await fixture();
  const doc: ParsedDocument = {
    name: "novel.txt",
    type: "UNKNOWN",
    format: "txt",
    method: "Plain text",
    sha256: "b".repeat(64),
    lines: values.map((value, i) => ({
      text: `Unfamiliar label ${i}: ${value}`,
      location: `Line ${i + 1}`,
    })),
  };
  const pending = analyzeReplacement(
    previous,
    [previous.documents[0], doc],
    ["si.txt", doc.name],
  );
  const proposal = {
    id: crypto.randomUUID(),
    case_id: pending.email.email_id,
    version: pending.version,
    name: doc.name,
    sha256: doc.sha256!,
    text_sha256: await sourceTextHash(doc),
    provider: "openai" as const,
    model: "synthetic-offline",
    prompt_version: "synthetic",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString(),
    warnings: [],
    ...validateProviderProposal(doc, {
      role: "BL",
      fields: Object.fromEntries(
        FIELDS.map((field, i) => [
          field,
          {
            citations: [{ line: i + 1, quote: values[i] }],
            unit_citation: null,
          },
        ]),
      ),
    }),
  };
  const recovered = await applyRecovery(pending, proposal, {
    role: "BL",
    actor: "Synthetic reviewer",
    reason: "Checked original synthetic quotes",
  });
  assert.equal(recovered.status, "MISMATCH");
  assert.equal(weight(recovered).si.normalized, 42500);
  assert.equal(weight(recovered).bl.normalized, 42000);
});

test("saved correction values remain private to full case detail, never inbox summaries", async () => {
  const pending = await append(await fixture());
  assert.ok(pending.retained_corrections?.length);
  assert.equal(
    Object.hasOwn(summaryOf(pending).result!, "retained_corrections"),
    false,
  );
  const client = createClient({ url: ":memory:" });
  try {
    await client.execute(
      "CREATE TABLE cases (workspace TEXT, email_id TEXT, payload TEXT, version INTEGER)",
    );
    await client.execute({
      sql: "INSERT INTO cases VALUES(?,?,?,?)",
      args: ["workspace-a", pending.email.email_id, JSON.stringify(pending), 1],
    });
    const summaries = await listCaseSummaries(
      "workspace-a",
      createNodeBindings(client).DB,
    );
    assert.equal(
      Object.hasOwn(summaries[0].result!, "retained_corrections"),
      false,
    );
    assert.deepEqual(
      summaries[0],
      JSON.parse(JSON.stringify(summaryOf(pending))),
    );
  } finally {
    client.close();
  }
});
