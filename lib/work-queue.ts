import { laneFor, type Lane } from "./operations";
import type { CaseSummary } from "./types";
import { compareSchedule } from "./case-scheduling";

export type WorkspaceView = "inbox" | "performance" | "activity" | "policies";
export const QUEUE_FILTERS = [
  ["all", "All cases"],
  ["action", "Needs action"],
  ["discrepancy", "Differences"],
  ["review", "Review"],
  ["awaiting_documents", "Missing documents"],
  ["verified", "Checked"],
] as const;

const laneFilters: Record<string, Lane> = {
  discrepancy: "amend",
  review: "recover",
  awaiting_documents: "request",
  verified: "handoff",
  pending: "refresh",
  routed: "routed",
};
const rank: Record<Lane, number> = {
  amend: 0,
  recover: 1,
  request: 2,
  refresh: 3,
  handoff: 4,
  routed: 5,
};

export function matchesQueue(row: CaseSummary, filter: string) {
  const lane = laneFor(row);
  if (filter === "all") return true;
  if (filter === "action") return rank[lane] < 4;
  return laneFilters[filter] === lane;
}

/** Same conservative work lanes everywhere; old results are not "Checked". */
export function workQueue(
  cases: CaseSummary[],
  filter = "all",
  category = "all",
  search = "",
) {
  const needle = search.trim().toLowerCase();
  return cases
    .filter(
      (row) =>
        matchesQueue(row, filter) &&
        (category === "all" || row.result?.category === category) &&
        `${row.email.email_id} ${row.email.subject} ${row.email.from} ${row.result?.defect_fields.join(" ") ?? ""}`
          .toLowerCase()
          .includes(needle),
    )
    .sort(
      (a, b) =>
        compareSchedule(a, b) ||
        rank[laneFor(a)] - rank[laneFor(b)] ||
        a.email.email_id.localeCompare(b.email.email_id),
    );
}

/** Use the queue captured when the inspector opened: saving may remove the
 * current case from a filter, but must not skip the following case. Never wrap. */
export function nextQueueCase(
  ids: readonly string[],
  currentId: string,
  available: readonly string[],
) {
  const index = ids.indexOf(currentId);
  if (index < 0) return null;
  const allowed = new Set(available);
  return (
    ids.slice(index + 1).find((id) => id !== currentId && allowed.has(id)) ??
    null
  );
}

export function caseDestination(tab: string) {
  return {
    tab:
      tab === "history"
        ? "history"
        : tab === "documents" || tab === "email"
          ? "documents"
          : "comparison",
    email: tab === "email",
    resolution: tab === "resolution",
  };
}
