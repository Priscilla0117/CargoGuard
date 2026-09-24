import { z } from "zod";
import { errorSession } from "./auth";
import { HttpError } from "./http";
import { respond } from "./storage";

export function mailError(request: Request, error: unknown) {
  if (!(error instanceof HttpError) && !(error instanceof z.ZodError))
    console.error(
      "CargoGuard mail operation failed",
      error instanceof Error ? error.name : "unknown",
    );
  return respond(
    {
      error:
        error instanceof HttpError
          ? error.message
          : error instanceof z.ZodError
            ? "Check the highlighted email details and try again."
            : "The mailbox request could not be completed. Try again shortly.",
    },
    errorSession(request),
    error instanceof HttpError
      ? error.status
      : error instanceof z.ZodError
        ? 400
        : 503,
  );
}
