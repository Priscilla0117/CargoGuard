import { z } from "zod";
import { HttpError } from "./http";
import { answerCase, comparisonComplete } from "./case-guide";
import { FIELD_LABELS, PIPELINE_VERSION, type CaseResult } from "./types";
import { recoveryHash } from "./recovery-schema";

export const ASSISTANT_VERSION = "case-advisor-v1";
export const ASSISTANT_LIMITS = {
  questionCharacters: 800,
  inputBytes: 24000,
  outputBytes: 40000,
  completionTokens: 1600,
  turns: 3,
  minutes: 30,
};
export interface AssistantFact {
  id: string;
  label: string;
  text: string;
  source?: { name: string; location: string };
}
export interface AssistantContext {
  hash: string;
  facts: AssistantFact[];
}
export const answerSchema = z
  .object({
    scope: z.enum(["case", "insufficient_evidence", "out_of_scope"]),
    blocks: z
      .array(
        z
          .object({
            kind: z.enum(["explanation", "next_step", "draft"]),
            text: z.string().trim().min(1).max(1600),
            citations: z.array(z.string().min(1).max(30)).max(12),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
export type AssistantAnswer = z.infer<typeof answerSchema>;
export interface AssistantTurn {
  question: string;
  answer: AssistantAnswer;
}
export interface AssistantReply {
  id: string;
  case_id: string;
  version: number;
  context_hash: string;
  prompt_version: string;
  created_at: string;
  expires_at: string;
  turns: AssistantTurn[];
  model: string;
  latency_ms: number;
}
export async function assistantContext(
  r: CaseResult,
): Promise<AssistantContext> {
  if (r.pipeline_version !== PIPELINE_VERSION)
    throw new HttpError(
      "Reprocess this older-engine case before asking AI. The Resolution tab remains available.",
      409,
    );
  if (r.workflow === "verified" && !comparisonComplete(r))
    throw new HttpError(
      "The saved readiness state is inconsistent. Reload or reprocess before asking AI.",
      409,
    );
  const facts: AssistantFact[] = [
    {
      id: "status",
      label: "Saved result",
      text: JSON.stringify({
        category: r.category,
        status: r.status,
        workflow: r.workflow,
        review_reason: r.review_reason,
        human_review_recorded: !!r.reviewed,
        human_route_override: !!r.category_override,
        route_needs_review: !!r.classification.needs_review,
        revision: r.version,
      }),
    },
    {
      id: "readiness",
      label: "Handoff boundary",
      text: answerCase(r, "readiness").paragraphs.slice(0, 1).join("\n"),
    },
    {
      id: "next",
      label: "Required next steps",
      text: answerCase(r, "next").paragraphs.join("\n"),
    },
    {
      id: "coverage",
      label: "Evidence coverage",
      text: `Saved comparison rows: ${r.comparison.length} of seven expected. Document roles: ${r.documents.map((d) => `${d.type}${d.error ? " (unreadable)" : ""}`).join(", ") || "none"}. Only selected field excerpts are provided; this is not the complete document or email. Absent evidence never means a match.`,
    },
  ];
  for (const row of r.comparison) {
    facts.push({
      id: `${row.field}_result`,
      label: `${FIELD_LABELS[row.field]} finding`,
      text: `Saved field result: ${row.result}.`,
    });
    for (const side of ["si", "bl"] as const) {
      const value = row[side],
        doc = r.documents.find((d) => d.name === value.source);
      const excerpt =
        (doc?.transcription ? [] : (doc?.lines ?? []))
          .filter((line) => line.location === value.evidence)
          .map((line) => line.text) ?? [];
      facts.push({
        id: `${row.field}_${side}`,
        label: `${FIELD_LABELS[row.field]} · ${side.toUpperCase()}`,
        text: JSON.stringify({
          saved_value: value.raw,
          normalized: value.normalized,
          method: value.method,
          issue: value.issue ?? value.extraction_issue ?? null,
          original_excerpts: excerpt,
          provenance: doc?.transcription
            ? "Human-confirmed scan transcription, not an original text quotation. The scanned image is not sent to AI; inspect the original page and audit trail."
            : excerpt.length
              ? "Saved value plus selected extracted source lines; human values may differ. Inspect the original."
              : "Saved extraction only; original source excerpt not included. Do not call this a verified quotation.",
        }),
        ...(doc
          ? { source: { name: doc.name, location: value.evidence } }
          : {}),
      });
    }
  }
  if (new Set(facts.map((f) => f.id)).size !== facts.length)
    throw new HttpError(
      "The saved comparison contains duplicate fields. Reprocess before asking AI.",
      409,
    );
  const serialized = JSON.stringify(facts);
  if (
    new TextEncoder().encode(serialized).byteLength >
    ASSISTANT_LIMITS.inputBytes
  )
    throw new HttpError(
      "This case is too large for the bounded AI preview. Nothing was sent; use the Resolution and Documents tabs.",
      413,
    );
  return { hash: await recoveryHash(serialized), facts };
}
export function validateAssistantAnswer(
  output: unknown,
  facts: AssistantFact[],
): AssistantAnswer {
  const answer = answerSchema.parse(output),
    ids = new Set(facts.map((f) => f.id));
  for (const block of answer.blocks) {
    if (
      block.citations.some((id) => !ids.has(id)) ||
      new Set(block.citations).size !== block.citations.length ||
      (answer.scope === "case" && !block.citations.length)
    )
      throw new Error("Unrecognized or absent evidence reference");
  }
  return answer;
}
export function assistantPacket(
  context: AssistantContext,
  question: string,
  history: AssistantTurn[],
) {
  const packet = {
    facts: context.facts.map(({ id, label, text }) => ({ id, label, text })),
    previous_turns: history,
    question,
  };
  if (
    new TextEncoder().encode(JSON.stringify(packet)).byteLength >
    ASSISTANT_LIMITS.inputBytes
  )
    throw new HttpError(
      "The conversation exceeds the AI preview limit. Start a new conversation or use the Resolution tab.",
      413,
    );
  return packet;
}
