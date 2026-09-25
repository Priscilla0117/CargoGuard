// Offline pilot evidence only. This module must never enter the application.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { verifyEvaluation } from "./verify-evaluation.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const requiredStrata = [
  "unfamiliar_layout",
  "scan",
  "amendment",
  "ambiguous_request",
];
const kinds = ["independent_pilot", "development", "synthetic"];
const timestamp = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value));
const rate = (count, total) => ({
  count,
  total,
  rate: total ? count / total : null,
});
const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

async function readInput(filename) {
  const resolved = await fs.realpath(filename);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || stat.size === 0 || stat.size > 64 * 1024 * 1024)
    throw new Error(
      "Pilot inputs must be non-empty files no larger than 64 MiB",
    );
  const bytes = await fs.readFile(resolved);
  return { resolved, bytes, sha256: hash(bytes) };
}
function json(input, label) {
  try {
    return JSON.parse(input.bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}
function evaluationGate(predictions, truth) {
  // Real mailbox routing can abstain in any category. The organiser gate only
  // knows document review reasons, so validate that one extension explicitly,
  // reuse its remaining schema checks, then compare the original values.
  const forGate = (entries) =>
    Object.fromEntries(
      Object.entries(entries).map(([id, entry]) => {
        if (
          entry?.status === "NEEDS_REVIEW" &&
          entry.review_reason === "uncertain_category"
        ) {
          if (
            ![
              "BL_COMPARISON",
              "SI_REQUEST",
              "INVOICE_QUERY",
              "GENERAL",
              "SPAM",
            ].includes(entry.category)
          )
            throw new Error("Invalid category for routing review");
          return [
            id,
            {
              ...entry,
              category: "BL_COMPARISON",
              review_reason: "missing_value",
            },
          ];
        }
        return [id, entry];
      }),
    );
  const gate = verifyEvaluation(forGate(predictions), forGate(truth));
  let matches = 0,
    exactDefects = 0,
    exactReviews = 0;
  for (const [id, expected] of Object.entries(truth)) {
    if (!Object.hasOwn(predictions, id)) continue;
    const actual = predictions[id];
    if (!actual) continue;
    const same =
      ["category", "status", "review_reason", "has_defect"].every(
        (key) => actual[key] === expected[key],
      ) &&
      [...actual.defect_fields].sort().join() ===
        [...expected.defect_fields].sort().join();
    if (same) {
      matches++;
      if (expected.has_defect) exactDefects++;
      if (expected.status === "NEEDS_REVIEW") exactReviews++;
    }
  }
  return {
    ...gate,
    passed:
      !gate.missing_ids && !gate.extra_ids && matches === gate.expected_records,
    exact_matches: matches,
    mismatched_records: gate.compared_records - matches,
    exact_defect_cases: exactDefects,
    exact_review_cases: exactReviews,
  };
}
function validateDataset(dataset) {
  if (
    !object(dataset) ||
    dataset.schema_version !== 1 ||
    !kinds.includes(dataset.kind) ||
    typeof dataset.dataset_id !== "string" ||
    !dataset.dataset_id.trim() ||
    !Array.isArray(dataset.cases) ||
    !dataset.cases.length ||
    dataset.cases.length > 10000
  )
    throw new Error("Invalid pilot dataset schema or case count");
  const ids = new Set();
  for (const item of dataset.cases) {
    if (
      !object(item) ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(item.id) ||
      ids.has(item.id) ||
      typeof item.file !== "string" ||
      !item.file.trim() ||
      !Array.isArray(item.strata) ||
      item.strata.some((value) => typeof value !== "string" || !value.trim()) ||
      new Set(item.strata).size !== item.strata.length
    )
      throw new Error(
        "Pilot cases need unique safe IDs, source files and unique strata",
      );
    ids.add(item.id);
  }
  const truth = Object.fromEntries(
    dataset.cases.map((item) => [item.id, item.truth]),
  );
  // Reuse the existing strict category/status/field/review contract.
  evaluationGate(truth, truth);
  if (dataset.kind === "independent_pilot") {
    const a = dataset.attestation;
    if (
      dataset.cases.length < 30 ||
      dataset.cases.length > 50 ||
      !object(a) ||
      a.real_anonymized_cases !== true ||
      a.labels_independent_of_system !== true ||
      a.used_for_training_or_tuning !== false ||
      a.labels_frozen_before_predictions !== true ||
      !Array.isArray(a.labeler_ids) ||
      !a.labeler_ids.length ||
      a.labeler_ids.some((id) => typeof id !== "string" || !id.trim())
    )
      throw new Error(
        "Independent pilots require 30–50 real anonymized cases, independent labels and explicit no-tuning/preprediction attestations",
      );
    const strata = new Set(dataset.cases.flatMap((item) => item.strata));
    if (requiredStrata.some((stratum) => !strata.has(stratum)))
      throw new Error(
        "Independent pilots must include unfamiliar layouts, scans, amendments and ambiguous requests",
      );
  }
  return truth;
}
async function sourceFiles(dataset, datasetPath) {
  const root = path.dirname(datasetPath);
  const seen = new Set();
  const result = [];
  for (const item of dataset.cases) {
    if (
      path.isAbsolute(item.file) ||
      path.extname(item.file).toLowerCase() !== ".eml"
    )
      throw new Error(
        "Each case must name a relative .eml file inside the dataset directory",
      );
    const candidate = await fs.realpath(path.resolve(root, item.file));
    const relative = path.relative(root, candidate);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      throw new Error(
        "Pilot source files must stay inside the dataset directory, including symlinks",
      );
    const input = await readInput(candidate);
    if (seen.has(input.sha256))
      throw new Error(
        "Duplicate email content would inflate the pilot; use distinct cases",
      );
    seen.add(input.sha256);
    result.push({ id: item.id, file: item.file, sha256: input.sha256 });
  }
  return result;
}
async function writeNew(filename, value) {
  // Never replace an existing freeze, dataset, predictions file or report.
  await fs.writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, {
    flag: "wx",
  });
}

export async function freezePilot(datasetFilename, outputFilename) {
  const input = await readInput(datasetFilename);
  const dataset = json(input, "Dataset");
  validateDataset(dataset);
  const sources = await sourceFiles(dataset, input.resolved);
  if (hash(await fs.readFile(input.resolved)) !== input.sha256)
    throw new Error("Dataset changed while freezing; retry with stable files");
  const frozen = {
    schema_version: 1,
    artifact: "cargoguard-pilot-freeze",
    frozen_at: new Date().toISOString(),
    dataset_path: input.resolved,
    dataset_sha256: input.sha256,
    kind: dataset.kind,
    sources,
  };
  await writeNew(outputFilename, frozen);
  const freeze = await readInput(outputFilename);
  return {
    artifact: frozen.artifact,
    kind: frozen.kind,
    cases: sources.length,
    frozen_at: frozen.frozen_at,
    freeze_sha256: freeze.sha256,
  };
}

export function pilotMetrics(dataset, run) {
  const truth = validateDataset(dataset);
  if (
    !object(run) ||
    !object(run.cases) ||
    typeof run.engine !== "string" ||
    !run.engine.trim()
  )
    throw new Error("Predictions require an engine label and a cases object");
  const predictions = Object.fromEntries(
    Object.entries(run.cases).map(([id, item]) => {
      if (
        !object(item) ||
        typeof item.needs_human_review !== "boolean" ||
        (item.prediction?.status === "NEEDS_REVIEW" && !item.needs_human_review)
      )
        throw new Error(
          "Every prediction needs an explicit, consistent human-review flag",
        );
      for (const key of ["manual_seconds", "assisted_seconds"])
        if (
          item[key] != null &&
          (typeof item[key] !== "number" ||
            !Number.isFinite(item[key]) ||
            item[key] <= 0 ||
            item[key] > 86400)
        )
          throw new Error(
            "Handling times must be positive seconds up to 24 hours, or null when unmeasured",
          );
      return [id, item.prediction];
    }),
  );
  const exact = evaluationGate(predictions, truth);
  if (exact.missing_ids || exact.extra_ids)
    throw new Error(
      "Prediction IDs must cover the frozen dataset exactly; missing cases cannot be omitted",
    );
  let unsafe = 0,
    requiringAction = 0,
    clearances = 0,
    unsafeRouted = 0;
  let missedDefects = 0,
    defects = 0,
    falseAlarms = 0,
    clean = 0,
    abstentions = 0;
  let manualOnly = 0,
    assistedOnly = 0,
    neither = 0;
  const paired = [];
  for (const item of dataset.cases) {
    const expected = item.truth,
      actual = run.cases[item.id],
      prediction = actual.prediction;
    const review =
      actual.needs_human_review || prediction.status === "NEEDS_REVIEW";
    if (review) abstentions++;
    const automaticClear =
      prediction.category === "BL_COMPARISON" &&
      prediction.status === "OK" &&
      !review;
    if (automaticClear) clearances++;
    if (expected.category === "BL_COMPARISON" && expected.status !== "OK") {
      requiringAction++;
      if (automaticClear) unsafe++;
      if (!review && prediction.category !== "BL_COMPARISON") unsafeRouted++;
    }
    if (expected.has_defect) {
      defects++;
      if (
        !review &&
        (prediction.category !== "BL_COMPARISON" ||
          prediction.status !== "MISMATCH")
      )
        missedDefects++;
    }
    if (expected.category === "BL_COMPARISON" && expected.status === "OK") {
      clean++;
      if (
        prediction.category === "BL_COMPARISON" &&
        prediction.status === "MISMATCH"
      )
        falseAlarms++;
    }
    if (actual.manual_seconds != null && actual.assisted_seconds != null)
      paired.push({
        manual: actual.manual_seconds,
        assisted: actual.assisted_seconds,
      });
    else if (actual.manual_seconds != null) manualOnly++;
    else if (actual.assisted_seconds != null) assistedOnly++;
    else neither++;
  }
  const manual = paired.reduce((sum, item) => sum + item.manual, 0);
  const assisted = paired.reduce((sum, item) => sum + item.assisted, 0);
  return {
    evidence_kind: dataset.kind,
    independence:
      dataset.kind === "independent_pilot"
        ? "Operator-attested independent pilot; software cannot verify labeler independence or prior exposure."
        : "Development or synthetic evidence; not independent operational accuracy.",
    cases: dataset.cases.length,
    exact_agreement: exact,
    automatic_clearances: clearances,
    false_clearances: rate(unsafe, requiringAction),
    unsafe_routing_away_from_document_check: rate(
      unsafeRouted,
      requiringAction,
    ),
    missed_discrepancies_without_review: rate(missedDefects, defects),
    false_alarms: rate(falseAlarms, clean),
    human_review: rate(abstentions, dataset.cases.length),
    handling_time: {
      paired_cases: paired.length,
      missing_manual_only: assistedOnly,
      missing_assisted_only: manualOnly,
      missing_both: neither,
      paired_manual_total_seconds: paired.length ? manual : null,
      paired_assisted_total_seconds: paired.length ? assisted : null,
      mean_manual_seconds: paired.length ? manual / paired.length : null,
      mean_assisted_seconds: paired.length ? assisted / paired.length : null,
      median_saved_seconds: median(
        paired.map((item) => item.manual - item.assisted),
      ),
      saved_fraction: manual ? (manual - assisted) / manual : null,
    },
    limitations:
      "Rates describe these cases only. Missing timing is not zero effort. No production-safety certification or statistically established time saving is implied.",
  };
}

export async function scorePilot(
  freezeFilename,
  predictionsFilename,
  outputFilename,
) {
  const freeze = await readInput(freezeFilename);
  const frozen = json(freeze, "Freeze");
  if (
    !object(frozen) ||
    frozen.schema_version !== 1 ||
    frozen.artifact !== "cargoguard-pilot-freeze" ||
    !timestamp(frozen.frozen_at) ||
    typeof frozen.dataset_path !== "string" ||
    !Array.isArray(frozen.sources)
  )
    throw new Error("Invalid pilot freeze artifact");
  const input = await readInput(frozen.dataset_path);
  if (input.sha256 !== frozen.dataset_sha256)
    throw new Error("Frozen labels or dataset metadata changed");
  const dataset = json(input, "Dataset");
  validateDataset(dataset);
  if (dataset.kind !== frozen.kind)
    throw new Error("Frozen evidence kind changed");
  const sources = await sourceFiles(dataset, input.resolved);
  if (JSON.stringify(sources) !== JSON.stringify(frozen.sources))
    throw new Error("Frozen email content changed");
  const predictions = await readInput(predictionsFilename);
  const run = json(predictions, "Predictions");
  if (
    !object(run) ||
    run.freeze_sha256 !== freeze.sha256 ||
    !timestamp(run.started_at) ||
    !timestamp(run.completed_at) ||
    Date.parse(run.started_at) < Date.parse(frozen.frozen_at) ||
    Date.parse(run.completed_at) < Date.parse(run.started_at) ||
    Date.parse(run.completed_at) > Date.now()
  )
    throw new Error(
      "Predictions must identify this freeze and have valid run times after it",
    );
  const metrics = pilotMetrics(dataset, run);
  // Check again after scoring rather than accepting a concurrent file change.
  for (const snapshot of [input, freeze, predictions])
    if (hash(await fs.readFile(snapshot.resolved)) !== snapshot.sha256)
      throw new Error("Pilot input changed during scoring");
  if (
    JSON.stringify(await sourceFiles(dataset, input.resolved)) !==
    JSON.stringify(sources)
  )
    throw new Error("Email content changed during scoring");
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    engine: run.engine,
    freeze_sha256: freeze.sha256,
    dataset_sha256: input.sha256,
    predictions_sha256: predictions.sha256,
    evaluator_sha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
    ...metrics,
  };
  if (outputFilename) await writeNew(outputFilename, report);
  return report;
}

