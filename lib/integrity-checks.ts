import { equivalent, normalize } from "./normalization";
import type { CaseResult, ParsedDocument, SourceLine } from "./types";

/** Independent advisories never change the organiser's seven-field comparison. */
export const INTEGRITY_RULE_VERSION = "1.0.0";
export type IntegrityStatus = "passed" | "blocking" | "review" | "not_checked";
export type IntegrityRule =
  | "source"
  | "container_identifier"
  | "container_count"
  | "container_capacity"
  | "port_route";
export interface IntegrityEvidence {
  quote: string;
  location: string;
  source_sha256: string | null;
}
export interface IntegrityFinding {
  id: string;
  rule: IntegrityRule;
  rule_version: string;
  status: IntegrityStatus;
  title: string;
  detail: string;
  document: string;
  evidence: IntegrityEvidence[];
}
export interface IntegrityAssessment {
  rule_version: string;
  findings: IntegrityFinding[];
  counts: Record<IntegrityStatus, number>;
  requires_attention: boolean;
}

/** ISO 6346: alphabet values skip multiples of eleven; remainder ten maps to zero.
 * This verifies syntax/transmission only, not registration, existence or condition.
 * Reference: https://www.bic-code.org/check-digit-calculator/
 */
export function containerCheckDigit(prefixAndSerial: string): number | null {
  const base = prefixAndSerial.toUpperCase();
  if (!/^[A-Z]{3}[UJZ]\d{6}$/.test(base)) return null;
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let index = 0; index < base.length; index++) {
    const char = base[index];
    const ordinal = letters.indexOf(char);
    const value =
      ordinal < 0
        ? Number(char)
        : ordinal + 10 + Math.floor((ordinal + 9) / 10);
    sum += value * 2 ** index;
  }
  return (sum % 11) % 10;
}

export function validateContainerIdentifier(raw: string): {
  status: "valid" | "invalid" | "uncertain";
  normalized: string;
  expected_digit?: number;
  reason: string;
} {
  // Formatting whitespace is removed; OCR letter/digit substitutions are never made.
  const value = raw.normalize("NFKC").toUpperCase().replace(/[\s-]/g, "");
  if (
    /^[A-Z]{4}[\dOQILSZB?]{6,8}$/.test(value) &&
    /[OQILSZB?]/.test(value.slice(4))
  )
    return {
      status: "uncertain",
      normalized: value,
      reason:
        "Possible OCR letter/digit ambiguity. Inspect the original identifier; no character was corrected.",
    };
  if (!/^[A-Z]{3}[UJZ]\d{7}$/.test(value))
    return {
      status: "uncertain",
      normalized: value,
      reason:
        "Expected three owner letters, equipment category U/J/Z, six serial digits and one check digit. Confirm the full identifier.",
    };
  const expected = containerCheckDigit(value.slice(0, 10))!;
  return Number(value[10]) === expected
    ? {
        status: "valid",
        normalized: value,
        expected_digit: expected,
        reason:
          "Format and check digit agree. This does not verify registration, existence, ownership or physical condition.",
      }
    : {
        status: "invalid",
        normalized: value,
        expected_digit: expected,
        reason: `Check digit is ${value[10]}; the preceding ten characters calculate to ${expected}. Confirm the whole identifier with the issuer; do not replace only the last digit.`,
      };
}

function sourceRows(doc: ParsedDocument): SourceLine[] {
  const rows: SourceLine[] = [];
  for (const line of doc.lines) {
    const previous = rows.at(-1);
    // PDF fragments at the same page/baseline belong to one row. Different pages
    // and positions are never combined into a manufactured equipment record.
    if (
      previous &&
      previous.location === line.location &&
      /^Page \d+, y=/.test(line.location)
    )
      previous.text += ` | ${line.text}`;
    else rows.push({ ...line });
  }
  return rows;
}

function evidence(
  doc: ParsedDocument,
  rows: SourceLine[],
): IntegrityEvidence[] {
  return rows.map((row) => ({
    quote: row.text,
    location: row.location,
    source_sha256: doc.sha256 ?? null,
  }));
}

type Candidate = { value: string; raw: string; row: SourceLine };
/** BL number prefixes that look like container numbers but carry 8 digits. */
const BL_PREFIX =
  /^(?:SINF|ONEY|OOLU|EGLV|HLCU|COSU|MAEU|CMDU|YMJA|SIJ[A-Z]|MCLS)/;
