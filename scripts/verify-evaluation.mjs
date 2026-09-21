// Offline acceptance gate. Never import this module from the application.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const categories = [
  "BL_COMPARISON",
  "SI_REQUEST",
  "INVOICE_QUERY",
  "GENERAL",
  "SPAM",
];
const statuses = ["OK", "MISMATCH", "NEEDS_REVIEW"];
const reasons = [
  "wrong_doc_type",
  "missing_attachment",
  "unreadable",
  "missing_value",
];
const fields = [
  "shipper",
  "consignee",
  "notify_party",
  "port_of_loading",
  "port_of_discharge",
  "container_count",
  "gross_weight_kg",
];
const keys = [
  "category",
  "status",
  "review_reason",
  "has_defect",
  "defect_fields",
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function validateDataset(dataset, label) {
  if (!object(dataset) || !Object.keys(dataset).length)
    throw new Error(`${label} must be a non-empty email-ID object`);
  for (const [index, [id, entry]] of Object.entries(dataset).entries()) {
    const location = `${label} entry ${index + 1}`;
    if (
      !id.trim() ||
      !object(entry) ||
      Object.keys(entry).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(entry, key))
    )
      throw new Error(
        `${location} must contain exactly the five organiser fields`,
      );
    if (
      !categories.includes(entry.category) ||
      !statuses.includes(entry.status) ||
      typeof entry.has_defect !== "boolean"
    )
      throw new Error(
        `${location} has an invalid category, status or defect flag`,
      );
    if (
      !Array.isArray(entry.defect_fields) ||
      entry.defect_fields.some((field) => !fields.includes(field)) ||
      new Set(entry.defect_fields).size !== entry.defect_fields.length
    )
      throw new Error(`${location} has invalid or duplicate defect fields`);
    const mismatch = entry.status === "MISMATCH";
    const review = entry.status === "NEEDS_REVIEW";
    if (
      entry.has_defect !== mismatch ||
      entry.defect_fields.length > 0 !== mismatch ||
      (review
        ? !reasons.includes(entry.review_reason)
        : entry.review_reason !== null) ||
      (entry.category !== "BL_COMPARISON" && entry.status !== "OK")
    )
      throw new Error(
        `${location} violates the organiser status/defect/review contract`,
      );
  }
}

/** Strict schema/coverage gate in addition to, not a replacement for, official scoring. */
export function verifyEvaluation(predictions, truth) {
  validateDataset(predictions, "Predictions");
  validateDataset(truth, "Ground truth");
  const expectedIds = Object.keys(truth);
  const suppliedIds = Object.keys(predictions);
  const missingIds = expectedIds.filter(
    (id) => !Object.hasOwn(predictions, id),
  ).length;
  const extraIds = suppliedIds.filter((id) => !Object.hasOwn(truth, id)).length;
  let exactMatches = 0;
  let compared = 0;
  let defectsCaughtExactly = 0;
  let reviewReasonsMatched = 0;
  let falseOkDecisions = 0;
  for (const id of expectedIds) {
    if (!Object.hasOwn(predictions, id)) continue;
    compared++;
    const expected = truth[id],
      actual = predictions[id];
    const exact =
      keys
        .filter((key) => key !== "defect_fields")
        .every((key) => actual[key] === expected[key]) &&
      [...actual.defect_fields].sort().join(",") ===
        [...expected.defect_fields].sort().join(",");
    if (exact) exactMatches++;
    if (expected.has_defect && exact) defectsCaughtExactly++;
    if (expected.status === "NEEDS_REVIEW" && exact) reviewReasonsMatched++;
    if (expected.status !== "OK" && actual.status === "OK") falseOkDecisions++;
  }
  return {
    passed:
      missingIds === 0 && extraIds === 0 && exactMatches === expectedIds.length,
    expected_records: expectedIds.length,
    supplied_records: suppliedIds.length,
    compared_records: compared,
    missing_ids: missingIds,
    extra_ids: extraIds,
    exact_matches: exactMatches,
    mismatched_records: compared - exactMatches,
    expected_defect_cases: Object.values(truth).filter(
      (entry) => entry.has_defect,
    ).length,
    exact_defect_cases: defectsCaughtExactly,
    expected_review_cases: Object.values(truth).filter(
      (entry) => entry.status === "NEEDS_REVIEW",
    ).length,
    exact_review_cases: reviewReasonsMatched,
    false_ok_decisions: falseOkDecisions,
  };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (
      ![
        "--predictions",
        "--truth",
        "--scorer",
        "--python",
        "--report",
        "--engine",
      ].includes(key) ||
      !args[index + 1] ||
      args[index + 1].startsWith("--") ||
      Object.hasOwn(options, key)
    )
      throw new Error(
        "Use --predictions <file> --truth <file> [--scorer <official scoring.py>] [--python <executable>] [--report <file>] [--engine <version>]",
      );
    options[key] = args[index + 1];
  }
  if (!options["--predictions"] || !options["--truth"])
    throw new Error(
      "Both --predictions and --truth are required; no answer-key path is inferred",
    );
  if (options["--python"] && !options["--scorer"])
    throw new Error("--python requires --scorer");
  return options;
}

