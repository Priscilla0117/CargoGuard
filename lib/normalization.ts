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
  /^(?:[\s?_\-–—.\/]+|[\s?_\-–—.\/]*[?_]{2,}[\s?_\-–—.\/]*(?:m\.?t\.?s?|kgs?|kilograms?|tonnes?|containers?|units?)\.?|t\.?\s*b\.?\s*[acd]\.?|n\.?\s*\/?\s*a\.?|nil|none|null|unknown|pending|unavailable|not\s+(?:available|provided|specified|stated|known|confirmed|applicable)|to\s+be\s+(?:advised|confirmed|determined|provided|decided)|awaiting\s+(?:confirmation|details|instructions)|same\s+as\s+above)$/i;
export const sameAsConsignee = (raw: string) =>
  /^(?:same as|as per)\s+(?:the\s+)?consignee\.?$/i.test(
    raw.normalize("NFKC").trim(),
  );

/** Consume the whole expression. A valid prefix must never hide a conflicting suffix. */
export function normalizeValue(field: Field, raw: string): NormalizedValue {
  const value = raw
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .trim();
  if (
    !value ||
    value
      .split(/\r?\n/)
      .some((line) => line.trim() && missing.test(line.trim()))
  ) {
    return {
      value: null,
      issue: "Required value is missing or is a placeholder.",
    };
  }
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

const PARTY_FIELDS = new Set<Field>(["shipper", "consignee", "notify_party"]);
const PORT_FIELDS = new Set<Field>(["port_of_loading", "port_of_discharge"]);
const LOCODE = /\s*\(([A-Z]{2}[A-Z0-9]{3})\)$/;
const nameLine = (raw: string) =>
  normalize("shipper", raw.split(/\r?\n/).find((l) => l.trim()) ?? "");
const hasAddressBlock = (raw: string) =>
  raw.split(/\r?\n/).filter((l) => l.trim()).length > 1;

/**
 * Only RELAXES formatting-only differences; it never hides a changed name, port or code.
 * - Party: one side gives the name only, the other gives the same name plus its address.
 * - Port: one side adds a UN/LOCODE in brackets (or gives only the code) that the other omits.
 */
export function formattingOnlyDifference(
  field: Field,
  si: { raw: string; normalized: string | number | null },
  bl: { raw: string; normalized: string | number | null },
): boolean {
  if (typeof si.normalized !== "string" || typeof bl.normalized !== "string")
    return false;
  if (PARTY_FIELDS.has(field)) {
    const siAddr = hasAddressBlock(si.raw),
      blAddr = hasAddressBlock(bl.raw);
    if (siAddr === blAddr) return false; // both or neither carry an address: exact rule applies
    const nameOnly = siAddr ? bl : si,
      withAddress = siAddr ? si : bl;
    const name = nameLine(withAddress.raw);
    return !!name && name === nameOnly.normalized;
  }
  if (PORT_FIELDS.has(field)) {
    const sa = si.normalized.match(LOCODE),
      ba = bl.normalized.match(LOCODE);
    if (sa && ba) return false; // both carry codes: exact rule applies
    const coded = sa ? si.normalized : ba ? bl.normalized : null;
    const plain = sa ? bl.normalized : ba ? si.normalized : null;
    if (!coded || !plain) return false;
    const m = coded.match(LOCODE)!;
    return coded.replace(LOCODE, "").trim() === plain || m[1] === plain;
  }
  return false;
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
        : a[field].normalized === b[field].normalized ||
            formattingOnlyDifference(field, a[field], b[field])
          ? "match"
          : "mismatch",
  }));
}

export function recomputeRows(rows: ComparisonRow[]): ComparisonRow[] {
  const side = (key: "si" | "bl") =>
    Object.fromEntries(rows.map((row) => [row.field, row[key]])) as Extracted;
  return compareFields(side("si"), side("bl"));
}
