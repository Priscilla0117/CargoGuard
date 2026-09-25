import { HttpError } from "@/lib/http";
import { errorSession, requireCapability } from "@/lib/auth";
import { emails } from "@/lib/bundle";
import { workspaceConfiguration } from "@/lib/workspace-mode";
import {
  listCaseSummaries,
  respond,
  audit,
  getPolicy,
  getCases,
} from "@/lib/storage";
import { PIPELINE_VERSION, emailSummaryOf, type CaseResult } from "@/lib/types";
import { listShipments } from "@/lib/shipment-storage";
import { shipmentWorkContexts } from "@/lib/conversation";
export async function GET(request: Request) {
  let s = errorSession(request);
  try {
    s = await requireCapability(request, "read");
    const workspace = workspaceConfiguration();
    const initialEmails = workspace.sample_data ? emails : [];
    const started = performance.now();
    const [results, events, policy] = await Promise.all([
        listCaseSummaries(s.id),
        audit(s.id),
        getPolicy(s.id),
      ]),
      byId = new Map(results.map((r) => [r.email.email_id, r]));
    const list = initialEmails.map((email) =>
      byId.has(email.email_id)
        ? byId.get(email.email_id)!
        : { email: emailSummaryOf(email), result: null },
    );
    for (const r of results)
      if (!initialEmails.some((e) => e.email_id === r.email.email_id))
        list.push(r);
    const shipments = await listShipments(s.id);
    const linkedIds = [
      ...new Set(shipments.flatMap((shipment) => shipment.case_ids)),
    ];
    const linkedCases: CaseResult[] = [];
    for (let index = 0; index < linkedIds.length; index += 100)
      linkedCases.push(
        ...(await getCases(s.id, linkedIds.slice(index, index + 100))),
      );
    const response = respond(
      {
        cases: list,
        shipment_contexts: Object.fromEntries(
          shipmentWorkContexts(shipments, linkedCases),
        ),
        workspace,
        audit: events,
        policy,
        loaded_at: new Date().toISOString(),
        model: {
          name: "Learned TF-IDF linear router with safety review",
          version: PIPELINE_VERSION,
          training:
            "Independently authored intent examples; organiser labels are evaluation-only",
          cloud: "Server-side processing + persistent workspace storage",
          dataset: workspace.sample_data
            ? "Organiser synthetic inbox and imported records"
            : "Imported workspace records",
        },
      },
      s,
    );
    response.headers.set(
      "Server-Timing",
      `workspace;dur=${Math.round(performance.now() - started)}`,
    );
    return response;
  } catch (error) {
    if (error instanceof HttpError)
      return respond({ error: error.message }, s, error.status);
    return respond(
      {
        error:
          "Unable to load workspace. Check storage availability and retry.",
      },
      s,
      503,
    );
  }
}