async function readInput(filename) {
  const resolved = await fs.realpath(filename);
  if ((await fs.stat(resolved)).size > 64 * 1024 * 1024)
    throw new Error("Evaluation input exceeds the 64 MiB safety limit");
  const bytes = await fs.readFile(resolved);
  return { resolved, bytes, sha256: hash(bytes) };
}

function parseInput(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    // JSON parser errors can echo input excerpts. Do not expose answer content.
    throw new Error(`${label} is not valid JSON`);
  }
}

export async function runGate(args) {
  const options = parseArgs(args);
  const predictions = await readInput(options["--predictions"]);
  const truth = await readInput(options["--truth"]);
  const scorer = options["--scorer"]
    ? await readInput(options["--scorer"])
    : null;
  const reportPath = options["--report"]
    ? path.resolve(options["--report"])
    : null;
  if (reportPath) {
    const resolvedReport = await fs
      .realpath(reportPath)
      .catch(() => reportPath);
    const canonical = (name) =>
      process.platform === "win32" ? name.toLowerCase() : name;
    if (
      [predictions.resolved, truth.resolved, scorer?.resolved]
        .filter(Boolean)
        .some((name) => canonical(name) === canonical(resolvedReport))
    )
      throw new Error(
        "Report output must not overwrite an evaluation input or scorer",
      );
  }
  const result = verifyEvaluation(
    parseInput(predictions.bytes, "Predictions"),
    parseInput(truth.bytes, "Ground truth"),
  );
  let official = null;
  if (scorer) {
    // The supplied, unmodified organiser module is the scoring authority.
    // Paths are argv values; no shell interpolation or network request is used.
    const python = options["--python"] ?? "python";
    const code =
      "import importlib.util,json,sys; s=importlib.util.spec_from_file_location('organiser_scoring',sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); truth=json.load(open(sys.argv[2],encoding='utf-8')); pred=json.load(open(sys.argv[3],encoding='utf-8')); print(json.dumps(m.score_all(truth,pred)))";
    const executed = spawnSync(
      python,
      ["-c", code, scorer.resolved, truth.resolved, predictions.resolved],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
        maxBuffer: 2 * 1024 * 1024,
        shell: false,
      },
    );
    if (executed.status !== 0 || executed.error)
      throw new Error(
        "Official scorer failed; check the Python executable and supplied scoring.py (its output is not exposed)",
      );
    const score = parseInput(executed.stdout, "Official scorer output");
    // Retain aggregates only, never per-ID predictions or answers.
    for (const value of [
      score.n_emails,
      score.final_score,
      score.stage1?.macro_f1,
      score.stage3?.defect_f1,
      score.end_to_end?.rate,
      score.reliability?.escalation_recall,
    ])
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new Error(
          "Official scorer returned an unexpected aggregate schema",
        );
    if (score.n_emails !== result.expected_records)
      throw new Error(
        "Official scorer record count disagrees with the strict gate",
      );
    official = {
      sha256: scorer.sha256,
      records: score.n_emails,
      composite_score: score.final_score,
      classification_macro_f1: score.stage1.macro_f1,
      defect_f1: score.stage3.defect_f1,
      exact_defect_catch_rate: score.end_to_end.rate,
      review_recall: score.reliability.escalation_recall,
    };
    for (const input of [predictions, truth, scorer]) {
      if (hash(await fs.readFile(input.resolved)) !== input.sha256)
        throw new Error(
          "An evaluation input changed during official scoring; rerun on stable files",
        );
    }
  }
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    engine: options["--engine"] ?? null,
    evidence_scope:
      "Exact supplied-corpus output agreement, not held-out accuracy, real-world safety or a judging score. Engine version is a caller label; hashes bind this report to its input files.",
    predictions_sha256: predictions.sha256,
    ground_truth_sha256: truth.sha256,
    verifier_sha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
    ...result,
    official_scorer: official,
  };
  if (reportPath) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const report = await runGate(process.argv.slice(2));
    console.log(JSON.stringify(report, null, 2));
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(
      `Evaluation gate failed: ${error instanceof Error ? error.message : "unknown failure"}`,
    );
    process.exitCode = 1;
  }
}
