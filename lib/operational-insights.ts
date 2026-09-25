import { z } from "zod";
import { currentMessage } from "./classifier";
import { normalize } from "./normalization";
import { FIELDS, PIPELINE_VERSION, type CaseResult, type Field } from "./types";
import { nextDeadline, shipmentStatus, type Shipment } from "./shipments";

export const insightFilters = z.object({
  status: z
    .enum([
      "all",
      "open_mismatches",
      "awaiting_documents",
      "review",
      "overdue",
      "unassigned",
      "verified",
    ])
    .default("all"),
  category: z
    .enum([
      "all",
      "BL_COMPARISON",
      "SI_REQUEST",
      "INVOICE_QUERY",
      "GENERAL",
      "SPAM",
    ])
    .default("all"),
  port: z.string().trim().max(100).default(""),
  customer: z.string().trim().max(120).default(""),
  carrier: z.string().trim().max(120).default(""),
});
export type InsightFilters = z.infer<typeof insightFilters>;
const plain = (value: string) =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const identityLabel = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("en-US");
export function interpretInboxQuestion(question: string): {
  supported: boolean;
  filters: InsightFilters;
  explanation: string;
} {
  const q = plain(question)
      .replace(/^(?:show me|show|list|which|find)\s+/, "")
      .replace(/\s+(?:please|now)$/, ""),
    base = insightFilters.parse({});
  const exact: Record<string, Partial<InsightFilters>> = {
    "open mismatches": { status: "open_mismatches" },
    "shipments with open mismatches": { status: "open_mismatches" },
    "awaiting documents": { status: "awaiting_documents" },
    "missing documents": { status: "awaiting_documents" },
    "review needed": { status: "review" },
    "cases needing review": { status: "review" },
    "overdue shipments": { status: "overdue" },
    "unassigned shipments": { status: "unassigned" },
    "verified cases": { status: "verified" },
    "invoice queries": { category: "INVOICE_QUERY" },
    "general updates": { category: "GENERAL" },
    "all cases": {},
  };
  if (Object.hasOwn(exact, q))
    return {
      supported: true,
      filters: { ...base, ...exact[q] },
      explanation:
        "Matched a supported question pattern. Review the filters below.",
    };
  const port = q.match(
    /^([\p{L}\p{N}][\p{L}\p{N} -]{1,70}?)\s+(?:shipments\s+)?(?:(?:still\s+)?(?:have|with)\s+)?open mismatches$/u,
  );
  if (
    port &&
    !/\b(?:ignore|instruction|delete|export|all|or|and|not|except|before|after)\b/.test(
      port[1],
    )
  )
    return {
      supported: true,
      filters: { ...base, status: "open_mismatches", port: port[1] },
      explanation: `Port text contains “${port[1]}”; current open document mismatches only.`,
    };
  return {
    supported: false,
    filters: base,
    explanation:
      "This question is outside the supported patterns. No answer was guessed. Use the visible filters, or try “Which Jakarta shipments still have open mismatches?”",
  };
}
export interface InsightCitation {
  case_id: string;
  version: number;
  subject: string;
  href: string;
  processed_at: string;
}
export const caseCitation = (result: CaseResult): InsightCitation => ({
  case_id: result.email.email_id,
  version: result.version,
  subject: result.email.subject,
  href: `/?case=${encodeURIComponent(result.email.email_id)}`,
  processed_at: result.processed_at,
});
function linkedShipments(result: CaseResult, shipments: Shipment[]) {
  return shipments.filter((shipment) =>
    shipment.case_ids.includes(result.email.email_id),
  );
}
const hasPort = (result: CaseResult, query: string) =>
  !query ||
  result.comparison.some(
    (row) =>
      ["port_of_loading", "port_of_discharge"].includes(row.field) &&
      [row.si, row.bl].some(
        (value) =>
          value.normalized !== null &&
          plain(String(value.normalized)).includes(plain(query)),
      ),
  );
