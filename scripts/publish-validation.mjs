import fs from "node:fs/promises";
import assert from "node:assert/strict";

// Publish aggregates only: never include answer-key rows, workspace identifiers,
// credentials, documents or per-email predictions in the public evidence card.
const read = async (path) => JSON.parse(await fs.readFile(path, "utf8"));
const { version } = await read("package.json");
const quality = await read("work/validation/quality-gate.json");
assert.equal(quality.complete, true);
assert.equal(quality.steps.length, 8);
assert.ok(quality.steps.every((step) => step.passed));
const log = await fs.readFile("work/validation/unit-tests.log", "utf8");
const tests = Number(log.match(/tests (\d+)/)?.[1]);
assert.ok(tests > 0);
assert.match(log, /fail 0\b/);
const paths = [
  ["Organiser development set", "work/validation/accuracy-gate.json"],
  ...[7, 20260920, 20260921, 8675309].map((seed) => [
    `Additional generator seed ${seed}`,
    `work/validation/ai-v31/seed-${seed}/exact-gate.json`,
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
const routing = await read("work/validation/ai-v31/routing-evaluation.json");
const summary = (row) => {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "incorrect_ids"));
};
const original = gates[0].gate;
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
  note: "Supplied-corpus development results, not held-out production accuracy or a judging score. Human-confirmed AI recovery is excluded from automatic benchmark results.",
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
    "These five generator-based sets were used during development and share templates. They are not independent real-world evidence. The separate 60-message routing challenge is small, synthetic and includes unresolved errors/ambiguities.",
  engineering: {
    unit_tests: tests,
    test_files: quality.test_files.length,
    quality_steps: quality.steps,
  },
  ablation: {
    scope: routing.scope,
    hashes: routing.hashes,
    supplied_corpus: routing.development.map(summary),
    separate_routing_challenge: routing.challenge.map(summary),
    challenge_sha256: routing.challenge_sha256,
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
