import { z } from "zod";
import { analyze, fieldLabel } from "./compare";
import {
  FIELDS,
  PIPELINE_VERSION,
  type CaseResult,
  type Field,
  type ParsedDocument,
} from "./types";
import { HttpError } from "./http";

export interface LabelRule {
  id: string;
  version: number;
  state: "proposed" | "active" | "disabled";
  label: string;
  field: Field;
  role: "SI" | "BL";
  format: string;
  template_signature: string;
  source_id: string;
  source_case_version: number;
  source_sha256: string;
  proposed_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
}
const actor = z.string().trim().min(2).max(160);
export const labelProposal = z
  .object({
    action: z.literal("propose"),
    id: z.string().min(1).max(80),
    case_version: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    label: z.string().trim().min(2).max(80),
    field: z.enum(FIELDS),
    actor,
  })
  .strict();
export const labelDecision = z
  .object({
    action: z.enum(["approve", "disable"]),
    rule_id: z.string().uuid(),
    version: z.number().int().positive(),
    actor,
    preview_token: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    acknowledge_new_verified: z.boolean().optional(),
  })
  .strict();
export const labelRequest = z.union([labelProposal, labelDecision]);
export const canonicalLabel = (text: string) =>
  text.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
export async function fingerprint(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
/** Scope contains only heading labels, never a party name, shipment value or filename. */
export function templateLabels(doc: ParsedDocument) {
  return [
    ...new Set(
      doc.lines
        .map((line) => line.text.match(/^([^:：]+)[:：]/)?.[1])
        .filter(
          (label): label is string =>
            !!label && /^[\p{L}\s/()._-]{2,80}$/u.test(label.trim()),
        )
        .map(canonicalLabel),
    ),
  ].sort();
}
export async function templateSignature(doc: ParsedDocument) {
  return fingerprint(
    JSON.stringify({
      role: doc.type,
      format: doc.format,
      labels: templateLabels(doc),
    }),
  );
}
export async function createLabelProposal(
  source: CaseResult,
  input: z.infer<typeof labelProposal>,
): Promise<LabelRule> {
  input = labelProposal.parse(input);
  if (
    source.version !== input.case_version ||
    source.email.email_id !== input.id ||
    source.pipeline_version !== PIPELINE_VERSION
  )
    throw new HttpError(
      "Source revision changed. Reprocess and inspect the current document before proposing a label.",
      409,
    );
  const docs = source.documents.filter((doc) => doc.sha256 === input.sha256);
  const doc = docs[0],
    label = canonicalLabel(input.label);
  if (
    docs.length !== 1 ||
    !doc ||
    doc.error ||
    doc.transcription ||
    doc.recovery ||
    !["SI", "BL"].includes(doc.type)
  )
    throw new HttpError(
      "Select one readable, identified original SI or BL with its source fingerprint.",
      422,
    );
  if (
    !/^[\p{L}\s/()._-]{2,80}$/u.test(label) ||
    !templateLabels(doc).includes(label) ||
    templateLabels(doc).length < 5
  )
    throw new HttpError(
      "Use an exact heading before a colon from a template with at least five headings. Values cannot be learned as labels.",
      422,
    );
  if (fieldLabel(label))
    throw new HttpError(
      "This heading is already recognized. A new rule cannot redefine a built-in field or boundary.",
      422,
    );
  // Units must stay in the original label; only weight fields may inherit one.
  if (/\([^)]*\)/.test(label) && input.field !== "gross_weight_kg")
    throw new HttpError(
      "Annotated headings need a weight mapping or manual review; annotations cannot be discarded.",
      422,
    );
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    version: 1,
    state: "proposed",
    label,
    field: input.field,
    role: doc.type as "SI" | "BL",
    format: doc.format,
    template_signature: await templateSignature(doc),
    source_id: input.id,
    source_case_version: input.case_version,
    source_sha256: input.sha256,
    proposed_by: input.actor,
    approved_by: null,
    created_at: now,
    updated_at: now,
    approved_at: null,
  };
}
/** Integration hook: call on freshly parsed source documents before analyze().
 * Persist the returned source-bound mappings and mark the result reviewed.
 * Existing snapshots remain immutable; disabling affects future reprocessing. */
export async function applyLabelRules(
  documents: ParsedDocument[],
  rules: LabelRule[],
) {
  return Promise.all(
    documents.map(async (source) => {
      const doc = { ...source };
      delete doc.label_rules;
      if (
        doc.error ||
        doc.transcription ||
        doc.recovery ||
        !doc.sha256 ||
        !["SI", "BL"].includes(doc.type)
      )
        return doc;
      const signature = await templateSignature(doc);
      const matching = rules.filter(
        (r) =>
          r.state === "active" &&
          r.role === doc.type &&
          r.format === doc.format &&
          r.template_signature === signature &&
          templateLabels(doc).includes(r.label),
      );
      if (matching.length)
        doc.label_rules = {
          source_sha256: doc.sha256,
          template_signature: signature,
          aliases: matching.map(({ id, version, label, field }) => ({
            id,
            version,
            label,
            field,
          })),
        };
      return doc;
    }),
  );
}
export async function resultWithLabelRules(
  source: CaseResult,
  rules: LabelRule[],
) {
  const documents = await applyLabelRules(source.documents, rules);
  const result = analyze(
    source.email,
    documents,
    source.duration_ms,
    source.category_override,
    source.policy,
    source.document_selection,
  );
  return {
    ...result,
    version: source.version,
    source_replaced: source.source_replaced,
    reviewed: source.reviewed || documents.some((doc) => !!doc.label_rules),
  };
}
export interface RuleImpact {
  case_id: string;
  before: string;
  after: string;
  newly_verified: boolean;
}
export async function previewLabelRule(
  rule: LabelRule,
  cases: CaseResult[],
  active: LabelRule[],
) {
  const affected: RuleImpact[] = [];
  let skipped = 0;
  for (const source of cases) {
    if (
      source.pipeline_version !== PIPELINE_VERSION ||
      source.comparison.some(
        (row) =>
          row.si.method.startsWith("Human correction") ||
          row.bl.method.startsWith("Human correction"),
      )
    ) {
      skipped++;
      continue;
    }
    const before = await resultWithLabelRules(source, active);
    const after = await resultWithLabelRules(source, [
      ...active.filter((r) => r.id !== rule.id),
      { ...rule, state: "active" },
    ]);
    if (
      !after.documents.some((doc) =>
        doc.label_rules?.aliases.some((r) => r.id === rule.id),
      )
    )
      continue;
    affected.push({
      case_id: source.email.email_id,
      before: before.workflow,
      after: after.workflow,
      newly_verified:
        before.workflow !== "verified" && after.workflow === "verified",
    });
  }
  const cases_stamp = JSON.stringify(
    cases
      .map((source) => [source.email.email_id, source.version])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en-US")),
  );
  const rules_stamp = JSON.stringify(
    active
      .map((r) => [r.id, r.version])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en-US")),
  );
  return {
    affected,
    skipped,
    newly_verified: affected.filter((r) => r.newly_verified).length,
    cases_stamp,
    rules_stamp,
    token: await fingerprint(
      JSON.stringify({ rule, cases_stamp, rules_stamp, affected, skipped }),
    ),
  };
}
