import { storage } from "./storage";
import { HttpError } from "./http";
import {
  completionBlocker,
  followUpInput,
  type FollowUp,
  type FollowUpInput,
} from "./follow-up";
import type { CaseResult } from "./types";

export async function listFollowUps(
  ws: string,
  db = storage().DB,
): Promise<FollowUp[]> {
  const rows = await db
    .prepare(
      "SELECT payload FROM case_follow_ups WHERE workspace=? ORDER BY email_id",
    )
    .bind(ws)
    .all<{ payload: string }>();
  return rows.results.map((row) => JSON.parse(row.payload));
}

/** One transaction binds operational state to BOTH the case and follow-up
 * revision. Concurrent source changes cannot receive a stale completion. */
export async function saveFollowUp(
  ws: string,
  input: FollowUpInput,
  db = storage().DB,
): Promise<FollowUp> {
  input = followUpInput.parse(input);
  const source = await db
    .prepare(
      "SELECT payload,version FROM cases WHERE workspace=? AND email_id=?",
    )
    .bind(ws, input.id)
    .first<{ payload: string; version: number }>();
  if (!source)
    throw new HttpError("Process this case before recording a follow-up.", 404);
  if (source.version !== input.case_version)
    throw new HttpError(
      "The case changed. Refresh and inspect the latest evidence before saving.",
      409,
    );
  const result = {
    ...JSON.parse(source.payload),
    version: source.version,
  } as CaseResult;
  if (input.state === "completed") {
    const blocker = completionBlocker(result);
    if (blocker) throw new HttpError(blocker, 409);
  }
  const prior = await db
    .prepare(
      "SELECT payload,version FROM case_follow_ups WHERE workspace=? AND email_id=?",
    )
    .bind(ws, input.id)
    .first<{ payload: string; version: number }>();
  if ((prior?.version ?? 0) !== input.version)
    throw new HttpError(
      "The follow-up changed. Refresh before saving your update.",
      409,
    );
  const previous = prior ? (JSON.parse(prior.payload) as FollowUp) : null;
  const now = new Date().toISOString();
  const followup: FollowUp = {
    email_id: input.id,
    version: input.version + 1,
    case_version: input.case_version,
    owner: input.owner,
    shipment_reference: input.shipment_reference,
    due_at: input.due_at ? new Date(input.due_at).toISOString() : null,
    state: input.state,
    note: input.note,
    actor: input.actor,
    created_at: previous?.created_at ?? now,
    updated_at: now,
    completed_at:
      input.state === "completed"
        ? previous?.state === "completed" &&
          previous.case_version === input.case_version
          ? previous.completed_at
          : now
        : null,
  };
  const payload = JSON.stringify(followup);
  const write =
    input.version === 0
      ? db
          .prepare(
            "INSERT INTO case_follow_ups(workspace,email_id,version,payload) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?) ON CONFLICT(workspace,email_id) DO NOTHING",
          )
          .bind(
            ws,
            input.id,
            followup.version,
            payload,
            ws,
            input.id,
            input.case_version,
          )
      : db
          .prepare(
            "UPDATE case_follow_ups SET version=?,payload=? WHERE workspace=? AND email_id=? AND version=? AND EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?)",
          )
          .bind(
            followup.version,
            payload,
            ws,
            input.id,
            input.version,
            ws,
            input.id,
            input.case_version,
          );
  const rows = await db.batch([
    write,
    db
      .prepare(
        "INSERT INTO follow_up_revisions(workspace,email_id,version,payload) SELECT ?,?,?,? WHERE changes()=1",
      )
      .bind(ws, input.id, followup.version, payload),
    db
      .prepare(
        "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        ws,
        input.id,
        "FOLLOW_UP_UPDATED",
        input.actor,
        JSON.stringify({
          summary: `Follow-up ${input.state}; owner ${input.owner}; case revision ${input.case_version}.`,
          reason: input.note,
          before: previous,
          after: followup,
        }),
        now,
      ),
  ]);
  if (rows[0].meta.changes !== 1)
    throw new HttpError(
      "The case or follow-up changed while saving. Refresh and review before trying again.",
      409,
    );
  return followup;
}
