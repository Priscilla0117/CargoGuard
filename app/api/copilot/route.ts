import { errorSession, requireCapability } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { replyAiConfig } from "@/lib/reply-ai";
import { questionPlanAvailable } from "@/lib/question-plan-ai";
import { respond } from "@/lib/storage";

/**
 * Tells Ask CargoGuard whether AI question reading is switched on. Ask
 * CargoGuard never sends emails, subjects, senders or statuses to an AI
 * model; only a typed question can go out, through /api/copilot/understand.
 */
export async function GET(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "read");
    return respond(
      { label: replyAiConfig().label, understand: questionPlanAvailable() },
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
