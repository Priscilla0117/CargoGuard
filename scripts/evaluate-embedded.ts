/** Offline convenience command for the source ZIP; never reads an answer key. */
import fs from "node:fs/promises";
import path from "node:path";
import { emails, bundleBytes } from "../lib/bundle";
import { submissionEntry } from "../lib/compare";
import { processEmail } from "../lib/processing";
import type { CaseResult } from "../lib/types";

const out = path.resolve("work/evaluation");
const results: CaseResult[] = [];
const started = performance.now();
for (const email of emails) {
  const result = await processEmail(email, async (attachment) =>
    bundleBytes(attachment),
  );
  results.push(result);
}
await fs.mkdir(out, { recursive: true });
await fs.writeFile(
  path.join(out, "results.json"),
  JSON.stringify(results, null, 2),
);
await fs.writeFile(
  path.join(out, "submission.json"),
  JSON.stringify(
    Object.fromEntries(
      results.map((r) => [r.email.email_id, submissionEntry(r)]),
    ),
    null,
    2,
  ),
);
const workflows: Record<string, number> = {};
for (const result of results) {
  workflows[result.workflow] = (workflows[result.workflow] ?? 0) + 1;
}
console.log({
  emails: results.length,
  duration_ms: Math.round(performance.now() - started),
  workflows,
  scope: "Computed from packaged inputs; no ground-truth scoring performed",
});
