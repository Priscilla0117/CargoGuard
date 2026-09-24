import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  evaluateFrozenDataset,
  evaluationMetrics,
  freezeEvaluation,
  groupedEvaluationMetrics,
  summarizePilotTimings,
  timingStatistics,
  verifyFrozenEvaluation,
  type EvaluatedCase,
} from "../lib/unseen-evaluation";

// These temporary synthetic inputs exercise the tooling. They are NOT unseen
// evaluation data, pilot observations, or evidence of application accuracy.
async function fixture(
  t: TestContext,
  ids = ["fixture-clear"],
  split: "holdout" | "development" = "holdout",
) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "cargoguard-unseen-test-"),
  );
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith("cargoguard-unseen-test-"));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const definition = {
    schema_version: 1,
    ready_for_freeze: true,
    dataset_id: "synthetic-tooling-fixture-only",
    provenance: {
      source_description: "Temporary unit-test fixture; not a held-out dataset",
      permission_reference: "Authored test strings only",
      collected_by: "Synthetic fixture builder",
      collected_at: "2026-09-24T00:00:00Z",
      holdout_independence_attested: true,
      holdout_not_used_for_tuning: true,
      holdout_frozen_before_model_run: true,
    },
    cases: ids.map((id) => ({
      id,
      split,
      shipment_group: `shipment-${id}`,
      template_family: `family-${id}`,
      email_file: `${id}.json`,
      missing_attachments: [] as string[],
    })),
  };
  const labels = {
    schema_version: 1,
    dataset_id: definition.dataset_id,
    provenance: {
      reviewers: ["Synthetic reviewer A", "Synthetic reviewer B"],
      adjudicator: "Synthetic adjudicator",
      adjudicated: true,
      labelled_without_model_outputs: true,
    },
    labels: ids.map((id) => ({
      case_id: id,
      category: "BL_COMPARISON",
      workflow: id.includes("blocked") ? "discrepancy" : "verified",
      blocking: id.includes("blocked"),
      defect_fields: id.includes("blocked") ? ["container_count"] : [],
      review_reason: null,
      rationale:
        "Synthetic fixed-count fixture, only for testing the evaluator",
    })),
  };
  for (const id of ids) {
    const attachments = [`${id}-si.txt`, `${id}-bl.txt`];
    await fs.writeFile(
      path.join(root, `${id}.json`),
      JSON.stringify({
        email_id: id,
        from: "test@example.test",
        subject: "Compare SI and draft BL",
        body: "Please compare the SI and draft BL and report differences.",
        attachments,
      }),
    );
    const common = [
      `Shipper: ALPHA ${id.toUpperCase()} EXPORTS LTD`,
      "Consignee: BETA IMPORTS LTD",
      "Notify Party: SAME AS CONSIGNEE",
      "Port of Loading: SINGAPORE",
      "Port of Discharge: PORT KLANG",
    ];
    for (const [index, name] of attachments.entries()) {
      await fs.writeFile(
        path.join(root, name),
        [
          index ? "DRAFT BILL OF LADING" : "SHIPPING INSTRUCTION",
          ...common,
          `Container Count: ${index && id.includes("blocked") ? 3 : 2}`,
          "Gross Weight: 42000 KG",
        ].join("\n"),
      );
    }
  }
  const write = async () => {
    await fs.writeFile(
      path.join(root, "dataset.json"),
      JSON.stringify(definition),
    );
    await fs.writeFile(path.join(root, "labels.json"), JSON.stringify(labels));
  };
  await write();
  return {
    root,
    manifest: path.join(root, "frozen.json"),
    definition,
    labels,
    write,
  };
}

test("freeze rejects empty templates, placeholder groups, missing labels and unadjudicated truth", async (t) => {
  const f = await fixture(t);
  f.definition.ready_for_freeze = false;
  await f.write();
  await assert.rejects(() => freezeEvaluation(f.root, f.manifest), /true/);
  f.definition.ready_for_freeze = true;
  f.definition.cases[0].template_family = "TBD";
  await f.write();
  await assert.rejects(
    () => freezeEvaluation(f.root, f.manifest),
    /placeholder/,
  );
  f.definition.cases[0].template_family = "fixture-family";
  f.labels.provenance.adjudicated = false;
  await f.write();
  await assert.rejects(() => freezeEvaluation(f.root, f.manifest), /true/);
  f.labels.provenance.adjudicated = true;
  f.labels.labels = [];
  await f.write();
  await assert.rejects(() => freezeEvaluation(f.root, f.manifest));
});

test("holdout independence attestations and consistent verified labels are mandatory", async (t) => {
  const f = await fixture(t);
  f.definition.provenance.holdout_not_used_for_tuning = false;
  await f.write();
  await assert.rejects(
    () => freezeEvaluation(f.root, f.manifest),
    /attestations/,
  );
  f.definition.provenance.holdout_not_used_for_tuning = true;
  f.labels.labels[0].blocking = true;
  await f.write();
  await assert.rejects(
    () => freezeEvaluation(f.root, f.manifest),
    /Contradictory verified/,
  );
});

