import { z } from "zod";
import {
  authenticatedActor,
  errorSession,
  permitted,
  requireCapability,
} from "@/lib/auth";
import { HttpError, readJson } from "@/lib/http";
import {
  listSiTemplates,
  saveSiTemplate,
  siTemplateCommand,
} from "@/lib/si-templates";
import { requireMutation, respond } from "@/lib/storage";
export async function GET(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "read");
    return respond(
      {
        templates: await listSiTemplates(session.id),
        can_approve: !session.user || permitted(session.user.role, "review"),
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
            : "Templates are temporarily unavailable.",
      },
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
    const input = siTemplateCommand.parse(await readJson(request, 3000));
    if (input.action !== "propose") await requireCapability(request, "review");
    input.actor = authenticatedActor(request, input.actor);
    return respond(
      { template: await saveSiTemplate(session.id, input) },
      session,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Check the template and source fields."
              : "Template could not be saved. Refresh before retrying.",
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
