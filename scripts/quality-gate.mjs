import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const tool = (name) => require.resolve(name);
const organiserBundle = process.env.CARGO_ORGANISER_BUNDLE ?? "../sdoc-hackathon-bundle";
const organiserDockerData = process.env.CARGO_ORGANISER_DOCKER_DATA ?? "../sdoc-hackathon-docker/data_v2";
const engine = JSON.parse(await fs.readFile("package.json", "utf8")).version;
const testFiles = (await fs.readdir("tests"))
  .filter((name) => name.endsWith(".test.ts"))
  .sort()
  .map((name) => path.join("tests", name));
if (!testFiles.length) throw new Error("No tests found; refusing an empty quality gate.");
await fs.mkdir("work/validation", { recursive: true });
const steps = [
  ["typecheck", [tool("typescript/bin/tsc"), "--noEmit"]],
  ["lint", [path.join(path.dirname(tool("eslint/package.json")), "bin/eslint.js"), "."]],
  [
    "unit-tests",
    [
      "--import",
      "tsx",
      "--test",
      ...testFiles,
    ],
  ],
  ["input-integrity", ["scripts/check-bundle.mjs"]],
  ["evaluate-organiser", ["--import", "tsx", "scripts/evaluate.ts", organiserBundle, "work/validation/v3/original"]],
  ["independent-accuracy", [
    "scripts/verify-evaluation.mjs",
    "--predictions", "work/validation/v3/original/submission.json",
    "--truth", path.join(organiserDockerData, "ground_truth.json"),
    "--scorer", path.join(organiserDockerData, "..", "server", "scoring.py"),
    "--python", process.env.CARGO_PYTHON ?? "python",
    "--engine", engine,
    "--report", "work/validation/accuracy-gate.json",
  ]],
];
if (process.argv.includes("--build")) {
  steps.push(["ocr-assets", ["scripts/stage-ocr.mjs"]]);
  steps.push(["build", [tool("next/dist/bin/next"), "build", "--webpack"]]);
}
const report = [];
for (const [name, args] of steps) {
  const started = performance.now();
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 240000,
    maxBuffer: 12 * 1024 * 1024,
  });
  await fs.writeFile(
    `work/validation/${name}.log`,
    (result.stdout ?? "") + (result.stderr ?? ""),
  );
  const row = {
    step: name,
    passed: result.status === 0,
    duration_ms: Math.round(performance.now() - started),
  };
  report.push(row);
  console.log(row);
  if (result.status !== 0) {
    console.error(result.stdout, result.stderr, result.error ?? "");
    break;
  }
}
await fs.writeFile(
  "work/validation/quality-gate.json",
  JSON.stringify(
    { generated_at: new Date().toISOString(), test_files: testFiles, complete: report.length === steps.length, steps: report },
    null,
    2,
  ),
);
if (report.some((r) => !r.passed)) process.exitCode = 1;
