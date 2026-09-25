import { z } from "zod";
import {
  FIELDS,
  type Field,
  type ParsedDocument,
  type Extracted,
} from "./types";
import { HttpError } from "./http";
import { normalizeValue, resolveFields } from "./normalization";
import { pdfCoverageIssue } from "./pdf-coverage";

export const RECOVERY_PROMPT_VERSION = "evidence-selectors-v3";
export const RECOVERY_LIMITS = {
  sourceCharacters: 16000,
  sourceBytes: 24000,
  sourceLines: 400,
  providerOutputBytes: 40000,
  completionTokens: 3072,
  timeoutMs: 25000,
  workspaceDailyCalls: 10,
  globalDailyCalls: 50,
  globalLifetimeCalls: 100,
  globalDailyReservedTokens: 500000,
  // Conservative lifetime reservation; does not reset on deployment or cookie changes.
  globalLifetimeReservedTokens: 1000000,
  concurrentCalls: 2,
  proposalMinutes: 30,
} as const;

export const citationSchema = z
  .object({
    line: z.number().int().min(1).max(RECOVERY_LIMITS.sourceLines),
    quote: z.string().min(1).max(1500),
  })
  .strict();
export const selectionSchema = z
  .object({
    citations: z.array(citationSchema).min(1).max(4),
    unit_citation: citationSchema.nullable(),
  })
  .strict();
export type RecoveryCitation = z.infer<typeof citationSchema>;
export type RecoverySelection = z.infer<typeof selectionSchema>;
export interface RecoveryFieldSuggestion extends RecoverySelection {
  value: string;
  issue?: string;
}
export interface RecoveryProposal {
  id: string;
  case_id: string;
  version: number;
  name: string;
  sha256: string;
  text_sha256: string;
  provider: "openai";
  model: string;
  prompt_version: string;
  created_at: string;
  expires_at: string;
  role: "SI" | "BL" | null;
  fields: Record<Field, RecoveryFieldSuggestion | null>;
  warnings: string[];
  latency_ms?: number;
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  resolved_model?: string;
}
export interface ConfirmedRecovery {
  proposal_id: string;
  sha256: string;
  text_sha256: string;
  role: "SI" | "BL";
  fields: Record<Field, RecoveryFieldSuggestion>;
  provider: "openai";
  model: string;
  prompt_version: string;
  actor: string;
  reason: string;
  confirmed_at: string;
}
export const providerProposalSchema = z
  .object({
    role: z.enum(["SI", "BL"]).nullable(),
    fields: z
      .object(
        Object.fromEntries(
          FIELDS.map((field) => [field, selectionSchema.nullable()]),
        ) as Record<Field, z.ZodNullable<typeof selectionSchema>>,
      )
      .strict(),
  })
  .strict();
export type ProviderProposal = z.infer<typeof providerProposalSchema>;

