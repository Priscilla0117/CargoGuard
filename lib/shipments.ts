import { z } from "zod";
import { currentMessage } from "./classifier";
import {
  compareFields,
  normalize,
  recomputeRows,
  sameAsConsignee,
} from "./normalization";
import { extract } from "./compare";
import { selectedDocuments } from "./document-selection";
import {
  FIELDS,
  PIPELINE_VERSION,
  type CaseResult,
  type Field,
  type Email,
  type Extracted,
} from "./types";

export const shipmentText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (v) => !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v),
      "Unsupported control character",
    );
const required = (max: number) =>
  shipmentText(max).refine((v) => v.length >= 2, "Value is required");
export const deadlineTypes = [
  "BL confirmation",
  "SI submission",
  "VGM",
  "Gate-in",
  "Internal follow-up",
  "ETD",
] as const;
export interface ShipmentDeadline {
  id: string;
  type: (typeof deadlineTypes)[number];
  at: string;
  zone: string;
  quote: string;
  source_case: string;
  source_version: number;
  confirmed_by: string;
  confirmed_at: string;
}
export interface ShipmentAmendment {
  id: string;
  field: Field;
  value: string;
  quote: string;
  source_case: string;
  source_version: number;
  si_sha256: string;
  proposed_by: string;
  proposed_at: string;
  status: "proposed" | "approved" | "rejected" | "superseded";
  decided_by?: string;
  decided_at?: string;
  reason?: string;
  /** Reviewer proof against a new SI. The approved email and original SI remain immutable. */
  incorporation?: {
    case_id: string;
    case_version: number;
    si_sha256: string;
    si_value: string;
    si_evidence: string;
    actor: string;
    at: string;
    reason: string;
  };
}
export interface ShipmentTask {
  id: string;
  kind:
    | "missing_documents"
    | "revised_si"
    | "billing"
    | "si_draft"
    | "it_report"
    | "handover";
  case_id: string;
  title: string;
  body: string;
  owner: string;
  state: "draft" | "working" | "waiting" | "done";
  created_at: string;
  updated_at: string;
  actor: string;
}
export interface Shipment {
  id: string;
  version: number;
  title: string;
  customer: string;
  carrier: string;
  references: string[];
  case_ids: string[];
  comparison_case_id: string | null;
  owner: string;
  owner_id: string | null;
  state: "open" | "completed";
  completed_cases: Record<string, number>;
  deadlines: ShipmentDeadline[];
  amendments: ShipmentAmendment[];
  tasks: ShipmentTask[];
  notes: string;
  created_at: string;
  updated_at: string;
  actor: string;
}
export const shipmentCommand = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("reconcile_amendment"),
      id: required(80),
      version: z.number().int().positive().safe(),
      amendment_id: required(80),
      case_id: required(120),
      case_version: z.number().int().positive().safe(),
      reason: required(600),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("withdraw_amendment"),
      id: required(80),
      version: z.number().int().positive().safe(),
      amendment_id: required(80),
      reason: required(600),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("create"),
      title: required(180),
      customer: shipmentText(120).default(""),
      carrier: shipmentText(120).default(""),
      references: z.array(required(120)).max(12).default([]),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      id: required(80),
      version: z.number().int().min(1),
      title: required(180),
      customer: shipmentText(120),
      carrier: shipmentText(120),
      references: z.array(required(120)).max(12),
      notes: shipmentText(4000),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("link"),
      id: required(80),
      version: z.number().int().min(1),
      case_id: required(120),
      case_version: z.number().int().min(1),
      reason: required(600),
      unlink: z.boolean().default(false),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("assign"),
      id: required(80),
      version: z.number().int().min(1),
      owner: required(80),
      owner_id: shipmentText(80).nullable(),
      reason: required(600),
      claim: z.boolean().default(false),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("select_comparison"),
      id: required(80),
      version: z.number().int().min(1),
      case_id: required(120),
      case_version: z.number().int().min(1),
      reason: required(600),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("deadline"),
      id: required(80),
      version: z.number().int().min(1),
      type: z.enum(deadlineTypes),
      at: z
        .string()
        .datetime({ offset: true })
        .refine((v) => Number.isFinite(Date.parse(v))),
      zone: required(100),
      quote: required(1000),
      case_id: required(120),
      case_version: z.number().int().min(1),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("remove_deadline"),
      id: required(80),
      version: z.number().int().min(1),
      deadline_id: required(80),
      reason: required(600),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("propose_amendment"),
      id: required(80),
      version: z.number().int().min(1),
      case_id: required(120),
      case_version: z.number().int().min(1),
      field: z.enum(FIELDS),
      value: shipmentText(1000).refine(
        (value) => value.length > 0,
        "Value is required",
      ),
      quote: required(2000),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("decide_amendment"),
      id: required(80),
      version: z.number().int().min(1),
      amendment_id: required(80),
      approve: z.boolean(),
      reason: required(600),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("task"),
      template_id: z.string().uuid().optional(),
      template_version: z.number().int().positive().safe().optional(),
      id: required(80),
      version: z.number().int().min(1),
      case_id: required(120),
      case_version: z.number().int().min(1),
      kind: z.enum([
        "missing_documents",
        "revised_si",
        "billing",
        "si_draft",
        "it_report",
        "handover",
      ]),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("update_task"),
      id: required(80),
      version: z.number().int().min(1),
      task_id: required(80),
      owner: shipmentText(80),
      body: required(8000),
      state: z.enum(["draft", "working", "waiting", "done"]),
      reason: required(600),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("complete"),
      id: required(80),
      version: z.number().int().min(1),
      cases: z.record(z.number().int().min(1)),
      acknowledge_advisories: z.boolean(),
      reason: required(600),
      actor: required(80),
    })
    .strict(),
  z
    .object({
      action: z.literal("reopen"),
      id: required(80),
      version: z.number().int().min(1),
      reason: required(600),
      actor: required(80),
    })
    .strict(),
]);
export type ShipmentCommand = z.infer<typeof shipmentCommand>;

