import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { emails, bundleBytes } from "../lib/bundle";
import {
  assessPort,
  buildPortReferenceIndex,
  checkPortReferences,
  parseStatedPort,
  resolveCountry,
  type PortReferenceData,
} from "../lib/port-reference";
import { loadPortReference } from "../lib/port-reference-data";
import { portReference } from "../lib/port-reference-server";
import unlocode from "../lib/reference/unlocode.json";

const data = unlocode as unknown as PortReferenceData;

test("snapshot provenance and size are recorded", () => {
  assert.equal(data.dataset, "UN/LOCODE");
  assert.equal(data.release, "2024-2");
  assert.equal(data.license, "ODC-PDDL-1.0");
  const index = portReference();
  assert.ok(index.ports.size > 15_000, "port-function entries");
  assert.ok(index.other.size > 90_000, "other-function codes");
  assert.equal(index.countries.get("KE"), "Kenya");
  assert.equal(index.countries.get("US"), "United States of America");
});

test("browser and server loaders build the same index", async () => {
  const lazy = await loadPortReference();
  const server = portReference();
  assert.equal(lazy.release, server.release);
  assert.equal(lazy.ports.size, server.ports.size);
  assert.equal(lazy.other.size, server.other.size);
});

test("stated ports are parsed without guessing a code", () => {
  assert.deepEqual(parseStatedPort("PORT KLANG (WESTPORT), MALAYSIA (MYPKG)"), {
    name: "PORT KLANG (WESTPORT)",
    country: "MALAYSIA",
    code: "MYPKG",
  });
  assert.deepEqual(parseStatedPort("SINGAPORE (SGSIN)"), {
    name: "SINGAPORE",
    country: null,
    code: "SGSIN",
  });
  assert.deepEqual(parseStatedPort("Nhava Sheva, India"), {
    name: "Nhava Sheva",
    country: "India",
    code: null,
  });
  assert.equal(parseStatedPort("MYPKG").code, "MYPKG");
  assert.equal(parseStatedPort("PORT KLANG (WESTPORT)").code, null);
});

test("trade country spellings resolve and ambiguous short forms do not", () => {
  const index = portReference();
  for (const [name, code] of [
    ["US", "US"],
    ["UAE", "AE"],
    ["SOUTH KOREA", "KR"],
    ["VIETNAM", "VN"],
    ["Viet Nam", "VN"],
    ["TURKEY", "TR"],
    ["Türkiye", "TR"],
    ["MALAYSIA", "MY"],
    ["GUINEA", "GN"],
  ])
    assert.equal(resolveCountry(index, name), code, name);
  assert.equal(resolveCountry(index, "KOREA"), null);
  assert.equal(resolveCountry(index, "CONGO"), null);
  assert.equal(resolveCountry(index, "ATLANTIS"), null);
});

test("each outcome is explicit and cautious", () => {
  const index = portReference();
  const status = (raw: string) => assessPort(raw, index).status;
  assert.equal(status("PORT KLANG (WESTPORT), MALAYSIA (MYPKG)"), "passed");
  assert.equal(status("NHAVA SHEVA, INDIA (INNSA)"), "passed");
  assert.equal(status("HOCHIMINH CITY, VIETNAM (VNSGN)"), "passed");
  assert.equal(status("SINGAPORE (SGSIN)"), "passed");
  // Country prefix contradiction is an internal error in one document.
  const contradiction = assessPort("TUTICORIN, INDIA (KEMBA)", index);
  assert.equal(contradiction.status, "blocking");
  assert.match(contradiction.detail, /Kenya/);
  assert.match(contradiction.detail, /Mombasa/);
  // Unknown codes and different reference names are advisories, not errors.
  assert.equal(status("AQABA, JORDAN (JOAQB)"), "review");
  const differentName = assessPort("BUATAN, INDONESIA (IDBUA)", index);
  assert.equal(differentName.status, "review");
  assert.match(differentName.detail, /Bula/);
  // A code listed without a port function is not compared, and not passed.
  assert.equal(status("RUGAO/NANTONG/SHANGHAI, CHINA (CNSHA)"), "not_checked");
  assert.equal(status("NANTONG, CHINA"), "not_checked");
  // Only a trailing parenthesised code counts; text after it means no code.
  assert.equal(status("PORT KLANG (NORTH), XX"), "not_checked");
  assert.equal(status("SOMEWHERE (ZZABC)"), "not_checked");
  assert.equal(status("MYPKG"), "not_checked");
});

