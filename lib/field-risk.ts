import { FIELD_LABELS, type Field } from "./types";

/**
 * What goes wrong in the real world when a draft BL detail is not corrected.
 * Weights order the work queue (impact first); they are planning aids, not a
 * legal or commercial assessment. Wording is for documentation staff.
 */
export const FIELD_RISK: Record<
  Field,
  { weight: number; short: string; risk: string }
> = {
  port_of_discharge: {
    weight: 45,
    short: "Wrong destination port",
    risk: "The cargo can be manifested to the wrong port — re-routing is costly and the customer's delivery is delayed.",
  },
  consignee: {
    weight: 42,
    short: "Wrong consignee",
    risk: "The buyer may be unable to clear customs or take delivery, and a bank can refuse the documents under a Letter of Credit.",
  },
  container_count: {
    weight: 40,
    short: "Container count differs",
    risk: "A container can be left off the BL — it then cannot be released or claimed at destination.",
  },
  gross_weight_kg: {
    weight: 34,
    short: "Weight differs",
    risk: "The weight must agree with the VGM and the customs declaration — a difference can stop loading or lead to penalties.",
  },
  port_of_loading: {
    weight: 30,
    short: "Wrong loading port",
    risk: "The BL no longer matches the export declaration and the Letter of Credit terms.",
  },
  notify_party: {
    weight: 22,
    short: "Wrong notify party",
    risk: "The arrival notice goes to the wrong company, so nobody is told the cargo has arrived and storage charges can build up.",
  },
  shipper: {
    weight: 20,
    short: "Shipper details differ",
    risk: "Document presentation under a Letter of Credit can be refused because the shipper does not match the SI.",
  },
};

/** Fields ordered by business impact, most serious first. */
export function byImpact(fields: readonly Field[]) {
  return [...fields].sort(
    (a, b) => FIELD_RISK[b].weight - FIELD_RISK[a].weight,
  );
}

/** Short impact phrase for a set of mismatching fields, e.g. "Wrong consignee (+1 more)". */
export function impactPhrase(fields: readonly Field[]) {
  const ordered = byImpact(fields);
  if (!ordered.length) return "";
  const first = FIELD_RISK[ordered[0]].short;
  return ordered.length > 1 ? `${first} (+${ordered.length - 1} more)` : first;
}

export function fieldName(field: Field) {
  return FIELD_LABELS[field];
}
