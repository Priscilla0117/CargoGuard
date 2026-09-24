import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";
import { parseDocument } from "../lib/parsers";
import { analyze } from "../lib/compare";
import { correctField, previewCorrection } from "../lib/corrections";
import { applyTranscript, type Transcript } from "../lib/transcription";
import { applyRecovery } from "../lib/recovery";
import type { RecoveryProposal } from "../lib/recovery-schema";
import { laneFor } from "../lib/operations";
import {
  FIELDS,
  PIPELINE_VERSION,
  summaryOf,
  type Email,
  type CaseResult,
} from "../lib/types";
import { saveCases, getCase, storage } from "../lib/storage";
import { POST as mutateCase } from "../app/api/cases/route";
import { POST as recoverCase } from "../app/api/recovery/route";

const email: Email = {
  email_id: "independent-stale-engine",
  from: "operations@example.test",
  subject: "Check draft BL",
  body: "Please compare the SI and draft BL.",
  attachments: ["uploads/si.txt", "uploads/bl.txt"],
};
const edit = { field: "shipper", side: "bl", value: "ALPHA LTD" } as const;

async function fixture() {
  const bytes = (["SI", "BL"] as const).map((role) =>
    new TextEncoder().encode(
      [
        role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
        "Shipper: ALPHA LTD",
        "Consignee: BETA LTD",
        "Notify Party: SAME AS CONSIGNEE",
        "Port of Loading: SINGAPORE",
        "Port of Discharge: ROTTERDAM",
        "Container Count: 2",
        `Gross Weight (${role === "SI" ? "MT" : "KG"}): 42`,
      ].join("\n"),
    ),
  );
  const documents = await Promise.all(
    bytes.map((data, i) => parseDocument(i === 0 ? "si.txt" : "bl.txt", data)),
  );
  const current = analyze(email, documents);
  const legacy = structuredClone(current);
  // Simulate an older saved extraction that omitted label units. One unrelated
  // human edit must never promote these untouched fields to a current check.
  legacy.pipeline_version = "older-engine";
  const weight = legacy.comparison.find(
    (row) => row.field === "gross_weight_kg",
  )!;
  for (const side of ["si", "bl"] as const) {
    weight[side].raw = "42";
    weight[side].normalized = 42;
  }
  weight.result = "match";
  legacy.status = "OK";
  legacy.workflow = "verified";
  legacy.has_defect = false;
  legacy.defect_fields = [];
  return { bytes, documents, current, legacy };
}

test("one correction cannot certify stale extraction from the other six fields", async () => {
  const { current, legacy } = await fixture();
  assert.equal(current.status, "MISMATCH");
  assert.deepEqual(current.defect_fields, ["gross_weight_kg"]);
  assert.equal(laneFor(summaryOf(legacy)), "refresh");
  const before = structuredClone(legacy);
  assert.throws(() => correctField(legacy, edit, "Test reviewer"), {
    status: 409,
  });
  const preview = previewCorrection(legacy, edit);
  assert.equal(preview.result, null);
  assert.match(preview.error ?? "", /older verification engine/);
  assert.deepEqual(legacy, before);
  const reviewed = correctField(current, edit, "Test reviewer");
  assert.equal(reviewed.pipeline_version, PIPELINE_VERSION);
  assert.equal(reviewed.status, "MISMATCH");
});

test("legacy cases without a recorded engine cannot be relabelled by correction", async () => {
  const { legacy } = await fixture();
  delete legacy.pipeline_version;
  assert.throws(() => correctField(legacy, edit, "Test reviewer"), {
    status: 409,
  });
});

test("scan and AI recovery cannot promote an old parsed case", async () => {
  const { legacy } = await fixture();
  assert.throws(
    () => applyTranscript(legacy, "scan.pdf", "a".repeat(64), {} as Transcript),
    { status: 409, message: /older verification engine/ },
  );
  await assert.rejects(
    applyRecovery(legacy, {} as RecoveryProposal, {
      role: "SI",
      actor: "Test reviewer",
      reason: "Confirm the source evidence",
    }),
    { status: 409, message: /older verification engine/ },
  );
});

