import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("PDF standard font and packed CMap resources resolve as nonempty local files", async () => {
  const packageUrl = import.meta.resolve("pdfjs-dist/package.json");
  for (const resource of [
    "standard_fonts/FoxitSymbol.pfb",
    "standard_fonts/FoxitDingbats.pfb",
    "cmaps/Adobe-GB1-UCS2.bcmap",
  ]) {
    const bytes = await fs.readFile(new URL(resource, packageUrl));
    assert.ok(bytes.length > 0, `${resource} must contain data`);
  }
});

/** ASCII-only in-memory fixture with byte-accurate xref offsets. */
function symbolPdf() {
  const stream = "BT /F1 18 Tf 36 100 Td (123) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let contents = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(contents));
    contents += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(contents);
  contents += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    contents += `${String(offset).padStart(10, "0")} 00000 n \n`;
  contents += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(contents);
}

test("real Symbol-font PDF extraction succeeds without missing font-resource warnings", () => {
  // A separate process prevents another test's PDF.js cache from masking a
  // missing resource. Keep normal library logging; do not alter its verbosity.
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      String.raw`
        import { readFileSync } from "node:fs";
        import { getDocumentProxy } from "unpdf";
        import { pdfResourceOptions } from "./lib/pdf-resources.ts";
        const pdf = await getDocumentProxy(new Uint8Array(readFileSync(0)), pdfResourceOptions());
        try {
          const content = await (await pdf.getPage(1)).getTextContent();
          const text = content.items.filter(item => "str" in item).map(item => item.str).join("");
          console.log("PDF_RESOURCE_TEXT=" + JSON.stringify(text));
        } finally {
          await pdf.loadingTask.destroy();
        }
      `,
    ],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      input: symbolPdf(),
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    },
  );
  // Preserve captured diagnostics in the test log, including on success.
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  assert.doesNotMatch(
    child.stdout + child.stderr,
    /standardFontDataUrl|Unable to load (?:font|CMap) data/i,
  );
  assert.match(child.stdout, /PDF_RESOURCE_TEXT="123"/);
});