/**
 * Values that only look like container numbers: an HS code ("HS CODE
 * 48025700") or a labelled BL / booking number ("B/L No.: SINF93802620").
 * A real container number has exactly seven digits, so only the longer
 * look-alikes are skipped; genuine malformed IDs are still reported.
 */
function notAContainer(text: string, raw: string, at: number) {
  const before = text.slice(Math.max(0, at - 40), at);
  const digits = raw.replace(/^[A-Z]{4}[ -]?/, "");
  if (/^CODE[ -]?/.test(raw) && /\bHS\s*$/.test(before)) return true;
  if (digits.length !== 8) return false;
  return (
    BL_PREFIX.test(raw) ||
    /(?:\bB\/?L|BILL OF LADING|BOOKING)\s*(?:NO\.?|NUMBER|#)?\s*[:#]?\s*$/.test(
      before,
    )
  );
}
function containerCandidates(rows: SourceLine[]): Candidate[] {
  const found: Candidate[] = [];
  for (const row of rows) {
    // A complete candidate may occur in a table without its heading on that row.
    const upper = row.text.toUpperCase();
    for (const match of upper.matchAll(/\b[A-Z]{4}[ -]?[\dOQILSZB?]{6,8}\b/g)) {
      if (notAContainer(upper, match[0], match.index ?? 0)) continue;
      found.push({ value: match[0].replace(/[ -]/g, ""), raw: match[0], row });
    }
    if (!found.some((item) => item.row === row)) {
      const explicit = row.text.match(
        /\bcontainer\s+(?:number|no\.?|identifier)\s*:\s*([^|;]+)/i,
      );
      if (explicit?.[1].trim())
        found.push({
          value: explicit[1].trim().toUpperCase(),
          raw: explicit[1].trim(),
          row,
        });
    }
  }
  return found;
}

function labeledValue(rows: SourceLine[], label: RegExp) {
  const values: { raw: string; rows: SourceLine[] }[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const match = row.text.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (match && label.test(match[1].trim())) {
      const raw = match[2].trim();
      // A PDF label and value can be fragments on a single baseline.
      if (raw.replace(/^\|\s*/, ""))
        values.push({ raw: raw.replace(/^\|\s*/, ""), rows: [row] });
      else if (
        rows[index + 1] &&
        !/[:：]/.test(rows[index + 1].text) &&
        samePage(row, rows[index + 1])
      )
        values.push({
          raw: rows[index + 1].text.trim(),
          rows: [row, rows[index + 1]],
        });
    } else if (
      label.test(row.text.trim().replace(/[:：]$/, "")) &&
      rows[index + 1] &&
      !/[:：]/.test(rows[index + 1].text) &&
      samePage(row, rows[index + 1])
    ) {
      values.push({
        raw: rows[index + 1].text.trim(),
        rows: [row, rows[index + 1]],
      });
    }
  }
  return values;
}

function samePage(a: SourceLine, b: SourceLine) {
  const pageA = a.location.match(/^Page (\d+)/)?.[1];
  const pageB = b.location.match(/^Page (\d+)/)?.[1];
  return pageA === pageB;
}

function listCompleteness(doc: ParsedDocument, rows: SourceLine[]) {
  const start = rows.findIndex((row) =>
    /^(?:complete container list|container list\s*\(complete\))\s*[:：]?\s*$/i.test(
      row.text.trim(),
    ),
  );
  const end = rows.findIndex(
    (row, index) =>
      index > start &&
      /^end (?:of )?container list\s*\.?$/i.test(row.text.trim()),
  );
  const partial = rows.some((row) =>
    /\b(?:partial list|list truncated|incomplete list|continued on|containers? omitted|more containers)\b|\.{3}|…/i.test(
      row.text,
    ),
  );
  const pages = new Set(
    rows.flatMap((row) => row.location.match(/^Page (\d+)/)?.[1] ?? []),
  );
  const missingPages =
    doc.format === "pdf" &&
    !!doc.page_count &&
    (pages.size !== doc.page_count ||
      Array.from({ length: doc.page_count }, (_, index) =>
        String(index + 1),
      ).some((page) => !pages.has(page)));
  return {
    complete: start >= 0 && end > start && !partial && !missingPages,
    rows: start >= 0 && end > start ? rows.slice(start + 1, end) : rows,
    markers: start >= 0 && end > start ? [rows[start], rows[end]] : [],
    reason: missingPages
      ? "Not every PDF page is represented in the extracted source."
      : partial
        ? "The source contains a partial/truncated/continued list marker."
        : "A complete list with explicit start and end markers was not established.",
  };
}

