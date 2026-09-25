import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  freezePilot,
  scorePilot,
  pilotMetrics,
  runPilot,
} from "../scripts/pilot-evaluation.mjs";

const clean = {
  category: "BL_COMPARISON",
  status: "OK",
  review_reason: null,
  has_defect: false,
  defect_fields: [],
};
const defect = {
  ...clean,
  status: "MISMATCH",
  has_defect: true,
  defect_fields: ["gross_weight_kg"],
};
const review = {
  ...clean,
  status: "NEEDS_REVIEW",
  review_reason: "unreadable",
};
const routed = { ...clean, category: "GENERAL" };
const dataset = {
  schema_version: 1,
  dataset_id: "synthetic-unit-fixture",
  kind: "synthetic",
  cases: [clean, defect, defect, review, clean].map((truth, index) => ({
    id: `case-${index + 1}`,
    file: `case-${index + 1}.eml`,
    strata: [],
    truth,
  })),
};
const predictions = {
  engine: "unit-test-only",
  cases: {
    "case-1": {
      prediction: defect,
      needs_human_review: false,
      manual_seconds: 100,
      assisted_seconds: 80,
    },
    "case-2": {
      prediction: clean,
      needs_human_review: false,
      manual_seconds: 100,
      assisted_seconds: 40,
    },
    "case-3": {
      prediction: routed,
      needs_human_review: false,
      manual_seconds: 50,
    },
    "case-4": {
      prediction: review,
      needs_human_review: true,
      assisted_seconds: 70,
    },
    "case-5": { prediction: clean, needs_human_review: true },
  },
};

test("pilot metrics distinguish false clearance, misrouting, abstention and missing timing", () => {
  const report = pilotMetrics(dataset, predictions);
  assert.deepEqual(report.false_clearances, {
    count: 1,
    total: 3,
    rate: 1 / 3,
  });
  assert.deepEqual(report.unsafe_routing_away_from_document_check, {
    count: 1,
    total: 3,
    rate: 1 / 3,
  });
  assert.deepEqual(report.missed_discrepancies_without_review, {
    count: 2,
    total: 2,
    rate: 1,
  });
  assert.deepEqual(report.false_alarms, { count: 1, total: 2, rate: 0.5 });
  assert.deepEqual(report.human_review, { count: 2, total: 5, rate: 0.4 });
  assert.equal(report.automatic_clearances, 1);
  assert.equal(report.handling_time.paired_cases, 2);
  assert.equal(report.handling_time.paired_manual_total_seconds, 200);
  assert.equal(report.handling_time.paired_assisted_total_seconds, 120);
  assert.equal(report.handling_time.saved_fraction, 0.4);
  assert.equal(report.handling_time.median_saved_seconds, 40);
  assert.equal(report.handling_time.missing_manual_only, 1);
  assert.equal(report.handling_time.missing_assisted_only, 1);
  assert.equal(report.handling_time.missing_both, 1);
  assert.equal(report.evidence_kind, "synthetic");
  assert.match(report.independence, /not independent operational accuracy/);
  assert.ok(!JSON.stringify(report).includes("case-1"));
});

test("zero denominators and unmeasured effort are unavailable, never perfect performance", () => {
  const sample = { ...dataset, cases: [dataset.cases[0]] };
  const report = pilotMetrics(sample, {
    engine: "test",
    cases: { "case-1": { prediction: clean, needs_human_review: false } },
  });
  assert.deepEqual(report.false_clearances, { count: 0, total: 0, rate: null });
  assert.equal(report.handling_time.saved_fraction, null);
  assert.equal(report.handling_time.mean_assisted_seconds, null);
  assert.equal(report.handling_time.paired_cases, 0);
});

test("real routing abstentions remain measurable without erasing their category or reason", () => {
  const expected = {
    ...routed,
    status: "NEEDS_REVIEW",
    review_reason: "uncertain_category",
  };
  const sample = {
    ...dataset,
    cases: [{ ...dataset.cases[0], truth: expected }],
  };
  const run = {
    engine: "test",
    cases: { "case-1": { prediction: expected, needs_human_review: true } },
  };
  assert.equal(pilotMetrics(sample, run).exact_agreement.exact_matches, 1);
  const different = {
    ...run,
    cases: {
      "case-1": {
        prediction: { ...expected, category: "SI_REQUEST" },
        needs_human_review: true,
      },
    },
  };
  assert.equal(
    pilotMetrics(sample, different).exact_agreement.exact_matches,
    0,
  );
  assert.equal(pilotMetrics(sample, different).human_review.count, 1);
  const invalid = {
    ...run,
    cases: {
      "case-1": {
        prediction: { ...expected, category: "INVALID" },
        needs_human_review: true,
      },
    },
  };
  assert.throws(() => pilotMetrics(sample, invalid), /Invalid category/);
});

test("30-case independent mode still refuses missing coverage or tuning reuse", () => {
  // Generated unit fixtures exercise the validation contract only; they are
  // never frozen or represented as real independent pilot evidence.
  const sample = {
    ...dataset,
    kind: "independent_pilot",
    attestation: {
      real_anonymized_cases: true,
      labels_independent_of_system: true,
      used_for_training_or_tuning: true,
      labels_frozen_before_predictions: true,
      labeler_ids: ["fixture"],
    },
    cases: Array.from({ length: 30 }, (_, i) => ({
      ...dataset.cases[0],
      id: `fixture-${i}`,
      file: `fixture-${i}.eml`,
    })),
  };
  const run = {
    engine: "unit-only",
    cases: Object.fromEntries(
      sample.cases.map((item) => [
        item.id,
        { prediction: clean, needs_human_review: false },
      ]),
    ),
  };
  assert.throws(() => pilotMetrics(sample, run), /Independent pilots/);
  sample.attestation.used_for_training_or_tuning = false;
  assert.throws(() => pilotMetrics(sample, run), /must include/);
});

