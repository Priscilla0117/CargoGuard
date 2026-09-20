import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createWorker } from "tesseract.js";
import { suggestScanFields } from "../lib/ocr.ts";
import { FIELDS } from "../lib/types.ts";
const poppler = process.argv[2];
if (!poppler) throw new Error("Usage: node --import tsx scripts/test-ocr.mjs <absolute pdftoppm executable>");
await fs.mkdir("work/validation/ocr", { recursive: true });
const results = JSON.parse(await fs.readFile("work/evaluation/results.json", "utf8")), report = [];
const worker = await createWorker("eng", 1, { langPath: path.resolve("public/ocr"), cacheMethod: "none" });
try {
  for (const r of results) for (const d of r.documents.filter((d) => d.error?.startsWith("Image-only scan:"))) {
    const source = r.email.attachments.find((p) => p.endsWith(d.name));
    const prefix = path.resolve("work/validation/ocr", d.name.replace(/\.pdf$/, ""));
    const render = spawnSync(poppler, ["-r", "180", "-singlefile", "-png", path.resolve("../sdoc-hackathon-bundle", source), prefix], { encoding: "utf8", windowsHide: true });
    if (render.status !== 0) throw new Error(render.stderr);
    const started = performance.now(), { data } = await worker.recognize(`${prefix}.png`);
    const lines = data.text.split(/\r?\n/).map((text, i) => ({ text, location: `Page 1; OCR line ${i + 1}` }));
    const fields = suggestScanFields(d, lines);
    const row = { document: d.name, confidence: data.confidence, duration_ms: Math.round(performance.now() - started), valid_candidate_fields: FIELDS.filter((f) => fields[f].normalized !== null).length, fields, text: data.text };
    report.push(row); console.log(JSON.stringify({ document: row.document, confidence: row.confidence, candidate_fields: row.valid_candidate_fields, ms: row.duration_ms }));
  }
} finally { await worker.terminate(); }
await fs.writeFile("work/validation/ocr-report.json", JSON.stringify({ note: "Candidate completeness is not accuracy. All fields require human confirmation; source scans are rendered for visual comparison.", documents: report }, null, 2));