const massLabels = {
  gross:
    /^(?:loaded container gross weight|loaded gross weight|verified gross mass|vgm)$/i,
  tare: /^(?:container tare|tare(?: weight)?)$/i,
  payload: /^(?:cargo weight|payload(?: weight)?)$/i,
  maxGross: /^(?:max(?:imum)?(?: permitted)? gross(?: weight| mass)?)$/i,
  maxPayload: /^(?:max(?:imum)?(?: permitted)? payload(?: weight)?)$/i,
};
type Masses = Record<keyof typeof massLabels, number | undefined>;
function massesInRow(text: string) {
  const masses = {} as Masses;
  let invalid = false;
  let mentioned = false;
  for (const part of text.split(/[|;]/)) {
    const match = part.match(/^\s*([^:：]+)[:：]\s*(.+?)\s*$/);
    if (!match) continue;
    const key = (Object.keys(massLabels) as (keyof Masses)[]).find((name) =>
      massLabels[name].test(match[1].trim()),
    );
    if (!key) continue;
    mentioned = true;
    // Never assume kg; pounds/unknown/omitted units are not checked.
    const hasUnit = /\s(?:kgs?|kilograms?|mt|metric tonnes?|tonnes?)\s*$/i.test(
      match[2],
    );
    const value = hasUnit ? normalize("gross_weight_kg", match[2]) : null;
    if (
      typeof value !== "number" ||
      (masses[key] !== undefined && masses[key] !== value)
    )
      invalid = true;
    else masses[key] = value;
  }
  return { masses, invalid, mentioned };
}

