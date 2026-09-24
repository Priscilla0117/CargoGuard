import type {
  IntegrityAssessment,
  IntegrityFinding,
  IntegrityStatus,
} from "./integrity-checks";
import { FIELD_LABELS, type CaseResult, type Field } from "./types";

/**
 * External reference check of stated port codes against a UN/LOCODE snapshot.
 * Findings are advisory evidence kept apart from the seven-field SI/BL result:
 * they never change a comparison, and the SI remains the reference document.
 */
export const PORT_REFERENCE_RULE_VERSION = "1.0.0";

export interface PortReferenceData {
  dataset: string;
  release: string;
  license: string;
  countries: Record<string, string>;
  /** Per country: "LOC|Name|function" lines for port (1) or unknown (0) function entries. */
  ports: Record<string, string>;
  /** Per country: space-separated codes listed without a port function. */
  other: Record<string, string>;
}
interface PortEntry {
  names: string[];
  candidates: string[];
  functions: Set<"0" | "1">;
}
export interface PortReferenceIndex {
  release: string;
  countries: Map<string, string>;
  ports: Map<string, PortEntry>;
  other: Set<string>;
  countryNames: Map<string, string>;
}

export const compact = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

const segments = (value: string) =>
  [value, ...value.split(/[/(),;]/)]
    .map(compact)
    .filter((part) => part.length >= 4);

// Common trade spellings. Explicit entries win over derived official forms.
const COUNTRY_ALIASES: Record<string, string> = {
  US: "US",
  USA: "US",
  UNITEDSTATES: "US",
  UNITEDSTATESOFAMERICA: "US",
  UK: "GB",
  GREATBRITAIN: "GB",
  UAE: "AE",
  SOUTHKOREA: "KR",
  REPUBLICOFKOREA: "KR",
  NORTHKOREA: "KP",
  VIETNAM: "VN",
  TURKEY: "TR",
  TURKIYE: "TR",
  RUSSIA: "RU",
  TAIWAN: "TW",
  IRAN: "IR",
  TANZANIA: "TZ",
  IVORYCOAST: "CI",
  LAOS: "LA",
  SYRIA: "SY",
  BOLIVIA: "BO",
  VENEZUELA: "VE",
  CZECHREPUBLIC: "CZ",
  HOLLAND: "NL",
  MOLDOVA: "MD",
  BRUNEI: "BN",
  PRC: "CN",
  PRCHINA: "CN",
  PEOPLESREPUBLICOFCHINA: "CN",
};

export function buildPortReferenceIndex(
  data: PortReferenceData,
): PortReferenceIndex {
  const countries = new Map(
    Object.entries(data.countries).map(([code, name]) => [
      code,
      name.replace(/\s*\(the\)\s*$/i, ""),
    ]),
  );
  const derived = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const [code, official] of countries) {
    // Short forms such as "Korea" can name two countries; conflicting forms are dropped.
    for (const form of new Set([
      compact(official),
      compact(official.split("(")[0]),
      compact(official.split(",")[0]),
    ])) {
      if (!form) continue;
      if (derived.has(form) && derived.get(form) !== code) conflicts.add(form);
      else derived.set(form, code);
    }
  }
  for (const form of conflicts) derived.delete(form);
  for (const [alias, code] of Object.entries(COUNTRY_ALIASES))
    derived.set(alias, code);

  const ports = new Map<string, PortEntry>();
  for (const [country, lines] of Object.entries(data.ports))
    for (const line of lines.split("\n")) {
      const [location, name, fn] = line.split("|");
      if (!location || !name) continue;
      const code = country + location;
      const entry = ports.get(code) ?? {
        names: [],
        candidates: [],
        functions: new Set<"0" | "1">(),
      };
      if (!entry.names.includes(name)) entry.names.push(name);
      entry.candidates.push(...segments(name));
      entry.functions.add(fn === "1" ? "1" : "0");
      ports.set(code, entry);
    }
  const other = new Set<string>();
  for (const [country, codes] of Object.entries(data.other))
    for (const location of codes.split(" "))
      if (location) other.add(country + location);
  return {
    release: data.release,
    countries,
    ports,
    other,
    countryNames: derived,
  };
}

export interface StatedPort {
  name: string;
  country: string | null;
  code: string | null;
}
/** Reads "NAME, COUNTRY (CODE)". Only an explicit trailing five-character code counts. */
export function parseStatedPort(raw: string): StatedPort {
  const value = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
  const bare = value.toUpperCase().match(/^([A-Z]{2}) ?([A-Z0-9]{3})$/);
  if (bare) return { name: "", country: null, code: bare[1] + bare[2] };
  const match = value.match(
    /^(.*?)\s*\(\s*([A-Za-z]{2}) ?([A-Za-z0-9]{3})\s*\)$/,
  );
  const text = (match ? match[1] : value).replace(/[\s,;]+$/, "");
  const comma = text.lastIndexOf(",");
  return {
    name: (comma >= 0 ? text.slice(0, comma) : text).trim(),
    country: comma >= 0 ? text.slice(comma + 1).trim() || null : null,
    code: match ? (match[2] + match[3]).toUpperCase() : null,
  };
}

export function resolveCountry(index: PortReferenceIndex, stated: string) {
  return index.countryNames.get(compact(stated)) ?? null;
}

