import { copyFile, mkdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const target = new URL("public/ocr/", root);
await mkdir(target, { recursive: true });
const files = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js/LICENSE.md", "LICENSE-tesseract.txt"],
  ["tesseract.js/dist/worker.min.js.LICENSE.txt", "worker.min.js.LICENSE.txt"],
  ["tesseract.js-core/LICENSE", "LICENSE-core.txt"],
  ["@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
  ...["tesseract-core", "tesseract-core-simd", "tesseract-core-lstm", "tesseract-core-simd-lstm"].map((name) => [`tesseract.js-core/${name}.wasm.js`, `${name}.wasm.js`]),
];
for (const [source, dest] of files) {
  const from = new URL(`node_modules/${source}`, root), to = new URL(dest, target);
  const existing = await stat(to).catch(() => null), original = await stat(from);
  if (!existing || existing.mtimeMs < original.mtimeMs || existing.size !== original.size) await copyFile(from, to);
}
console.log(`Staged same-origin OCR runtime in ${fileURLToPath(target)}`);