export function checkDocumentIntegrity(
  result: Pick<CaseResult, "documents" | "comparison" | "document_selection">,
): IntegrityAssessment {
  const findings: IntegrityFinding[] = [];
  function add(
    doc: ParsedDocument,
    rule: IntegrityRule,
    status: IntegrityStatus,
    title: string,
    detail: string,
    rows: SourceLine[] = [],
  ) {
    findings.push({
      id: `${doc.name}:${rule}:${findings.length}`,
      rule,
      rule_version: INTEGRITY_RULE_VERSION,
      status,
      title,
      detail,
      document: doc.name,
      evidence: evidence(doc, rows),
    });
  }
  let documents = result.documents.filter(
    (doc) => doc.type === "SI" || doc.type === "BL",
  );
  if (result.document_selection) {
    const refs = [result.document_selection.si, result.document_selection.bl];
    const selected = refs.map((ref) =>
      documents.filter(
        (doc) => doc.name === ref.name && doc.sha256 === ref.sha256,
      ),
    );
    if (
      selected.some(
        (matches, index) =>
          matches.length !== 1 || matches[0].type !== (index ? "BL" : "SI"),
      )
    ) {
      documents = [];
      add(
        {
          name: "Document selection",
          type: "UNKNOWN",
          format: "",
          lines: [],
          method: "",
        },
        "source",
        "review",
        "Source selection needs review",
        "The saved SI/BL selection does not identify a unique current pair. Choose the current documents before using integrity checks.",
      );
    } else documents = selected.flat();
  } else if (
    ["SI", "BL"].some(
      (type) => documents.filter((doc) => doc.type === type).length > 1,
    )
  ) {
    documents = [];
    add(
      {
        name: "Document selection",
        type: "UNKNOWN",
        format: "",
        lines: [],
        method: "",
      },
      "source",
      "review",
      "Choose the current SI and BL",
      "Multiple documents have the same role. Integrity findings must be tied to the selected pair, not an excluded draft.",
    );
  }
  if (!documents.length && !findings.length)
    add(
      {
        name: "No readable SI or BL",
        type: "UNKNOWN",
        format: "",
        lines: [],
        method: "",
      },
      "source",
      "not_checked",
      "No document evidence to check",
      "Add or confirm readable source documents. Missing evidence is not a passed check.",
    );
  for (const doc of documents) {
    const rows = sourceRows(doc);
    if (
      doc.error ||
      !/^[a-f0-9]{64}$/i.test(doc.sha256 ?? "") ||
      !rows.length
    ) {
      add(
        doc,
        "source",
        doc.error ? "review" : "not_checked",
        "Source evidence is unavailable",
        doc.error ??
          "A readable source and its SHA-256 fingerprint are required for integrity checks.",
        rows.slice(0, 1),
      );
      continue;
    }
    if (/\bocr\b/i.test(doc.method) && !doc.transcription) {
      add(
        doc,
        "source",
        "review",
        "Confirm OCR evidence first",
        "Unconfirmed OCR text cannot establish a passed integrity check. Inspect the source image and confirm the extracted values.",
        rows.slice(0, 1),
      );
      continue;
    }
    const candidates = containerCandidates(rows);
    const unique = new Map<string, Candidate[]>();
    for (const candidate of candidates)
      unique.set(candidate.value, [
        ...(unique.get(candidate.value) ?? []),
        candidate,
      ]);
    for (const entries of unique.values()) {
      const checked = validateContainerIdentifier(entries[0].raw);
      const otherEquipment =
        checked.status === "valid" && checked.normalized[3] !== "U";
      add(
        doc,
        "container_identifier",
        checked.status === "valid"
          ? otherEquipment
            ? "review"
            : "passed"
          : checked.status === "invalid"
            ? "blocking"
            : "review",
        `${otherEquipment ? "Equipment" : "Container"} ${checked.normalized}`,
        otherEquipment
          ? `${checked.reason} Equipment category ${checked.normalized[3]} identifies ${checked.normalized[3] === "J" ? "detachable container-related equipment" : "a trailer or chassis"}, not a freight container. Confirm its role in this list.`
          : checked.reason,
        entries.map((entry) => entry.row),
      );
    }
    if (!unique.size)
      add(
        doc,
        "container_identifier",
        "not_checked",
        "Container identifiers not found",
        "No complete container identifier was located in the available source. This is not a checksum pass.",
      );

    const list = listCompleteness(doc, rows);
    const listCandidates = containerCandidates(list.rows);
    const validFormat = listCandidates.filter((candidate) =>
      /^[A-Z]{3}U\d{7}$/.test(candidate.value),
    );
    const unresolvedListRow = list.rows.some(
      (row) =>
        row.text.trim() &&
        !listCandidates.some((candidate) => candidate.row === row) &&
        !/^(?:container\s+(?:no\.?|number|identifier)(?:\s*[|/]\s*(?:size|type|seal\s*(?:no\.?)?|weight|gross|tare|payload))*|page\s+\d+\s+of\s+\d+|[-=\s]+)$/i.test(
          row.text.trim(),
        ),
    );
    const declared = labeledValue(
      rows,
      /^(?:total containers|container count|no\.? of containers)(?:\s*\([^)]*\))?$/i,
    );
    const totals = declared.map((value) =>
      normalize("container_count", value.raw),
    );
    const declaredEvidence = declared.flatMap((value) => value.rows);
    const distinct = new Set(validFormat.map((candidate) => candidate.value));
    if (
      !list.complete ||
      unresolvedListRow ||
      !totals.length ||
      totals.some(
        (total) => typeof total !== "number" || total !== totals[0],
      ) ||
      validFormat.length !== listCandidates.length ||
      !validFormat.length
    ) {
      add(
        doc,
        "container_count",
        "not_checked",
        "Container list completeness unconfirmed",
        !list.complete
          ? list.reason
          : "A complete, unambiguous declared total and readable identifiers are required before comparing list counts.",
        [...declaredEvidence, ...list.markers],
      );
    } else {
      const matches = distinct.size === totals[0];
      add(
        doc,
        "container_count",
        matches ? "passed" : "blocking",
        matches
          ? "Container count agrees with complete list"
          : "Container count differs from complete list",
        `${distinct.size} distinct identifiers in the explicitly complete list; declared total ${totals[0]}. Repeated occurrences are counted once.`,
        [
          ...declaredEvidence,
          ...list.markers,
          ...validFormat.map((item) => item.row),
        ],
      );
    }

    let weightChecks = 0;
    for (const row of rows) {
      const rowCandidates = candidates.filter((item) => item.row === row);
      const ids = [...new Set(rowCandidates.map((item) => item.value))];
      const { masses: mass, invalid, mentioned } = massesInRow(row.text);
      if (!mentioned) continue;
      weightChecks++;
      if (invalid || ids.length !== 1 || !/^[A-Z]{3}U\d{7}$/.test(ids[0])) {
        add(
          doc,
          "container_capacity",
          "not_checked",
          "Equipment capacity evidence incomplete",
          "Weights need explicit supported units, one unambiguous container identifier and consistent labels on the same source row. No average or assumed capacity is used.",
          [row],
        );
        continue;
      }
      const issues: string[] = [];
      const comparisons: string[] = [];
      if (mass.gross !== undefined && mass.maxGross !== undefined) {
        comparisons.push(
          `loaded gross ${mass.gross} kg ≤ stated maximum gross ${mass.maxGross} kg`,
        );
        if (mass.gross > mass.maxGross)
          issues.push("Loaded gross exceeds stated maximum gross.");
      }
      const derivedPayload =
        mass.gross !== undefined && mass.tare !== undefined
          ? mass.gross - mass.tare
          : undefined;
      if (derivedPayload !== undefined && derivedPayload < 0)
        issues.push("Tare exceeds loaded gross weight.");
      if (
        derivedPayload !== undefined &&
        mass.payload !== undefined &&
        Math.abs(derivedPayload - mass.payload) > 0.001
      )
        issues.push("Loaded gross minus tare differs from the stated payload.");
      const payload = mass.payload ?? derivedPayload;
      if (payload !== undefined && mass.maxPayload !== undefined) {
        comparisons.push(
          `payload ${payload} kg ≤ stated maximum payload ${mass.maxPayload} kg`,
        );
        if (payload > mass.maxPayload)
          issues.push("Payload exceeds stated maximum payload.");
      }
      add(
        doc,
        "container_capacity",
        issues.length
          ? "blocking"
          : comparisons.length
            ? "passed"
            : "not_checked",
        `Equipment weights · ${ids[0]}`,
        issues.length
          ? issues.join(" ")
          : comparisons.length
            ? `${comparisons.join("; ")}. Checks use limits stated in this document; they do not certify equipment condition or legal loading compliance.`
            : "Actual per-container load and an explicit applicable maximum were not both supplied. Shipment averages and generic size-based limits are not used.",
        [row],
      );
    }
    if (!weightChecks)
      add(
        doc,
        "container_capacity",
        "not_checked",
        "Per-container capacity not checked",
        "No source row ties an individual container's load to an explicit equipment maximum with supported units. Total shipment weight cannot prove each container is within capacity.",
      );

    const pol = labeledValue(rows, /^(?:port of loading|load port|pol)$/i);
    const pod = labeledValue(
      rows,
      /^(?:port of discharge|discharge port|pod)$/i,
    );
    const loading = pol.map((value) => normalize("port_of_loading", value.raw));
    const discharge = pod.map((value) =>
      normalize("port_of_discharge", value.raw),
    );
    const unambiguous = (values: (string | number | null)[]) =>
      !!values.length &&
      values.every(
        (value) =>
          typeof value === "string" &&
          equivalent("port_of_loading", value, values[0]),
      );
    const portEvidence = [...pol, ...pod].flatMap((value) => value.rows);
    if (!unambiguous(loading) || !unambiguous(discharge))
      add(
        doc,
        "port_route",
        "not_checked",
        "Route sanity check unavailable",
        "Loading and discharge ports must both be readable and unambiguous in this source.",
        portEvidence,
      );
    else {
      const same = equivalent("port_of_loading", loading[0], discharge[0]);
      add(
        doc,
        "port_route",
        same ? "review" : "passed",
        same
          ? "Loading and discharge ports are the same"
          : "Loading and discharge labels differ",
        same
          ? "Confirm the intended route with the issuer. Equal ports are an advisory, not proof of an invalid shipment."
          : "The two normalized port labels are different. This does not validate the route, port existence or carrier service.",
        portEvidence,
      );
    }
  }
  const counts: Record<IntegrityStatus, number> = {
    passed: 0,
    blocking: 0,
    review: 0,
    not_checked: 0,
  };
  for (const finding of findings) counts[finding.status]++;
  return {
    rule_version: INTEGRITY_RULE_VERSION,
    findings,
    counts,
    requires_attention: counts.blocking + counts.review > 0,
  };
}
