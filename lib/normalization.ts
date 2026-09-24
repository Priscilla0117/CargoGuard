import {
  FIELDS,
  type ComparisonRow,
  type Extracted,
  type Field,
} from "./types";

export interface NormalizedValue {
  value: string | number | null;
  issue?: string;
}
const missing =
  /^(?:[\s?_\-–—.\/]+|t\.?\s*b\.?\s*[acd]\.?|n\.?\s*\/?\s*a\.?|nil|none|null|unknown|pending|unavailable|not\s+(?:available|provided|specified|stated|known|confirmed|applicable)|to\s+be\s+(?:advised|confirmed|determined|provided|decided)|awaiting\s+(?:confirmation|details|instructions)|same\s+as\s+above)$/i;
const unitPlaceholder =
  /^(?:[?_\-–—.\s]+)\s*(?:kgs?|kilograms?|mt|metric tonnes?|tonnes?)$/i;
// A document that points elsewhere does not state the value itself.
const referral =
  /^(?:see\s+(?:attached|attachment|annex|appendix|below|above|remarks?|si|shipping\s+instructions?)|as\s+per\s+(?:attached|attachment|si|shipping\s+instructions?|booking|previous|last)|refer\s+to\s+(?:attached|attachment|si|shipping\s+instructions?|booking)|x{2,}|\*+|to\s+follow|will\s+(?:advise|confirm|follow))$/i;
// Markers that say a stated value is still unconfirmed.
const unconfirmed =
  /^(?:t\.?\s*b\.?\s*[acd]\.?|pending|not\s+(?:yet\s+)?confirmed|to\s+be\s+(?:advised|confirmed|determined|provided|decided)|awaiting\s+(?:confirmation|details|instructions)|subject\s+to\s+confirmation)$/i;
const segmentsOf = (value: string) =>
  value
    .replace(/\bn\s*\/\s*a\b/gi, "NA")
    .split(/[/|;,()[\]{}]+|\s+(?:or|and|&)\s+|\s[-–—]\s/i)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
/** "TBA / TBC", "TO BE ADVISED (TBA)" or "SEE ATTACHED" state no value at all. */
export function placeholderOnly(value: string) {
  const parts = segmentsOf(value);
  return (
    parts.length > 0 &&
    parts.every((part) => missing.test(part) || referral.test(part))
  );
}
/** A real value with a "(TBC)" style marker is not yet confirmed by its issuer. */
export function hasUnconfirmedMarker(value: string) {
  return segmentsOf(value).some((part) => unconfirmed.test(part));
}
export const sameAsConsignee = (raw: string) =>
  /^(?:same as|as per)\s+(?:the\s+)?consignee\.?$/i.test(
    raw.normalize("NFKC").trim(),
  );

/** Two unexplained legal entities are not a confirmed party, even on both documents.
 * Wrapped names and address lines remain intact; this is an ambiguity gate, not
 * a name extractor. Explicit agency relationships are left for exact comparison.
 */
function ambiguousParty(value: string) {
  const names = new Set<string>();
  const blocks = value.split(/[;|]+/);
  for (const block of blocks) {
    // Join wrapped names before checking their endings, including numeric names
    // such as "3S PAPER ...". The original value is never altered by this gate.
    const plain = block
      .split(/\r?\n/)
      .filter(
        (line) =>
          !/\b(?:on behalf of|as agents? for|care of)\b|\bc\s*\/\s*o\b/i.test(
            line,
          ),
      )
      .join(" ")
      .toUpperCase()
      .replace(/[.,]/g, "")
      .trim();
    const endings =
      /\b(?:SDN BHD|PTE LTD|PTY LTD|LIMITED|LTD|INCORPORATED|INC|CORPORATION|CORP|LLC|GMBH)\b/g;
    let start = 0;
    for (const match of plain.matchAll(endings)) {
      const name = plain.slice(start, match.index + match[0].length).trim();
      const prefix = plain.slice(start, match.index).trim();
      // A suffix on a wrapped line is not another company name.
      if (/[A-Z]/.test(prefix)) names.add(name.replace(/\s+/g, " "));
      start = match.index + match[0].length;
    }
  }
  return names.size > 1;
}

