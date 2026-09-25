import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { analyze, extract, recomputeRows } from "../lib/compare";
import { normalizeValue, normalize } from "../lib/normalization";
import { classify, currentMessage } from "../lib/classifier";
import { parseDocument } from "../lib/parsers";
import { mapLimited, processEmail } from "../lib/processing";
import { readForm } from "../lib/http";
import { requestJson, latencySummary } from "../lib/client-api";
import { FIELDS, type Email, type Field } from "../lib/types";

const fields: Record<Field, string> = {
  shipper: "ALPHA EXPORTS LTD",
  consignee: "BETA IMPORTS LTD",
  notify_party: "SAME AS CONSIGNEE",
  port_of_loading: "SINGAPORE",
  port_of_discharge: "PORT KLANG",
  container_count: "2 x 40HC",
  gross_weight_kg: "42000 KG",
};
const names: Record<Field, string> = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify_party: "Notify Party",
  port_of_loading: "Port of Loading",
  port_of_discharge: "Port of Discharge",
  container_count: "Container Count",
  gross_weight_kg: "Gross Weight (KG)",
};
const email: Email = {
  email_id: "independent-regression",
  from: "test@example.test",
  subject: "Please compare the attached SI and draft BL",
  body: "Verify all seven shipment fields against the SI.",
  attachments: ["si.txt", "bl.txt"],
};
function source(role: string, values = fields, order = [...FIELDS]) {
  return role + "\n" + order.map((f) => `${names[f]}: ${values[f]}`).join("\n");
}
async function documents(si = fields, bl = fields) {
  return Promise.all([
    parseDocument("si.txt", strToU8(source("SHIPPING INSTRUCTION", si))),
    parseDocument("bl.txt", strToU8(source("DRAFT BILL OF LADING", bl))),
  ]);
}

test("compound containers are fully consumed and summed", async () => {
  const r = analyze(
    email,
    await documents(fields, {
      ...fields,
      container_count: "2 x 20GP + 3 x 40HC",
    }),
  );
  assert.deepEqual(r.defect_fields, ["container_count"]);
  assert.equal(
    r.comparison.find((x) => x.field === "container_count")?.bl.normalized,
    5,
  );
});
for (const raw of [
  "2 containers (total 5)",
  "2 x 40HC extra 3",
  "2 x 40HC / 3 x 20GP",
  "2x",
  "0",
  "-1",
  "2.5",
  "9007199254740993",
  "2 +",
  "2,3",
  "2 or 3",
]) {
  test("unsafe container expression escalates: " + raw, async () => {
    const r = analyze(
      email,
      await documents(fields, { ...fields, container_count: raw }),
    );
    assert.equal(r.workflow, "review");
    assert.ok(
      r.comparison.find((x) => x.field === "container_count")?.bl.issue,
    );
  });
}
test("metamorphic container sums: 400 generated expressions", () => {
  for (let a = 1; a <= 20; a++)
    for (let b = 1; b <= 20; b++)
      assert.equal(
        normalize("container_count", `${a} x 20GP + ${b} x 40'HC`),
        a + b,
      );
});
for (const marker of [
  "TBD",
  "T.B.D.",
  "NOT PROVIDED",
  "N.A.",
  "NOT SPECIFIED",
  "to be determined",
  "awaiting confirmation",
  "—",
  "NIL",
  "none",
  "??",
  "unknown",
  "pending",
]) {
  test("matching missing markers never verify: " + marker, async () => {
    const v = { ...fields, port_of_loading: marker };
    assert.equal(analyze(email, await documents(v, v)).workflow, "review");
  });
}
test("placeholder inside multiline company value is not hidden by its address", () =>
  assert.equal(normalize("shipper", "TBD\n10 Port Road"), null));
test("real company containing placeholder-like words is retained", () =>
  assert.equal(
    normalize("shipper", "NONE SUCH EXPORTS LTD"),
    "NONE SUCH EXPORTS LTD",
  ));
