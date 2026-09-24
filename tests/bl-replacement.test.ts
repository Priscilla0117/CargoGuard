import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createClient } from "@libsql/client";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { correctField } from "../lib/corrections";
import { blReplacementSources, replaceDraftBl } from "../lib/bl-replacement";
import { recoverDocument } from "../lib/recovery";
import {
  sourceTextHash,
  validateProviderProposal,
  type ConfirmedRecovery,
} from "../lib/recovery-schema";
import {
  canTranscribe,
  transcribeDocument,
  type Transcript,
} from "../lib/transcription";
import { emails, bundleBytes } from "../lib/bundle";
import { FIELDS, type CaseResult, type Email } from "../lib/types";
import { storage, getCase, saveCases, getRevision } from "../lib/storage";
import { POST as upload } from "../app/api/upload/route";
import { GET as documentResponse } from "../app/api/document/route";

const reviewer = {
  actor: "Synthetic reviewer",
  reason: "Issuer returned the corrected BL",
};
const values = [
  "ALPHA LTD",
  "BETA LTD",
  "SAME AS CONSIGNEE",
  "SINGAPORE",
  "ROTTERDAM",
  "2",
  "42000 KG",
];
function source(role: "SI" | "BL", weight = "42000 KG", shipper = "ALPHA LTD") {
  return [
    role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
    `Shipper: ${shipper}`,
    "Consignee: BETA LTD",
    "Notify Party: SAME AS CONSIGNEE",
    "Port of Loading: SINGAPORE",
    "Port of Discharge: ROTTERDAM",
    "Container Count: 2",
    `Gross Weight: ${weight}`,
  ].join("\n");
}
async function fixture(multiple = false) {
  const contents: Record<string, string> = {
    "si.txt": source("SI"),
    "bl.txt": source("BL", "43000 KG"),
    ...(multiple
      ? {
          "excluded-old-bl.txt": source("BL"),
          "invoice.txt": "COMMERCIAL INVOICE\nInvoice: SYNTHETIC-1",
        }
      : {}),
  };
  const bytes = new Map<string, Uint8Array>(
    Object.entries(contents).map(([name, text]) => [
      `uploads/${name}`,
      new TextEncoder().encode(text),
    ]),
  );
  const docs = await Promise.all(
    [...bytes].map(([name, data]) =>
      parseDocument(name.split("/").pop()!, data),
    ),
  );
  const email: Email = {
    email_id: "upload_replacement-test",
    from: "ops@example.test",
    subject: "Check draft BL",
    body: "Please compare the SI and draft BL.",
    attachments: [...bytes.keys()],
  };
  const selection = multiple
    ? {
        si: { name: docs[0].name, sha256: docs[0].sha256! },
        bl: { name: docs[1].name, sha256: docs[1].sha256! },
        ...reviewer,
        selected_at: new Date().toISOString(),
      }
    : undefined;
  const previous = analyze(email, docs, 0, undefined, undefined, selection);
  const read = async (name: string) => bytes.get(name) ?? null;
  return { previous, bytes, read };
}
async function revised(text: string, name = "revised-bl.txt") {
  const bytes = new TextEncoder().encode(text);
  return { document: await parseDocument(name, bytes), bytes };
}

test("a revised BL retains SI fingerprints and recomputes all seven fields", async () => {
  const f = await fixture();
  const next = await revised(source("BL"));
  f.bytes.set(`uploads/${next.document.name}`, next.bytes);
  const before = structuredClone(f.previous);
  const { result, retainedSi } = await replaceDraftBl(
    f.previous,
    next.document,
    f.read,
    reviewer,
  );
  assert.equal(result.status, "OK");
  assert.deepEqual(
    result.comparison.map((row) => row.field),
    [...FIELDS],
  );
  assert.deepEqual(retainedSi, {
    name: "si.txt",
    sha256: f.previous.documents[0].sha256,
  });
  assert.equal(result.documents[0].sha256, f.previous.documents[0].sha256);
  assert.deepEqual(result.email.attachments, [
    "uploads/si.txt",
    "uploads/revised-bl.txt",
  ]);
  assert.equal(result.reviewed, true);
  assert.equal(result.source_replaced, true);
  assert.deepEqual(f.previous, before);
});