/** Consume the whole expression. A valid prefix must never hide a conflicting suffix. */
export function normalizeValue(field: Field, raw: string): NormalizedValue {
  const value = raw
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .trim();
  if (
    !value ||
    !/[\p{L}\p{N}]/u.test(value) ||
    placeholderOnly(value) ||
    value
      .split(/\r?\n/)
      .some(
        (line) =>
          line.trim() &&
          (missing.test(line.trim()) ||
            unitPlaceholder.test(line.trim()) ||
            placeholderOnly(line)),
      )
  ) {
    return {
      value: null,
      issue: "Required value is missing or is a placeholder.",
    };
  }
  if (hasUnconfirmedMarker(value))
    return {
      value: null,
      issue:
        "The value is marked as unconfirmed (for example TBA or TBC). Confirm it with the issuer; matching unconfirmed text in both documents is not a verified match.",
    };
  if (field === "container_count") {
    const parts = value.split(/\s*(?:\+|;|&|\band\b)\s*/i);
    let total = 0;
    for (const part of parts) {
      // Sizes/types describe containers; they are not additional shipment fields.
      const match = part
        .trim()
        .match(
          /^(\d+)\s*(?:(?:containers?|units?)|(?:x|×)\s*(?:20|40|45)\s*(?:['′’]|ft|feet|foot)?\s*(?:hc|hq|gp|dc|dv|ot|rf|reefer|fcl|std)?)?$/i,
        );
      if (
        !match ||
        !Number.isSafeInteger(Number(match[1])) ||
        Number(match[1]) < 1
      ) {
        return {
          value: null,
          issue:
            "Container expression is incomplete, contradictory or unsupported. Confirm the total.",
        };
      }
      total += Number(match[1]);
    }
    return Number.isSafeInteger(total) && total <= 100000
      ? { value: total }
      : {
          value: null,
          issue: "Container total is outside the supported range.",
        };
  }
  if (field === "gross_weight_kg") {
    const match = value.match(
      /^(\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|mt|metric tonnes?|tonnes?)?$/i,
    );
    if (!match)
      return {
        value: null,
        issue:
          "Weight needs an unambiguous number and a supported unit (kg or tonnes).",
      };
    // A single dot and three digits can be a decimal or a locale thousands separator.
    if (/^\d{1,3}\.\d{3}$/.test(match[1])) {
      return {
        value: null,
        issue:
          "Ambiguous decimal/thousands separator. Confirm the weight in kilograms.",
      };
    }
    const number =
      Number(match[1].replace(/[ ,]/g, "")) *
      (/^(?:mt|metric tonnes?|tonnes?)$/i.test(match[2] ?? "") ? 1000 : 1);
    if (Math.abs(number * 1000 - Math.round(number * 1000)) > 0.000001)
      return {
        value: null,
        issue:
          "Weight precision exceeds one gram. Confirm the supported shipment value; no silent rounding is allowed.",
      };
    return Number.isFinite(number) && number > 0 && number <= 1e12
      ? { value: Math.round(number * 1000) / 1000 }
      : {
          value: null,
          issue: "Gross weight must be a positive, finite shipment weight.",
        };
  }
  if (
    ["shipper", "consignee", "notify_party"].includes(field) &&
    ambiguousParty(value)
  )
    return {
      value: null,
      issue:
        "Multiple possible company names appear in this party field. Confirm the intended party from the source; identical ambiguity in both documents is not a match.",
    };
  return {
    value: value
      .toUpperCase()
      .replace(/&/g, " AND ")
      .replace(/[|;\n\r]/g, " ")
      .replace(/[.,]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  };
}

export function normalize(field: Field, raw: string) {
  return normalizeValue(field, raw).value;
}

// Optional codes are equivalent only for an explicitly supported name/code pair.
// Unknown codes, different names and contradictory codes must not disappear.
const portCodes: Record<string, string> = {
  SINGAPORE: "SGSIN",
  "PORT KLANG": "MYPKG",
  SHANGHAI: "CNSHA",
  ROTTERDAM: "NLRTM",
  "HONG KONG": "HKHKG",
};
export function equivalent(
  field: Field,
  a: string | number | null,
  b: string | number | null,
) {
  if (a === null || b === null) return false;
  if (a === b) return true;
  if (
    !field.startsWith("port_of_") ||
    typeof a !== "string" ||
    typeof b !== "string"
  )
    return false;
  const canonical = (value: string) => {
    const match = value.match(/^(.+?)\s*\(([A-Z]{2}[A-Z0-9]{3})\)$/);
    return match && portCodes[match[1].trim()] === match[2]
      ? match[1].trim()
      : value;
  };
  return canonical(a) === canonical(b);
}

/** Shared by extraction AND review. Extraction ambiguity remains until that field is corrected. */
export function resolveFields(fields: Extracted): Extracted {
  const resolved = structuredClone(fields);
  for (const field of FIELDS) {
    const n = normalizeValue(field, resolved[field].raw);
    resolved[field].normalized = resolved[field].extraction_issue
      ? null
      : n.value;
    resolved[field].issue = resolved[field].extraction_issue ?? n.issue;
  }
  if (
    sameAsConsignee(resolved.notify_party.raw) &&
    !resolved.notify_party.extraction_issue
  ) {
    resolved.notify_party.normalized = resolved.consignee.normalized;
    resolved.notify_party.issue =
      resolved.consignee.normalized === null
        ? "The referenced consignee needs confirmation first."
        : undefined;
  }
  return resolved;
}

export function compareFields(si: Extracted, bl: Extracted): ComparisonRow[] {
  const a = resolveFields(si),
    b = resolveFields(bl);
  return FIELDS.map((field) => ({
    field,
    si: a[field],
    bl: b[field],
    result:
      a[field].normalized === null || b[field].normalized === null
        ? "uncertain"
        : equivalent(field, a[field].normalized, b[field].normalized)
          ? "match"
          : "mismatch",
  }));
}

export function recomputeRows(rows: ComparisonRow[]): ComparisonRow[] {
  const side = (key: "si" | "bl") =>
    Object.fromEntries(rows.map((row) => [row.field, row[key]])) as Extracted;
  return compareFields(side("si"), side("bl"));
}
