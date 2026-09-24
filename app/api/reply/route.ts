import { z } from "zod";
import { errorSession, requireCapability } from "@/lib/auth";
import { HttpError, readJson } from "@/lib/http";
import { polishReply, replyAiConfig } from "@/lib/reply-ai";
import { getCase, requireMutation, respond } from "@/lib/storage";

const windowMs = 60 * 60 * 1000;
const recent = new Map<string, number[]>();
/** Small per-workspace hourly allowance so a stuck button cannot run up costs. */
function allow(workspace: string, limit = 30) {
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
        case_id: z.string().min(1).max(120),
        version: z.number().int().positive(),
        tone: z.enum(["formal", "friendly", "short"]),
        body: z.string().trim().min(1).max(12000),
        consent: z.literal(true),
      })
      .strict()
      .parse(await readJson(request, 64 * 1024));
    const saved = await getCase(session.id, input.case_id);
    if (!saved) throw new HttpError("This case is no longer available.", 404);
    if (!allow(session.id))
      throw new HttpError(
        "AI wording help is limited to 30 uses per hour. Try again later.",
        429,
      );
    return respond(
      { body: await polishReply(input.body, input.tone) },
      session,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Write a reply first, then ask for wording help."
              : "AI wording help is unavailable. Your draft is unchanged.",
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
