import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  operationsChallengeSchema,
  scoreOperationsCase,
  type ChallengeObserved,
} from "../scripts/evaluate-operations-challenge";

const raw = JSON.parse(
  await fs.readFile(
    new URL("./fixtures/operations-challenge.json", import.meta.url),
    "utf8",
  ),
);
const dataset = operationsChallengeSchema.parse(raw);

test("authored challenge declares synthetic provenance, unique paired sources and every field before scoring", () => {
  assert.equal(dataset.cases.length, 20);
  assert.equal(dataset.provenance.classification, "SYNTHETIC_SELF_AUTHORED");
  for (const mutate of [
    (copy: typeof raw) => {
      copy.cases[1].id = copy.cases[0].id;
    },
    (copy: typeof raw) => {
      copy.cases[0].input.documents[1].name = "si.txt";
    },
    (copy: typeof raw) => {
      delete copy.cases[0].expected.strict.field_results.consignee;
    },
    (copy: typeof raw) => {
      copy.provenance.external_customer_records_used = true;
    },
  ]) {
    const copy = structuredClone(raw);
    mutate(copy);
    assert.equal(operationsChallengeSchema.safeParse(copy).success, false);
  }
});

test("challenge scoring rejects missing, unexpected and duplicate integrity findings", () => {
  const expected = dataset.cases[12].expected;
  for (const change of ["missing", "extra", "weakened"] as const) {
    const actual = structuredClone(expected) as ChallengeObserved;
    if (change === "missing") actual.integrity.pop();
    if (change === "extra") actual.integrity.push({ ...actual.integrity[0] });
    if (change === "weakened") {
      actual.integrity = actual.integrity.map((finding) => ({
        ...finding,
        status: finding.status === "blocking" ? "not_checked" : finding.status,
      }));
      actual.requires_attention = false;
    }
    const result = scoreOperationsCase(expected, actual);
    assert.equal(result.strict_passed, true);
    assert.equal(result.integrity_passed, false);
    assert.equal(result.passed, false);
  }
});

test("challenge scoring cannot pass a missed defect, wrong reason or extra field", () => {
  const expected = dataset.cases[8].expected;
  const actual = structuredClone(expected) as ChallengeObserved;
  actual.strict.status = "OK";
  actual.strict.has_defect = false;
  actual.strict.defect_fields = [];
  actual.strict.field_results.consignee = "match";
  assert.equal(scoreOperationsCase(expected, actual).strict_passed, false);
  const wrongReason = structuredClone(
    dataset.cases[4].expected,
  ) as ChallengeObserved;
  wrongReason.strict.review_reason = "unreadable";
  assert.equal(
    scoreOperationsCase(dataset.cases[4].expected, wrongReason).strict_passed,
    false,
  );
  const extra = structuredClone(expected) as ChallengeObserved;
  extra.strict.field_results.unexpected = "match";
  assert.equal(scoreOperationsCase(expected, extra).strict_passed, false);
});

test("finding order and defect-field set order do not change an otherwise exact score", () => {
  const expected = dataset.cases[8].expected;
  const actual = structuredClone(expected) as ChallengeObserved;
  actual.integrity.reverse();
  actual.strict.defect_fields.reverse();
  assert.equal(scoreOperationsCase(expected, actual).passed, true);
});
