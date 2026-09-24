import { z } from "zod";
import { errorSession, requireCapability } from "@/lib/auth";
import { HttpError, readJson } from "@/lib/http";
import { askCopilotAi } from "@/lib/copilot-ai";
import { listFollowUps } from "@/lib/follow-up-storage";
import { planFor } from "@/lib/priority";
import { replyAiConfig } from "@/lib/reply-ai";
import { listCaseSummaries, requireMutation, respond } from "@/lib/storage";

const windowMs = 60 * 60 * 1000;
const recent = new Map<string, number[]>();
/** Small per-workspace hourly allowance so a stuck button cannot run up costs. */
function allow(workspace: string, limit = 40) {
  const now = Date.now();
  const list = (recent.get(workspace) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) return false;
  list.push(now);
  recent.set(workspace, list);
  if (recent.size > 5000) recent.clear();
  return true;
}

export async function GET(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "read");
    const config = replyAiConfig();
    return respond(
      { available: config.available, label: config.label },
      session,
    );
  } catch (error) {
    return respond(
      { error: error instanceof HttpError ? error.message : "Unavailable." },
      session,
      error instanceof HttpError ? error.status : 503,
    );
  }
}

export async function POST(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "operate");
    requireMutation(request);
    const input = z
      .object({
        question: z.string().trim().min(2).max(800),
        consent: z.literal(true),
      })
      .strict()
      .parse(await readJson(request, 16 * 1024));
    if (!allow(session.id))
      throw new HttpError(
        "AI answers are limited to 40 per hour. The instant answers still work.",
        429,
      );
    const [cases, followups] = await Promise.all([
      listCaseSummaries(session.id),
      listFollowUps(session.id),
    ]);
    const byId = new Map(followups.map((item) => [item.email_id, item]));
    const now = Date.now();
    const rows = cases.map((row) => ({
      row,
      plan: planFor(row, byId.get(row.email.email_id), now),
    }));
    return respond(
      await askCopilotAi(input.question, rows, new Date(now)),
      session,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Type a question first."
              : "AI answers are unavailable right now.",
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