function nameAgrees(entry: PortEntry, statedName: string) {
  const stated = segments(statedName);
  return stated.some((part) =>
    entry.candidates.some(
      (official) => part.includes(official) || official.includes(part),
    ),
  );
}

export interface PortAssessment {
  status: IntegrityStatus;
  title: string;
  detail: string;
}
export function assessPort(
  raw: string,
  index: PortReferenceIndex,
): PortAssessment {
  const release = `UN/LOCODE ${index.release}`;
  const stated = parseStatedPort(raw);
  if (!stated.code)
    return {
      status: "not_checked",
      title: "No port code stated",
      detail: `The value has no five-character location code in parentheses, so it was not compared with ${release}. A missing code is not a passed check.`,
    };
  const code = stated.code;
  const prefix = code.slice(0, 2);
  const codeCountry = index.countries.get(prefix);
  // Without a country prefix the parenthesis is treated as text, not as a code.
  if (!codeCountry)
    return {
      status: "not_checked",
      title: "No recognised port code",
      detail: `“${code}” does not start with a country code in ${release}, so it was not treated as a location code. A missing code is not a passed check.`,
    };
  const entry = index.ports.get(code);
  const listed = entry
    ? ` ${release} lists ${code} as ${entry.names.join(" / ")}, ${codeCountry}.`
    : "";
  const statedCountry = stated.country
    ? resolveCountry(index, stated.country)
    : null;
  if (statedCountry && statedCountry !== prefix)
    return {
      status: "blocking",
      title: `Port name and code disagree on country`,
      detail: `The document states ${stated.country}, but ${code} belongs to ${codeCountry} (country prefix ${prefix}).${listed} One of the two parts is wrong. Confirm the whole port with the issuer; do not correct only the name or only the code.`,
    };
  const countryNote = statedCountry
    ? " The stated country agrees with the code prefix."
    : stated.country
      ? ` The stated country “${stated.country}” was not recognised, so it was not compared.`
      : " No country was stated.";
  if (!entry)
    return index.other.has(code)
      ? {
          status: "not_checked",
          title: `Code ${code} is not listed as a port`,
          detail: `${release} lists ${code} without a seaport function, so the stated name was not compared.${countryNote} Trade usage can differ from the reference; this is neither a pass nor an error.`,
        }
      : {
          status: "review",
          title: `Code ${code} not found in ${release}`,
          detail: `${code} does not appear in the ${release} snapshot.${countryNote} Newer or carrier-specific codes can be absent; confirm the code with the issuer.`,
        };
  if (!stated.name)
    return {
      status: "not_checked",
      title: `Code ${code} stated without a port name`,
      detail: `${listed.trim()} No port name was stated to compare with it.`,
    };
  if (nameAgrees(entry, stated.name))
    return {
      status: "passed",
      title: `${code} agrees with ${release}`,
      detail: `${listed.trim()}${countryNote} This confirms consistency with the reference only, not the carrier's routing, service or booking.`,
    };
  return {
    status: "review",
    title: `Port name differs from the ${code} reference entry`,
    detail: `The document names ${stated.name}.${listed}${countryNote} Local or terminal names can differ; confirm the intended port and code with the issuer.`,
  };
}

const PORT_FIELDS: Field[] = ["port_of_loading", "port_of_discharge"];

export function checkPortReferences(
  result: Pick<CaseResult, "documents" | "comparison">,
  index: PortReferenceIndex,
): IntegrityAssessment {
  const findings: IntegrityFinding[] = [];
  for (const row of result.comparison) {
    if (!PORT_FIELDS.includes(row.field)) continue;
    for (const side of ["si", "bl"] as const) {
      const value = row[side];
      const doc = result.documents.find((item) => item.name === value.source);
      const usable = value.raw.trim() && !value.extraction_issue;
      const outcome: PortAssessment = usable
        ? assessPort(value.raw, index)
        : {
            status: "not_checked",
            title: "Port value unavailable",
            detail:
              value.extraction_issue ??
              "No port value was located. Missing evidence is not a passed check.",
          };
      findings.push({
        id: `${side}:${row.field}`,
        rule: "port_reference",
        rule_version: PORT_REFERENCE_RULE_VERSION,
        status: outcome.status,
        title: `${FIELD_LABELS[row.field]} · ${outcome.title}`,
        detail: outcome.detail,
        document: `${side.toUpperCase()} · ${value.source}`,
        evidence: usable
          ? [
              {
                quote: value.raw,
                location: value.evidence,
                source_sha256: doc?.sha256 ?? null,
              },
            ]
          : [],
      });
    }
  }
  if (!findings.length)
    findings.push({
      id: "ports:none",
      rule: "port_reference",
      rule_version: PORT_REFERENCE_RULE_VERSION,
      status: "not_checked",
      title: "No compared ports",
      detail:
        "This case has no SI/BL port comparison to check against the reference.",
      document: "Case",
      evidence: [],
    });
  const counts: Record<IntegrityStatus, number> = {
    passed: 0,
    blocking: 0,
    review: 0,
    not_checked: 0,
  };
  for (const finding of findings) counts[finding.status]++;
  return {
    rule_version: `${PORT_REFERENCE_RULE_VERSION} · UN/LOCODE ${index.release}`,
    findings,
    counts,
    requires_attention: counts.blocking + counts.review > 0,
  };
}
