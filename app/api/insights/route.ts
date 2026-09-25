import { z } from "zod";
import { errorSession, requireCapability } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { automaticBaselines, listCases, respond } from "@/lib/storage";
import { listShipments } from "@/lib/shipment-storage";
import {
  generalDigest,
  historicalConsigneeAdvisories,
  insightFilters,
  interpretInboxQuestion,
  operationalAnalytics,
  searchOperationalCases,
} from "@/lib/operational-insights";
export async function GET(request: Request) {
  let session = errorSession(request);
  try {
    session = await requireCapability(request, "read");
    const params = new URL(request.url).searchParams;
    for (const key of params.keys())
      if (
        !["q", "status", "category", "port", "customer", "carrier"].includes(
          key,
        ) ||
        params.getAll(key).length !== 1
      )
        throw new HttpError("Unknown or repeated insight filter.");
    const question = z
      .string()
      .trim()
      .max(300)
      .parse(params.get("q") ?? "");
    const interpreted = question ? interpretInboxQuestion(question) : null;
    const filters =
      interpreted?.filters ?? insightFilters.parse(Object.fromEntries(params));
    const [cases, baselines, shipments] = await Promise.all([
      listCases(session.id),
      automaticBaselines(session.id),
      listShipments(session.id),
    ]);
    const now = new Date();
    return respond(
      {
        as_of: now.toISOString(),
        filters,
        question: interpreted,
        search:
          interpreted && !interpreted.supported
            ? { total: 0, results: [], limit: 100 }
            : searchOperationalCases(cases, shipments, filters, now),
        analytics: operationalAnalytics(cases, baselines, shipments),
        digest: generalDigest(cases, shipments, now),
        historical_advisories: historicalConsigneeAdvisories(cases, shipments),
        scope:
          "Saved cases and explicitly linked shipment cards in this workspace. Unprocessed inbox items are excluded. Analytics and digest describe the whole workspace; search filters apply only to case search.",
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
              ? "Check the insight filters and question length."
              : "Insights are temporarily unavailable. Retry shortly.",
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
