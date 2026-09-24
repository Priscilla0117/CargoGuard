// Runs the UN/LOCODE port-code check over the supplied organiser inbox.
// Reads only inbox records and attachments; no answer key is used.
// Usage: node --import tsx scripts/evaluate-port-reference.ts [--report path.json]
import fs from "node:fs/promises";
import path from "node:path";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { emails, bundleBytes } from "../lib/bundle";
import { checkPortReferences } from "../lib/port-reference";
import { portReference } from "../lib/port-reference-server";

const reportIndex = process.argv.indexOf("--report");
const report = reportIndex > 0 ? process.argv[reportIndex + 1] : null;
const index = portReference();
const counts = { passed: 0, blocking: 0, review: 0, not_checked: 0 };
const flagged: {
  email_id: string;
  workflow: string;
  seven_field_result: string;
  document: string;
  value: string;
  status: string;
  title: string;
}[] = [];
let cases = 0;
for (const email of emails) {
  const docs = [];
  for (const name of email.attachments) {
    const bytes = bundleBytes(name);
    if (bytes) docs.push(await parseDocument(path.basename(name), bytes));
  }
  const result = analyze(email, docs);
  if (!result.comparison.length) continue;
  cases++;
  for (const finding of checkPortReferences(result, index).findings) {
    counts[finding.status]++;
    if (finding.status === "blocking" || finding.status === "review")
      flagged.push({
        email_id: email.email_id,
        workflow: result.workflow,
        seven_field_result:
          result.comparison.find(
            (row) => row.field === finding.id.split(":")[1],
          )?.result ?? "n/a",
        document: finding.document,
        value: finding.evidence[0]?.quote ?? "",
        status: finding.status,
        title: finding.title,
      });
  }
}
const summary = {
  reference: `UN/LOCODE ${index.release}`,
  compared_cases: cases,
  port_values: Object.values(counts).reduce((a, b) => a + b, 0),
  counts,
  blocking_on_verified_cases: flagged.filter(
    (item) => item.status === "blocking" && item.workflow === "verified",
  ).length,
  blocking_outside_seven_field_mismatch: flagged.filter(
    (item) =>
      item.status === "blocking" && item.seven_field_result !== "mismatch",
  ).length,
  review_on_verified_cases: flagged.filter(
    (item) => item.status === "review" && item.workflow === "verified",
  ).length,
};
console.log(JSON.stringify(summary, null, 2));
if (report) {
  await fs.mkdir(path.dirname(report), { recursive: true });
  await fs.writeFile(report, JSON.stringify({ summary, flagged }, null, 2), {
    flag: "wx",
  });
  console.log(`Report written to ${report}`);
}