for (const weight of [
  "0",
  "-1 KG",
  "42,50 KG",
  "4200,500 KG",
  "42.000 KG",
  "42,000 KG plus 50",
  "42,000 KG MT",
  "42e3",
  "Infinity",
]) {
  test("ambiguous/invalid weight requires review: " + weight, () =>
    assert.equal(normalizeValue("gross_weight_kg", weight).value, null),
  );
}
test("equivalent numeric units and valid grouping", () => {
  for (const raw of [
    "42000",
    "42,000 KG",
    "42 000 kgs",
    "42 tonnes",
    "42.0 mt",
    "42000.00 kilograms",
  ])
    assert.equal(normalize("gross_weight_kg", raw), 42000);
});
test("conflicting repeated port labels require review", async () => {
  const docs = await documents();
  docs[1] = await parseDocument(
    "bl.txt",
    strToU8(source("DRAFT BILL OF LADING") + "\nPort of Loading: PENANG"),
  );
  const r = analyze(email, docs);
  assert.equal(r.workflow, "review");
  assert.match(
    r.comparison.find((x) => x.field === "port_of_loading")?.bl.issue ?? "",
    /Conflicting/,
  );
});
test("identical repeated numeric labels remain safe", async () => {
  const docs = await documents();
  docs[1] = await parseDocument(
    "bl.txt",
    strToU8(source("DRAFT BILL OF LADING") + "\nContainer Count: 2 x 40HC"),
  );
  assert.equal(analyze(email, docs).workflow, "verified");
});
test("same-value notification confirmation is idempotent", async () => {
  const r = analyze(email, await documents());
  const rows = structuredClone(r.comparison);
  rows.find((x) => x.field === "notify_party")!.bl.raw = "SAME AS CONSIGNEE";
  assert.ok(recomputeRows(rows).every((x) => x.result === "match"));
});
for (const side of ["si", "bl"] as const)
  test(
    "consignee edits recompute notification dependency: " + side,
    async () => {
      const r = analyze(email, await documents());
      r.comparison.find((x) => x.field === "consignee")![side].raw =
        "NEW IMPORT LTD";
      const rows = recomputeRows(r.comparison);
      assert.equal(
        rows.find((x) => x.field === "notify_party")![side].normalized,
        "NEW IMPORT LTD",
      );
      assert.equal(
        rows.find((x) => x.field === "notify_party")!.result,
        "mismatch",
      );
    },
  );
test("unresolved consignee keeps SAME AS CONSIGNEE uncertain", async () => {
  const r = analyze(email, await documents({ ...fields, consignee: "TBD" }));
  assert.equal(
    r.comparison.find((x) => x.field === "notify_party")!.si.normalized,
    null,
  );
});
for (const subject of [
  "Reminder: shipping documents for today",
  "SI NEEDED",
  "Outstanding invoices",
  "Weekly status",
]) {
  test(
    "current verification request wins over misleading subject: " + subject,
    async () => {
      const r = analyze(
        {
          ...email,
          subject,
          body: "Please check the draft BL against the SI; both documents are attached.",
        },
        await documents(fields, { ...fields, gross_weight_kg: "43000 KG" }),
      );
      assert.equal(r.category, "BL_COMPARISON");
      assert.equal(r.workflow, "discrepancy");
    },
  );
}
test("current request survives external sender warning", () =>
  assert.equal(
    classify({
      ...email,
      subject: "Documents",
      body: "EXTERNAL SENDER: use caution\nPlease verify the draft bill of lading against the SI.",
    }).category,
    "BL_COMPARISON",
  ));
test("a forwarded old request does not become the current intent", () => {
  const e = {
    ...email,
    subject: "Office closure",
    body: "Our office is closed Monday for a public holiday.\nFrom: ops@example.test\nPlease compare the SI and draft BL.",
  };
  assert.equal(classify(e).category, "GENERAL");
  assert.ok(!currentMessage(e.body).includes("compare"));
});
test("ordinary from label does not truncate the request", () =>
  assert.ok(
    currentMessage(
      "Shipping from: Port Klang\nPlease check the draft BL.",
    ).includes("Please check"),
  ));
