import {
  authenticatedActor,
  errorSession,
  requireCapability,
} from "@/lib/auth";
import { z } from "zod";
import { followUpInput, followUpBrief } from "@/lib/follow-up";
import { listFollowUps, saveFollowUp } from "@/lib/follow-up-storage";
import { listCaseSummaries, requireMutation, respond } from "@/lib/storage";
import { HttpError, readJson } from "@/lib/http";

export async function GET(request: Request) {
  let s = errorSession(request);
  try {
    s = await requireCapability(request, "read");
    const followups = await listFollowUps(s.id);
    const now = new Date().toISOString();
    if (new URL(request.url).searchParams.get("export") === "1") {
      return new Response(
        followUpBrief(followups, await listCaseSummaries(s.id), now),
        {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition":
              "attachment; filename=cargoguard-follow-up-handover.txt",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    return respond({ followups, loaded_at: now }, s);
  } catch (error) {
    if (error instanceof HttpError)
      return respond({ error: error.message }, s, error.status);
    return respond(
      { error: "Unable to load follow-ups. Refresh to retry." },
      s,
      503,
    );
  }
}

export async function POST(request: Request) {
  let s = errorSession(request);
  try {
    s = await requireCapability(request, "operate");
    requireMutation(request);
    const input = followUpInput.parse(await readJson(request));
    if (input.state === "completed") await requireCapability(request, "review");
    input.actor = authenticatedActor(request, input.actor);
    return respond({ followup: await saveFollowUp(s.id, input) }, s);
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Check the owner, recorder, note, deadline and version fields."
              : "Unable to save the follow-up. Refresh before retrying.",
      },
      s,
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 503,
    );
  }
}