export async function runPilot(args) {
  const [command, ...rest] = args;
  const allowed =
    command === "freeze"
      ? ["--dataset", "--out"]
      : command === "score"
        ? ["--freeze", "--predictions", "--out"]
        : [];
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index],
      value = rest[index + 1];
    if (
      !allowed.includes(key) ||
      !value ||
      value.startsWith("--") ||
      Object.hasOwn(options, key)
    )
      throw new Error("Invalid pilot arguments");
    options[key] = value;
  }
  if (command === "freeze" && options["--dataset"] && options["--out"])
    return freezePilot(options["--dataset"], options["--out"]);
  if (command === "score" && options["--freeze"] && options["--predictions"])
    return scorePilot(
      options["--freeze"],
      options["--predictions"],
      options["--out"],
    );
  throw new Error(
    "Use freeze --dataset <dataset.json> --out <new-freeze.json>, or score --freeze <freeze.json> --predictions <run.json> [--out <new-report.json>]",
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(JSON.stringify(await runPilot(process.argv.slice(2)), null, 2));
  } catch (error) {
    // Do not expose filesystem error paths or malformed JSON excerpts.
    console.error(
      `Pilot evaluation failed: ${error?.code ? "file operation failed; check paths and use new output filenames" : error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 1;
  }
}