test("unchanged SI corrections survive; corrections on the replaced BL never do", async () => {
  const f = await fixture();
  let previous = correctField(
    f.previous,
    { field: "shipper", side: "si", value: "ALPHA VERIFIED LTD" },
    reviewer.actor,
  );
  previous = correctField(
    previous,
    { field: "gross_weight_kg", side: "bl", value: "42000 KG" },
    reviewer.actor,
  );
  const next = await revised(source("BL", "44000 KG", "ALPHA VERIFIED LTD"));
  f.bytes.set(`uploads/${next.document.name}`, next.bytes);
  const { result, retainedCorrections } = await replaceDraftBl(
    previous,
    next.document,
    f.read,
    reviewer,
  );
  assert.deepEqual(retainedCorrections, ["shipper"]);
  assert.equal(result.comparison[0].result, "match");
  assert.match(result.comparison[0].si.method, /^Human correction/);
  assert.deepEqual(result.defect_fields, ["gross_weight_kg"]);
  assert.equal(result.comparison.at(-1)!.bl.normalized, 44000);
  assert.doesNotMatch(result.comparison.at(-1)!.bl.method, /Human correction/);
});

test("selected multi-attachment cases retain every excluded source and replace only the selected BL", async () => {
  const f = await fixture(true);
  const next = await revised(source("BL"));
  f.bytes.set(`uploads/${next.document.name}`, next.bytes);
  const { result } = await replaceDraftBl(
    f.previous,
    next.document,
    f.read,
    reviewer,
  );
  assert.equal(result.status, "OK");
  assert.equal(result.documents.length, 4);
  assert.equal(
    result.document_selection?.si.sha256,
    f.previous.documents[0].sha256,
  );
  assert.equal(result.document_selection?.bl.name, "revised-bl.txt");
  for (const old of f.previous.documents.slice(2))
    assert.deepEqual(
      result.documents.find((doc) => doc.name === old.name),
      old,
    );
  assert.match(
    result.summary,
    /2 other attachments are retained but not verified/,
  );
});

test("a wrong-role replacement stays in review and cannot fall back to an excluded matching BL", async () => {
  const f = await fixture(true);
  const next = await revised("COMMERCIAL INVOICE\nInvoice: SYNTHETIC-NEW");
  f.bytes.set(`uploads/${next.document.name}`, next.bytes);
  const { result } = await replaceDraftBl(
    f.previous,
    next.document,
    f.read,
    reviewer,
  );
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.comparison.length, 0);
  assert.equal(result.document_selection?.bl.name, "revised-bl.txt");
  assert.equal(blReplacementSources(result).si.name, "si.txt");
});

test("ambiguous SI selection, stale engines and changed retained bytes are rejected", async () => {
  const f = await fixture(true);
  assert.throws(
    () =>
      blReplacementSources({ ...f.previous, document_selection: undefined }),
    { status: 422 },
  );
  assert.throws(
    () => blReplacementSources({ ...f.previous, pipeline_version: "old" }),
    { status: 409 },
  );
  const next = await revised(source("BL"));
  f.bytes.set(`uploads/${next.document.name}`, next.bytes);
  f.bytes.set(
    "uploads/si.txt",
    new TextEncoder().encode(source("SI", "999 KG")),
  );
  await assert.rejects(
    replaceDraftBl(f.previous, next.document, f.read, reviewer),
    { status: 409, message: /retained SI/ },
  );
});

test("source-bound SI recovery survives reparse without transferring to the revised BL", async () => {
  const f = await fixture();
  const si = f.previous.documents[0];
  const selections = Object.fromEntries(
    FIELDS.map((field, i) => [
      field,
      {
        citations: [{ line: i + 2, quote: i === 6 ? "42000" : values[i] }],
        unit_citation: i === 6 ? { line: 8, quote: "KG" } : null,
      },
    ]),
  );
  const validated = validateProviderProposal(si, {
    role: "SI",
    fields: selections,
  });
  const recovery: ConfirmedRecovery = {
    proposal_id: crypto.randomUUID(),
    sha256: si.sha256!,
    text_sha256: await sourceTextHash(si),
    role: "SI",
    fields: validated.fields as ConfirmedRecovery["fields"],
    provider: "openai",
    model: "synthetic-test",
    prompt_version: "synthetic-test",
    ...reviewer,
    confirmed_at: new Date().toISOString(),
  };
  const recovered = await recoverDocument(si, recovery);
  const previous = analyze(f.previous.email, [
    recovered,
    f.previous.documents[1],
  ]);
  const next = await revised(source("BL"));
  f.bytes.set(`uploads/${next.document.name}`, next.bytes);
  const { result } = await replaceDraftBl(
    previous,
    next.document,
    f.read,
    reviewer,
  );
  assert.equal(result.status, "OK");
  assert.deepEqual(result.documents[0].recovery, recovery);
  assert.equal(result.documents[1].recovery, undefined);
});

