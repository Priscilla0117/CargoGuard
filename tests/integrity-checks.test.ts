import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import {
  checkDocumentIntegrity,
  containerCheckDigit,
  validateContainerIdentifier,
} from "../lib/integrity-checks";
import type { ParsedDocument } from "../lib/types";

function doc(
  text: string,
  overrides: Partial<ParsedDocument> = {},
): ParsedDocument {
  return {
    name: "draft.txt",
    type: "BL",
    format: "txt",
    method: "UTF-8 text",
    sha256: "a".repeat(64),
    lines: text
      .split("\n")
      .map((text, i) => ({ text, location: `Line ${i + 1}` })),
    ...overrides,
  };
}
function checks(document: ParsedDocument) {
  return checkDocumentIntegrity({ documents: [document], comparison: [] });
}
function recordPdfCoverage(source: ParsedDocument) {
  source.pdf_coverage = {
    version: 1,
    pages: Array.from({ length: source.page_count! }, (_, index) => {
      const text_items = source.lines.filter((line) =>
        line.location.startsWith(`Page ${index + 1},`),
      ).length;
      return {
        page: index + 1,
        text_items,
        has_images: false,
        requires_review: !text_items,
      };
    }),
  };
  return source;
}
function list(text: string, count = 1) {
  return doc(
    `Container count: ${count}\nComplete container list:\n${text}\nEnd container list`,
  );
}
const forRule = (document: ParsedDocument, rule: string) =>
  checks(document).findings.filter((finding) => finding.rule === rule);

