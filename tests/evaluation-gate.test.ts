import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { verifyEvaluation, runGate } from "../scripts/verify-evaluation.mjs";

const ok = {
  category: "GENERAL",
  status: "OK",
  review_reason: null,
  has_defect: false,
  defect_fields: [],
};
const defect = {
  category: "BL_COMPARISON",
  status: "MISMATCH",
  review_reason: null,
  has_defect: true,
  defect_fields: ["consignee", "container_count"],
};
const review = {
  category: "BL_COMPARISON",
  status: "NEEDS_REVIEW",
  review_reason: "unreadable",
  has_defect: false,
  defect_fields: [],
};
const truth = { alpha: ok, beta: defect, gamma: review };

test("offline exact gate accepts field-set ordering and records aggregates only", () => {
  const result = verifyEvaluation(
    {
      ...truth,
      beta: { ...defect, defect_fields: [...defect.defect_fields].reverse() },
    },
    truth,
  );
  assert.equal(result.passed, true);
  assert.equal(result.exact_matches, 3);
  assert.equal(result.exact_defect_cases, 1);
  assert.equal(result.exact_review_cases, 1);
  assert.equal(result.false_ok_decisions, 0);
  assert.equal(JSON.stringify(result).includes("alpha"), false);
});

test("offline exact gate rejects missing and extra IDs", () => {
  const result = verifyEvaluation(
    { alpha: ok, beta: defect, delta: review },
    truth,
  );
  assert.equal(result.passed, false);
  assert.equal(result.missing_ids, 1);
  assert.equal(result.extra_ids, 1);
});

test("offline exact gate rejects wrong review reasons even when escalation is correct", () => {
  const result = verifyEvaluation(
    { ...truth, gamma: { ...review, review_reason: "missing_value" } },
    truth,
  );
  assert.equal(result.passed, false);
  assert.equal(result.mismatched_records, 1);
  assert.equal(result.exact_review_cases, 0);
});

test("offline exact gate counts incorrect OK outcomes without claiming UI clearance", () => {
  const result = verifyEvaluation(
    { ...truth, beta: { ...ok, category: "BL_COMPARISON" }, gamma: ok },
    truth,
  );
  assert.equal(result.passed, false);
  assert.equal(result.false_ok_decisions, 2);
});

test("offline exact gate rejects malformed and internally inconsistent contracts", () => {
  for (const invalid of [
    { ...ok, category: "UNKNOWN" },
    { ...ok, status: "CLEARED" },
    { ...ok, has_defect: "false" },
    { ...ok, extra: "not in organiser contract" },
    { ...defect, defect_fields: ["consignee", "consignee"] },
    { ...defect, defect_fields: ["unknown"] },
    { ...defect, defect_fields: [] },
    { ...defect, category: "GENERAL" },
    { ...review, review_reason: null },
    { ...ok, review_reason: "unreadable" },
    { ...ok, has_defect: true },
  ])
    assert.throws(() => verifyEvaluation({ item: invalid }, { item: ok }));
  for (const invalid of [null, [], {}, { item: null }]) {
    assert.throws(() => verifyEvaluation(invalid, truth));
    assert.throws(() => verifyEvaluation(truth, invalid));
  }
});

test("offline CLI produces hash-bound sanitized evidence and fails nonzero on mismatch", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "cargoguard-evaluation-test-"),
  );
  try {
    const predictions = path.join(directory, "predictions.json");
    const reference = path.join(directory, "reference.json");
    const output = path.join(directory, "report.json");
    await fs.writeFile(predictions, JSON.stringify(truth));
    await fs.writeFile(reference, JSON.stringify(truth));
    const report = await runGate([
      "--predictions",
      predictions,
      "--truth",
      reference,
      "--report",
      output,
      "--engine",
      "fixture",
    ]);
    assert.equal(report.passed, true);
    assert.equal(report.predictions_sha256, report.ground_truth_sha256);
    assert.match(report.verifier_sha256, /^[a-f0-9]{64}$/);
    assert.equal(report.official_scorer, null);
    assert.equal(JSON.stringify(report).includes(directory), false);
    assert.equal(JSON.stringify(report).includes("alpha"), false);
    assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), report);
    await assert.rejects(
      runGate([
        "--predictions",
        predictions,
        "--truth",
        reference,
        "--report",
        reference,
      ]),
      /overwrite/,
    );
    await fs.writeFile(predictions, JSON.stringify({ ...truth, beta: ok }));
    const cli = spawnSync(
      process.execPath,
      [
        "scripts/verify-evaluation.mjs",
        "--predictions",
        predictions,
        "--truth",
        reference,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(cli.status, 1, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).passed, false);
    const missing = spawnSync(
      process.execPath,
      ["scripts/verify-evaluation.mjs"],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(missing.status, 1);
    await fs.writeFile(predictions, "PRIVATE_ANSWER_MARKER not-json");
    const malformed = spawnSync(
      process.execPath,
      [
        "scripts/verify-evaluation.mjs",
        "--predictions",
        predictions,
        "--truth",
        reference,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    assert.equal(malformed.status, 1);
    assert.equal(malformed.stderr.includes("PRIVATE_ANSWER_MARKER"), false);
    await fs.writeFile(predictions, JSON.stringify(truth));
    await assert.rejects(
      runGate([
        "--predictions",
        predictions,
        "--truth",
        reference,
        "--scorer",
        reference,
        "--python",
        path.join(directory, "missing-python-executable"),
      ]),
      /Official scorer failed/,
    );
  } finally {
    // This exact mkdtemp-created directory contains only fixtures owned by this test.
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert.ok(
      path.basename(directory).startsWith("cargoguard-evaluation-test-"),
    );
    await fs.rm(directory, { recursive: true, force: true });
  }
});
