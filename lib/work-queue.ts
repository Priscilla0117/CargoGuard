import { laneFor, type Lane } from "./operations";
import type { CaseSummary } from "./types";
import { effectiveFollowUp, followUpOverdue, type FollowUp } from "./follow-up";

export type WorkspaceView = "inbox" | "performance" | "activity" | "policies";
export const QUEUE_FILTERS = [
  ["all", "All cases"],
  ["action", "Needs action"],
  ["discrepancy", "Differences"],
  ["review", "Review"],
  ["awaiting_documents", "Missing documents"],
  ["verified", "Checked"],
] as const;
export const FOLLOW_UP_FILTERS = [
  ["overdue", "Overdue"],
  ["waiting", "Awaiting reply"],
  ["reopened", "Reopened"],
] as const;
export type FollowUpMap = Record<string, FollowUp>;

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

export function isFollowUpOverdue(
  row: CaseSummary,
  followup: FollowUp | undefined,
  now = Date.now(),
) {
  return !!followup && followUpOverdue(followup, row, now);
}

export function matchesQueue(
  row: CaseSummary,
  filter: string,
  followups: FollowUpMap = {},
  now = Date.now(),
) {
  const lane = laneFor(row);
  const followup = followups[row.email.email_id];
  const state = followup ? effectiveFollowUp(followup, row) : null;
  if (filter === "all") return true;
  if (filter === "overdue") return isFollowUpOverdue(row, followup, now);
  if (filter === "waiting" || filter === "reopened") return state === filter;
  if (filter === "action")
    return (
      rank[lane] < 4 ||
      state === "reopened" ||
      state === "open" ||
      (state === "waiting" && isFollowUpOverdue(row, followup, now))
    );
  return laneFilters[filter] === lane;
}

/** Same conservative work lanes everywhere; old results are not "Checked". */
export function workQueue(
  cases: CaseSummary[],
  filter = "all",
  category = "all",
  search = "",
  followups: FollowUpMap = {},
  now = Date.now(),
) {
  const needle = search.trim().toLowerCase();
  return cases
    .filter(
      (row) =>
        matchesQueue(row, filter, followups, now) &&
        (category === "all" || row.result?.category === category) &&
        `${row.email.email_id} ${row.email.subject} ${row.email.from} ${row.result?.defect_fields.join(" ") ?? ""} ${followups[row.email.email_id]?.owner ?? ""} ${followups[row.email.email_id]?.shipment_reference ?? ""}`
          .toLowerCase()
          .includes(needle),
    )
    .sort(
      (a, b) =>
        Number(isFollowUpOverdue(b, followups[b.email.email_id], now)) -
          Number(isFollowUpOverdue(a, followups[a.email.email_id], now)) ||
        followUpDeadline(a, followups) - followUpDeadline(b, followups) ||
        rank[laneFor(a)] - rank[laneFor(b)] ||
        a.email.email_id.localeCompare(b.email.email_id),
    );
}

function followUpDeadline(row: CaseSummary, followups: FollowUpMap) {
  const followup = followups[row.email.email_id];
  const due = followup?.due_at ? Date.parse(followup.due_at) : NaN;
  return followup &&
    effectiveFollowUp(followup, row) !== "completed" &&
    Number.isFinite(due)
    ? due
    : Number.MAX_SAFE_INTEGER;
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
      tab === "followup"
        ? "followup"
        : tab === "history"
          ? "history"
          : tab === "documents" || tab === "email"
            ? "documents"
            : "comparison",
    email: tab === "email",
    resolution: tab === "resolution",
  };
}