export function canRecover(doc: ParsedDocument): boolean {
  return (
    !!doc.sha256 &&
    !doc.error &&
    !pdfCoverageIssue(doc) &&
    !doc.transcription &&
    ["txt", "pdf", "docx", "xlsx"].includes(doc.format) &&
    doc.type !== "OTHER" &&
    doc.lines.some((line) => line.text.trim().length > 0)
  );
}
export function requireRecoverable(doc: ParsedDocument) {
  if (!canRecover(doc))
    throw new HttpError(
      "Evidence recovery requires a readable original document. Use scan assistance for image-only PDFs or replace damaged/unsupported sources.",
      422,
    );
  const content = JSON.stringify(doc.lines);
  if (
    doc.lines.length > RECOVERY_LIMITS.sourceLines ||
    doc.lines.reduce((sum, line) => sum + line.text.length, 0) >
      RECOVERY_LIMITS.sourceCharacters ||
    new TextEncoder().encode(content).byteLength > RECOVERY_LIMITS.sourceBytes
  )
    throw new HttpError(
      "This document is too large for bounded AI recovery. No partial source was sent; use manual review or a shorter readable source.",
      422,
    );
}
export async function recoveryHash(text: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export const sourceTextHash = (doc: ParsedDocument) =>
  recoveryHash(JSON.stringify(doc.lines));

function citedText(doc: ParsedDocument, citation: RecoveryCitation): string {
  const line = doc.lines[citation.line - 1]?.text;
  if (!line || !citation.quote.trim() || !line.includes(citation.quote))
    throw new HttpError(
      "A proposed quotation is not present on its cited source line. No recovery was applied.",
      422,
    );
  return citation.quote;
}
function unitOf(raw: string, allowHeading = false): "KG" | "MT" | null {
  let value = raw
    .normalize("NFKC")
    .trim()
    .replace(/^[([]|[)\]]$/g, "")
    .trim();
  // A model may cite the complete heading, e.g. "total gross kilograms".
  // Preserve that exact quote but permit only this finite neutral heading
  // grammar. Negation, net/tare, numbers, alternatives and unknown words fail.
  if (allowHeading)
    value = value.replace(
      /^(?:(?:total|gross|shipment|cargo|mass|weight|units?|in|of)\s+)+/i,
      "",
    );
  return /^(?:kgs?|kilograms?)$/i.test(value)
    ? "KG"
    : /^(?:mt|metric tonnes?|tonnes?)$/i.test(value)
      ? "MT"
      : null;
}
export function materializeSelection(
  doc: ParsedDocument,
  field: Field,
  input: unknown,
): RecoveryFieldSuggestion {
  const selection = selectionSchema.parse(input);
  const ordered = selection.citations.map((citation) =>
    citedText(doc, citation),
  );
  if (
    new Set(selection.citations.map((c) => `${c.line}:${c.quote}`)).size !==
    selection.citations.length
  )
    throw new HttpError("Repeated source citations are ambiguous.", 422);
  if (
    selection.citations.some(
      (c, i) => i > 0 && c.line < selection.citations[i - 1].line,
    )
  )
    throw new HttpError(
      "Source citations must follow the original line order.",
      422,
    );
  let value = ordered.join("\n").trim();
  if (value.length > 1500)
    throw new HttpError("A recovered field exceeds the review limit.", 422);
  let issue: string | undefined;
  if (field !== "gross_weight_kg" && selection.unit_citation)
    throw new HttpError("Unit citations apply only to gross weight.", 422);
  if (field === "gross_weight_kg") {
    const rawUnit = selection.unit_citation
      ? citedText(doc, selection.unit_citation)
      : null;
    const unit = rawUnit ? unitOf(rawUnit, true) : null;
    const suffix = value
      .normalize("NFKC")
      .match(/([a-z]+(?:\s+[a-z]+)*)$/i)?.[1];
    const valueUnit = suffix ? unitOf(suffix) : null;
    if (rawUnit && !unit)
      issue =
        "The cited weight unit is unsupported. Confirm the original unit manually.";
    else if (unit && valueUnit && unit !== valueUnit)
      issue = "Cited weight units conflict.";
    else if (!valueUnit && !unit)
      issue =
        "An explicit source weight unit must be cited; kilograms are never assumed by recovery.";
    else if (!valueUnit && unit && !suffix) value = `${value} ${unit}`;
    // Never silently ignore a conflicting unit printed beside the selected value.
    const nearbyUnits = selection.citations.flatMap((citation) => {
      const line = doc.lines[citation.line - 1].text;
      return [
        ...line.matchAll(/\b(kgs?|kilograms?|mt|metric tonnes?|tonnes?)\b/gi),
      ].map((m) => unitOf(m[0]));
    });
    const effective = valueUnit ?? unit;
    if (effective && nearbyUnits.some((u) => u && u !== effective))
      issue =
        "The source line contains conflicting weight units. Manual review is required.";
    if (
      selection.unit_citation &&
      !selection.citations.some(
        (c) =>
          selection.unit_citation!.line <= c.line &&
          c.line - selection.unit_citation!.line <= 2,
      )
    )
      issue =
        "The cited unit is not beside the value or its immediate heading. Confirm the source manually.";
    // A split heading can carry the actual unit. Do not borrow KG from another
    // quantity while silently discarding an adjacent MT/tonnes heading.
    for (const citation of selection.citations) {
      const context = doc.lines
        .slice(Math.max(0, citation.line - 3), citation.line)
        .map((line) => line.text);
      for (const line of context) {
        if (!/\b(?:gross|mass|weight|wt)\b/i.test(line)) continue;
        const units = [
          ...line.matchAll(
            /\b(kgs?|kilograms?|mt|metric tonnes?|tonnes?|lbs?|pounds?)\b/gi,
          ),
        ].map((m) => unitOf(m[0]));
        if (effective && units.some((u) => !u || u !== effective))
          issue =
            "A nearby weight heading specifies conflicting or unsupported units. Manual review is required.";
      }
    }
  }
  if (["gross_weight_kg", "container_count"].includes(field)) {
    for (const citation of selection.citations) {
      const line = doc.lines[citation.line - 1].text;
      const position = line.indexOf(citation.quote);
      const before = line[position - 1] ?? "";
      const after = line[position + citation.quote.length] ?? "";
      if (
        (/^[\d.,]/.test(citation.quote) && /[\d.,+-]/.test(before)) ||
        (/[\d.,]$/.test(citation.quote) && /[\d.,]/.test(after))
      )
        issue =
          "The proposed number is only part of a larger source number. Confirm the complete value.";
    }
  }
  if (!issue && field !== "notify_party")
    issue = normalizeValue(field, value).issue;
  return { ...selection, value, ...(issue ? { issue } : {}) };
}
export function validateProviderProposal(doc: ParsedDocument, raw: unknown) {
  const parsed = providerProposalSchema.parse(raw);
  const fields = Object.fromEntries(
    FIELDS.map((field) => [
      field,
      parsed.fields[field] === null
        ? null
        : materializeSelection(doc, field, parsed.fields[field]),
    ]),
  ) as Record<Field, RecoveryFieldSuggestion | null>;
  return { role: parsed.role, fields };
}
export function recoveryExtracted(doc: ParsedDocument): Extracted {
  const recovery = doc.recovery!;
  return resolveFields(
    Object.fromEntries(
      FIELDS.map((field) => {
        const selected = materializeSelection(doc, field, {
          citations: recovery.fields[field].citations,
          unit_citation: recovery.fields[field].unit_citation,
        });
        return [
          field,
          {
            raw: selected.value,
            normalized: null,
            evidence:
              selected.citations
                .map(
                  (c) =>
                    `${doc.lines[c.line - 1].location}; exact quote: ${c.quote}`,
                )
                .join(" | ") +
              (selected.unit_citation
                ? ` | Unit: ${doc.lines[selected.unit_citation.line - 1].location}; ${selected.unit_citation.quote}`
                : ""),
            source: doc.name,
            method: "Human-confirmed AI evidence recovery",
            ...(selected.issue
              ? { extraction_issue: selected.issue, issue: selected.issue }
              : {}),
          },
        ];
      }),
    ) as Extracted,
  );
}
