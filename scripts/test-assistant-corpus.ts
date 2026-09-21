import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { assistantContext, assistantPacket } from "../lib/assistant";
import type { CaseResult } from "../lib/types";

const paths = ["work/validation/v3/original/results.json", ...[7, 20260920, 20260921, 8675309].map(seed => `work/validation/ai-v31/seed-${seed}/results.json`)];
const datasets = [];
let cases = 0, excerpts = 0, maxBytes = 0;
for (const path of paths) {
  const raw = await fs.readFile(path, "utf8"), results: CaseResult[] = JSON.parse(raw);
  for (const r of results) {
    const before = JSON.stringify(r), context = await assistantContext(r), packet = assistantPacket(context, "Explain the findings in this case and the next steps.", []);
    assert.equal(context.facts.length, 4 + r.comparison.length * 3);
    for (const fact of context.facts.filter(f => f.source)) {
      const source = r.documents.find(d => d.name === fact.source!.name);
      assert.ok(source);
      const data = JSON.parse(fact.text);
      for (const text of data.original_excerpts) { assert.ok(source.lines.some(line => line.location === fact.source!.location && line.text === text)); excerpts++; }
    }
    assert.equal(JSON.stringify(r), before);
    maxBytes = Math.max(maxBytes, new TextEncoder().encode(JSON.stringify(packet)).byteLength);
    cases++;
  }
  datasets.push({ path, cases: results.length, sha256: createHash("sha256").update(raw).digest("hex") });
}
const report = { passed: true, generated_at: new Date().toISOString(), cases, exact_source_excerpts: excerpts, largest_packet_bytes: maxBytes, note: "Context construction and source-link integrity only. No provider calls; not a test of LLM answer accuracy. These are development generator sets, not held-out production data.", datasets };
await fs.mkdir("work/validation/assistant", { recursive: true });
await fs.writeFile("work/validation/assistant/corpus.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
