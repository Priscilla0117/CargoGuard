import { z } from "zod";
import { HttpError } from "./http";
import { storage } from "./storage";
import { shipmentPair } from "./shipments";
import { PIPELINE_VERSION, type CaseResult, type FieldValue } from "./types";

export const TEMPLATE_FIELDS = [
  "shipper",
  "consignee",
  "notify_party",
] as const;
type TemplateField = (typeof TEMPLATE_FIELDS)[number];
export interface SiTemplate {
  id: string;
  version: number;
  name: string;
  customer: string;
  state: "proposed" | "approved" | "disabled";
  source_case: string;
  source_version: number;
  source_sha256: string;
  source_document: string;
  fields: Record<
    TemplateField,
    Pick<FieldValue, "raw" | "normalized" | "evidence">
  >;
  proposed_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}
const label = z
  .string()
  .trim()
  .min(2)
  .max(120)
  .refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const actor = z.string().trim().min(2).max(160);
export const siTemplateCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("propose"),
      name: label,
      customer: label,
      source_case: z.string().min(1).max(80),
      source_version: z.number().int().positive().safe(),
      actor,
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      id: z.string().uuid(),
      version: z.number().int().positive().safe(),
      confirmed: z.literal(true),
      actor,
    })
    .strict(),
  z
    .object({
      action: z.literal("disable"),
      id: z.string().uuid(),
      version: z.number().int().positive().safe(),
      actor,
    })
    .strict(),
]);
export type SiTemplateCommand = z.infer<typeof siTemplateCommand>;
export const customerKey = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("en-US");
async function sourceCase(ws: string, id: string, db: D1Database) {
  const row = await db
    .prepare(
      "SELECT payload,version FROM cases WHERE workspace=? AND email_id=?",
    )
    .bind(ws, id)
    .first<{ payload: string; version: number }>();
  if (!row)
    throw new HttpError(
      "Template source case is unavailable in this workspace.",
      404,
    );
  return { ...JSON.parse(row.payload), version: row.version } as CaseResult;
}
export function templateSource(result: CaseResult, expectedVersion: number) {
  if (
    result.version !== expectedVersion ||
    result.pipeline_version !== PIPELINE_VERSION
  )
    throw new HttpError(
      "Source changed or needs reprocessing. Inspect the current SI before proposing or approving a template.",
      409,
    );
  const { si } = shipmentPair(result);
  if (!si?.sha256 || si.error)
    throw new HttpError("An unambiguous, readable SI source is required.", 422);
  const fields = {} as SiTemplate["fields"];
  for (const field of TEMPLATE_FIELDS) {
    const value = result.comparison.find((row) => row.field === field)?.si;
    if (
      !value ||
      value.issue ||
      value.normalized === null ||
      !value.raw ||
      !value.evidence ||
      value.source !== si.name
    )
      throw new HttpError(
        "Confirm the three SI party fields from their original evidence before proposing a template.",
        422,
      );
    fields[field] = {
      raw: value.raw,
      normalized: value.normalized,
      evidence: value.evidence,
    };
  }
  return { source_document: si.name, source_sha256: si.sha256, fields };
}
export async function listSiTemplates(
  ws: string,
  db = storage().DB,
): Promise<SiTemplate[]> {
  return (
    await db
      .prepare(
        "SELECT payload FROM si_templates WHERE workspace=? ORDER BY id LIMIT 100",
      )
      .bind(ws)
      .all<{ payload: string }>()
  ).results.map((row) => JSON.parse(row.payload));
}
export async function saveSiTemplate(
  ws: string,
  command: SiTemplateCommand,
  db = storage().DB,
) {
  const input = siTemplateCommand.parse(command),
    now = new Date().toISOString();
  let next: SiTemplate,
    expected = 0;
  if (input.action === "propose") {
    const source = await sourceCase(ws, input.source_case, db),
      evidence = templateSource(source, input.source_version);
    next = {
      id: crypto.randomUUID(),
      version: 1,
      name: input.name,
      customer: input.customer,
      state: "proposed",
      source_case: input.source_case,
      source_version: input.source_version,
      ...evidence,
      proposed_by: input.actor,
      approved_by: null,
      created_at: now,
      updated_at: now,
    };
  } else {
    const row = await db
      .prepare(
        "SELECT payload,version FROM si_templates WHERE workspace=? AND id=?",
      )
      .bind(ws, input.id)
      .first<{ payload: string; version: number }>();
    if (!row || row.version !== input.version)
      throw new HttpError(
        "Template changed or is unavailable. Refresh before deciding.",
        409,
      );
    const previous = JSON.parse(row.payload) as SiTemplate;
    if (input.action === "approve") {
      if (previous.state !== "proposed")
        throw new HttpError(
          "Only a proposed template can be approved. Create a fresh proposal after changes.",
          409,
        );
      const evidence = templateSource(
        await sourceCase(ws, previous.source_case, db),
        previous.source_version,
      );
      if (
        evidence.source_sha256 !== previous.source_sha256 ||
        JSON.stringify(evidence.fields) !== JSON.stringify(previous.fields)
      )
        throw new HttpError(
          "SI evidence changed. Create and inspect a new template proposal.",
          409,
        );
    }
    next = {
      ...previous,
      version: previous.version + 1,
      state: input.action === "approve" ? "approved" : "disabled",
      approved_by:
        input.action === "approve" ? input.actor : previous.approved_by,
      updated_at: now,
    };
    expected = previous.version;
  }
  const payload = JSON.stringify(next),
    sourceGuard =
      input.action === "disable"
        ? ""
        : " AND EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?)",
    sourceArgs =
      input.action === "disable"
        ? []
        : [ws, next.source_case, next.source_version];
  const mutation =
    expected === 0
      ? db
          .prepare(
            "INSERT INTO si_templates(workspace,id,version,payload) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM si_templates WHERE workspace=?)<100" +
              sourceGuard,
          )
          .bind(ws, next.id, next.version, payload, ws, ...sourceArgs)
      : db
          .prepare(
            "UPDATE si_templates SET version=?,payload=? WHERE workspace=? AND id=? AND version=?" +
              sourceGuard,
          )
          .bind(next.version, payload, ws, next.id, expected, ...sourceArgs);
  const writes = await db.batch([
    mutation,
    db
      .prepare(
        "INSERT INTO si_template_revisions(workspace,id,version,payload,created_at) SELECT ?,?,?,?,? WHERE changes()=1",
      )
      .bind(ws, next.id, next.version, payload, now),
    db
      .prepare(
        "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        ws,
        next.source_case,
        `SI_TEMPLATE_${input.action.toUpperCase()}`,
        input.actor,
        JSON.stringify({
          id: next.id,
          version: next.version,
          source_version: next.source_version,
          state: next.state,
        }),
        now,
      ),
  ]);
  if (writes[0].meta.changes !== 1)
    throw new HttpError(
      "Template/source changed, or the 100-template workspace limit was reached. Refresh before retrying.",
      409,
    );
  return next;
}
/** Draft use is explicit and bound to an approved version, customer and unchanged source. */
export async function loadApprovedSiTemplate(
  ws: string,
  id: string,
  version: number,
  customer: string,
  db = storage().DB,
): Promise<SiTemplate> {
  const row = await db
    .prepare(
      "SELECT payload,version FROM si_templates WHERE workspace=? AND id=?",
    )
    .bind(ws, id)
    .first<{ payload: string; version: number }>();
  if (!row || row.version !== version)
    throw new HttpError(
      "SI template changed or is unavailable. Refresh and select it again.",
      409,
    );
  const template = JSON.parse(row.payload) as SiTemplate;
  if (
    template.state !== "approved" ||
    !customer.trim() ||
    customerKey(customer) !== customerKey(template.customer)
  )
    throw new HttpError(
      "Choose an approved template for this exact recorded customer.",
      409,
    );
  const evidence = templateSource(
    await sourceCase(ws, template.source_case, db),
    template.source_version,
  );
  if (
    evidence.source_sha256 !== template.source_sha256 ||
    JSON.stringify(evidence.fields) !== JSON.stringify(template.fields)
  )
    throw new HttpError(
      "Template source evidence changed. An authorized reviewer must approve a fresh proposal.",
      409,
    );
  return template;
}
export function siTemplateDraft(template: SiTemplate, reference: string) {
  return `DRAFT SI WORKSHEET — ${reference || "[confirm current reference]"}\n\nApproved template: ${template.name}, version ${template.version}\nRecorded customer: ${template.customer}\nShipper: ${template.fields.shipper.raw}\nConsignee: ${template.fields.consignee.raw}\nNotify party: ${template.fields.notify_party.raw}\n\nPort of loading: [confirm current order]\nPort of discharge: [confirm current order]\nContainers: [enter current shipment]\nGross weight (kg): [enter current shipment]\nVoyage / date / seals: [enter current shipment]\n\nTemplate source: ${template.source_case}, revision ${template.source_version}; SI ${template.source_document}, SHA-256 ${template.source_sha256}.\nConfirm every party against the current order. No shipment-specific quantities, voyage, dates or equipment were copied. Nothing has been sent.`;
}
