// Records the engine's organiser-format output for every supplied inbox email,
// or compares the current engine with an earlier recording.
// Reads only inbox records and attachments; no answer key is used.
// Usage:
//   node --import tsx scripts/regression-snapshot.ts save work/snapshot.json
//   node --import tsx scripts/regression-snapshot.ts compare work/snapshot.json
import fs from "node:fs/promises";
import path from "node:path";
import { analyze, submissionEntry } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { emails, bundleBytes } from "../lib/bundle";

const [mode, file] = process.argv.slice(2);
if (!["save", "compare"].includes(mode) || !file) {
  console.error("Usage: regression-snapshot.ts save|compare <file.json>");
  process.exit(2);
}
const current: Record<string, unknown> = {};
for (const email of emails) {
  const docs = [];
  for (const name of email.attachments) {
    const bytes = bundleBytes(name);
    if (bytes) docs.push(await parseDocument(path.basename(name), bytes));
  }
  const result = analyze(email, docs);
  current[email.email_id] = {
    output: submissionEntry(result),
    workflow: result.workflow,
    fields: result.comparison.map((row) => [row.field, row.result]),
  };
}
if (mode === "save") {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(current, null, 1));
  console.log(`Saved ${Object.keys(current).length} results to ${file}`);
} else {
  const earlier = JSON.parse(await fs.readFile(file, "utf8"));
  const changed = Object.keys(current).filter(
    (id) => JSON.stringify(current[id]) !== JSON.stringify(earlier[id]),
  );
  console.log(
    JSON.stringify(
      {
        emails: Object.keys(current).length,
        changed: changed.length,
        ids: changed,
      },
      null,
      2,
    ),
  );
  if (changed.length) process.exit(1);
}