export function referenceCandidates(email: Pick<Email, "subject" | "body">) {
  const scan = (text: string, source: "subject" | "body") =>
    [
      ...text.matchAll(
        /\b(?:booking|b\/?l|bill of lading|oc|order|reference|ref)\s*(?:no\.?|number|#|:)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{5,40})\b|\b([A-Z]{2,6}\d{6,15})\b/gi,
      ),
    ].flatMap((m) => {
      const value = (m[1] ?? m[2]).toUpperCase();
      return /\d/.test(value) ? [{ value, source, quote: m[0] }] : [];
    });
  const candidates = [
    ...scan(email.subject, "subject"),
    ...scan(currentMessage(email.body), "body"),
  ];
  const body = new Set(
    candidates.filter((v) => v.source === "body").map((v) => v.value),
  );
  const subject = new Set(
    candidates.filter((v) => v.source === "subject").map((v) => v.value),
  );
  return {
    candidates: candidates.filter(
      (v, i, a) =>
        a.findIndex((x) => x.value === v.value && x.source === v.source) === i,
    ),
    conflict:
      body.size > 0 &&
      subject.size > 0 &&
      [...subject].some((v) => !body.has(v)),
  };
}

export function deadlineCandidates(email: Email) {
  return currentMessage(email.body)
    .split(/\r?\n/)
    .filter((line) =>
      /\b(?:cut[- ]?off|deadline|etd|due|latest submission)\b/i.test(line),
    )
    .slice(0, 12)
    .map((quote) => ({
      quote,
      type: /\bETD\b/i.test(quote)
        ? "ETD"
        : /\bVGM\b/i.test(quote)
          ? "VGM"
          : /gate[- ]?in/i.test(quote)
            ? "Gate-in"
            : /\bSI\b|shipping instruction/i.test(quote)
              ? "SI submission"
              : "BL confirmation",
      requires_confirmation: true,
    }));
}
export function shipmentStatus(shipment: Shipment, cases: CaseResult[]) {
  if (shipment.state !== "completed") return "open" as const;
  if (
    shipment.tasks.some((t) => t.state !== "done") ||
    shipment.amendments.some((a) => a.status === "proposed")
  )
    return "reopened" as const;
  return shipment.case_ids.length &&
    shipment.case_ids.every((id) =>
      cases.some(
        (c) =>
          c.email.email_id === id &&
          c.version === shipment.completed_cases[id] &&
          c.pipeline_version === PIPELINE_VERSION,
      ),
    )
    ? ("completed" as const)
    : ("reopened" as const);
}
export function nextDeadline(shipment: Shipment, cases: CaseResult[]) {
  if (shipmentStatus(shipment, cases) === "completed") return null;
  return (
    shipment.deadlines
      .filter(
        (d) =>
          d.type !== "ETD" &&
          cases.some(
            (c) =>
              c.email.email_id === d.source_case &&
              c.version === d.source_version,
          ),
      )
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null
  );
}
export function approvedComparison(
  shipment: Shipment,
  result: CaseResult,
  sources: CaseResult[] = [result],
) {
  const pair = shipmentPair(result);
  if (!pair.si?.sha256 || !result.comparison.length)
    return {
      rows: [],
      applied: [],
      blocked: "A selected, source-linked SI/BL comparison is required.",
    };
  const approved = shipment.amendments.filter((a) => a.status === "approved");
  const amendments = approved.filter(
    (a) =>
      amendmentSourceCurrent(shipment, a, sources) &&
      (a.incorporation
        ? amendmentIncorporationCurrent(shipment, a, result, sources)
        : a.si_sha256 === pair.si!.sha256),
  );
  const rows = structuredClone(result.comparison);
  for (const amendment of amendments) {
    // Incorporated instructions are evidenced by the real revised SI; do not
    // replace its values with an email overlay or conceal its provenance.
    if (amendment.incorporation) continue;
    const row = rows.find((r) => r.field === amendment.field);
    if (row)
      row.si = {
        raw: amendment.value,
        normalized: normalize(amendment.field, amendment.value),
        evidence: `Approved ${amendment.id}; ${amendment.source_case} v${amendment.source_version}: ${amendment.quote}`,
        source: amendment.source_case,
        method: "Approved instruction overlay",
      };
  }
  return {
    rows: recomputeRows(rows),
    applied: amendments,
    blocked:
      approved.length !== amendments.length
        ? "An approved instruction has changed source evidence or SI. Reconfirm it; stale instructions are excluded."
        : shipment.amendments.some((a) => a.status === "proposed")
          ? "An instruction change awaits a decision."
          : null,
  };
}

export function amendmentSourceCurrent(
  shipment: Shipment,
  amendment: ShipmentAmendment,
  sources: CaseResult[],
) {
  return (
    shipment.case_ids.includes(amendment.source_case) &&
    sources.some(
      (source) =>
        source.email.email_id === amendment.source_case &&
        source.version === amendment.source_version &&
        source.pipeline_version === PIPELINE_VERSION &&
        source.email.body.includes(amendment.quote) &&
        amendment.quote.includes(amendment.value),
    )
  );
}

/** A candidate SI must establish the instruction from source-backed values.
 * This check never changes the original SI/BL result or grants completion.
 */
function amendmentEvidenceBlocker(
  shipment: Shipment,
  amendment: ShipmentAmendment,
  result: CaseResult,
  sources: CaseResult[],
  requireRevisedSI: boolean,
): string | null {
  if (amendment.status !== "approved")
    return "Approve this instruction before checking a revised SI.";
  const active = shipment.amendments.filter(
    (item) => item.status === "approved",
  );
  if (new Set(active.map((item) => item.field)).size !== active.length)
    return "Conflicting active instructions need review. Withdraw the superseded instruction before reconciling.";
  if (!amendmentSourceCurrent(shipment, amendment, sources))
    return "The instruction evidence changed. Withdraw it and propose a new instruction from current evidence.";
  if (
    !shipment.case_ids.includes(result.email.email_id) ||
    shipment.comparison_case_id !== result.email.email_id ||
    result.category !== "BL_COMPARISON" ||
    result.pipeline_version !== PIPELINE_VERSION ||
    (result.classification.needs_review && !result.category_override)
  )
    return "Select a current, confirmed document-comparison case linked to this shipment.";
  const pair = shipmentPair(result);
  if (
    !pair.si ||
    !pair.bl ||
    pair.si.error ||
    pair.bl.error ||
    !/^[a-f0-9]{64}$/.test(pair.si.sha256 ?? "") ||
    !/^[a-f0-9]{64}$/.test(pair.bl.sha256 ?? "") ||
    result.comparison.length !== FIELDS.length ||
    new Set(result.comparison.map((row) => row.field)).size !== FIELDS.length ||
    FIELDS.some(
      (field) => !result.comparison.some((row) => row.field === field),
    ) ||
    result.comparison.some(
      (row) =>
        row.si.source !== pair.si!.name ||
        row.bl.source !== pair.bl!.name ||
        !row.si.evidence.trim() ||
        !row.bl.evidence.trim(),
    )
  )
    return "A readable, selected SI/BL pair with all seven source-linked fields is required.";
  if (requireRevisedSI && pair.si.sha256 === amendment.si_sha256)
    return "Obtain and select a revised SI. The selected SI is still the original instruction reference.";
  // Extract again from the selected document. Editing a comparison value cannot
  // impersonate receipt of an authoritative revised SI. Confirmed OCR/recovery
  // stays supported because extract reads that document's bound transcription.
  const source = extract(pair.si);
  const displayed = Object.fromEntries(
    result.comparison.map((row) => [row.field, row.si]),
  ) as Extracted;
  const sourceCheck = compareFields(source, displayed);
  const dependency =
    amendment.field === "notify_party" &&
    (sameAsConsignee(amendment.value) ||
      sameAsConsignee(source.notify_party.raw));
  if (
    sourceCheck.some(
      (row) =>
        (row.field === amendment.field ||
          (dependency && row.field === "consignee")) &&
        row.result !== "match",
    )
  )
    return "The comparison value does not match the revised SI source. Confirm the document transcription or obtain the corrected SI; a field edit alone is not incorporation evidence.";
  const intended = structuredClone(source);
  for (const instruction of active) {
    if (!amendmentSourceCurrent(shipment, instruction, sources))
      return "Resolve changed evidence for all approved instructions before reconciling the revised SI.";
    intended[instruction.field] = {
      raw: instruction.value,
      normalized: normalize(instruction.field, instruction.value),
      source: instruction.source_case,
      evidence: instruction.quote,
      method: "Approved instruction",
    };
  }
  if (
    compareFields(source, intended).find((row) => row.field === amendment.field)
      ?.result !== "match"
  )
    return "The revised SI does not yet establish this approved value. Correct or review its source evidence first.";
  return null;
}

export function amendmentReconciliationBlocker(
  shipment: Shipment,
  amendment: ShipmentAmendment,
  result: CaseResult,
  sources: CaseResult[],
): string | null {
  return amendmentEvidenceBlocker(shipment, amendment, result, sources, true);
}

/** A no-change instruction needs support from the real original SI, not edited comparison values. */
export function amendmentOriginalSupported(
  shipment: Shipment,
  amendment: ShipmentAmendment,
  result: CaseResult,
  sources: CaseResult[],
): boolean {
  return (
    !amendment.incorporation &&
    shipmentPair(result).si?.sha256 === amendment.si_sha256 &&
    amendmentEvidenceBlocker(shipment, amendment, result, sources, false) ===
      null
  );
}

export function amendmentIncorporationCurrent(
  shipment: Shipment,
  amendment: ShipmentAmendment,
  result: CaseResult,
  sources: CaseResult[],
) {
  const proof = amendment.incorporation;
  const si = shipmentPair(result).si;
  const source = si && extract(si)[amendment.field];
  return (
    !!proof &&
    proof.case_id === result.email.email_id &&
    proof.case_version === result.version &&
    proof.si_sha256 === si?.sha256 &&
    proof.si_value === source?.raw &&
    proof.si_evidence === source?.evidence &&
    amendmentReconciliationBlocker(shipment, amendment, result, sources) ===
      null
  );
}

/** Shared by task creation and the UI; never amplify stale or conflicting advice. */
export function revisedSiRequestBlocker(
  shipment: Shipment,
  result: CaseResult,
  sources: CaseResult[],
): string | null {
  if (
    !shipment.case_ids.includes(result.email.email_id) ||
    shipment.comparison_case_id !== result.email.email_id ||
    result.category !== "BL_COMPARISON" ||
    result.pipeline_version !== PIPELINE_VERSION ||
    (result.classification.needs_review && !result.category_override)
  )
    return "Use the selected current, confirmed comparison to request a revised SI.";
  if (shipment.amendments.some((item) => item.status === "proposed"))
    return "Resolve pending instruction proposals before drafting the revised SI request.";
  const approved = shipment.amendments.filter(
    (item) => item.status === "approved",
  );
  if (new Set(approved.map((item) => item.field)).size !== approved.length)
    return "Conflicting active instructions need review before drafting the revised SI request.";
  if (approved.some((item) => !amendmentSourceCurrent(shipment, item, sources)))
    return "Instruction evidence changed. Resolve it before drafting a revised SI request.";
  if (
    !approved.some(
      (item) =>
        !amendmentIncorporationCurrent(shipment, item, result, sources) &&
        !amendmentOriginalSupported(shipment, item, result, sources),
    )
  )
    return "There are no outstanding approved instructions needing a revised SI request.";
  return null;
}

/** Suggestions only: quoted email text never gains authority through extraction. */
export function amendmentCandidates(email: Email) {
  const labels: [RegExp, Field][] = [
    [/^(?:consignee)$/i, "consignee"],
    [/^(?:shipper)$/i, "shipper"],
    [/^(?:notify party)$/i, "notify_party"],
    [/^(?:port of loading|load port)$/i, "port_of_loading"],
    [/^(?:port of discharge|discharge port)$/i, "port_of_discharge"],
    [/^(?:container count|number of containers)$/i, "container_count"],
    [/^(?:gross weight)$/i, "gross_weight_kg"],
  ];
  return currentMessage(email.body)
    .split(/\r?\n/)
    .flatMap((quote) => {
      const match = quote
        .trim()
        .match(
          /^(?:(?:please|pls|kindly)\s+)?(?:change|amend|update|correct)\s+(.+?)\s+to\s+(.+?)\s*$/i,
        );
      const field =
        match && labels.find(([pattern]) => pattern.test(match[1]))?.[1];
      if (
        !match ||
        !field ||
        match[2].length > 1000 ||
        normalize(field, match[2]) === null
      )
        return [];
      return [{ field, value: match[2], quote, requires_approval: true }];
    })
    .slice(0, 12);
}

export function shipmentPair(result: CaseResult) {
  if (result.document_selection) {
    try {
      const [si, bl] = selectedDocuments(
        result.documents,
        result.document_selection,
      );
      return { si, bl };
    } catch {
      return { si: undefined, bl: undefined };
    }
  }
  const si = result.documents.filter((d) => d.type === "SI" && !d.error),
    bl = result.documents.filter((d) => d.type === "BL" && !d.error);
  return {
    si: si.length === 1 ? si[0] : undefined,
    bl: bl.length === 1 ? bl[0] : undefined,
  };
}

export function taskDraft(
  kind: ShipmentTask["kind"],
  result: CaseResult,
  shipment: Shipment,
  sources: CaseResult[] = [result],
) {
  const refs = shipment.references.join(", ") || "[confirm shipment reference]";
  const read = result.email.body.slice(0, 5000);
  if (kind === "revised_si") {
    const outstanding = shipment.amendments.filter(
      (amendment) =>
        amendment.status === "approved" &&
        !amendmentIncorporationCurrent(shipment, amendment, result, sources) &&
        !amendmentOriginalSupported(shipment, amendment, result, sources),
    );
    const blocker = revisedSiRequestBlocker(shipment, result, sources);
    const lines = blocker
      ? [blocker]
      : outstanding.flatMap((amendment) => [
          `${amendment.field.replaceAll("_", " ")}: ${amendment.value}`,
          `Approved source: ${amendment.source_case}, revision ${amendment.source_version}. Quote: ${amendment.quote}`,
          `Original SI fingerprint: ${amendment.si_sha256}`,
          "",
        ]);
    return {
      title: "Request revised Shipping Instruction",
      body: `DRAFT — review recipient, authority and references before sending.\nVersion-bound snapshot: regenerate this draft if any cited instruction or selected document changes.\n\nSubject: Revised SI required — ${refs}\n\nPlease provide a revised authoritative Shipping Instruction incorporating the reviewed instructions below and the corresponding current draft Bill of Lading for ${refs}.\n\n${lines.join("\n")}\nSelected comparison: ${result.email.email_id}, revision ${result.version}.\nCurrent SI fingerprint: ${shipmentPair(result).si?.sha256 ?? "not available"}.\n\nWe will recheck every field when the documents arrive. This draft does not approve a BL or authorize cargo release. Nothing has been sent.`,
    };
  }
  if (kind === "missing_documents") {
    const si = result.documents.some((d) => d.type === "SI" && !d.error);
    const bl = result.documents.some((d) => d.type === "BL" && !d.error);
    const missing = [
      !si && "authoritative Shipping Instruction",
      !bl && "readable draft Bill of Lading",
    ].filter(Boolean);
    return {
      title: "Request missing documents",
      body: `DRAFT — review recipient and references before sending.\n\nSubject: Documents required — ${refs}\n\nPlease provide ${missing.length ? missing.join(" and ") : "the confirmed current document versions"} for ${refs}. We will compare the draft after the required sources are available.\n\nSource: ${result.email.email_id}, revision ${result.version}.\nNothing has been sent.`,
    };
  }
  if (kind === "billing") {
    const ids = [
      ...read.matchAll(
        /\binvoice\s*(?:no\.?|number|#|:)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{3,40})\b/gi,
      ),
    ]
      .filter((m) => /\d/.test(m[1]))
      .map((m) => m[0]);
    const charges = [
      ...new Set(
        read.match(
          /\b(?:demurrage|detention|D\s*&\s*D|local charges|freight charges)\b/gi,
        ) ?? [],
      ),
    ];
    return {
      title: "Billing review and acknowledgement",
      body: `DRAFT — billing review required.\n\nWe acknowledge your query concerning ${refs}. The billing team will review the supplied documents and respond.\n\nInvoice references quoted: ${ids.join("; ") || "not located — confirm"}\nCharge descriptions quoted: ${charges.join("; ") || "not located — confirm"}\nSource: ${result.email.email_id}, revision ${result.version}.\nThis does not confirm liability, amount due, payment or resolution. Nothing has been sent.`,
    };
  }
  if (kind === "si_draft")
    return {
      title: "Prepare Shipping Instruction",
      body: `DRAFT SI WORKSHEET — ${refs}\n\nCustomer: ${shipment.customer || "[confirm customer]"}\nUse an approved customer template or current order evidence.\nShipper: [confirm]\nConsignee: [confirm]\nNotify party: [confirm]\nLoading port: [confirm]\nDischarge port: [confirm]\nContainers: [enter current shipment]\nGross weight (kg): [enter current shipment]\nVoyage / date / seals: [enter current shipment]\n\nSource request: ${result.email.email_id}, revision ${result.version}. Do not copy volatile values from a previous shipment.`,
    };
  if (kind === "it_report")
    return {
      title: "Report suspicious message",
      body: `DRAFT — review and choose the approved IT destination.\n\nCase: ${result.email.email_id}, revision ${result.version}\nSubject: ${result.email.subject}\nRouting: ${result.category}\nObserved indicators: ${result.classification.signals.join("; ")}\n\nPreserve the original message for investigation. A classifier label is not proof of maliciousness. Links have not been followed. Nothing has been sent.`,
    };
  return {
    title: "Shift handover",
    body: `Handover — ${shipment.title}\nReferences: ${refs}\nOwner: ${shipment.owner || "Unassigned"}\nCase: ${result.email.email_id}, revision ${result.version}\nResult: ${result.summary}\nNext action: [confirm]\nDeadline: [confirm]\nNothing has been dispatched or released.`,
  };
}