test("synthetic reference data keeps the checker independent of the snapshot", () => {
  const index = buildPortReferenceIndex({
    dataset: "UN/LOCODE",
    release: "0000-0",
    license: "test",
    countries: { AA: "Alphaland", BB: "Betaland" },
    ports: { AA: "PRT|Alpha Harbour (Old Town)|1" },
    other: { AA: "AIR" },
  });
  assert.equal(
    assessPort("OLD TOWN, ALPHALAND (AAPRT)", index).status,
    "passed",
  );
  assert.equal(
    assessPort("ALPHA HARBOUR, BETALAND (AAPRT)", index).status,
    "blocking",
  );
  assert.equal(
    assessPort("ALPHA AIRPORT (AAAIR)", index).status,
    "not_checked",
  );
  assert.equal(
    assessPort("ELSEWHERE, ALPHALAND (AAXYZ)", index).status,
    "review",
  );
});

test("case assessment uses the compared values and never mutates the result", async () => {
  const text = (port: string) =>
    `Shipper: A\nConsignee: B\nNotify party: C\nPort of loading: SINGAPORE (SGSIN)\nPort of discharge: ${port}\nContainer count: 1\nGross weight (KG): 1000`;
  const result = analyze(
    {
      email_id: "ports",
      from: "a@example.test",
      subject: "Please check draft BL against SI",
      body: "Compare the attached SI and draft BL",
      attachments: ["si.txt", "bl.txt"],
    },
    await Promise.all([
      parseDocument(
        "si.txt",
        new TextEncoder().encode(
          `SHIPPING INSTRUCTION\n${text("MOMBASA, KENYA (KEMBA)")}`,
        ),
      ),
      parseDocument(
        "bl.txt",
        new TextEncoder().encode(
          `DRAFT BILL OF LADING\n${text("TUTICORIN, INDIA (KEMBA)")}`,
        ),
      ),
    ]),
  );
  const before = JSON.stringify(result);
  const assessment = checkPortReferences(result, portReference());
  assert.equal(JSON.stringify(result), before);
  assert.equal(assessment.findings.length, 4);
  assert.deepEqual(assessment.counts, {
    passed: 3,
    blocking: 1,
    review: 0,
    not_checked: 0,
  });
  const blocking = assessment.findings.find((f) => f.status === "blocking")!;
  assert.equal(blocking.document, "BL · bl.txt");
  assert.equal(blocking.evidence[0].quote, "TUTICORIN, INDIA (KEMBA)");
  assert.match(blocking.evidence[0].source_sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.equal(
    checkPortReferences({ documents: [], comparison: [] }, portReference())
      .findings[0].status,
    "not_checked",
  );
});

test("organiser inbox: country contradictions occur only where the seven-field check already found a port mismatch", async () => {
  const index = portReference();
  let blocking = 0;
  for (const email of emails) {
    const docs = [];
    for (const name of email.attachments) {
      const bytes = bundleBytes(name);
      if (bytes) docs.push(await parseDocument(name.split("/").pop()!, bytes));
    }
    const result = analyze(email, docs);
    if (!result.comparison.length) continue;
    for (const finding of checkPortReferences(result, index).findings) {
      if (finding.status !== "blocking") continue;
      blocking++;
      const field = finding.id.split(":")[1];
      const row = result.comparison.find((r) => r.field === field)!;
      assert.equal(row.result, "mismatch", email.email_id);
      assert.equal(result.workflow, "discrepancy", email.email_id);
    }
  }
  assert.equal(blocking, 16);
});
