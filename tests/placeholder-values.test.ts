import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import { correctField } from "../lib/corrections";
import { normalizeValue } from "../lib/normalization";
import { parseDocument } from "../lib/parsers";
import { recoverDocument } from "../lib/recovery";
import {
  materializeSelection,
  sourceTextHash,
  type ConfirmedRecovery,
} from "../lib/recovery-schema";
import { transcribeDocument, type Transcript } from "../lib/transcription";
import { FIELDS, type Email, type Field } from "../lib/types";

const values: Record<Field, string> = {
  shipper: "ALPHA EXPORTS LTD",
  consignee: "BETA IMPORTS LTD",
  notify_party: "SAME AS CONSIGNEE",
  port_of_loading: "SINGAPORE",
  port_of_discharge: "PORT KLANG",
  container_count: "2",
  gross_weight_kg: "42000 KG",
};
const labels: Record<Field, string> = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify_party: "Notify Party",
  port_of_loading: "Port of Loading",
  port_of_discharge: "Port of Discharge",
  container_count: "Container Count",
  gross_weight_kg: "Gross Weight",
};
const email: Email = {
  email_id: "placeholder-regression",
  from: "ops@example.test",
  subject: "Please compare the SI and draft BL",
  body: "Please verify the draft BL against the SI.",
  attachments: ["si.txt", "bl.txt"],
};
async function document(
  role: "SI" | "BL",
  changes: Partial<typeof values> = {},
) {
  const fields = { ...values, ...changes };
  return parseDocument(
    `${role.toLowerCase()}.txt`,
    new TextEncoder().encode(
      [
        role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
        ...FIELDS.map((field) => `${labels[field]}: ${fields[field]}`),
      ].join("\n"),
    ),
  );
}

test("whole placeholder expressions include alternatives and parenthetical aliases", () => {
  for (const marker of [
    "TBA / TBC",
    "TO BE ADVISED (TBA)",
    "to be advised (t.b.a.)",
    "(TBC)",
    "TBA or TBC",
    "TBA & TBC",
    "NOT PROVIDED; UNKNOWN",
    "N/A / TBA",
    "N.A. (NOT AVAILABLE)",
    "ＴＢＡ ／ ＴＢＣ",
    " TBA / TBC \n10 Port Road",
    "TO BE ADVISED (TBA)\n10 Port Road",
  ]) {
    for (const field of FIELDS) {
      const result = normalizeValue(field, marker);
      assert.equal(result.value, null, `${field}: ${marker}`);
      assert.match(result.issue ?? "", /missing|placeholder/i);
    }
  }
});

for (const marker of ["TBA / TBC", "TO BE ADVISED (TBA)"]) {
  test(`one-sided and matching placeholders require review: ${marker}`, async () => {
    for (const field of FIELDS) {
      for (const side of ["si", "bl", "both"] as const) {
        const change = { [field]: marker };
        const result = analyze(
          email,
          await Promise.all([
            document("SI", side === "bl" ? {} : change),
            document("BL", side === "si" ? {} : change),
          ]),
        );
        const context = `${field}: ${side}`;
        assert.equal(result.status, "NEEDS_REVIEW", context);
        assert.equal(result.workflow, "review", context);
        assert.equal(result.review_reason, "missing_value", context);
        const row = result.comparison.find((row) => row.field === field)!;
        assert.equal(row.result, "uncertain", context);
        for (const key of ["si", "bl"] as const) {
          if (side === key || side === "both") {
            assert.equal(row[key].normalized, null, context);
            assert.equal(row[key].raw, marker, context);
          }
        }
        if (field === "consignee") {
          const notify = result.comparison.find(
            (row) => row.field === "notify_party",
          )!;
          assert.equal(notify.result, "uncertain", context);
        }
      }
    }
  });
}

test("placeholder words within complete company names remain valid and comparable", async () => {
  for (const name of [
    "NONE SUCH EXPORTS LTD",
    "TBA LOGISTICS LTD",
    "UNKNOWN BAY TRADING LTD",
    "PENDING CREEK EXPORTS LTD",
    "NA SHIPPING LTD",
    "TBC (MALAYSIA) SDN BHD",
    "TBA / ABC LOGISTICS LTD",
  ]) {
    assert.equal(normalizeValue("shipper", name).value, name);
    const changed = { shipper: name, consignee: name };
    const result = analyze(
      email,
      await Promise.all([document("SI", changed), document("BL", changed)]),
    );
    assert.equal(result.workflow, "verified", name);
    assert.ok(
      result.comparison.every((row) => row.result === "match"),
      name,
    );
  }
});

test("field corrections cannot turn compound placeholders into reviewed facts", async () => {
  const previous = analyze(
    email,
    await Promise.all([document("SI"), document("BL")]),
  );
  const original = structuredClone(previous);
  for (const value of ["TBA / TBC", "TO BE ADVISED (TBA)"]) {
    for (const field of FIELDS) {
      assert.throws(
        () =>
          correctField(previous, { field, side: "bl", value }, "Test reviewer"),
        { status: 422 },
      );
    }
  }
  assert.deepEqual(previous, original);
});

test("scan confirmation rejects compound placeholders and notification dependencies", () => {
  for (const value of ["TBA / TBC", "TO BE ADVISED (TBA)"]) {
    for (const field of ["consignee", "notify_party"] as const) {
      const transcript: Transcript = {
        role: "SI",
        fields: Object.fromEntries(
          FIELDS.map((key) => [
            key,
            { value: key === field ? value : values[key], page: 1 },
          ]),
        ) as Transcript["fields"],
        actor: "Test reviewer",
        reason: "Synthetic source validation test",
        confirmed_at: "2026-09-24T00:00:00Z",
      };
      assert.throws(
        () =>
          transcribeDocument(
            {
              name: "scan.pdf",
              format: "pdf",
              type: "UNKNOWN",
              lines: [],
              method: "PDF text and layout",
              error: "Image-only scan: no text layer.",
              sha256: "a".repeat(64),
              page_count: 1,
            },
            transcript,
          ),
        { status: 422 },
      );
    }
  }
});

test("source-grounded recovery cannot confirm compound placeholders", async () => {
  for (const marker of ["TBA / TBC", "TO BE ADVISED (TBA)"]) {
    for (const missingField of ["consignee", "notify_party"] as const) {
      const sourceValues = { ...values, [missingField]: marker };
      const doc = await document("SI", sourceValues);
      const recovery: ConfirmedRecovery = {
        proposal_id: "synthetic-no-provider-call",
        sha256: doc.sha256!,
        text_sha256: await sourceTextHash(doc),
        role: "SI",
        fields: Object.fromEntries(
          FIELDS.map((field, index) => [
            field,
            materializeSelection(doc, field, {
              citations: [{ line: index + 2, quote: sourceValues[field] }],
              unit_citation: null,
            }),
          ]),
        ) as ConfirmedRecovery["fields"],
        provider: "openai",
        model: "synthetic-test",
        prompt_version: "synthetic-test",
        actor: "Test reviewer",
        reason: "Synthetic source validation test",
        confirmed_at: "2026-09-24T00:00:00Z",
      };
      await assert.rejects(() => recoverDocument(doc, recovery), {
        status: 422,
      });
    }
  }
});
