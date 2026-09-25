import { effectiveFollowUp, type FollowUp } from "./follow-up";
import { groupThreads, type ThreadInfo } from "./mail-intel";
import { planFor, receivedTime, type Plan, type PlanContext } from "./priority";
import { byImpact } from "./field-risk";
import type { CaseSummary, Field } from "./types";

/** Conversations for the inbox. Spam never joins a conversation. */
export function threadsFor(cases: CaseSummary[]) {
  return groupThreads(
    cases.map((row) => ({
      id: row.email.email_id,
      subject: row.email.subject,
      refs: row.email.insight?.refs,
      message_id: row.email.message_id,
      in_reply_to: row.email.in_reply_to,
      references: row.email.references,
      thread_hint: row.email.thread_hint,
      excluded: row.result?.category === "SPAM",
    })),
  );
}

const headerIds = (row: CaseSummary) =>
  [row.email.message_id, row.email.in_reply_to, ...(row.email.references ?? [])]
    .filter((value): value is string => !!value)
    .map((value) => value.trim().toLowerCase());

/**
 * Proof that two emails are about the same shipment: the same order number
 * or BL/booking number, the same mail thread (reply headers or the Gmail
 * thread). A matching subject alone is only a hint — it may group emails in
 * the list but can never close or compare work.
 */
export function sameShipment(a: CaseSummary, b: CaseSummary) {
  const ra = a.email.insight?.refs;
  const rb = b.email.insight?.refs;
  const shared = (x?: string[], y?: string[]) =>
    !!x?.length && !!y?.length && x.some((value) => y.includes(value));
  if (shared(ra?.shipment, rb?.shipment) || shared(ra?.booking, rb?.booking))
    return true;
  if (a.email.thread_hint && a.email.thread_hint === b.email.thread_hint)
    return true;
  const ids = new Set(headerIds(a));
  return headerIds(b).some((value) => ids.has(value));
}

const isDraftCheck = (row: CaseSummary) =>
  row.result?.category === "BL_COMPARISON" &&
  (row.result.workflow === "verified" || row.result.workflow === "discrepancy");

/** What the rest of each conversation means for planning. */
export function planContexts(
  cases: CaseSummary[],
  threads: Map<string, ThreadInfo>,
  followups: Record<string, FollowUp | undefined>,
): Map<string, PlanContext> {
  const byId = new Map(cases.map((row) => [row.email.email_id, row]));
  const contexts = new Map<string, PlanContext>();
  for (const row of cases) {
    const id = row.email.email_id;
    const thread = threads.get(id);
    if (!thread) continue;
    const members = thread.ids
      .filter((other) => other !== id)
      .map((other) => byId.get(other))
      .filter((other): other is CaseSummary => !!other);
    const context: PlanContext = { conversation_size: thread.ids.length };
    const followup = followups[id];
    if (followup && effectiveFollowUp(followup, row) === "waiting") {
      const since = Date.parse(followup.updated_at);
      context.replied_after_waiting = members.some((other) => {
        const at = receivedTime(other);
        return at !== null && Number.isFinite(since) && at > since;
      });
    }
    const at = receivedTime(row);
    const lane = row.result?.workflow;
    if (
      at !== null &&
      (lane === "discrepancy" || lane === "awaiting_documents")
    )
      context.superseded_by_match = members.some((other) => {
        const later = receivedTime(other);
        return (
          later !== null &&
          later > at &&
          isDraftCheck(other) &&
          other.result!.workflow === "verified" &&
          sameShipment(row, other)
        );
      });
    // An SI request is answered once a draft BL for the order has come in.
    if (at !== null && row.result?.category === "SI_REQUEST")
      context.si_answered = members.some((other) => {
        const later = receivedTime(other);
        return (
          later !== null &&
          later > at &&
          isDraftCheck(other) &&
          sameShipment(row, other)
        );
      });
    contexts.set(id, context);
  }
  return contexts;
}

/** Plans for every email, aware of its conversation. */
export function planAll(
  cases: CaseSummary[],
  followups: Record<string, FollowUp | undefined>,
  now = Date.now(),
  threads = threadsFor(cases),
): Map<string, Plan> {
  const contexts = planContexts(cases, threads, followups);
  return new Map(
    cases.map((row) => [
      row.email.email_id,
      planFor(
        row,
        followups[row.email.email_id],
        now,
        contexts.get(row.email.email_id),
      ),
    ]),
  );
}

export interface DraftProgress {
  previous: CaseSummary;
  fixed: Field[];
  still: Field[];
  added: Field[];
}

/**
 * Compares this checked draft with the previous checked draft in the same
 * conversation: which differences the sender fixed, which remain, and
 * which are new. Needs received dates to know which draft came first.
 */
export function draftProgress(
  current: CaseSummary,
  cases: CaseSummary[],
  thread: ThreadInfo | undefined,
): DraftProgress | null {
  if (!thread || !isDraftCheck(current)) return null;
  const at = receivedTime(current);
  if (at === null) return null;
  const previous = thread.ids
    .map((id) => cases.find((row) => row.email.email_id === id))
    .filter(
      (row): row is CaseSummary =>
        !!row &&
        row.email.email_id !== current.email.email_id &&
        isDraftCheck(row) &&
        receivedTime(row) !== null &&
        receivedTime(row)! < at &&
        sameShipment(row, current),
    )
    .sort((a, b) => receivedTime(b)! - receivedTime(a)!)[0];
  if (!previous) return null;
  const before = new Set(previous.result!.defect_fields);
  const now = new Set(current.result!.defect_fields);
  return {
    previous,
    fixed: byImpact([...before].filter((field) => !now.has(field))),
    still: byImpact([...now].filter((field) => before.has(field))),
    added: byImpact([...now].filter((field) => !before.has(field))),
  };
}
