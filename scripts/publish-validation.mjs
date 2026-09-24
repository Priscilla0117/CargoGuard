import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// Publish aggregates only: never include answer-key rows, workspace identifiers,
// credentials, documents or per-email predictions in the public evidence card.
const read = async (path) => JSON.parse(await fs.readFile(path, "utf8"));
const hashFile = async (path) =>
  createHash("sha256")
    .update(await fs.readFile(path))
    .digest("hex");
const { version } = await read("package.json");
const quality = await read("work/validation/quality-gate.json");
assert.equal(quality.complete, true);
assert.equal(quality.steps.length, 8);
assert.ok(quality.steps.every((step) => step.passed));
const log = await fs.readFile("work/validation/unit-tests.log", "utf8");
const tests = Number(log.match(/tests (\d+)/)?.[1]);
assert.ok(tests > 0);
assert.match(log, /fail 0\b/);
const freshDirectory = "work/validation/final-enhancements-331";
const fresh = await read(`${freshDirectory}/summary.json`);
assert.equal(fresh.engine, version);
assert.equal(fresh.completed_runs, 3);
assert.equal(fresh.all_gates_passed, true);
assert.equal(fresh.source_unchanged, true);
assert.deepEqual(fresh.seeds, [196613, 262147, 327673]);
const frozen = await read(`${freshDirectory}/source-after.json`);
assert.equal(frozen.source_sha256, fresh.source_sha256);
assert.deepEqual(await read(`${freshDirectory}/source-before.json`), frozen);
for (const file of frozen.source_files) {
  assert.equal(
    await hashFile(file.path),
    file.sha256,
    `Frozen engine file changed: ${file.path}. Re-evaluate the final source before publication.`,
  );
}
const paths = [
  ["Organiser development set", "work/validation/accuracy-gate.json"],
  ...fresh.seeds.map((seed) => [
    `Fresh first-run generator seed ${seed}`,
    `${freshDirectory}/seed-${seed}/first-run/exact-gate.json`,
  ]),
];
const gates = await Promise.all(
  paths.map(async ([name, path]) => {
    const gate = await read(path);
    assert.equal(gate.engine, version);
    assert.equal(gate.passed, true);
    return { name, gate };
  }),
);
const original = gates[0].gate;
assert.ok(
  Date.parse(quality.generated_at) >= Date.parse(original.generated_at),
  "The final complete quality/build gate must finish after the current original-corpus evaluation.",
);
assert.ok(
  (await fs.stat("work/validation/unit-tests.log")).mtimeMs <=
    Date.parse(quality.generated_at) + 1000,
  "Unit test log is newer than the completed quality gate; wait for the final gate.",
);
for (let index = 0; index < fresh.seeds.length; index++) {
  const seed = fresh.seeds[index],
    run = fresh.runs.find((row) => row.seed === seed),
    gate = gates[index + 1].gate;
  assert.ok(run);
  assert.equal(run.exact_matches, gate.exact_matches);
  assert.equal(run.predictions_sha256, gate.predictions_sha256);
  assert.equal(
    await hashFile(`${freshDirectory}/seed-${seed}/first-run/submission.json`),
    gate.predictions_sha256,
  );
  assert.equal(
    await hashFile(`${freshDirectory}/seed-${seed}/dataset/ground_truth.json`),
    gate.ground_truth_sha256,
  );
}
const freshRecords = fresh.runs.reduce((count, row) => count + row.records, 0);
const report = {
  version,
  generated_at: new Date().toISOString(),
  engine: `CargoGuard ${version}`,
  metrics: {
    classification_macro_f1: original.official_scorer.classification_macro_f1,
    defect_f1: original.official_scorer.defect_f1,
    exact_defect_catch: original.official_scorer.exact_defect_catch_rate,
    review_recall: original.official_scorer.review_recall,
  },
  note: `Supplied-corpus development results, not production accuracy or a judging score. Three additional untouched first-run seeds matched ${fresh.combined_exact_matches}/${freshRecords} outputs with ${fresh.combined_false_verified_cases} observed false verified cases; the engine closure was unchanged between those runs. Human-confirmed recovery, OCR transcription and learned-rule assistance are excluded from automatic benchmark results.`,
  challenge_sets: gates.map(({ name, gate }) => ({
    name,
    emails: gate.expected_records,
    output_differences: gate.mismatched_records,
    false_clearances: gate.false_ok_decisions,
    exact_defect_cases: gate.exact_defect_cases,
    exact_review_cases: gate.exact_review_cases,
    predictions_sha256: gate.predictions_sha256,
    ground_truth_sha256: gate.ground_truth_sha256,
  })),
  challenge_limitations:
    "The original development corpus and three fresh seeds share the organiser generator and templates. Fresh seeds were fixed before generation and run once without tuning. Stable scores show within-generator robustness, not independent layout diversity, live shipping accuracy or immunity to overfitting. Image-only scans correctly remain in review in this automatic evaluation. Historical 3.1 routing ablations are not presented as current-engine measurements.",
  fresh_seed_stability: {
    engine: fresh.engine,
    first_run: true,
    seeds: fresh.seeds,
    records: freshRecords,
    exact_matches: fresh.combined_exact_matches,
    false_verified_cases: fresh.combined_false_verified_cases,
    source_unchanged: fresh.source_unchanged,
    source_file_count: fresh.source_file_count,
    engine_closure_sha256: fresh.source_sha256,
    model_sha256: fresh.model_sha256,
    generator_sha256: fresh.generator_sha256,
    scorer_sha256: fresh.scorer_sha256,
    started_at: fresh.generated_at,
    completed_at: fresh.completed_at,
    runs: fresh.runs.map((row) => ({
      seed: row.seed,
      records: row.records,
      exact_matches: row.exact_matches,
      category_macro_f1: row.classification_macro_f1,
      defect_f1: row.defect_f1,
      exact_defect_catch: row.exact_defect_catch,
      review_recall: row.review_recall,
      expected_review_cases: row.expected_review_cases,
      false_verified_cases: row.false_verified_cases,
    })),
  },
  engineering: {
    unit_tests: tests,
    test_files: quality.test_files.length,
    quality_steps: quality.steps,
  },
  ai_evidence_recovery: {
    role: "Optional source-quoted extraction followed by seven-field human confirmation and deterministic comparison",
    live_provider_validation:
      "See docs/CLOUD_RELEASE.md for dated live-provider acceptance evidence; mock tests are not model-quality results.",
    constraints:
      "Owner-funded server-side key; explicit synthetic/organiser-text consent; bounded persistent usage; no autonomous approval.",
  },
};
await fs.writeFile(
  "public/validation.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log({
  version,
  tests,
  datasets: gates.length,
  total_records: gates.reduce((n, x) => n + x.gate.expected_records, 0),
});
