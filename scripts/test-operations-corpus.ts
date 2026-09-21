import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  amendmentDraft,
  answerCase,
  comparisonComplete,
  GUIDE_QUESTIONS,
  type GuideQuestion,
} from "../lib/case-guide";
import { LANES, operationsSnapshot } from "../lib/operations";
import { summaryOf, PIPELINE_VERSION, type CaseResult } from "../lib/types";

const paths = [
  "work/validation/v3/original/results.json",
  ...[7, 20260920, 20260921, 8675309].map(
    (seed) => `work/validation/ai-v31/seed-${seed}/results.json`,
  ),
];
const datasets = [];
let checks = 0;
for (const path of paths) {
  const raw = await fs.readFile(path, "utf8");
  const results: CaseResult[] = JSON.parse(raw);
  const snapshot = operationsSnapshot(results.map(summaryOf));
  assert.equal(results.length, 520);
  assert.equal(
    LANES.reduce((sum, lane) => sum + snapshot.lanes[lane].length, 0),
    results.length,
  );
  checks += 2;
  let drafts = 0,
    complete = 0;
  for (const result of results) {
    const before = JSON.stringify(result);
    assert.equal(result.pipeline_version, PIPELINE_VERSION);
    checks++;
    for (const question of Object.keys(GUIDE_QUESTIONS) as GuideQuestion[]) {
      const answer = answerCase(result, question);
      assert.ok(answer.title && answer.paragraphs.length);
      checks++;
      for (const row of answer.rows) {
        assert.ok(result.comparison.includes(row));
        checks++;
      }
    }
    const ready = comparisonComplete(result);
    assert.equal(ready, result.workflow === "verified");
    checks++;
    if (ready) complete++;
    const draft = amendmentDraft(result);
    if (draft.available) {
      drafts++;
      assert.ok(draft.differences > 0);
      assert.equal(result.category, "BL_COMPARISON");
      assert.match(draft.text, /NOTHING HAS BEEN SENT/);
      checks += 3;
      for (const row of result.comparison.filter(
        (r) => r.result === "mismatch",
      )) {
        assert.ok(draft.text.includes(`SI reference: ${row.si.raw}`));
        assert.ok(draft.text.includes(`Current draft BL: ${row.bl.raw}`));
        checks += 2;
      }
    }
    assert.equal(JSON.stringify(result), before);
    checks++;
  }
  assert.equal(snapshot.lanes.handoff.length, complete);
  checks++;
  datasets.push({
    path,
    source_sha256: createHash("sha256").update(raw).digest("hex"),
    cases: results.length,
    lanes: Object.fromEntries(
      LANES.map((lane) => [lane, snapshot.lanes[lane].length]),
    ),
    amendment_drafts: drafts,
  });
}
const report = {
  passed: true,
  generated_at: new Date().toISOString(),
  engine: PIPELINE_VERSION,
  cases: datasets.reduce((n, d) => n + d.cases, 0),
  checks,
  note: "Read-only operations/guide transformations across existing development outputs. This is not a new held-out model evaluation or employee usability study.",
  datasets,
};
await fs.mkdir("work/validation/operations", { recursive: true });
await fs.writeFile(
  "work/validation/operations/corpus.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
