import { z } from "zod";
import {
  authenticatedActor,
  errorSession,
  requireAuthOrigin,
  requireCapability,
  teamMode,
} from "@/lib/auth";
import {
  createMember,
  listTeam,
  memberFields,
  roles,
  teamHistory,
  updateMember,
} from "@/lib/team-storage";
import { HttpError, readJson } from "@/lib/http";
import { respond } from "@/lib/storage";

const inputSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("create"), ...memberFields, role: roles })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      id: z.string().uuid(),
      version: z.number().int().positive().safe(),
      role: roles,
      active: z.boolean(),
    })
    .strict(),
]);
export async function GET(request: Request) {
  let session = errorSession(request);
  try {
    if (!teamMode())
      return respond({ mode: "demo", members: [], audit: [] }, session);
    session = await requireCapability(request, "read");
    const members = await listTeam(session.id);
    // Operators need the directory for assignment; only admins see account emails and security history.
    return respond(
      {
        mode: "team",
        members:
          session.user!.role === "admin"
            ? members
            : members.map((member) => ({
                id: member.id,
                display_name: member.display_name,
                role: member.role,
                active: member.active,
                version: member.version,
              })),
        audit:
          session.user!.role === "admin" ? await teamHistory(session.id) : [],
        actor: authenticatedActor(request),
      },
      session,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "Team is temporarily unavailable.",
      },
      session,
      error instanceof HttpError ? error.status : 503,
    );
  }
}
export async function POST(request: Request) {
  let session = errorSession(request);
  try {
    if (!teamMode())
      throw new HttpError("Team management requires team mode.", 404);
    requireAuthOrigin(request);
    session = await requireCapability(request, "admin");
    const input = inputSchema.parse(await readJson(request, 5000));
    if (input.action === "create") await createMember(session.user!, input);
    else await updateMember(session.user!, input);
    return respond(
      {
        members: await listTeam(session.id),
        audit: await teamHistory(session.id),
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
              ? "Check the member fields, role and version."
              : "Team operation failed. Reload before retrying.",
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
