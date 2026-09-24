import fs from "node:fs/promises";
import path from "node:path";
import { submissionEntry } from "../lib/compare";
import { processEmail } from "../lib/processing";
import type { Email, CaseResult } from "../lib/types";
const root = path.resolve(process.argv[2] ?? "../sdoc-hackathon-bundle"),
  out = path.resolve(process.argv[3] ?? "work/validation/v3/original");
await fs.mkdir(out, { recursive: true });
const files = (await fs.readdir(path.join(root, "inbox")))
  .filter((f) => f.endsWith(".json"))
  .sort();
const results: CaseResult[] = [];
const started = performance.now();
for (const file of files) {
  const e: Email = JSON.parse(
    await fs.readFile(path.join(root, "inbox", file), "utf8"),
  );
  // Exercise the same classify-before-parsing intake and deterministic pipeline
  // as the application. Ground truth is only consumed by the offline scorer.
  const r = await processEmail(
    e,
    async (attachment) =>
      new Uint8Array(await fs.readFile(path.join(root, attachment))),
  );
  results.push(r);
}
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
const histogram: Record<string, number> = {};
for (const r of results)
  histogram[r.workflow] = (histogram[r.workflow] ?? 0) + 1;
console.log(
  JSON.stringify(
    {
      emails: results.length,
      duration_ms: Math.round(performance.now() - started),
      workflows: histogram,
    },
    null,
    2,
  ),
);
