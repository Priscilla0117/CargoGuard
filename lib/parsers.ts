import { unzipSync, strFromU8 } from "fflate";
import { XMLParser } from "fast-xml-parser";
import type { ParsedDocument, SourceLine } from "./types";
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
    page_count: number | undefined;
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
      const { getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes.slice());
      page_count = pdf.numPages;
      try {
        if (pdf.numPages > 30)
          throw new Error("PDF exceeds the 30-page limit.");
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          for (const item of content.items) {
            if ("str" in item && item.str.trim())
              lines.push({
                text: item.str,
                location: `Page ${p}, y=${Math.round(item.transform[5])}`,
              });
          }
        }
      } finally {
        await pdf.loadingTask.destroy();
      }
      if (!lines.length)
        throw new Error(
          "Image-only scan: no text layer. Request a readable copy or submit verified text for human review.",
        );
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
            const value =
              type === "s"
                ? shared[Number(cell.v)]
                : type === "inlineStr"
                  ? texts(cell.is)
                  : texts(cell.v);
            if (cell.f && !value)
              throw new Error(
                "A spreadsheet formula has no cached value. Recalculate and save before uploading.",
              );
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
    return {
      name,
      format,
      lines,
      type: identify(lines),
      method,
      sha256,
      page_count,
    };
  } catch (error) {
    return {
      name,
      format,
      lines: [],
      type: "UNKNOWN",
      method: method || "File validation",
      sha256,
      page_count,
      error:
        error instanceof Error
          ? error.message
          : "Document parsing failed. Retry or request a readable copy.",
    };
  }
}
