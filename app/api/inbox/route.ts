import { emails } from "@/lib/bundle";
import {
  listCaseSummaries,
  respond,
  workspace,
  audit,
  getPolicy,
} from "@/lib/storage";
import { PIPELINE_VERSION, emailSummaryOf } from "@/lib/types";
import { schedulingMetadata } from "@/lib/scheduling-storage";
export async function GET(request: Request) {
  const s = workspace(request);
  try {
    const started = performance.now();
    const [results, events, policy, scheduling] = await Promise.all([
        listCaseSummaries(s.id),
        audit(s.id),
        getPolicy(s.id),
        schedulingMetadata(s.id),
      ]),
      byId = new Map(results.map((r) => [r.email.email_id, r]));
    const list = emails.map((email) =>
      byId.has(email.email_id)
        ? byId.get(email.email_id)!
        : { email: emailSummaryOf(email), result: null },
    );
    for (const r of results)
      if (!emails.some((e) => e.email_id === r.email.email_id)) list.push(r);
    const response = respond(
      {
        cases: list.map((row) => ({
          ...row,
          scheduling: scheduling[row.email.email_id],
        })),
        audit: events,
        policy,
        loaded_at: new Date().toISOString(),
        model: {
          name: "Learned TF-IDF linear router with safety review",
          version: PIPELINE_VERSION,
          training:
            "Independently authored intent examples; organiser labels are evaluation-only",
          cloud: "Server-side processing + persistent workspace storage",
          dataset: "Organiser synthetic inbox",
        },
      },
      s,
    );
    response.headers.set(
      "Server-Timing",
      `workspace;dur=${Math.round(performance.now() - started)}`,
    );
    return response;
  } catch {
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