test("every email, label and attachment is hashed; frozen files cannot be replaced silently", async (t) => {
  for (const file of [
    "dataset.json",
    "labels.json",
    "fixture-clear.json",
    "fixture-clear-bl.txt",
  ]) {
    const f = await fixture(t);
    const frozen = await freezeEvaluation(f.root, f.manifest);
    assert.equal(frozen.manifest.files.length, 5);
    assert.equal(
      (await verifyFrozenEvaluation(f.root, f.manifest)).manifest_sha256,
      frozen.manifest_sha256,
    );
    await assert.rejects(() => freezeEvaluation(f.root, f.manifest), /EEXIST/);
    await fs.appendFile(path.join(f.root, file), " ");
    await assert.rejects(
      () => verifyFrozenEvaluation(f.root, f.manifest),
      /Frozen input changed/,
    );
  }
});

test("intentionally absent attachments are frozen as absent and cannot appear later", async (t) => {
  const f = await fixture(t);
  const missing = "absent-bl.txt";
  const emailPath = path.join(f.root, "fixture-clear.json");
  const email = JSON.parse(await fs.readFile(emailPath, "utf8"));
  email.attachments[1] = missing;
  await fs.writeFile(emailPath, JSON.stringify(email));
  f.definition.cases[0].missing_attachments = [missing];
  await f.write();
  const frozen = await freezeEvaluation(f.root, f.manifest);
  assert.equal(
    frozen.manifest.files.find((file) => file.path === missing)?.sha256,
    null,
  );
  await verifyFrozenEvaluation(f.root, f.manifest);
  await fs.writeFile(path.join(f.root, missing), "Appeared after freeze");
  await assert.rejects(
    () => verifyFrozenEvaluation(f.root, f.manifest),
    /declared missing is present/,
  );
});

test("shipment and template groups must not cross development/holdout splits", async (t) => {
  for (const key of ["shipment_group", "template_family"] as const) {
    const f = await fixture(t, ["fixture-first", "fixture-second"]);
    f.definition.cases[0].split = "development";
    f.definition.cases[1][key] = f.definition.cases[0][key].toUpperCase();
    await f.write();
    await assert.rejects(
      () => freezeEvaluation(f.root, f.manifest),
      /Split leakage/,
    );
  }
});

test("development manifest detects reused groups and renamed identical source files", async (t) => {
  const dev = await fixture(t, ["fixture-development"], "development");
  await freezeEvaluation(dev.root, dev.manifest);
  for (const mode of ["shipment_group", "template_family", "bytes"] as const) {
    const holdout = await fixture(t, [`fixture-new-${mode}`]);
    if (mode === "bytes") {
      await fs.copyFile(
        path.join(dev.root, "fixture-development-si.txt"),
        path.join(holdout.root, `fixture-new-${mode}-si.txt`),
      );
    } else {
      holdout.definition.cases[0][mode] = dev.definition.cases[0][mode];
      await holdout.write();
    }
    await assert.rejects(
      () => freezeEvaluation(holdout.root, holdout.manifest, dev.manifest),
      /Development-manifest leakage/,
    );
  }
});

test("dataset attachment paths cannot escape to external files", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.root, "fixture-clear.json");
  const email = JSON.parse(await fs.readFile(file, "utf8"));
  email.attachments = ["../outside.txt"];
  await fs.writeFile(file, JSON.stringify(email));
  await assert.rejects(
    () => freezeEvaluation(f.root, f.manifest),
    /no traversal/,
  );
});

test("frozen holdout evaluator runs original TXT bytes through processEmail", async (t) => {
  const f = await fixture(t, [
    "fixture-clear",
    "fixture-blocked",
    "fixture-development",
  ]);
  f.definition.cases[2].split = "development";
  await f.write();
  await freezeEvaluation(f.root, f.manifest);
  const { report, predictions } = await evaluateFrozenDataset(
    f.root,
    f.manifest,
  );
  assert.deepEqual(
    predictions.map((row) => row.prediction.workflow),
    ["verified", "discrepancy"],
  );
  assert.deepEqual(predictions[1].prediction.defect_fields, [
    "container_count",
  ]);
  assert.equal(report.overall.cases, 2);
  assert.deepEqual(report.overall.false_clear_among_gold_blocking, {
    numerator: 0,
    denominator: 1,
    rate: 0,
  });
  assert.equal(report.by_format.txt.cases, 2);
  assert.equal(report.development_overlap_checked, false);
  assert.equal(report.development_cases_excluded, 1);
  assert.equal(report.pilot, null);
  assert.equal(report.source_fingerprint.sha256.length, 64);
  assert.match(report.engine, /processEmail/);
});

