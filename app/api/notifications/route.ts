import { z } from "zod";
import {
  errorSession,
  requireCapability,
  authenticatedActor,
} from "@/lib/auth";
import { getCases, requireMutation, respond } from "@/lib/storage";
import { HttpError, readJson } from "@/lib/http";
import { listShipments } from "@/lib/shipment-storage";
import {
  acknowledgeNotification,
  listNotifications,
  refreshNotifications,
} from "@/lib/operational-notifications";
import type { CaseResult } from "@/lib/types";
async function snapshot(ws: string) {
  const shipments = await listShipments(ws),
    ids = [...new Set(shipments.flatMap((s) => s.case_ids))],
    cases: CaseResult[] = [];
  for (let i = 0; i < ids.length; i += 100)
    cases.push(...(await getCases(ws, ids.slice(i, i + 100))));
  return { shipments, cases };
}
export async function GET(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "read");
    const { shipments, cases } = await snapshot(session.id);
    return respond(
      { notifications: await listNotifications(session.id, shipments, cases) },
      session,
    );
  } catch (e) {
    return respond(
      {
        error:
          e instanceof HttpError ? e.message : "Reminders could not be loaded.",
      },
      session,
      e instanceof HttpError ? e.status : 503,
    );
  }
}
export async function POST(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "operate");
    requireMutation(request);
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("refresh") }).strict(),
        z
          .object({
            action: z.literal("acknowledge"),
            id: z.string().min(1).max(250),
          })
          .strict(),
      ])
      .parse(await readJson(request, 1000));
    if (input.action === "acknowledge")
      await acknowledgeNotification(
        session.id,
        input.id,
        authenticatedActor(request, "Demo operator"),
      );
    const { shipments, cases } = await snapshot(session.id);
    return respond(
      {
        notifications: await refreshNotifications(session.id, shipments, cases),
      },
      session,
    );
  } catch (e) {
    return respond(
      {
        error:
          e instanceof HttpError
            ? e.message
            : e instanceof z.ZodError
              ? "Invalid reminder action."
              : "Reminder update failed. Refresh before retrying.",
      },
      session,
      e instanceof HttpError ? e.status : e instanceof z.ZodError ? 400 : 503,
    );
  }
}
