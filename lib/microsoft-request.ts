import {
  errorSession,
  requireCapability,
  teamMode,
  tokenFromRequest,
  type Capability,
} from "./auth";
import { HttpError } from "./http";
import { requireMutation, respond, storage } from "./storage";
import { requireMicrosoftConfig } from "./microsoft";
import type { MicrosoftContext } from "./microsoft-storage";
import { z } from "zod";

export async function microsoftRequest(
  request: Request,
  capability: Capability,
  mutate = false,
): Promise<MicrosoftContext> {
  const session = await requireCapability(request, capability);
  if (!teamMode() || !session.user)
    throw new HttpError(
      "Microsoft integration requires authenticated team mode. Anonymous demo workspaces cannot connect mailboxes.",
      403,
    );
  if (mutate) requireMutation(request);
  const token = tokenFromRequest(request);
  if (!token) throw new HttpError("Sign in before connecting Microsoft.", 401);
  return {
    workspace: session.id,
    user: session.user,
    sessionToken: token,
    config: requireMicrosoftConfig(),
    db: storage().DB,
  };
}
export function microsoftError(request: Request, error: unknown) {
  return respond(
    {
      error:
        error instanceof HttpError
          ? error.message
          : error instanceof z.ZodError
            ? "Check the correspondence fields and current source versions."
            : "Microsoft integration could not complete this request. Refresh status before retrying.",
    },
    errorSession(request),
    error instanceof HttpError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 503,
  );
}
