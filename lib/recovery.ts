import { FIELDS, type CaseResult, type ParsedDocument } from "./types";
import { HttpError } from "./http";
import { requireCurrentEngine } from "./review-guard";
import { analyze, deriveResult, recomputeRows } from "./compare";
import {
  requireRecoverable,
  sourceTextHash,
  materializeSelection,
  recoveryExtracted,
  type ConfirmedRecovery,
  type RecoveryProposal,
  type RecoveryFieldSuggestion,
} from "./recovery-schema";

export async function recoverDocument(
  doc: ParsedDocument,
  recovery: ConfirmedRecovery,
): Promise<ParsedDocument> {
  requireRecoverable(doc);
  if (
    doc.sha256 !== recovery.sha256 ||
    (await sourceTextHash(doc)) !== recovery.text_sha256
  )
    throw new HttpError(
      "Source bytes or extracted text changed. Generate a fresh proposal and review it again.",
      409,
    );
  if (doc.type !== "UNKNOWN" && doc.type !== recovery.role)
    throw new HttpError(
      "The confirmed role conflicts with this document's recognized type. Replace or review its source.",
      422,
    );
  for (const field of FIELDS) {
    const saved = recovery.fields[field];
    const current = materializeSelection(doc, field, {
      citations: saved.citations,
      unit_citation: saved.unit_citation,
    });
    if (current.value !== saved.value || current.issue)
      throw new HttpError(
        "A recovered field is ambiguous or no longer matches its original evidence.",
        422,
      );
  }
  const next = {
    ...doc,
    type: recovery.role,
    recovery,
    method: "Original readable source + human-confirmed AI evidence recovery",
  };
  const extracted = recoveryExtracted(next);
  if (
    FIELDS.some(
      (field) => extracted[field].normalized === null || extracted[field].issue,
    )
  )
    throw new HttpError(
      "All seven recovered fields must be complete and unambiguous, including notification-party dependencies.",
      422,
    );
  return next;
}

export async function applyRecovery(
  previous: CaseResult,
  proposal: RecoveryProposal,
  confirmation: { role: "SI" | "BL"; actor: string; reason: string },
  now = new Date(),
): Promise<CaseResult> {
  requireCurrentEngine(previous);
  if (
    proposal.case_id !== previous.email.email_id ||
    proposal.version !== previous.version ||
    !Number.isFinite(Date.parse(proposal.expires_at)) ||
    Date.parse(proposal.expires_at) <= now.getTime()
  )
    throw new HttpError(
      "This proposal expired or the case changed. Generate a fresh proposal.",
      409,
    );
  const doc = previous.documents.find(
    (d) => d.name === proposal.name && d.sha256 === proposal.sha256,
  );
  if (!doc)
    throw new HttpError(
      "The proposal's source no longer matches this case.",
      409,
    );
  if (
    FIELDS.some(
      (field) => !proposal.fields[field] || proposal.fields[field]!.issue,
    )
  )
    throw new HttpError(
      "The proposal abstained or found ambiguity. All seven fields need grounded evidence; use manual review or replace the document.",
      422,
    );
  const recovery: ConfirmedRecovery = {
    proposal_id: proposal.id,
    sha256: proposal.sha256,
    text_sha256: proposal.text_sha256,
    fields: proposal.fields as Record<
      (typeof FIELDS)[number],
      RecoveryFieldSuggestion
    >,
    provider: proposal.provider,
    model: proposal.model,
    prompt_version: proposal.prompt_version,
    ...confirmation,
    confirmed_at: now.toISOString(),
  };
  const recovered = await recoverDocument(doc, recovery);
  const documents = previous.documents.map((d) => (d === doc ? recovered : d));
  let next = analyze(
    previous.email,
    documents,
    previous.duration_ms,
    previous.category_override,
    previous.policy,
    previous.document_selection,
  );
  if (next.comparison.length && previous.comparison.length) {
    const rows = structuredClone(next.comparison);
    for (const row of rows)
      for (const side of ["si", "bl"] as const) {
        const old = previous.comparison.find((r) => r.field === row.field)?.[
          side
        ];
        if (
          old?.method.startsWith("Human correction") &&
          old.source !== doc.name &&
          old.source === row[side].source
        )
          row[side] = old;
      }
    next = deriveResult(next, recomputeRows(rows));
  }
  return { ...next, reviewed: true, source_replaced: previous.source_replaced };
}
