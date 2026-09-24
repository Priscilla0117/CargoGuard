import { extract } from "./compare";
import type { ParsedDocument, SourceLine } from "./types";

/** OCR-only label recovery. Never correct numbers or company names by guessing.
 * Every returned value is an UNCONFIRMED suggestion, not an operational decision. */
export function suggestScanFields(doc: ParsedDocument, lines: SourceLine[]) {
  const labels: [RegExp, string][] = [
    [/^shipper\b\s*[:.,;]?\s*/i, "Shipper"],
    [/^consignee\b\s*[:.,;]?\s*/i, "Consignee"],
    [/^notify(?:\s*party)?\b\s*[:.,;]?\s*/i, "Notify party"],
    [/^[pf]ort\s*[oa]f\s*loading\b\s*[:.,;]?\s*/i, "Port of loading"],
    [/^[pf]ort\s*[oa]f\s*discharge\b\s*[:.,;]?\s*/i, "Port of discharge"],
    [
      /^(?:container\s*count|(?:no\.?\s*of\s*)?containers)\b\s*[:.,;]?\s*/i,
      "Container count",
    ],
    [/^vessel\b\s*[:.,;]?\s*/i, "Vessel"],
    [/^booking\b\s*[:.,;]?\s*/i, "Booking"],
  ];
  return extract({
    ...doc,
    error: undefined,
    transcription: undefined,
    method: "Unconfirmed OCR suggestion",
    lines: lines.map((line) => {
      // Unit annotations are source evidence, including unsupported/conflicting
      // units. Never discard them while recovering an OCR label.
      const weight = line.text
        .trim()
        .match(
          /^((?:total\s*)?gross\s*(?:weight|wt)\b)((?:\s*\([^)]*\))*)\s*[:.,;]?\s*/i,
        );
      if (weight)
        return {
          ...line,
          text: `${/^total/i.test(weight[1]) ? "Total " : ""}Gross weight${weight[2]}: ${line.text.trim().slice(weight[0].length)}`,
        };
      const match = labels.find(([rx]) => rx.test(line.text.trim()));
      return match
        ? {
            ...line,
            text: `${match[1]}: ${line.text.trim().replace(match[0], "")}`,
          }
        : line;
    }),
  });
}