test("source-bound SI scan confirmation survives a BL-only replacement", async () => {
  const scanEmail = emails.find((email) => email.email_id === "email_512")!;
  const scans = await Promise.all(
    scanEmail.attachments.map(async (name) => ({
      name,
      bytes: bundleBytes(name)!,
      document: await parseDocument(name.split("/").pop()!, bundleBytes(name)!),
    })),
  );
  const scan = scans.find(({ document }) => canTranscribe(document));
  assert.ok(
    scan,
    "The organiser synthetic scan fixture must parse as an image-only PDF.",
  );
  const transcript: Transcript = {
    role: "SI",
    fields: Object.fromEntries(
      FIELDS.map((field, i) => [field, { value: values[i], page: 1 }]),
    ) as Transcript["fields"],
    ...reviewer,
    confirmed_at: new Date().toISOString(),
  };
  const si = transcribeDocument(scan.document, transcript);
  const f = await fixture();
  f.bytes.delete("uploads/si.txt");
  f.bytes.set(scan.name, scan.bytes);
  const previous = analyze(
    { ...f.previous.email, attachments: [scan.name, "uploads/bl.txt"] },
    [si, f.previous.documents[1]],
  );
  const next = await revised(source("BL"));
  f.bytes.set(`uploads/${next.document.name}`, next.bytes);
  const { result } = await replaceDraftBl(
    previous,
    next.document,
    f.read,
    reviewer,
  );
  assert.equal(result.status, "OK");
  assert.deepEqual(result.documents[0].transcription, transcript);
  assert.equal(result.documents[1].transcription, undefined);
});