test("unknown vocabulary asks a human instead of using a class tie", async () => {
  const r = analyze(
    { ...email, subject: "ZXQ 917", body: "Xyzzy." },
    await documents(),
  );
  assert.equal(r.workflow, "review");
  assert.equal(r.review_reason, "uncertain_category");
});
test("attachment/routing conflict stays visible", async () => {
  const r = analyze(
    {
      ...email,
      subject: "Prepare shipping instructions",
      body: "Prepare shipping instructions for the next booking.",
    },
    await documents(),
  );
  assert.equal(r.workflow, "review");
  assert.equal(r.review_reason, "uncertain_category");
});
test("human category confirmation unlocks the same document pipeline", async () => {
  const r = analyze(
    { ...email, subject: "ZXQ", body: "Xyzzy." },
    await documents(),
    0,
    "BL_COMPARISON",
  );
  assert.equal(r.workflow, "verified");
  assert.equal(r.category_override, "BL_COMPARISON");
});
test("field order variation uses labels, not positions", async () => {
  const a = await parseDocument(
    "si.txt",
    strToU8(source("SHIPPING INSTRUCTION", fields, [...FIELDS].reverse())),
  );
  const b = await parseDocument(
    "bl.txt",
    strToU8(source("DRAFT BILL OF LADING")),
  );
  assert.equal(analyze(email, [a, b]).workflow, "verified");
});
test("unrecognized required label fails visibly", async () => {
  const docs = await documents();
  docs[1] = await parseDocument(
    "bl.txt",
    strToU8(
      source("DRAFT BILL OF LADING").replace(
        "Port of Loading:",
        "Embarkation location:",
      ),
    ),
  );
  assert.notEqual(analyze(email, docs).workflow, "verified");
});
test("mixed Word table paragraphs extract source values", async () => {
  const xml =
    "<w:document><w:body>" +
    source("DRAFT BILL OF LADING")
      .split("\n")
      .map((line) => "<w:p><w:r><w:t>" + line + "</w:t></w:r></w:p>")
      .join("") +
    "</w:body></w:document>";
  const docs = await documents();
  docs[1] = await parseDocument(
    "unfamiliar.docx",
    zipSync({ "word/document.xml": strToU8(xml) }),
  );
  assert.equal(analyze(email, docs).workflow, "verified");
});
test("extraction tracks source and value locations", async () => {
  const d = await parseDocument(
    "x.txt",
    strToU8(
      "SHIPPING INSTRUCTION\nPort of Loading\nSINGAPORE\nPort of Discharge\nPORT KLANG",
    ),
  );
  assert.match(extract(d).port_of_loading.evidence, /Line 2; value Line 3/);
});
test("batch mapper has bounded concurrency and stable order", async () => {
  let active = 0,
    peak = 0;
  const result = await mapLimited([1, 2, 3, 4, 5], 2, async (x) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 2));
    active--;
    return x * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(peak, 2);
});
test("engine upgrade preserves reviewed values when source hashes are unchanged", async () => {
  const read = async (path: string) =>
    strToU8(
      source(
        path === "si.txt" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
      ),
    );
  const old = await processEmail(email, read);
  old.reviewed = true;
  old.comparison.find((x) => x.field === "gross_weight_kg")!.bl = {
    ...old.comparison.find((x) => x.field === "gross_weight_kg")!.bl,
    raw: "43000 KG",
    method: "Human correction by Tester",
  };
  const next = await processEmail(email, read, old, true);
  assert.equal(next.status, "NEEDS_REVIEW");
  assert.equal(next.comparison.at(-1)!.bl.raw, "43000 KG");
  assert.equal(next.comparison.at(-1)!.bl.correction?.state, "unresolved");
  assert.equal(next.reviewed, true);
});
test("explicit reprocess discards extracted-value edits, not source documents", async () => {
  const read = async (path: string) =>
    strToU8(
      source(
        path === "si.txt" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
      ),
    );
  const old = await processEmail(email, read);
  old.reviewed = true;
  old.comparison.find((x) => x.field === "gross_weight_kg")!.bl.raw =
    "43000 KG";
  const next = await processEmail(email, read, old, false);
  assert.equal(next.workflow, "verified");
});
test("bounded multipart parser handles an actual file", async () => {
  const f = new FormData();
  f.append("files", new File(["example"], "file.txt"));
  const result = await readForm(
    new Request("http://localhost", { method: "POST", body: f }),
  );
  assert.equal((result.get("files") as File).name, "file.txt");
});
test("chunked oversized multipart is rejected before form decoding", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(11 * 1024 * 1024 + 1));
      controller.close();
    },
  });
  await assert.rejects(
    readForm(
      new Request("http://localhost", {
        method: "POST",
        headers: { "content-type": "multipart/form-data; boundary=test" },
        body,
        duplex: "half",
      } as RequestInit),
    ),
    /too large/,
  );
});
test("HTML error page produces an actionable client error", async () => {
  await assert.rejects(
    requestJson(
      "/api",
      {},
      async () => new Response("<html>Gateway error</html>", { status: 502 }),
    ),
    /temporarily unavailable or restarting/,
  );
});
test("JSON validation errors preserve their message", async () => {
  await assert.rejects(
    requestJson("/api", {}, async () =>
      Response.json({ error: "Case changed" }, { status: 409 }),
    ),
    /Case changed/,
  );
});
test("latency summary is measured from independent samples", () =>
  assert.deepEqual(latencySummary([30, 10, 20, 50, 40]), {
    count: 5,
    median: 30,
    p95: 50,
  }));

test("excessive weight precision is reviewed instead of silently rounded", () => {
  assert.equal(normalize("gross_weight_kg", "0.0004 KG"), null);
  assert.equal(normalize("gross_weight_kg", "42000.1234 KG"), null);
});
test("prize scam cannot borrow the invoice subject to evade quarantine", () => {
  const c = classify({
    ...email,
    subject: "Invoice payment: confirm details",
    body: "You were selected in a random prize draw. Claim your gift card now.",
  });
  assert.equal(c.category, "SPAM");
  assert.equal(c.needs_review, false);
});
test("legitimate customs invoice is not treated as a prize scam", () => {
  assert.equal(
    classify({
      ...email,
      subject: "Customs duty invoice payment",
      body: "Please clarify the invoice total for customs duty. We paid this invoice yesterday.",
    }).category,
    "INVOICE_QUERY",
  );
});
test("administrative greetings and outstanding-BL lists route to operations", () => {
  for (const body of [
    "Wishing colleagues a happy new year. Office resumes on Monday.",
    "Please find the list of outstanding BL for the documentation team.",
  ])
    assert.equal(
      classify({ ...email, subject: "Team update", body }).category,
      "GENERAL",
    );
});
