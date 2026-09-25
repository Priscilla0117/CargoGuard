import { z } from "zod";
import { errorSession, requireCapability } from "@/lib/auth";
import { HttpError, readJson } from "@/lib/http";
import { sensitiveFindings, sensitiveMessage } from "@/lib/assistant-privacy";
import { planQuestion, questionPlanAvailable } from "@/lib/question-plan-ai";
import type { QuestionPlan } from "@/lib/question-plan";
import { requireMutation, respond } from "@/lib/storage";

/**
 * Reads ONE question with AI and returns a checked search plan. Only the
 * question text leaves CargoGuard: no email, subject, sender, count or date
 * is loaded or sent here, and the question is never written to the database.
 */
const windowMs = 60 * 60 * 1000;
const recent = new Map<string, number[]>();
function allow(workspace: string, limit = 60) {
  const now = Date.now();
  const list = (recent.get(workspace) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) return false;
  list.push(now);
  recent.set(workspace, list);
  if (recent.size > 5000) recent.clear();
  return true;
}
// The same question is not sent twice: a short, in-memory cache per workspace.
const cache = new Map<
  string,
  { at: number; plan: QuestionPlan; label: string }
>();
const cacheMs = 30 * 60 * 1000;
const cacheKey = (workspace: string, question: string) =>
  `${workspace}\u0000${question.toLowerCase().replace(/\s+/g, " ").trim()}`;

export async function POST(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "operate");
    requireMutation(request);
    const { question } = z
      .object({ question: z.string().trim().min(2).max(800) })
      .strict()
      .parse(await readJson(request, 4 * 1024));
    const secrets = sensitiveFindings(question);
    if (secrets.length)
      throw new HttpError(sensitiveMessage(secrets, "server"), 422);
    if (!questionPlanAvailable())
      throw new HttpError(
        "AI question reading is not set up on this server. The instant answers still work.",
        503,
      );
    const key = cacheKey(session.id, question);
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < cacheMs)
      return respond({ plan: hit.plan, label: hit.label }, session);
    if (!allow(session.id))
      throw new HttpError(
        "AI question reading is limited to 60 questions an hour. The instant answers still work.",
        429,
      );
    const result = await planQuestion(question);
    if (cache.size > 500) cache.clear();
    cache.set(key, { at: Date.now(), ...result });
    return respond(result, session);
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Type a question first."
              : "AI question reading is unavailable right now. The instant answer is shown instead.",
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
