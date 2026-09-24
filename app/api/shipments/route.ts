import { z } from "zod";
import {
  errorSession,
  requireCapability,
  authenticatedActor,
} from "@/lib/auth";
import {
  requireMutation,
  respond,
  getCase,
  getCases,
  storage,
} from "@/lib/storage";
import { HttpError, readJson } from "@/lib/http";
import {
  shipmentCommand,
  referenceCandidates,
  deadlineCandidates,
  nextDeadline,
  shipmentStatus,
} from "@/lib/shipments";
import {
  getShipment,
  listShipments,
  saveShipment,
  shipmentHistory,
} from "@/lib/shipment-storage";
import type { CaseResult } from "@/lib/types";

export async function GET(request: Request) {
  let s = errorSession(request);
  try {
    s = await requireCapability(request, "read");
    const query = new URL(request.url).searchParams,
      id = query.get("id"),
      candidate = query.get("candidate");
    if (candidate) {
      const result = await getCase(s.id, candidate);
      if (!result)
        throw new HttpError("Process this case before linking it.", 404);
      return respond(
        {
          result,
          references: referenceCandidates(result.email),
          deadlines: deadlineCandidates(result.email),
        },
        s,
      );
    }
    if (id) {
      const shipment = await getShipment(s.id, id);
      if (!shipment) throw new HttpError("Shipment not found.", 404);
      return respond(
        {
          shipment,
          cases: await getCases(s.id, shipment.case_ids),
          history: await shipmentHistory(s.id, id),
        },
        s,
      );
    }
    const shipments = await listShipments(s.id),
      ids = [...new Set(shipments.flatMap((v) => v.case_ids))],
      cases: CaseResult[] = [];
    for (let i = 0; i < ids.length; i += 100)
      cases.push(...(await getCases(s.id, ids.slice(i, i + 100))));
    return respond(
      {
        shipments: shipments.map((shipment) => ({
          ...shipment,
          effective_state: shipmentStatus(shipment, cases),
          next_deadline: nextDeadline(shipment, cases),
        })),
        loaded_at: new Date().toISOString(),
        identity: s.user ?? null,
      },
      s,
    );
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "Unable to load shipments. Retry shortly.",
      },
      s,
      error instanceof HttpError ? error.status : 503,
    );
  }
}
export async function POST(request: Request) {
  let s = errorSession(request);
  try {
    s = await requireCapability(request, "operate");
    requireMutation(request);
    const input = shipmentCommand.parse(await readJson(request, 24000));
    if (
      [
        "decide_amendment",
        "withdraw_amendment",
        "complete",
        "select_comparison",
      ].includes(input.action)
    )
      s = await requireCapability(request, "review");
    input.actor = authenticatedActor(request, input.actor);
    if (input.action === "assign" && s.user) {
      if (input.claim) {
        input.owner_id = s.user.id;
        input.owner = s.user.display_name;
      } else {
        s = await requireCapability(request, "review");
        const member = await storage()
          .DB.prepare(
            "SELECT u.display_name FROM team_users u JOIN team_memberships m ON m.user_id=u.id WHERE m.workspace=? AND m.user_id=? AND m.active=1",
          )
          .bind(s.id, input.owner_id)
          .first<{ display_name: string }>();
        if (!member)
          throw new HttpError("Select an active member of this team.", 400);
        input.owner = member.display_name;
      }
    }
    return respond({ shipment: await saveShipment(s.id, input) }, s);
  } catch (error) {
    return respond(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof z.ZodError
              ? "Check the required fields and source evidence."
              : "Unable to save shipment. Refresh before retrying.",
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
