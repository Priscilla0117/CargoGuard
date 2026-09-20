import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
await fs.mkdir("work/validation", { recursive: true });
const steps = [
  ["typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["lint", ["node_modules/eslint/bin/eslint.js", "."]],
  [
    "unit-tests",
    [
      "--import",
      "tsx",
      "--test",
      "tests/pipeline.test.ts",
      "tests/hardening.test.ts",
      "tests/transcription.test.ts",
      "tests/upgrade.test.ts",
      "tests/storage-node.test.ts",
    ],
  ],
  ["input-integrity", ["scripts/check-bundle.mjs"]],
];
if (process.argv.includes("--build")) {
  steps.push(["ocr-assets", ["scripts/stage-ocr.mjs"]]);
  steps.push(["build", ["node_modules/next/dist/bin/next", "build", "--webpack"]]);
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
    { generated_at: new Date().toISOString(), steps: report },
    null,
    2,
  ),
);
if (report.some((r) => !r.passed)) process.exitCode = 1;
