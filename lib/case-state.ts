import type { CaseSummary } from "./types";

/** Delayed reads/batches must not roll back a newer saved revision in the inbox. */
export function mergeCaseSummaries(current: CaseSummary[], incoming: CaseSummary[]) {
  const latest = new Map(current.map((row) => [row.email.email_id, row]));
  for (const row of incoming) {
    const previous = latest.get(row.email.email_id);
    if (!previous || (row.result?.version ?? 0) >= (previous.result?.version ?? 0)) {
      latest.set(row.email.email_id, row);
    }
  }
  return [...latest.values()];
}