test("ISO 6346 known checksum vectors and malformed bases", () => {
  assert.equal(containerCheckDigit("MSCU123456"), 6);
  assert.equal(containerCheckDigit("CSQU305438"), 3);
  assert.equal(containerCheckDigit("TGHU759933"), 0);
  assert.equal(containerCheckDigit("MSCA123456"), null);
  assert.equal(containerCheckDigit("MSCU12345"), null);
  assert.equal(containerCheckDigit("MSCU1234560"), null);
});
test("remainder ten follows the defined zero check digit mapping", () => {
  // ABCU000007 has weighted sum 1770, remainder 10.
  assert.equal(containerCheckDigit("ABCU000007"), 0);
});
test("bad check digit is an issue, not a suggested automatic repair", () => {
  const result = validateContainerIdentifier("MSCU1234560");
  assert.equal(result.status, "invalid");
  assert.equal(result.expected_digit, 6);
  assert.equal(result.normalized, "MSCU1234560");
  assert.match(result.reason, /Confirm the whole identifier/);
});
test("valid syntax does not assert physical existence or registration", () => {
  const result = validateContainerIdentifier("mscu 123456-6");
  assert.equal(result.status, "valid");
  assert.match(result.reason, /does not verify registration, existence/);
});
for (const raw of [
  "MSCU12345O6",
  "MSCU123456",
  "MSCA1234566",
  "MSCU12345666",
  "MSCU12345?6",
]) {
  test(`ambiguous or incomplete identifier requires review: ${raw}`, () => {
    assert.equal(validateContainerIdentifier(raw).status, "uncertain");
    assert.notEqual(
      forRule(doc(`Container number: ${raw}`), "container_identifier")[0]
        .status,
      "passed",
    );
  });
}
test("both documents can match all seven fields while both contain an invalid identifier", async () => {
  const files = ["si-matching-invalid-id.txt", "bl-matching-invalid-id.txt"];
  const docs = await Promise.all(
    files.map(async (name) =>
      parseDocument(
        name,
        await readFile(
          new URL(`../examples/integrity-checks/${name}`, import.meta.url),
        ),
      ),
    ),
  );
  const result = analyze(
    {
      email_id: "integrity-fixture",
      from: "demo@example.test",
      subject: "Check SI and draft BL",
      body: "Please compare the draft BL against SI.",
      attachments: files,
    },
    docs,
    0,
    "BL_COMPARISON",
  );
  assert.equal(result.workflow, "verified");
  const before = JSON.stringify(result);
  const extra = checkDocumentIntegrity(result);
  assert.equal(extra.counts.blocking, 2);
  assert.equal(extra.requires_attention, true);
  assert.equal(
    JSON.stringify(result),
    before,
    "Independent checks must not mutate the scored result",
  );
  const invalid = extra.findings.find(
    (finding) => finding.status === "blocking",
  )!;
  assert.equal(invalid.evidence[0].quote, "MSCU1234560");
  assert.match(invalid.evidence[0].location, /^Line \d+$/);
  assert.match(invalid.evidence[0].source_sha256!, /^[a-f0-9]{64}$/);
  assert.equal(invalid.rule_version, "1.0.0");
});
test("missing identifiers and absent fingerprints are never passed", () => {
  assert.equal(
    forRule(doc("Container count: 2"), "container_identifier")[0].status,
    "not_checked",
  );
  const result = checks(
    doc("Container number: MSCU1234566", { sha256: undefined }),
  );
  assert.equal(result.counts.passed, 0);
  assert.equal(result.findings[0].status, "not_checked");
});
test("valid J/Z equipment is not automatically counted as a freight container", () => {
  for (const category of ["J", "Z"]) {
    const base = `ABC${category}123456`;
    const source = list(`${base}${containerCheckDigit(base)}`);
    assert.equal(forRule(source, "container_identifier")[0].status, "review");
    assert.match(
      forRule(source, "container_identifier")[0].detail,
      /not a freight container/,
    );
    assert.equal(forRule(source, "container_count")[0].status, "not_checked");
  }
});
test("unreadable and unconfirmed OCR text cannot establish a pass", () => {
  assert.equal(
    checks(doc("MSCU1234566", { error: "Corrupt source" })).findings[0].status,
    "review",
  );
  assert.equal(
    checks(doc("MSCU1234566", { method: "Browser OCR" })).findings[0].status,
    "review",
  );
});
test("complete lists compare distinct identifiers and preserve repeat evidence", () => {
  const result = checks(
    list(
      "Container number | Size\nMSCU1234566\nMSCU1234566\nContainer number | Size\nCSQU3054383",
      2,
    ),
  );
  assert.equal(
    result.findings.find((f) => f.rule === "container_count")!.status,
    "passed",
  );
  assert.equal(
    result.findings.filter((f) => f.rule === "container_identifier").length,
    2,
  );
  assert.equal(
    result.findings.find((f) => f.title === "Container MSCU1234566")!.evidence
      .length,
    2,
  );
});
test("complete list count disagreement is blocking", () => {
  assert.equal(
    forRule(list("MSCU1234566", 2), "container_count")[0].status,
    "blocking",
  );
});
for (const text of [
  "Container count: 2\nMSCU1234566",
  "Container count: 1\nComplete container list:\nMSCU1234566\n...\nEnd container list",
  "Container count: 1\nComplete container list:\nMSCU1234566\nMSCU\nEnd container list",
  "Container count: 1\nComplete container list:\nMSCU1234566\nContinued on next page\nEnd container list",
]) {
  test(`incomplete list does not produce count pass: ${text.split("\n").at(-2)}`, () => {
    assert.equal(
      forRule(doc(text), "container_count")[0].status,
      "not_checked",
    );
  });
}
test("PDF list with absent page source cannot be declared complete", () => {
  const source = list("MSCU1234566");
  source.format = "pdf";
  source.page_count = 2;
  source.lines = source.lines.map((line, index) => ({
    ...line,
    location: `Page 1, y=${500 - index * 10}`,
  }));
  recordPdfCoverage(source);
  assert.equal(forRule(source, "source")[0].status, "blocking");
  assert.equal(checks(source).requires_attention, true);
});
test("PDF repeated headers across actual pages are counted once", () => {
  const source = list(
    "Container number | Size\nMSCU1234566\nContainer number | Size\nCSQU3054383",
    2,
  );
  source.format = "pdf";
  source.page_count = 2;
  source.lines = source.lines.map((line, index) => ({
    ...line,
    location: `Page ${index < 4 ? 1 : 2}, y=${500 - index * 10}`,
  }));
  recordPdfCoverage(source);
  assert.equal(forRule(source, "container_count")[0].status, "passed");
});
test("only the current selected pair contributes findings", () => {
  const selectedSi = doc("Container number: MSCU1234566", {
    name: "si.txt",
    type: "SI",
  });
  const selectedBl = doc("Container number: MSCU1234566");
  const oldBl = doc("Container number: MSCU1234560", {
    name: "old.txt",
    sha256: "b".repeat(64),
  });
  const selection = {
    si: { name: selectedSi.name, sha256: selectedSi.sha256! },
    bl: { name: selectedBl.name, sha256: selectedBl.sha256! },
    actor: "reviewer",
    reason: "current pair",
    selected_at: new Date().toISOString(),
  };
  const result = checkDocumentIntegrity({
    documents: [selectedSi, selectedBl, oldBl],
    comparison: [],
    document_selection: selection,
  });
  assert.equal(result.counts.blocking, 0);
  assert.ok(result.findings.every((f) => f.document !== "old.txt"));
  assert.equal(
    checkDocumentIntegrity({
      documents: [selectedSi, selectedBl, oldBl],
      comparison: [],
    }).findings[0].status,
    "review",
  );
  assert.equal(
    checkDocumentIntegrity({
      documents: [selectedSi, selectedBl],
      comparison: [],
      document_selection: {
        ...selection,
        bl: { ...selection.bl, sha256: "c".repeat(64) },
      },
    }).findings[0].status,
    "review",
  );
});
test("explicit per-container load exceeding source-stated maximum is blocking", () => {
  const source = doc(
    "Container number: MSCU1234566 | Loaded gross weight: 33000 KG | Tare: 3800 KG | Max gross weight: 32500 KG | Max payload: 28700 KG",
  );
  const finding = forRule(source, "container_capacity")[0];
  assert.equal(finding.status, "blocking");
  assert.match(finding.detail, /Loaded gross exceeds/);
  assert.match(finding.detail, /Payload exceeds/);
});
test("supported units convert and within-stated-limit check is narrowly labelled", () => {
  const finding = forRule(
    doc(
      "Container number: MSCU1234566 | Loaded gross weight: 30 MT | Tare: 3800 KG | Max gross weight: 32500 KG | Max payload: 28700 KG",
    ),
    "container_capacity",
  )[0];
  assert.equal(finding.status, "passed");
  assert.match(finding.detail, /30000 kg/);
  assert.match(finding.detail, /do not certify/);
});
for (const line of [
  "Gross weight: 60000 KG\nContainer count: 2",
  "Container number: MSCU1234566 | Loaded gross weight: 30000 KG",
  "Container number: MSCU1234566 | Loaded gross weight: 30000 LB | Max gross weight: 32500 KG",
  "Container number: MSCU1234566 | Loaded gross weight: 30000 | Max gross weight: 32500 KG",
  "MSCU1234566 CSQU3054383 | Loaded gross weight: 30000 KG | Max gross weight: 32500 KG",
]) {
  test(`averages, missing capacities, ambiguous equipment or units are not passed: ${line}`, () => {
    assert.equal(
      forRule(doc(line), "container_capacity")[0].status,
      "not_checked",
    );
  });
}
test("weights cannot be paired across different PDF page/baseline records", () => {
  const source = doc("", {
    format: "pdf",
    page_count: 2,
    lines: [
      {
        text: "Container number: MSCU1234566 | Loaded gross weight: 30000 KG",
        location: "Page 1, y=100",
      },
      { text: "Max gross weight: 32500 KG", location: "Page 2, y=100" },
    ],
  });
  recordPdfCoverage(source);
  assert.ok(forRule(source, "container_capacity").length > 0);
  assert.ok(
    forRule(source, "container_capacity").every(
      (f) => f.status === "not_checked",
    ),
  );
});
test("same-baseline PDF fragments retain a single source location", () => {
  const source = doc("", {
    format: "pdf",
    page_count: 1,
    lines: [
      { text: "Container number: MSCU1234566", location: "Page 1, y=100" },
      { text: "Loaded gross weight: 30000 KG", location: "Page 1, y=100" },
      { text: "Max gross weight: 32500 KG", location: "Page 1, y=100" },
    ],
  });
  recordPdfCoverage(source);
  const finding = forRule(source, "container_capacity")[0];
  assert.equal(finding.status, "passed");
  assert.equal(finding.evidence[0].location, "Page 1, y=100");
});
test("contradictory tare and payload produce independent weight findings", () => {
  const finding = forRule(
    doc(
      "Container number: MSCU1234566 | Loaded gross weight: 30000 KG | Tare: 3800 KG | Payload: 27000 KG | Max payload: 28000 KG",
    ),
    "container_capacity",
  )[0];
  assert.equal(finding.status, "blocking");
  assert.match(finding.detail, /minus tare differs/);
});
test("same normalized ports are an advisory, not an automatic shipment rejection", () => {
  const finding = forRule(
    doc("Port of loading: Singapore (SGSIN)\nPort of discharge: SINGAPORE"),
    "port_route",
  )[0];
  assert.equal(finding.status, "review");
  assert.match(finding.detail, /not proof/);
});
test("missing or contradictory ports cannot pass the route sanity check", () => {
  assert.equal(
    forRule(doc("POL: Singapore"), "port_route")[0].status,
    "not_checked",
  );
  assert.equal(
    forRule(
      doc("POL: Singapore\nPOL: Rotterdam\nPOD: Port Klang"),
      "port_route",
    )[0].status,
    "not_checked",
  );
});
