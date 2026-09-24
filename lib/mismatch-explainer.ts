import { sameAsConsignee } from "./normalization";
import { parseStatedPort } from "./port-reference";
import { FIELD_LABELS, type ComparisonRow, type Field } from "./types";

/**
 * Explains a strict mismatch in plain words so an employee knows what kind of
 * correction to ask for. Explanations never change the verdict: a mismatch
 * stays a mismatch, and the SI remains the reference.
 *
 * - "clerical": the pattern of a typing or copying slip (swapped digits,
 *   tonnes vs kg, a one-letter typo, swapped parties). Ask the issuer to
 *   correct the draft.
 * - "material": the draft states a genuinely different value. Confirm which is
 *   right (the SI may be outdated) before requesting the change.
 */
export type MismatchKind = "clerical" | "material";
export interface MismatchExplanation {
  field: Field;
  kind: MismatchKind;
  title: string;
  detail: string;
}

const compact = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

export function editDistance(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++)
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    previous = current;
  }
  return previous[b.length];
}

const number = (value: number) => value.toLocaleString("en-US");
const difference = (a: string, b: string) => {
  let start = 0;
  while (start < a.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { si: a.slice(start, endA) || "—", bl: b.slice(start, endB) || "—" };
};

function explainWeight(
  si: number,
  bl: number,
): Omit<MismatchExplanation, "field"> {
  const siDigits = String(si).replace(".", ""),
    blDigits = String(bl).replace(".", "");
  const heavier = bl > si;
  const delta = Math.abs(bl - si);
  const percent = si ? (delta / si) * 100 : 0;
  if (si && (bl === si * 1000 || si === bl * 1000))
    return {
      kind: "clerical",
      title: "Likely tonnes / kilograms mix-up",
      detail: `One value is exactly 1,000 times the other (SI ${number(si)} kg, BL ${number(bl)} kg). A weight entered in tonnes was probably read as kilograms, or the reverse.`,
    };
  if (
    siDigits.length === blDigits.length &&
    [...siDigits].sort().join("") === [...blDigits].sort().join("")
  ) {
    const positions = [...siDigits].flatMap((digit, i) =>
      digit === blDigits[i] ? [] : [i],
    );
    if (positions.length === 2)
      return {
        kind: "clerical",
        title: "Likely swapped digits",
        detail: `The same digits appear in a different order (SI ${number(si)} kg, BL ${number(bl)} kg). This is a typical typing slip; ask the issuer to correct the BL to the SI weight.`,
      };
  }
  if (editDistance(siDigits, blDigits) === 1)
    return {
      kind: "clerical",
      title: "Likely one-digit typing error",
      detail: `Only one digit is added, missing or different (SI ${number(si)} kg, BL ${number(bl)} kg). Ask the issuer to correct the BL to the SI weight.`,
    };
  return {
    kind: "material",
    title: `BL weight is ${number(delta)} kg ${heavier ? "higher" : "lower"}`,
    detail: `The BL states ${number(bl)} kg against ${number(si)} kg in the SI (${percent.toFixed(1)}% ${heavier ? "more" : "less"}). This is not a typing pattern; confirm the correct weight (the SI may be outdated) before requesting the change.`,
  };
}

const LEGAL_FORMS: [RegExp, string][] = [
  [/\bLIMITED\b/g, "LTD"],
  [/\bCOMPANY\b/g, "CO"],
  [/\bCORPORATION\b/g, "CORP"],
  [/\bINCORPORATED\b/g, "INC"],
  [/\bPRIVATE\b/g, "PTE"],
  [/\bSENDIRIAN\b/g, "SDN"],
  [/\bBERHAD\b/g, "BHD"],
  [/\bPERSEROAN TERBATAS\b/g, "PT"],
];
const legalForm = (value: string) =>
  compact(
    LEGAL_FORMS.reduce(
      (text, [pattern, short]) => text.replace(pattern, short),
      value.toUpperCase().replace(/[^A-Z0-9 ]/g, " "),
    ),
  );
const firstLine = (raw: string) =>
  raw
    .split(/\r?\n|;/)
    .find((line) => line.trim())
    ?.trim() ?? "";

function explainParty(row: ComparisonRow): Omit<MismatchExplanation, "field"> {
  const si = row.si.raw,
    bl = row.bl.raw;
  if (compact(si) === compact(bl))
    return {
      kind: "clerical",
      title: "Only spacing or symbols differ",
      detail:
        "The letters and numbers are identical; only spaces, hyphens, brackets or similar symbols differ. Ask the issuer to copy the SI text exactly.",
    };
  if (legalForm(si) === legalForm(bl))
    return {
      kind: "clerical",
      title: "Only the legal-form spelling differs",
      detail:
        "The names differ only in how the company form is written (for example LIMITED vs LTD or SENDIRIAN BERHAD vs SDN BHD). Ask the issuer to use the SI wording.",
    };
  const siName = firstLine(si),
    blName = firstLine(bl);
  const rest = (raw: string) =>
    compact(raw.slice(raw.indexOf(firstLine(raw)) + firstLine(raw).length));
  if (compact(siName) && compact(siName) === compact(blName)) {
    const siRest = rest(si),
      blRest = rest(bl);
    if (!siRest || !blRest)
      return {
        kind: "clerical",
        title: `Same company; the ${siRest ? "BL leaves out" : "BL adds"} address lines`,
        detail: `Both documents name ${siName}. Only the ${siRest ? "SI" : "BL"} includes further address lines. Ask the issuer to state the party exactly as in the SI.`,
      };
    return {
      kind: "material",
      title: "Same company, different address details",
      detail: `The company name matches (${siName}), but the address or following lines differ. Address details can decide delivery and customs clearance; confirm them before requesting the change.`,
    };
  }
  const distance = editDistance(compact(siName), compact(blName));
  if (compact(siName).length >= 6 && distance <= 2) {
    const changed = difference(siName.toUpperCase(), blName.toUpperCase());
    return {
      kind: "clerical",
      title: `Likely typo in the name (${distance} character${distance === 1 ? "" : "s"})`,
      detail: `The names are nearly identical: “${changed.si}” in the SI became “${changed.bl}” in the BL. Ask the issuer to correct the spelling to match the SI.`,
    };
  }
  if (rest(si) && rest(si) === rest(bl))
    return {
      kind: "material",
      title: "Different company name at the same address",
      detail: `The address matches the SI, but the company was changed from ${siName} to ${blName}. A replaced name on an unchanged address is a common copy error from another booking; confirm the party with the shipper before requesting the change.`,
    };
  return {
    kind: "material",
    title: "A different party",
    detail: `The BL names ${blName || "another party"} where the SI names ${siName || "another party"}. Confirm with the shipper which party is correct before requesting the change.`,
  };
}

function explainPort(row: ComparisonRow): Omit<MismatchExplanation, "field"> {
  const si = parseStatedPort(row.si.raw),
    bl = parseStatedPort(row.bl.raw);
  const sameName = !!si.name && compact(si.name) === compact(bl.name);
  if (si.code && bl.code && si.code === bl.code && !sameName)
    return {
      kind: "clerical",
      title: `Same port code (${si.code}), different port name`,
      detail: `The BL keeps the SI code ${si.code} but names ${bl.name} instead of ${si.name}. The name and code in the BL now point to different ports; ask the issuer to correct the name to match the SI.`,
    };
  if (sameName && si.code && bl.code && si.code !== bl.code)
    return {
      kind: "clerical",
      title: `Same port name, different code (${si.code} vs ${bl.code})`,
      detail: `Both documents name ${si.name}, but the BL uses code ${bl.code} instead of ${si.code}. Carrier systems route by code; ask the issuer to correct the code.`,
    };
  if (sameName && !!si.code !== !!bl.code)
    return {
      kind: "clerical",
      title: "Same port; one document omits the code",
      detail: `Both documents name ${si.name}, but only the ${si.code ? "SI" : "BL"} states a location code (${si.code ?? bl.code}). Ask the issuer to state the port exactly as in the SI.`,
    };
  if (compact(row.si.raw) === compact(row.bl.raw))
    return {
      kind: "clerical",
      title: "Only spacing or symbols differ",
      detail: "The port text is identical apart from spaces or symbols.",
    };
  return {
    kind: "material",
    title: "A different port",
    detail: `The BL states ${row.bl.raw} where the SI states ${row.si.raw}. This would send the cargo elsewhere; confirm the route with the shipper before requesting the change.`,
  };
}

export function explainMismatches(
  rows: ComparisonRow[],
): Partial<Record<Field, MismatchExplanation>> {
  const byField = Object.fromEntries(
    rows.map((row) => [row.field, row]),
  ) as Partial<Record<Field, ComparisonRow>>;
  const out: Partial<Record<Field, MismatchExplanation>> = {};
  const same = (a?: ComparisonRow["si"], b?: ComparisonRow["bl"]) =>
    !!a && !!b && a.normalized !== null && a.normalized === b.normalized;
  // Two fields exchanged with each other is one clerical slip, not two changes.
  for (const [a, b, label] of [
    ["consignee", "notify_party", "Consignee and notify party"],
    ["port_of_loading", "port_of_discharge", "Loading and discharge ports"],
  ] as const) {
    const first = byField[a],
      second = byField[b];
    if (
      first?.result === "mismatch" &&
      second?.result === "mismatch" &&
      same(first.si, second.bl) &&
      same(second.si, first.bl)
    )
      for (const field of [a, b])
        out[field] = {
          field,
          kind: "clerical",
          title: `${label} are swapped`,
          detail: `The BL has the SI's ${FIELD_LABELS[a].toLowerCase()} and ${FIELD_LABELS[b].toLowerCase()} in each other's places. Ask the issuer to swap them back.`,
        };
  }
  for (const row of rows) {
    if (row.result !== "mismatch" || out[row.field]) continue;
    const si = row.si.normalized,
      bl = row.bl.normalized;
    let explanation: Omit<MismatchExplanation, "field">;
    if (
      row.field === "gross_weight_kg" &&
      typeof si === "number" &&
      typeof bl === "number"
    )
      explanation = explainWeight(si, bl);
    else if (
      row.field === "container_count" &&
      typeof si === "number" &&
      typeof bl === "number"
    ) {
      const delta = bl - si;
      explanation = {
        kind: "material",
        title: `BL lists ${Math.abs(delta)} container${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "more" : "fewer"}`,
        detail: `SI: ${si} / BL: ${bl}. The equipment count affects freight, loading and release; confirm the booked count before requesting the change.`,
      };
    } else if (row.field.startsWith("port_of_")) explanation = explainPort(row);
    else if (
      row.field === "notify_party" &&
      (sameAsConsignee(row.si.raw) || sameAsConsignee(row.bl.raw))
    ) {
      const both = sameAsConsignee(row.si.raw) && sameAsConsignee(row.bl.raw);
      const consignee = out.consignee;
      explanation = both
        ? {
            kind: consignee?.kind ?? "material",
            title: "Follows the consignee difference",
            detail:
              "Both documents say SAME AS CONSIGNEE, so the notify party differs only because the consignee differs. Correcting the consignee corrects this field too.",
          }
        : {
            kind: "material",
            title: `Only the ${sameAsConsignee(row.si.raw) ? "SI" : "BL"} says SAME AS CONSIGNEE`,
            detail: `One document refers to the consignee while the other names ${firstLine(sameAsConsignee(row.si.raw) ? row.bl.raw : row.si.raw)}, and the resulting parties differ. Confirm the intended notify party before requesting the change.`,
          };
    } else if (["shipper", "consignee", "notify_party"].includes(row.field))
      explanation = explainParty(row);
    else continue;
    out[row.field] = { field: row.field, ...explanation };
  }
  return out;
}