test("pilot refuses incomplete predictions, inconsistent review flags and invalid durations", () => {
  const incomplete = structuredClone(predictions);
  delete (incomplete.cases as Record<string, unknown>)["case-1"];
  assert.throws(
    () => pilotMetrics(dataset, incomplete),
    /cover the frozen dataset exactly/,
  );
  const inconsistent = structuredClone(predictions);
  inconsistent.cases["case-4"].needs_human_review = false;
  assert.throws(() => pilotMetrics(dataset, inconsistent), /human-review flag/);
  for (const seconds of [0, -1, NaN, Infinity, 86401, "100"]) {
    const invalid = structuredClone(predictions);
    (invalid.cases["case-1"] as Record<string, unknown>).manual_seconds =
      seconds;
    assert.throws(() => pilotMetrics(dataset, invalid), /Handling times/);
  }
});

test("independent evidence requires the planned sample and declarations; development never becomes independent", () => {
  assert.throws(
    () => pilotMetrics({ ...dataset, kind: "independent_pilot" }, predictions),
    /Independent pilots/,
  );
  assert.equal(
    pilotMetrics(
      {
        ...dataset,
        kind: "development",
        attestation: { labels_independent_of_system: true },
      },
      predictions,
    ).evidence_kind,
    "development",
  );
});

async function fixture() {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "cargoguard-pilot-test-"),
  );
  const manifest = path.join(directory, "dataset.json");
  const freeze = path.join(directory, "freeze.json");
  const run = path.join(directory, "predictions.json");
  await fs.writeFile(manifest, JSON.stringify(dataset));
  for (const item of dataset.cases)
    await fs.writeFile(
      path.join(directory, item.file),
      `Message-ID: <${item.id}@example.test>\r\nSubject: unit fixture\r\n\r\nSynthetic test only\r\n`,
    );
  return { directory, manifest, freeze, run };
}
async function writeRun(
  location: Awaited<ReturnType<typeof fixture>>,
  sha: string,
) {
  const value = {
    ...predictions,
    freeze_sha256: sha,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
  };
  await fs.writeFile(location.run, JSON.stringify(value));
  return value;
}

test("freeze and score bind labels, complete emails and predictions without overwriting inputs", async () => {
  const location = await fixture();
  try {
    const frozen = await freezePilot(location.manifest, location.freeze);
    assert.match(frozen.freeze_sha256, /^[a-f0-9]{64}$/);
    assert.equal(frozen.kind, "synthetic");
    await writeRun(location, frozen.freeze_sha256);
    const output = path.join(location.directory, "report.json");
    const report = await scorePilot(location.freeze, location.run, output);
    assert.equal(report.freeze_sha256, frozen.freeze_sha256);
    assert.equal(report.false_clearances.count, 1);
    assert.ok(!JSON.stringify(report).includes(location.directory));
    assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), report);
    await assert.rejects(freezePilot(location.manifest, location.freeze));
    await assert.rejects(
      scorePilot(location.freeze, location.run, location.manifest),
    );
    assert.deepEqual(
      JSON.parse(await fs.readFile(location.manifest, "utf8")),
      dataset,
    );
    await fs.appendFile(
      path.join(location.directory, dataset.cases[0].file),
      "changed attachment",
    );
    await assert.rejects(
      scorePilot(location.freeze, location.run),
      /Frozen email content changed/,
    );
  } finally {
    await fs.rm(location.directory, { recursive: true, force: true });
  }
});

test("scoring rejects changed labels, wrong freeze identity and predictions predating freeze", async () => {
  const location = await fixture();
  try {
    const frozen = await freezePilot(location.manifest, location.freeze);
    const run = await writeRun(location, "0".repeat(64));
    await assert.rejects(
      scorePilot(location.freeze, location.run),
      /identify this freeze/,
    );
    run.freeze_sha256 = frozen.freeze_sha256;
    run.started_at = "2000-01-01T00:00:00.000Z";
    await fs.writeFile(location.run, JSON.stringify(run));
    await assert.rejects(
      scorePilot(location.freeze, location.run),
      /identify this freeze/,
    );
    await writeRun(location, frozen.freeze_sha256);
    await fs.writeFile(
      location.manifest,
      JSON.stringify({ ...dataset, kind: "development" }),
    );
    await assert.rejects(
      scorePilot(location.freeze, location.run),
      /Frozen labels/,
    );
  } finally {
    await fs.rm(location.directory, { recursive: true, force: true });
  }
});

test("freeze rejects duplicate email bytes and source path escape", async () => {
  const location = await fixture();
  try {
    await fs.copyFile(
      path.join(location.directory, dataset.cases[0].file),
      path.join(location.directory, dataset.cases[1].file),
    );
    await assert.rejects(
      freezePilot(location.manifest, location.freeze),
      /Duplicate email content/,
    );
    const invalid = structuredClone(dataset);
    invalid.cases[0].file = path.join(
      location.directory,
      dataset.cases[0].file,
    );
    await fs.writeFile(location.manifest, JSON.stringify(invalid));
    await assert.rejects(
      freezePilot(location.manifest, location.freeze),
      /relative .eml/,
    );
    await assert.rejects(
      runPilot([
        "freeze",
        "--dataset",
        location.manifest,
        "--dataset",
        location.manifest,
      ]),
      /Invalid pilot arguments/,
    );
  } finally {
    await fs.rm(location.directory, { recursive: true, force: true });
  }
});
