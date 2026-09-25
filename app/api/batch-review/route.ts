import { z } from "zod";
import {
  authenticatedActor,
  errorSession,
  permitted,
  requireCapability,
} from "@/lib/auth";
import { HttpError, readJson } from "@/lib/http";
import { respond, requireMutation } from "@/lib/storage";
import {
  batchCandidates,
  batchReviewInput,
  completeBatch,
} from "@/lib/batch-review";

export async function GET(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "read");
    return respond(
      {
        candidates: await batchCandidates(session.id),
        can_complete: !session.user || permitted(session.user.role, "review"),
        actor: authenticatedActor(request, "Demo reviewer"),
      },
      session,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "Unable to load batch candidates. Refresh to retry.",
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
    const input = batchReviewInput.parse(await readJson(request));
    input.actor = authenticatedActor(request, input.actor);
    return respond(
      { outcomes: await completeBatch(session.id, input) },
      session,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Select 1–25 distinct current cases and confirm the document-check scope with a note."
              : "Unable to complete the batch. Refresh saved progress before retrying.",
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
