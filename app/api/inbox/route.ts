import { emails } from "@/lib/bundle";
import { listCases, respond, workspace, audit, getPolicy } from "@/lib/storage";
import { summaryOf, PIPELINE_VERSION } from "@/lib/types";
export async function GET(request: Request) {
  const s = workspace(request);
  try {
    const results = await listCases(s.id),
      byId = new Map(results.map((r) => [r.email.email_id, r]));
    const list = emails.map((email) =>
      byId.has(email.email_id)
        ? summaryOf(byId.get(email.email_id)!)
        : { email, result: null },
    );
    for (const r of results)
      if (!emails.some((e) => e.email_id === r.email.email_id))
        list.push(summaryOf(r));
    return respond(
      {
        cases: list,
        audit: await audit(s.id),
        policy: await getPolicy(s.id),
        model: {
          name: "Learned TF-IDF linear router with safety review",
          version: PIPELINE_VERSION,
          training: "64 independently authored intent examples",
          cloud: "Server-side processing + persistent workspace storage",
          dataset: "Organiser synthetic inbox",
        },
      },
      s,
    );
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
