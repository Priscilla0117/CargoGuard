import { z } from "zod";
import {
  authenticatedActor,
  errorSession,
  requireCapability,
} from "@/lib/auth";
import { readJson, HttpError } from "@/lib/http";
import { requireMutation, respond } from "@/lib/storage";
import { labelRequest } from "@/lib/label-rules";
import {
  decideLabelRule,
  getRulePreview,
  labelRuleSummary,
  proposeLabelRule,
} from "@/lib/label-rule-storage";

export async function GET(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "read");
    const id = new URL(request.url).searchParams.get("preview");
    return respond(
      id
        ? {
            preview: await getRulePreview(
              session.id,
              z.string().uuid().parse(id),
            ),
          }
        : await labelRuleSummary(session.id),
      session,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Invalid rule identifier."
              : "Unable to load label rules. Refresh to retry.",
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
export async function POST(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "operate");
    requireMutation(request);
    const input = labelRequest.parse(await readJson(request));
    if (input.action !== "propose") await requireCapability(request, "review");
    input.actor = authenticatedActor(request, input.actor);
    return respond(
      {
        rule:
          input.action === "propose"
            ? await proposeLabelRule(session.id, input)
            : await decideLabelRule(session.id, input),
      },
      session,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Check the source, exact label, field and revision."
              : "Unable to save the label rule. Refresh before retrying.",
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