export function searchOperationalCases(
  cases: CaseResult[],
  shipments: Shipment[],
  filters: InsightFilters,
  now = new Date(),
) {
  const found = cases
    .filter((result) => {
      const linked = linkedShipments(result, shipments),
        open =
          linked.length === 0 ||
          linked.some(
            (shipment) => shipmentStatus(shipment, cases) !== "completed",
          );
      if (filters.category !== "all" && result.category !== filters.category)
        return false;
      if (
        filters.customer &&
        !linked.some(
          (shipment) =>
            identityLabel(shipment.customer) ===
            identityLabel(filters.customer),
        )
      )
        return false;
      if (
        filters.carrier &&
        !linked.some(
          (shipment) =>
            identityLabel(shipment.carrier) === identityLabel(filters.carrier),
        )
      )
        return false;
      if (!hasPort(result, filters.port)) return false;
      switch (filters.status) {
        case "open_mismatches":
          return (
            open &&
            result.pipeline_version === PIPELINE_VERSION &&
            result.workflow === "discrepancy" &&
            result.has_defect
          );
        case "awaiting_documents":
          return open && result.workflow === "awaiting_documents";
        case "review":
          return (
            open &&
            (result.status === "NEEDS_REVIEW" ||
              result.pipeline_version !== PIPELINE_VERSION)
          );
        case "overdue":
          return linked.some((shipment) => {
            const due = nextDeadline(shipment, cases);
            return !!due && Date.parse(due.at) < now.getTime();
          });
        case "unassigned":
          return linked.some(
            (shipment) =>
              !shipment.owner_id &&
              !shipment.owner &&
              shipmentStatus(shipment, cases) !== "completed",
          );
        case "verified":
          return (
            eligibleComparison(result) &&
            result.workflow === "verified" &&
            !result.has_defect &&
            result.comparison.every((row) => row.result === "match")
          );
        default:
          return true;
      }
    })
    .map((result) => {
      const linked = linkedShipments(result, shipments),
        deadlines = linked
          .map((shipment) => nextDeadline(shipment, cases))
          .filter((v) => v !== null)
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      return {
        ...caseCitation(result),
        category: result.category,
        workflow: result.workflow,
        summary: result.summary,
        fields: result.defect_fields,
        deadline: deadlines[0] ?? null,
        shipments: linked.map((shipment) => ({
          id: shipment.id,
          title: shipment.title,
          href: `/shipments?shipment=${encodeURIComponent(shipment.id)}`,
          state: shipmentStatus(shipment, cases),
        })),
      };
    })
    .sort(
      (a, b) =>
        (a.deadline ? Date.parse(a.deadline.at) : Infinity) -
          (b.deadline ? Date.parse(b.deadline.at) : Infinity) ||
        a.case_id.localeCompare(b.case_id, "en-US"),
    );
  return { total: found.length, results: found.slice(0, 100), limit: 100 };
}
export function eligibleComparison(result: CaseResult) {
  return (
    result.pipeline_version === PIPELINE_VERSION &&
    result.category === "BL_COMPARISON" &&
    (!result.classification.needs_review || !!result.category_override) &&
    ["verified", "discrepancy"].includes(result.workflow) &&
    result.comparison.length === FIELDS.length &&
    new Set(result.comparison.map((row) => row.field)).size === FIELDS.length &&
    FIELDS.every((field) =>
      result.comparison.some((row) => row.field === field),
    ) &&
    result.comparison.every(
      (row) =>
        row.result !== "uncertain" &&
        [row.si, row.bl].every(
          (value) =>
            value.normalized !== null &&
            !value.issue &&
            !!value.source &&
            !!value.evidence,
        ),
    )
  );
}
function outcomeCounts(cases: CaseResult[]) {
  const eligible = cases.filter(eligibleComparison),
    discrepancies = eligible.filter((result) =>
      result.comparison.some((row) => row.result === "mismatch"),
    );
  return {
    eligible: eligible.length,
    discrepancies: discrepancies.length,
    rate: eligible.length ? discrepancies.length / eligible.length : null,
    citations: discrepancies.map(caseCitation),
  };
}
export function operationalAnalytics(
  cases: CaseResult[],
  baselines: CaseResult[],
  shipments: Shipment[],
) {
  const before = new Map(
      baselines.map((result) => [result.email.email_id, result]),
    ),
    selected = shipments.filter((shipment) => shipment.comparison_case_id);
  // One comparison cannot be counted twice because two shipment cards reference it.
  const unique = selected.filter(
    (shipment) =>
      selected.filter(
        (other) => other.comparison_case_id === shipment.comparison_case_id,
      ).length === 1,
  );
  const carriers = new Map<
    string,
    { carrier: string; cases: CaseResult[]; baseline: CaseResult[] }
  >();
  for (const shipment of unique) {
    if (!shipment.carrier.trim()) continue;
    const current = cases.find(
      (result) => result.email.email_id === shipment.comparison_case_id,
    );
    if (!current) continue;
    const key = identityLabel(shipment.carrier),
      group = carriers.get(key) ?? {
        carrier: shipment.carrier,
        cases: [],
        baseline: [],
      };
    group.cases.push(current);
    const first = before.get(current.email.email_id);
    if (first) group.baseline.push(first);
    carriers.set(key, group);
  }
  const fields = FIELDS.map((field) => ({
    field,
    first_pass: baselines
      .filter(eligibleComparison)
      .filter((result) =>
        result.comparison.some(
          (row) => row.field === field && row.result === "mismatch",
        ),
      ).length,
    current: cases
      .filter(eligibleComparison)
      .filter((result) =>
        result.comparison.some(
          (row) => row.field === field && row.result === "mismatch",
        ),
      ).length,
  }));
  const baselineEligible = baselines.filter(eligibleComparison),
    paired = baselineEligible
      .map((first) => ({
        first,
        current: cases.find(
          (result) => result.email.email_id === first.email.email_id,
        ),
      }))
      .filter((pair) => pair.current && eligibleComparison(pair.current));
  const weeks = new Map<
    string,
    {
      week_start: string;
      automatic_cases: number;
      eligible_comparisons: number;
      discrepancies: number;
    }
  >();
  for (const first of baselines) {
    const date = new Date(first.processed_at);
    if (!Number.isFinite(date.getTime())) continue;
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const key = date.toISOString().slice(0, 10),
      week = weeks.get(key) ?? {
        week_start: key,
        automatic_cases: 0,
        eligible_comparisons: 0,
        discrepancies: 0,
      };
    week.automatic_cases++;
    if (eligibleComparison(first)) {
      week.eligible_comparisons++;
      if (first.comparison.some((row) => row.result === "mismatch"))
        week.discrepancies++;
    }
    weeks.set(key, week);
  }
  return {
    recorded_cases: cases.length,
    automatic_baselines: baselines.length,
    first_pass: outcomeCounts(baselines),
    current: outcomeCounts(cases),
    paired_resolved: paired.filter(
      ({ first, current }) =>
        first.comparison.some((row) => row.result === "mismatch") &&
        !current!.comparison.some((row) => row.result === "mismatch"),
    ).length,
    paired_discrepant_baselines: paired.filter(({ first }) =>
      first.comparison.some((row) => row.result === "mismatch"),
    ).length,
    fields,
    carriers: [...carriers.values()]
      .map((group) => ({
        carrier: group.carrier,
        linked_comparisons: group.cases.length,
        first_pass: outcomeCounts(group.baseline),
        current: outcomeCounts(group.cases),
      }))
      .sort((a, b) => a.carrier.localeCompare(b.carrier, "en-US")),
    ambiguous_attribution: selected.length - unique.length,
    weeks: [...weeks.values()].sort((a, b) =>
      a.week_start.localeCompare(b.week_start),
    ),
    definition:
      "Rates count distinct eligible seven-field comparisons with source evidence. Missing/uncertain/legacy cases are excluded, never counted as correct. First-pass uses retained current-engine automatic baselines. Carrier labels are explicitly recorded on shipment cards; association is not proof of cause. Week boundaries are UTC and use processing time, not email arrival time.",
  };
}
/** Exact current-message excerpt, never an inferred or generated update. */
function digestExcerpt(body: string) {
  const lines = currentMessage(body).split(/\r?\n/);
  const greeting =
    /^(?:(?:dear|hi|hello)\s+(?:team|all|everyone|colleagues|sir|madam|sirs|operations(?:\s+team)?|shipping\s+team|ops(?:\s+team)?)\s*[,!:]?|(?:hi|hello|good (?:morning|afternoon|evening))\s*[,!:]?|(?:dear|hi|hello)\s+[\p{L}][\p{L} .'-]{0,50}[,:])$/iu;
  const closing =
    /^(?:kind regards|best regards|regards|thanks(?: and regards)?|thank you|sincerely|best wishes)\s*[,!.]?$/i;
  let start = 0;
  while (
    start < lines.length &&
    (!lines[start].trim() || greeting.test(lines[start].trim()))
  )
    start++;
  const selected: string[] = [];
  let meaningfulLines = 0,
    truncated = false;
  for (const line of lines.slice(start)) {
    if (closing.test(line.trim())) break;
    if (line.trim()) {
      if (meaningfulLines === 3) {
        truncated = true;
        break;
      }
      meaningfulLines++;
    }
    selected.push(line);
  }
  const text = selected.join("\n").trimEnd();
  if (!text.trim())
    return "[No operational text available in the current message.]";
  const excerpt = text.slice(0, 280).trimEnd();
  return (
    excerpt +
    (truncated || text.length > 280
      ? "\n[Excerpt truncated; open source for the remaining text.]"
      : "")
  );
}

export function generalDigest(
  cases: CaseResult[],
  shipments: Shipment[],
  now = new Date(),
) {
  return cases
    .filter((result) => result.category === "GENERAL")
    .filter((result) => {
      const linked = linkedShipments(result, shipments);
      return (
        !linked.length ||
        linked.some(
          (shipment) => shipmentStatus(shipment, cases) !== "completed",
        )
      );
    })
    .map((result) => {
      const due =
        linkedShipments(result, shipments)
          .map((shipment) => nextDeadline(shipment, cases))
          .filter((v) => v !== null)
          .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null;
      const quote = digestExcerpt(result.email.body);
      return {
        ...caseCitation(result),
        quote,
        deadline: due,
        overdue: !!due && Date.parse(due.at) < now.getTime(),
        summary: result.summary,
      };
    })
    .sort(
      (a, b) =>
        (a.deadline ? Date.parse(a.deadline.at) : Infinity) -
          (b.deadline ? Date.parse(b.deadline.at) : Infinity) ||
        Date.parse(b.processed_at) - Date.parse(a.processed_at) ||
        a.case_id.localeCompare(b.case_id, "en-US"),
    )
    .slice(0, 20);
}
export function historicalConsigneeAdvisories(
  cases: CaseResult[],
  shipments: Shipment[],
) {
  const selected = shipments.filter(
      (shipment) => shipment.customer.trim() && shipment.comparison_case_id,
    ),
    unique = selected.filter(
      (shipment) =>
        selected.filter(
          (other) => other.comparison_case_id === shipment.comparison_case_id,
        ).length === 1,
    );
  const observations = unique
    .flatMap((shipment) => {
      const result = cases.find(
          (value) => value.email.email_id === shipment.comparison_case_id,
        ),
        value = result?.comparison.find((row) => row.field === "consignee")?.si;
      if (
        !result ||
        !eligibleComparison(result) ||
        !value ||
        value.issue ||
        !value.source ||
        !value.evidence ||
        value.normalized === null ||
        !Number.isFinite(Date.parse(result.processed_at))
      )
        return [];
      const normalized = normalize("consignee", value.raw);
      if (normalized === null) return [];
      return [
        {
          shipment,
          result,
          value: String(normalized),
          customer: identityLabel(shipment.customer),
        },
      ];
    })
    .sort(
      (a, b) =>
        Date.parse(a.result.processed_at) - Date.parse(b.result.processed_at),
    );
  return observations
    .flatMap((observation, index) => {
      const previous = observations
        .slice(0, index)
        .filter(
          (candidate) =>
            candidate.customer === observation.customer &&
            Date.parse(candidate.result.processed_at) <
              Date.parse(observation.result.processed_at),
        )
        .slice(-12);
      if (previous.length < 3) return [];
      const counts = new Map<string, typeof previous>();
      for (const item of previous)
        counts.set(item.value, [...(counts.get(item.value) ?? []), item]);
      const [usual, examples] = [...counts.entries()].sort(
        (a, b) => b[1].length - a[1].length,
      )[0];
      if (
        examples.length < 3 ||
        examples.length / previous.length < 0.8 ||
        usual === observation.value
      )
        return [];
      return [
        {
          customer: observation.shipment.customer,
          current_value: observation.value,
          prior_value: usual,
          prior_matches: examples.length,
          prior_total: previous.length,
          current: caseCitation(observation.result),
          sources: examples.map((item) => caseCitation(item.result)),
          note: "Advisory only: the SI consignee differs from prior cases sharing this recorded customer label. Confirm the current order; a change may be legitimate. No document verdict was changed.",
        },
      ];
    })
    .slice(-20);
}
export type OperationalSearch = ReturnType<typeof searchOperationalCases>;
export type OperationalAnalytics = ReturnType<typeof operationalAnalytics>;
export type GeneralDigest = ReturnType<typeof generalDigest>;
export type HistoricalAdvisories = ReturnType<
  typeof historicalConsigneeAdvisories
>;
export const insightFieldLabels: Record<Field, string> = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify_party: "Notify party",
  port_of_loading: "Loading port",
  port_of_discharge: "Discharge port",
  container_count: "Containers",
  gross_weight_kg: "Gross weight",
};