test("BL-only upload API retains source history, rejects forged control fields and serializes revisions", async (t) => {
  const workRoot = path.resolve("work");
  await fs.mkdir(workRoot, { recursive: true });
  const dir = await fs.mkdtemp(path.join(workRoot, "bl-replacement-api-test-"));
  const oldEnv = { ...process.env };
  process.env.CARGO_LOCAL_DB = path.join(dir, "test.db");
  for (const name of [
    "TURSO_DATABASE_URL",
    "TURSO_AUTH_TOKEN",
    "RENDER",
    "CARGO_PUBLIC_ORIGIN",
    "RENDER_EXTERNAL_URL",
  ])
    delete process.env[name];
  const client = createClient({ url: `file:${process.env.CARGO_LOCAL_DB}` });
  try {
    for (const file of (await fs.readdir("drizzle"))
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await client.executeMultiple(
        await fs.readFile(`drizzle/${file}`, "utf8"),
      );
    const f = await fixture(true);
    const owner = crypto.randomUUID();
    await saveCases(owner, [
      {
        result: f.previous,
        expected: 0,
        action: "UPLOADED",
        actor: reviewer.actor,
        detail: "Synthetic fixture",
      },
    ]);
    for (const [name, bytes] of f.bytes)
      await storage().BUCKET.put(
        `${owner}/${f.previous.email.email_id}/${name.split("/").pop()}`,
        bytes,
      );
    const form = (version: number) => {
      const data = new FormData();
      for (const [key, value] of Object.entries({
        mode: "replace_bl",
        id: f.previous.email.email_id,
        version: String(version),
        ...reviewer,
      }))
        data.set(key, value);
      data.set(
        "bl",
        new File([source("BL")], "returned-bl.txt", { type: "text/plain" }),
      );
      return data;
    };
    const send = (data: FormData, workspace = owner) =>
      upload(
        new Request("https://cargo.example/api/upload", {
          method: "POST",
          headers: {
            Cookie: `cargo_workspace=${workspace}`,
            Origin: "https://cargo.example",
          },
          body: data,
        }),
      );
    const getBytes = async (name: string, version: number, workspace = owner) =>
      documentResponse(
        new Request(
          `https://cargo.example/api/document?id=${f.previous.email.email_id}&name=${encodeURIComponent(name)}&revision=${version}`,
          { headers: { Cookie: `cargo_workspace=${workspace}` } },
        ),
      );
    await t.test(
      "a client cannot substitute the reference SI or smuggle extra files",
      async () => {
        for (const field of ["si", "files", "sourcePath"]) {
          const data = form(1);
          data.append(field, "forged-reference");
          assert.equal((await send(data)).status, 400);
        }
        for (const field of ["mode", "bl"]) {
          const data = form(1);
          data.append(field, "duplicate");
          assert.equal((await send(data)).status, 400);
        }
        assert.equal((await send(form(1), crypto.randomUUID())).status, 409);
        assert.equal(
          (await getCase(owner, f.previous.email.email_id))?.version,
          1,
        );
      },
    );
    await t.test(
      "only the selected BL changes and both historical originals remain downloadable",
      async () => {
        const response = await send(form(1));
        assert.equal(response.status, 200);
        const { result } = (await response.json()) as { result: CaseResult };
        assert.equal(result.version, 2);
        assert.equal(result.status, "OK");
        assert.equal(
          result.documents[0].sha256,
          f.previous.documents[0].sha256,
        );
        assert.equal(result.documents.length, 4);
        assert.equal(result.document_selection?.si.name, "si.txt");
        const revision = await getRevision(owner, f.previous.email.email_id, 1);
        assert.deepEqual(
          revision?.documents,
          JSON.parse(JSON.stringify(f.previous.documents)),
        );
        for (const name of [
          "si.txt",
          "bl.txt",
          "excluded-old-bl.txt",
          "invoice.txt",
        ]) {
          const old = await getBytes(name, 1);
          assert.equal(old.status, 200);
          assert.deepEqual(
            new Uint8Array(await old.arrayBuffer()),
            f.bytes.get(`uploads/${name}`),
          );
        }
        assert.equal((await getBytes("si.txt", 2)).status, 200);
        assert.equal(
          (await getBytes("si.txt", 2, crypto.randomUUID())).status,
          404,
        );
      },
    );
    await t.test(
      "two simultaneous revisions have one winner and cleanup cannot remove retained evidence",
      async () => {
        const before = Number(
          (await client.execute("SELECT COUNT(*) AS n FROM attachment_blobs"))
            .rows[0].n,
        );
        const responses = await Promise.all([send(form(2)), send(form(2))]);
        assert.deepEqual(
          responses.map((response) => response.status).sort(),
          [200, 409],
        );
        const latest = await getCase(owner, f.previous.email.email_id);
        assert.equal(latest?.version, 3);
        const after = Number(
          (await client.execute("SELECT COUNT(*) AS n FROM attachment_blobs"))
            .rows[0].n,
        );
        assert.equal(after, before + 1);
        assert.equal((await getBytes("si.txt", 3)).status, 200);
        assert.equal((await getBytes("bl.txt", 1)).status, 200);
      },
    );
    await t.test(
      "an unknown commit response retains the newly referenced BL and all historical bytes",
      async () => {
        const db = storage().DB;
        const originalBatch = db.batch.bind(db);
        db.batch = async (...args: Parameters<typeof db.batch>) => {
          await originalBatch(...args);
          throw new Error("Synthetic lost commit response");
        };
        try {
          assert.equal((await send(form(3))).status, 503);
        } finally {
          db.batch = originalBatch;
        }
        const latest = await getCase(owner, f.previous.email.email_id);
        assert.equal(latest?.version, 4);
        assert.equal(
          (await getBytes(latest!.document_selection!.bl.name, 4)).status,
          200,
        );
        assert.equal((await getBytes("si.txt", 4)).status, 200);
        assert.equal((await getBytes("bl.txt", 1)).status, 200);
      },
    );
  } finally {
    client.close();
    for (const name of Object.keys(process.env))
      if (!(name in oldEnv)) delete process.env[name];
    Object.assign(process.env, oldEnv);
    assert.ok(path.resolve(dir).startsWith(`${workRoot}${path.sep}`));
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});
