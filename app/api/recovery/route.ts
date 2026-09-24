import {
  authenticatedActor,
  errorSession,
  requireCapability,
} from "@/lib/auth";
import { z } from "zod";
import { FIELDS } from "@/lib/types";
import { HttpError, readJson } from "@/lib/http";
import {
  requireMutation,
  respond,
  getCase,
  storage,
  saveCase,
  audit,
} from "@/lib/storage";
import {
  RECOVERY_LIMITS,
  RECOVERY_PROMPT_VERSION,
  requireRecoverable,
  sourceTextHash,
  recoveryHash,
  type RecoveryProposal,
} from "@/lib/recovery-schema";
import {
  recoveryConfig,
  reservedRecoveryTokens,
  callRecoveryProvider,
} from "@/lib/recovery-provider";
import {
  cachedRecovery,
  getRecoveryProposal,
  reserveRecoveryAttempt,
  finishRecoveryAttempt,
  persistRecoveryProposal,
} from "@/lib/recovery-storage";
import { applyRecovery } from "@/lib/recovery";
import { requireCurrentEngine } from "@/lib/review-guard";

const common = {
  id: z.string().min(1).max(80),
  version: z.number().int().positive().safe(),
  name: z.string().min(1).max(180),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
};
const inputSchema = z.discriminatedUnion("action", [
  z
    .object({
      ...common,
      action: z.literal("suggest"),
      externalProcessingConfirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      ...common,
      action: z.literal("confirm"),
      proposalId: z.string().uuid(),
      role: z.enum(["SI", "BL"]),
      confirmed: z
        .object(
          Object.fromEntries(
            FIELDS.map((field) => [field, z.literal(true)]),
          ) as Record<(typeof FIELDS)[number], z.ZodLiteral<true>>,
        )
        .strict(),
      actor: z.string().trim().min(2).max(80),
      reason: z.string().trim().min(5).max(2000),
    })
    .strict(),
]);
export async function GET(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "read");
    return respond(
      {
        ...recoveryConfig(),
        notice:
          "Optional external AI proposes exact source quotations only. Nothing changes until all seven fields and the document role are confirmed by a human. Never send confidential shipping data.",
      },
      session,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "Recovery settings are unavailable.",
      },
      session,
      error instanceof HttpError ? error.status : 503,
    );
  }
}
export async function POST(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "review");
    requireMutation(request);
    const input = inputSchema.parse(await readJson(request));
    if (input.action === "confirm")
      input.actor = authenticatedActor(request, input.actor);
    const config = recoveryConfig();
    if (input.action === "suggest" && !config.enabled)
      throw new HttpError(
        "AI evidence recovery is not enabled. Deterministic checks and manual review remain available.",
        503,
      );
    const previous = await getCase(session.id, input.id);
    if (!previous)
      throw new HttpError("Case not found in this workspace.", 404);
    if (previous.version !== input.version)
      throw new HttpError(
        "Case changed. Reload it before recovering evidence.",
        409,
      );
    requireCurrentEngine(previous);
    const doc = previous.documents.find(
      (d) => d.name === input.name && d.sha256 === input.sha256,
    );
    if (!doc)
      throw new HttpError(
        "Document fingerprint changed. Reload this case.",
        409,
      );
    requireRecoverable(doc);
    const db = storage().DB;
    if (input.action === "confirm") {
      const proposal = await getRecoveryProposal(
        db,
        session.id,
        input.proposalId,
      );
      if (
        proposal.case_id !== input.id ||
        proposal.version !== input.version ||
        proposal.name !== input.name ||
        proposal.sha256 !== input.sha256
      )
        throw new HttpError(
          "Proposal does not match this case revision and source.",
          409,
        );
      const result = await applyRecovery(previous, proposal, {
        role: input.role,
        actor: input.actor,
        reason: input.reason,
      });
      const saved = await saveCase(
        session.id,
        result,
        input.version,
        "EVIDENCE_RECOVERY_CONFIRMED",
        input.actor,
        JSON.stringify({
          proposalId: proposal.id,
          document: proposal.name,
          sha256: proposal.sha256,
          provider: proposal.provider,
          model: proposal.model,
          promptVersion: proposal.prompt_version,
          sourceTextSha256: proposal.text_sha256,
          role: input.role,
          reason: input.reason,
          fields: proposal.fields,
        }),
      );
      return respond(
        { result: saved, audit: await audit(session.id, input.id) },
        session,
      );
    }
    const textHash = await sourceTextHash(doc);
    const cacheKey = await recoveryHash(
      JSON.stringify({
        workspace: session.id,
        id: input.id,
        version: input.version,
        name: input.name,
        sha256: input.sha256,
        textHash,
        provider: config.provider,
        model: config.model,
        prompt: RECOVERY_PROMPT_VERSION,
      }),
    );
    const cached = await cachedRecovery(db, session.id, cacheKey);
    if (cached) return respond({ proposal: cached, cached: true }, session);
    const attempt = await reserveRecoveryAttempt(
      db,
      session.id,
      cacheKey,
      reservedRecoveryTokens(doc),
    );
    try {
      const selected = await callRecoveryProvider(doc);
      const now = new Date();
      const proposal: RecoveryProposal = {
        id: crypto.randomUUID(),
        case_id: input.id,
        version: input.version,
        name: input.name,
        sha256: input.sha256,
        text_sha256: textHash,
        provider: config.provider,
        model: config.model,
        prompt_version: RECOVERY_PROMPT_VERSION,
        created_at: now.toISOString(),
        expires_at: new Date(
          now.getTime() + RECOVERY_LIMITS.proposalMinutes * 60000,
        ).toISOString(),
        ...selected,
        warnings: [
          "AI-selected source spans are suggestions, not verified facts. Check the complete original document, field labels and units before confirming.",
          ...(FIELDS.some(
            (field) => !selected.fields[field] || selected.fields[field]!.issue,
          )
            ? [
                "One or more fields are missing or ambiguous. This proposal cannot be confirmed.",
              ]
            : []),
        ],
      };
      await persistRecoveryProposal(db, session.id, cacheKey, proposal);
      await finishRecoveryAttempt(db, attempt, "completed");
      return respond({ proposal, cached: false }, session);
    } catch (error) {
      await finishRecoveryAttempt(db, attempt, "failed").catch(() => {});
      throw error;
    }
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Check the source revision, explicit external-processing consent, and all seven confirmation boxes. No decision changed."
              : "Evidence recovery is temporarily unavailable. Refresh the case before retrying; no automatic approval is performed.",
      },
      session,
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503,
    );
  }
}
