// Offline evaluation only. No application module imports answer keys.
import fs from "node:fs/promises";
const sets = [
  ["original", "../sdoc-hackathon-docker/data_v2"],
  ["seed-7", "work/audit-seed-7"],
  ["seed-20260920", "work/audit-seed-20260920"],
  ["seed-20260921", "work/validation-seed-20260921"],
  ["seed-8675309", "../tmp/harborcheck-comparison-20260920/fresh-seed-8675309"],
];
const datasets = [];
for (const [name, root] of sets) {
  const truth = JSON.parse(
    await fs.readFile(`${root}/ground_truth.json`, "utf8"),
  );
  const predicted = JSON.parse(
    await fs.readFile(`work/validation/v3/${name}/submission.json`, "utf8"),
  );
  const results = JSON.parse(
    await fs.readFile(`work/validation/v3/${name}/results.json`, "utf8"),
  );
  const keys = Object.keys(truth),
    differences = [];
  if (Object.keys(predicted).sort().join() !== keys.sort().join())
    throw new Error("Different ID coverage");
  for (const id of keys) {
    const a = truth[id],
      b = predicted[id];
    if (
      ["category", "status", "review_reason", "has_defect"].some(
        (k) => a[k] !== b[k],
      ) ||
      [...a.defect_fields].sort().join() !== [...b.defect_fields].sort().join()
    )
      differences.push({ id, expected: a, actual: b });
  }
  datasets.push({
    name,
    emails: keys.length,
    exact_matches: keys.length - differences.length,
    differences,
    false_clearances: results
      .filter(
        (r) =>
          r.workflow === "verified" &&
          (truth[r.email.email_id].has_defect ||
            truth[r.email.email_id].status === "NEEDS_REVIEW"),
      )
      .map((r) => r.email.email_id),
  });
}
const report = {
  engine: "3.0.0",
  generated_at: new Date().toISOString(),
  limitation:
    "All are supplied or same-generator synthetic development sets, not independent real-world holdouts. The comparison seed was used to diagnose the v2 error before this release.",
  datasets,
};
await fs.writeFile(
  "work/validation/v3/exact-evaluation.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
if (datasets.some((d) => d.differences.length)) process.exitCode = 1;
