import { z } from "zod";
import { emails } from "@/lib/bundle";
import { workspace, respond, requireMutation, getCase } from "@/lib/storage";
import { schedulingMetadata, saveScheduling } from "@/lib/scheduling-storage";
import { HttpError, readJson } from "@/lib/http";

export async function GET(request: Request) {
  const s = workspace(request);
  try {
    return respond({ metadata: await schedulingMetadata(s.id) }, s);
  } catch {
    return respond({ error: "Scheduling is temporarily unavailable." }, s, 503);
  }
}
const instant = z.string().datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), "Use a valid timezone offset.")
  .transform((value) => new Date(value).toISOString()).nullable();
const schema = z
  .object({
    id: z.string().min(1).max(80),
    version: z.number().int().min(0),
    due_at: instant,
    follow_up_at: instant,
    priority: z.enum(["normal", "high", "urgent"]),
    actor: z.string().trim().min(2).max(80),
  })
  .strict();
export async function POST(request: Request) {
  let s = workspace(request);
  try {
    s = requireMutation(request);
    const { id, actor, ...data } = schema.parse(await readJson(request));
    if (!emails.some((e) => e.email_id === id) && !(await getCase(s.id, id)))
      throw new HttpError("Case not found.", 404);
    return respond(
      { scheduling: await saveScheduling(s.id, id, data, actor) },
      s,
    );
  } catch (e) {
    return respond(
      {
        error:
          e instanceof HttpError
            ? e.message
            : e instanceof z.ZodError
              ? "Complete the priority and valid dates."
              : "Unable to save schedule.",
      },
      s,
      e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 503,
    );
  }
}