function outcome(
  id: string,
  goldWorkflow: EvaluatedCase["gold"]["workflow"],
  predictedWorkflow: EvaluatedCase["prediction"]["workflow"],
): EvaluatedCase {
  return {
    id,
    template_family: "metrics-test-family",
    formats: ["txt"],
    gold: {
      case_id: id,
      category: "BL_COMPARISON",
      workflow: goldWorkflow,
      blocking: ["discrepancy", "review"].includes(goldWorkflow),
      defect_fields: goldWorkflow === "discrepancy" ? ["container_count"] : [],
      review_reason: goldWorkflow === "review" ? "missing_value" : null,
      rationale: "Metric arithmetic fixture only",
    },
    prediction: {
      category: "BL_COMPARISON",
      workflow: predictedWorkflow,
      review_reason: predictedWorkflow === "review" ? "missing_value" : null,
      defect_fields: [],
      duration_ms: 1,
    },
  };
}
test("false-clear, verified-error and review rates use explicit distinct denominators", () => {
  const rows = [
    outcome("a", "discrepancy", "verified"),
    outcome("b", "review", "review"),
    outcome("c", "verified", "verified"),
    outcome("d", "verified", "review"),
    outcome("e", "routed", "routed"),
    outcome("f", "routed", "verified"),
  ];
  rows[4].gold.category = "INVOICE_QUERY";
  rows[4].prediction.category = "GENERAL";
  rows[4].formats = [];
  rows[5].gold.category = "GENERAL";
  rows[0].formats.push("pdf");
  const metrics = groupedEvaluationMetrics(rows);
  assert.deepEqual(metrics.overall.false_clear_among_gold_blocking, {
    numerator: 1,
    denominator: 2,
    rate: 0.5,
  });
  assert.deepEqual(metrics.overall.error_among_verified, {
    numerator: 2,
    denominator: 3,
    rate: 2 / 3,
  });
  assert.deepEqual(metrics.overall.review_fraction, {
    numerator: 2,
    denominator: 6,
    rate: 1 / 3,
  });
  assert.deepEqual(metrics.overall.unnecessary_review_among_gold_verified, {
    numerator: 1,
    denominator: 2,
    rate: 0.5,
  });
  assert.equal(metrics.overall.routing_errors.numerator, 2);
  assert.equal(metrics.by_format.pdf.cases, 1);
  assert.equal(metrics.by_format.txt.cases, 5);
  assert.equal(metrics.by_format.no_attachments.cases, 1);
  assert.equal(evaluationMetrics([]).error_among_verified.rate, null);
});

function timings() {
  const sample = (id: string, manual: number, assisted: number | null) => ({
    pair_id: id,
    case_id: id,
    reviewer_id: "Synthetic reviewer",
    order: "manual_first",
    manual_active_seconds: manual,
    assisted_active_seconds: assisted,
    manual_complete: true,
    assisted_complete: assisted !== null,
    manual_correct: true,
    assisted_correct: assisted !== null,
  });
  const samples = [
    sample("a", 100, 60),
    sample("b", 200, 250),
    sample("c", 300, null),
    sample("d", 150, 100),
  ];
  samples[1].order = "assisted_first";
  samples[3].assisted_correct = false;
  return {
    schema_version: 1,
    provenance: {
      observer: "Synthetic observer",
      captured_at: "2026-09-24T00:00:00Z",
      protocol_reference: "Unit test only; not pilot observations",
      active_time_definition: "Synthetic arithmetic fixture, seconds",
      outcomes_independently_adjudicated: true,
    },
    samples,
  };
}
test("paired pilot time summaries expose completion, correctness, exclusions and negative savings", () => {
  const report = summarizePilotTimings(timings(), ["a", "b", "c", "d"]);
  assert.deepEqual(report.manual.active_seconds_for_completed_tasks, {
    n: 4,
    median: 175,
    p95: 300,
  });
  assert.deepEqual(report.assisted.active_seconds_for_completed_tasks, {
    n: 3,
    median: 100,
    p95: 250,
  });
  assert.deepEqual(report.assisted.correct_completion, {
    numerator: 2,
    denominator: 4,
    rate: 0.5,
  });
  assert.equal(report.completed_correct_pairs, 2);
  assert.equal(report.excluded_from_paired_time_comparison, 2);
  assert.deepEqual(report.paired_seconds_saved, { n: 2, median: -5, p95: 40 });
  assert.equal(report.order_counts.assisted_first, 1);
  assert.deepEqual(timingStatistics([]), { n: 0, median: null, p95: null });
});
test("pilot summaries reject unknown cases, duplicate pairs and unmeasured completed tasks", () => {
  const input = timings();
  assert.throws(() => summarizePilotTimings(input, ["a"]), /evaluated holdout/);
  input.samples.push(input.samples[0]);
  assert.throws(
    () => summarizePilotTimings(input, ["a", "b", "c", "d"]),
    /Duplicate/,
  );
  input.samples.pop();
  input.samples[0].assisted_active_seconds = null;
  assert.throws(
    () => summarizePilotTimings(input, ["a", "b", "c", "d"]),
    /measured active seconds/,
  );
});
