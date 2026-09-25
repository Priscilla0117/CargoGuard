import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { ParsedDocument, SourceLine } from "./types";
import { pdfCoverageIssue } from "./pdf-coverage";
const MAX_BYTES = 5 * 1024 * 1024;
const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  processEntities: false,
});
const arr = <T>(v: T | T[] | undefined): T[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];
function decode(s: string) {
  return s
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const n =
        code[0].toLowerCase() === "x"
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return n <= 0x10ffff ? String.fromCodePoint(n) : "�";
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
function texts(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node !== "object") return String(node);
  if (Array.isArray(node)) return node.map(texts).join("");
  return Object.entries(node)
    .filter(([k]) => !k.startsWith("@_"))
    .map(([k, v]) => (k === "#text" ? String(v) : texts(v)))
    .join("");
}
function zipXml(bytes: Uint8Array) {
  let total = 0,
    files = 0;
  return unzipSync(bytes, {
    filter: (f) => {
      if (++files > 1000)
        throw new Error("Too many entries in the document archive.");
      if (!/\.xml$|\.rels$/.test(f.name)) return false;
      total += f.originalSize;
      if (total > 12 * 1024 * 1024 || f.originalSize > 6 * 1024 * 1024)
        throw new Error("Expanded document exceeds the safe parsing limit.");
      return true;
    },
  });
}
export function identify(lines: SourceLine[]): ParsedDocument["type"] {
  const head = lines
    .slice(0, 9)
    .map((l) => l.text)
    .join(" ");
  if (/commercial invoice|packing list|certificate of origin/i.test(head))
    return "OTHER";
  if (
    /shipping instruction|bill of lading instruction|\bbl instruction\b|\bb\/l instruction\b/i.test(
      head,
    )
  )
    return "SI";
  if (/bill of lading|draft\s*b\/?l/i.test(head)) return "BL";
  return "UNKNOWN";
}
export async function parseDocument(
  name: string,
  bytes: Uint8Array,
): Promise<ParsedDocument> {
  const format = name.split(".").pop()?.toLowerCase() ?? "";
  let lines: SourceLine[] = [];
  let method = "",
    sha256: string | undefined,
    page_count: number | undefined,
    pdf_coverage: ParsedDocument["pdf_coverage"];
  try {
    if (bytes.length > MAX_BYTES)
      throw new Error("File exceeds the 5 MB upload limit.");
    if (!bytes.length)
      throw new Error("The file is empty. Request a readable copy.");
    sha256 = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
      ),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (format === "txt") {
      method = "UTF-8 text";
      lines = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .split(/\r?\n/)
        .map((text, i) => ({ text, location: `Line ${i + 1}` }));
    } else if (format === "pdf") {
      method = "PDF text and layout";
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
        throw new Error("Invalid PDF header. Request a readable copy.");
      const { getDocumentProxy, getResolvedPDFJS } = await import("unpdf");
      const { pdfResourceOptions } = await import("./pdf-resources");
      const pdf = await getDocumentProxy(bytes.slice(), pdfResourceOptions());
      page_count = pdf.numPages;
      pdf_coverage = { version: 1, pages: [] };
      try {
        if (pdf.numPages > 30)
          throw new Error("PDF exceeds the 30-page limit.");
        const { OPS } = await getResolvedPDFJS();
        const imageOps = new Set(
          Object.entries(OPS)
            .filter(([key]) => /^paint.*Image|^beginInlineImage$/.test(key))
            .map(([, value]) => value),
        );
        const textOps = new Set([
          OPS.showText,
          OPS.showSpacedText,
          OPS.nextLineShowText,
          OPS.nextLineSetSpacingShowText,
        ]);
        const pathPaintOps = new Set([
          OPS.stroke,
          OPS.closeStroke,
          OPS.fill,
          OPS.eoFill,
          OPS.fillStroke,
          OPS.eoFillStroke,
          OPS.closeFillStroke,
          OPS.closeEOFillStroke,
          OPS.shadingFill,
          OPS.rawFillPath,
        ]);
        for (let p = 1; p <= pdf.numPages; p++) {
          const before = lines.length;
          try {
            const page = await pdf.getPage(p);
            const content = await page.getTextContent();
            for (const item of content.items) {
              if ("str" in item && item.str.trim())
                lines.push({
                  text: item.str,
                  location: `Page ${p}, y=${Math.round(item.transform[5])}`,
                });
            }
            const operators = await page.getOperatorList();
            const has_images = operators.fnArray.some((op: number) =>
              imageOps.has(op),
            );
            let textDrawn = false;
            const has_vector_overlays = operators.fnArray.some(
              (op: number, index: number) => {
                if (textOps.has(op)) textDrawn = true;
                // PDF.js folds a rectangle fill or stroke into constructPath:
                // args[0] is the paint operator, not another fnArray entry.
                // rawFillPath may likewise be produced for a compiled image mask.
                const paint =
                  op === OPS.constructPath
                    ? operators.argsArray[index]?.[0]
                    : op;
                return textDrawn && pathPaintOps.has(paint);
              },
            );
            const annotations = await page.getAnnotations();
            const has_annotations = annotations.some(
              (annotation) =>
                annotation.subtype !== "Link" ||
                !!annotation.contentsObj?.str?.trim() ||
                !!annotation.richText,
            );
            const text_items = lines.length - before;
            const requires_review =
              !text_items ||
              has_images ||
              has_annotations ||
              has_vector_overlays;
            pdf_coverage.pages.push({
              page: p,
              text_items,
              has_images,
              requires_review,
              ...(requires_review
                ? {
                    reason: !text_items
                      ? "No readable text layer on this page."
                      : has_images
                        ? "This page contains image content that text extraction cannot verify."
                        : has_annotations
                          ? "This page has visual annotations or form content requiring inspection."
                          : "This page paints shapes or lines after readable text. They may cover or cross out values; inspect the original page. Table borders can also require this conservative visual review.",
                  }
                : {}),
            });
            page.cleanup();
          } catch {
            // Other pages stay useful. Failure on one page must never disappear
            // behind a successful text extraction elsewhere in the document.
            pdf_coverage.pages.push({
              page: p,
              text_items: lines.length - before,
              has_images: false,
              requires_review: true,
              reason: "This page could not be fully inspected.",
            });
          }
        }
      } finally {
        await pdf.loadingTask.destroy();
      }
    } else if (format === "docx") {
      method = "DOCX paragraphs and table cells";
      const files = zipXml(bytes),
        doc = files["word/document.xml"];
      if (!doc) throw new Error("Missing Word document content.");
      const raw = strFromU8(doc);
      let n = 0;
      for (const match of raw.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)) {
        const text = [
          ...match[0].matchAll(
            /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:br|tab|cr)\b[^>]*\/>/g,
          ),
        ]
          .map((m) => (m[1] === undefined ? "\n" : decode(m[1])))
          .join("");
        if (text.trim()) lines.push({ text, location: `Paragraph ${++n}` });
      }
    } else if (format === "xlsx") {
      method = "XLSX cells";
      const files = zipXml(bytes);
      const shared = files["xl/sharedStrings.xml"]
        ? arr(xml.parse(strFromU8(files["xl/sharedStrings.xml"])).sst?.si).map(
            texts,
          )
        : [];
      const workbook = files["xl/workbook.xml"]
        ? xml.parse(strFromU8(files["xl/workbook.xml"]))
        : {};
      const sheets = arr(workbook.workbook?.sheets?.sheet) as Record<
        string,
        string
      >[];
      const rels = files["xl/_rels/workbook.xml.rels"]
        ? (arr(
            xml.parse(strFromU8(files["xl/_rels/workbook.xml.rels"]))
              .Relationships?.Relationship,
          ) as Record<string, string>[])
        : [];
      for (const sheet of sheets) {
        const relation = rels.find((r) => r["@_Id"] === sheet["@_r:id"]);
        const target = relation?.["@_Target"] ?? "";
        const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
        const data = files[path];
        if (!data) continue;
        const ws = xml.parse(strFromU8(data));
        for (const row of arr(ws.worksheet?.sheetData?.row) as Record<
          string,
          unknown
        >[]) {
          for (const cell of arr(row.c) as Record<string, unknown>[]) {
            const type = cell["@_t"];
            if (type === "e")
              throw new Error(
                "The spreadsheet contains an error cell. Resolve the errors and export a values-only copy before uploading.",
              );
            // A cached formula result can be stale, and this parser does not
            // execute Excel formulas or linked workbooks. Never verify it as fact.
            if ("f" in cell)
              throw new Error(
                "Spreadsheet formula results cannot be independently recalculated. Recalculate, inspect and export a values-only copy before uploading.",
              );
            const value =
              type === "s"
                ? shared[Number(cell.v)]
                : type === "inlineStr"
                  ? texts(cell.is)
                  : texts(cell.v);
            if (value !== undefined && String(value).trim())
              lines.push({
                text: decode(String(value)),
                location: `${sheet["@_name"]}!${cell["@_r"]}`,
              });
          }
        }
      }
      if (!lines.length)
        throw new Error("No readable spreadsheet cells found.");
    } else
      throw new Error("Unsupported file type. Use TXT, PDF, DOCX or XLSX.");
    if (lines.reduce((n, l) => n + l.text.length, 0) > 200000)
      throw new Error("Extracted document is too large.");
    const document: ParsedDocument = {
      name,
      format,
      lines,
      type: identify(lines),
      method,
      sha256,
      page_count,
      pdf_coverage,
    };
    const coverageIssue = pdfCoverageIssue(document);
    if (coverageIssue)
      document.error =
        format === "pdf" && !lines.length
          ? `Image-only scan: no text layer. ${coverageIssue}`
          : coverageIssue;
    return document;
  } catch (error) {
    return {
      name,
      format,
      lines: [],
      type: "UNKNOWN",
      method: method || "File validation",
      sha256,
      page_count,
      pdf_coverage,
      error:
        error instanceof Error
          ? error.message
          : "Document parsing failed. Retry or request a readable copy.",
    };
  }
}
