import { z } from "zod";
import { storage } from "./storage";
import { HttpError } from "./http";
import {
  completionBlocker,
  effectiveFollowUp,
  type FollowUp,
} from "./follow-up";
import { saveFollowUp } from "./follow-up-storage";
import { checkDocumentIntegrity } from "./integrity-checks";
import type { CaseResult, Field } from "./types";

export const batchReviewInput = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string().min(1).max(80),
            case_version: z.number().int().positive().safe(),
            follow_up_version: z.number().int().nonnegative().safe(),
          })
          .strict(),
      )
      .min(1)
      .max(25)
      .refine(
        (items) => new Set(items.map((item) => item.id)).size === items.length,
        "Select each case only once.",
      ),
    actor: z.string().trim().min(2).max(80),
    note: z.string().trim().min(10).max(1500),
    confirmed_document_check_only: z.literal(true),
  })
  .strict();
export interface BatchCandidate {
  id: string;
  case_version: number;
  follow_up_version: number;
  subject: string;
  owner: string;
  not_checked: number;
  values: { field: Field; si: string; bl: string }[];
}
export interface BatchOutcome {
  id: string;
  status: "completed" | "already_completed" | "conflict" | "blocked" | "failed";
  message: string;
}
export function batchReviewBlocker(result: CaseResult): string | null {
  const blocked = completionBlocker(result);
  if (blocked) return blocked;
  if (
    result.reviewed ||
    result.source_replaced ||
    result.category_override ||
    result.document_selection ||
    result.documents.some(
      (doc) => doc.transcription || doc.recovery || doc.label_rules,
    ) ||
    result.comparison.some((row) =>
      [row.si, row.bl].some((value) =>
        /human|approved label rule/i.test(value.method),
      ),
    )
  )
    return "Human-reviewed, recovered, selected-source or rule-assisted evidence requires individual completion.";
  if (checkDocumentIntegrity(result).requires_attention)
    return "An independent document integrity finding needs individual review.";
  return null;
}
async function getSource(ws: string, id: string, db: D1Database) {
  const row = await db
    .prepare(
      "SELECT payload,version FROM cases WHERE workspace=? AND email_id=?",
    )
    .bind(ws, id)
    .first<{ payload: string; version: number }>();
  return row
    ? ({ ...JSON.parse(row.payload), version: row.version } as CaseResult)
    : null;
}
async function getFollowUp(ws: string, id: string, db: D1Database) {
  const row = await db
    .prepare(
      "SELECT payload FROM case_follow_ups WHERE workspace=? AND email_id=?",
    )
    .bind(ws, id)
    .first<{ payload: string }>();
  return row ? (JSON.parse(row.payload) as FollowUp) : null;
}
export async function batchCandidates(ws: string, db = storage().DB) {
  const rows = await db
    .prepare(
      "SELECT payload,version FROM cases WHERE workspace=? ORDER BY email_id",
    )
    .bind(ws)
    .all<{ payload: string; version: number }>();
  const followRows = await db
    .prepare("SELECT payload FROM case_follow_ups WHERE workspace=?")
    .bind(ws)
    .all<{ payload: string }>();
  const followups = new Map(
    followRows.results.map((row) => {
      const f = JSON.parse(row.payload) as FollowUp;
      return [f.email_id, f];
    }),
  );
  const candidates: BatchCandidate[] = [];
  for (const row of rows.results) {
    const source = {
      ...JSON.parse(row.payload),
      version: row.version,
    } as CaseResult;
    if (batchReviewBlocker(source)) continue;
    const f = followups.get(source.email.email_id);
    if (f && effectiveFollowUp(f, source) === "completed") continue;
    candidates.push({
      id: source.email.email_id,
      case_version: source.version,
      follow_up_version: f?.version ?? 0,
      subject: source.email.subject,
      owner: f?.owner ?? "",
      not_checked: checkDocumentIntegrity(source).counts.not_checked,
      values: source.comparison.map((row) => ({
        field: row.field,
        si: row.si.raw,
        bl: row.bl.raw,
      })),
    });
  }
  return candidates;
}
/** Independent per-case commits: partial success is explicit, never retried silently. */
export async function completeBatch(
  ws: string,
  request: z.infer<typeof batchReviewInput>,
  db = storage().DB,
): Promise<BatchOutcome[]> {
  const input = batchReviewInput.parse(request);
  const outcomes: BatchOutcome[] = [];
  for (const item of input.items) {
    try {
      const source = await getSource(ws, item.id, db);
      if (!source)
        throw new HttpError("Case not found in this workspace.", 404);
      if (source.version !== item.case_version)
        throw new HttpError(
          "The case changed. Refresh and inspect the current revision.",
          409,
        );
      const blocker = batchReviewBlocker(source);
      if (blocker) {
        outcomes.push({ id: item.id, status: "blocked", message: blocker });
        continue;
      }
      const prior = await getFollowUp(ws, item.id, db);
      if (prior && effectiveFollowUp(prior, source) === "completed") {
        outcomes.push({
          id: item.id,
          status: "already_completed",
          message:
            "Document check already completed for this revision; no new decision was written.",
        });
        continue;
      }
      if ((prior?.version ?? 0) !== item.follow_up_version)
        throw new HttpError(
          "The follow-up changed. Refresh before completing it.",
          409,
        );
      await saveFollowUp(
        ws,
        {
          id: item.id,
          case_version: item.case_version,
          version: item.follow_up_version,
          owner: prior?.owner || input.actor,
          shipment_reference: prior?.shipment_reference ?? "",
          due_at: prior?.due_at ?? null,
          state: "completed",
          actor: input.actor,
          note: `Batch document-check sign-off only; not cargo release or compliance clearance. ${input.note}`,
        },
        db,
      );
      outcomes.push({
        id: item.id,
        status: "completed",
        message:
          "Document-check follow-up completed with revision-bound audit evidence.",
      });
    } catch (error) {
      outcomes.push({
        id: item.id,
        status:
          error instanceof HttpError && error.status === 409
            ? "conflict"
            : error instanceof HttpError
              ? "blocked"
              : "failed",
        message:
          error instanceof HttpError
            ? error.message
            : "Could not save this case. Refresh saved progress before retrying.",
      });
    }
  }
  return outcomes;
}
