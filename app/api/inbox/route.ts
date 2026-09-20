import { emails } from "@/lib/bundle";
import { listCases, respond, workspace, audit } from "@/lib/storage";
import { summaryOf } from "@/lib/types";
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
        model: {
          name: "Naive Bayes + intent rules",
          version: "1.0",
          training: "64 independently authored intent examples",
          cloud: "Cloudflare Workers + D1 + R2",
          dataset: "Organiser synthetic inbox",
        },
      },
      s,
    );
  } catch (e) {
    return respond(
      { error: e instanceof Error ? e.message : "Unable to load workspace." },
      s,
      503,
    );
  }
}
