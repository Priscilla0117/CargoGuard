import { z } from "zod";
import { HttpError, readJson } from "@/lib/http";
import {
  workspace,
  requireMutation,
  respond,
  getCase,
  storage,
} from "@/lib/storage";
import { recoveryConfig } from "@/lib/recovery-provider";
import { recoveryHash } from "@/lib/recovery-schema";
import {
  ASSISTANT_VERSION,
  ASSISTANT_LIMITS,
  assistantContext,
  assistantPacket,
  type AssistantReply,
} from "@/lib/assistant";
import {
  assistantBody,
  reservedAssistantTokens,
  callAssistantProvider,
} from "@/lib/assistant-provider";
import { assistantReply, persistAssistantReply } from "@/lib/assistant-storage";
import {
  reserveRecoveryAttempt,
  finishRecoveryAttempt,
} from "@/lib/recovery-storage";

const common = {
  id: z.string().min(1).max(80),
  version: z.number().int().positive().safe(),
  question: z.string().trim().min(3).max(ASSISTANT_LIMITS.questionCharacters),
  parentId: z.string().uuid().nullable(),
};
const inputSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("preview") }).strict(),
  z
    .object({
      ...common,
      action: z.literal("ask"),
      requestHash: z.string().regex(/^[a-f0-9]{64}$/),
      externalProcessingConfirmed: z.literal(true),
    })
    .strict(),
]);
export async function GET(request: Request) {
  return respond(
    { ...recoveryConfig(), assistantLimits: ASSISTANT_LIMITS },
    workspace(request),
  );
}
export async function POST(request: Request) {
  let session = workspace(request);
  try {
    session = requireMutation(request);
    const input = inputSchema.parse(await readJson(request, 6000));
    const config = recoveryConfig(),
      db = storage().DB;
    const current = await getCase(session.id, input.id);
    if (!current) throw new HttpError("Case not found in this workspace.", 404);
    if (current.version !== input.version)
      throw new HttpError(
        "Case changed. Reload it and start a fresh conversation.",
        409,
      );
    const context = await assistantContext(current);
    const parent = input.parentId
      ? await assistantReply(db, session.id, { id: input.parentId })
      : null;
    if (
      input.parentId &&
      (!parent ||
        parent.case_id !== input.id ||
        parent.version !== input.version ||
        parent.context_hash !== context.hash ||
        parent.prompt_version !== ASSISTANT_VERSION)
    )
      throw new HttpError(
        "Conversation expired or belongs to another case revision. Start a new conversation.",
        409,
      );
    const history = parent?.turns ?? [];
    if (history.length >= ASSISTANT_LIMITS.turns)
      throw new HttpError(
        "This conversation reached its three-turn limit. Start a new conversation; shared AI limits still apply.",
        409,
      );
    const packet = assistantPacket(context, input.question, history);
    const requestHash = await recoveryHash(
      JSON.stringify({
        workspace: session.id,
        id: input.id,
        version: input.version,
        context: context.hash,
        question: input.question,
        parentId: input.parentId,
        model: config.model,
        prompt: ASSISTANT_VERSION,
      }),
    );
    if (input.action === "preview")
      return respond(
        {
          requestHash,
          packet,
          facts: context.facts,
          enabled: config.enabled,
          model: config.model,
        },
        session,
      );
    if (input.requestHash !== requestHash)
      throw new HttpError(
        "The question or evidence changed. Review a fresh preview before consenting.",
        409,
      );
    if (!config.enabled)
      throw new HttpError(
        "AI chat is unavailable. Resolution remains available without AI.",
        503,
      );
    const cached = await assistantReply(db, session.id, { key: requestHash });
    if (cached)
      return respond(
        { reply: cached, facts: context.facts, cached: true },
        session,
      );
    const attempt = await reserveRecoveryAttempt(
      db,
      session.id,
      requestHash,
      reservedAssistantTokens(
        assistantBody(context, input.question, history, config.model),
      ),
    );
    try {
      const generated = await callAssistantProvider(
        context,
        input.question,
        history,
      );
      const fresh = await getCase(session.id, input.id);
      if (
        !fresh ||
        fresh.version !== input.version ||
        (await assistantContext(fresh)).hash !== context.hash
      )
        throw new HttpError(
          "The case changed while AI was answering. The answer was discarded; reload the case. This request still counts toward the limit.",
          409,
        );
      const now = new Date();
      const reply: AssistantReply = {
        id: crypto.randomUUID(),
        case_id: input.id,
        version: input.version,
        context_hash: context.hash,
        prompt_version: ASSISTANT_VERSION,
        created_at: now.toISOString(),
        expires_at: new Date(
          now.getTime() + ASSISTANT_LIMITS.minutes * 60000,
        ).toISOString(),
        turns: [
          ...history,
          { question: input.question, answer: generated.answer },
        ],
        model: generated.model,
        latency_ms: generated.latency_ms,
      };
      await persistAssistantReply(db, session.id, requestHash, reply);
      await finishRecoveryAttempt(db, attempt, "completed");
      return respond({ reply, facts: context.facts, cached: false }, session);
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
              ? "Check the question, case revision and explicit consent. Nothing was sent without valid consent."
              : "AI chat is temporarily unavailable. Use Resolution; no case decision was changed.",
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
