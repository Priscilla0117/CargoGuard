import { storage } from "./storage";
import { HttpError } from "./http";
import type { CaseScheduling } from "./types";

export async function schedulingMetadata(
  ws: string,
  db = storage().DB,
): Promise<Record<string, CaseScheduling>> {
  const rows = await db
    .prepare(
      "SELECT case_id,version,due_at,follow_up_at,priority FROM case_scheduling WHERE workspace=?",
    )
    .bind(ws)
    .all<CaseScheduling & { case_id: string }>();
  return Object.fromEntries(
    rows.results.map(({ case_id, ...value }) => [case_id, value]),
  );
}
export async function saveScheduling(
  ws: string,
  id: string,
  data: CaseScheduling,
  actor: string,
  db = storage().DB,
) {
  const now = new Date().toISOString();
  const statement =
    data.version === 0
      ? db
          .prepare(
            "INSERT INTO case_scheduling(workspace,case_id,version,due_at,follow_up_at,priority,updated_at) VALUES(?,?,1,?,?,?,?) ON CONFLICT(workspace,case_id) DO NOTHING",
          )
          .bind(ws, id, data.due_at, data.follow_up_at, data.priority, now)
      : db
          .prepare(
            "UPDATE case_scheduling SET version=version+1,due_at=?,follow_up_at=?,priority=?,updated_at=? WHERE workspace=? AND case_id=? AND version=?",
          )
          .bind(
            data.due_at,
            data.follow_up_at,
            data.priority,
            now,
            ws,
            id,
            data.version,
          );
  const saved = await db.batch([
    statement,
    db
      .prepare(
        "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        ws,
        id,
        "SCHEDULE_UPDATED",
        actor,
        JSON.stringify({ ...data, version: data.version + 1 }),
        now,
      ),
  ]);
  if (saved[0].meta.changes !== 1)
    throw new HttpError("The schedule changed. Refresh before saving.", 409);
  return { ...data, version: data.version + 1 };
}