test("all manual mutation routes reject old engines without writes; Run inbox reparses originals", async () => {
  const workRoot = path.resolve("work");
  await fs.mkdir(workRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(workRoot, "stale-engine-api-test-"));
  const previousEnv = { ...process.env };
  process.env.CARGO_LOCAL_DB = path.join(dir, "test.db");
  for (const name of [
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "RENDER",
    "CARGO_PUBLIC_ORIGIN",
    "RENDER_EXTERNAL_URL",
  ])
    delete process.env[name];
  const setup = createClient({ url: `file:${process.env.CARGO_LOCAL_DB}` });
  try {
    for (const file of (await fs.readdir("drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await setup.executeMultiple(await fs.readFile(`drizzle/${file}`, "utf8"));
    const { legacy, bytes, documents } = await fixture();
    const workspace = crypto.randomUUID();
    await saveCases(workspace, [
      {
        result: legacy,
        expected: 0,
        action: "PROCESSED",
        actor: "Test setup",
        detail: "Synthetic older-engine snapshot",
      },
    ]);
    for (let index = 0; index < documents.length; index++)
      await storage().BUCKET.put(
        `${workspace}/${email.email_id}/${documents[index].name}`,
        bytes[index],
      );
    const send = (handler: typeof mutateCase, body: unknown) =>
      handler(
        new Request("https://cargo.example/api/test", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: `cargo_workspace=${workspace}`,
            Origin: "https://cargo.example",
          },
          body: JSON.stringify(body),
        }),
      );
    const common = {
      id: email.email_id,
      version: 1,
      actor: "Test reviewer",
      reason: "Checked the original evidence",
    };
    const mutations = [
      { ...common, action: "review", ...edit },
      { ...common, action: "route", category: "BL_COMPARISON" },
      { ...common, action: "select_documents", si: "si.txt", bl: "bl.txt" },
      {
        ...common,
        action: "transcribe",
        name: "scan.pdf",
        sha256: "a".repeat(64),
        role: "SI",
        fields: Object.fromEntries(
          FIELDS.map((field) => [
            field,
            {
              value: "1",
              page: 1,
              confirmed: true,
            },
          ]),
        ),
      },
    ];
    for (const mutation of mutations) {
      const response = await send(mutateCase, mutation);
      assert.equal(response.status, 409, mutation.action);
      assert.match(
        ((await response.json()) as { error: string }).error,
        /older verification engine/,
      );
    }
    const recoveryResponse = await send(recoverCase, {
      ...common,
      action: "confirm",
      name: "si.txt",
      sha256: documents[0].sha256,
      proposalId: crypto.randomUUID(),
      role: "SI",
      confirmed: Object.fromEntries(FIELDS.map((field) => [field, true])),
    });
    assert.equal(recoveryResponse.status, 409);
    assert.match(
      ((await recoveryResponse.json()) as { error: string }).error,
      /older verification engine/,
    );
    assert.equal((await getCase(workspace, email.email_id))?.version, 1);
    for (const table of ["result_revisions", "events"])
      assert.equal(
        (await setup.execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows[0].n,
        1,
      );

    const reprocessed = await send(mutateCase, {
      action: "process",
      ids: [email.email_id],
      skipSaved: true,
    });
    assert.equal(reprocessed.status, 200);
    const result = ((await reprocessed.json()) as { results: CaseResult[] })
      .results[0];
    assert.equal(result.version, 2);
    assert.equal(result.pipeline_version, PIPELINE_VERSION);
    assert.equal(result.status, "MISMATCH");
    assert.deepEqual(result.defect_fields, ["gross_weight_kg"]);
    assert.equal(laneFor(summaryOf(result)), "amend");
  } finally {
    setup.close();
    for (const name of Object.keys(process.env))
      if (!(name in previousEnv)) delete process.env[name];
    Object.assign(process.env, previousEnv);
    assert.ok(path.resolve(dir).startsWith(`${workRoot}${path.sep}`));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
