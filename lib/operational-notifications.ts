import { storage } from "./storage";
import { HttpError } from "./http";
import { shipmentStatus, type Shipment } from "./shipments";
import type { CaseResult } from "./types";

export interface OperationalNotification {
  id: string;
  shipment_id: string;
  shipment_version: number;
  deadline_id: string;
  source_case: string;
  source_version: number;
  level: "due_soon" | "overdue";
  title: string;
  due_at: string;
  owner: string;
  created_at: string;
  acknowledged_at: string | null;
}
export function dueNotifications(
  shipments: Shipment[],
  cases: CaseResult[],
  now = Date.now(),
) {
  return shipments.flatMap((shipment) => {
    if (shipmentStatus(shipment, cases) === "completed") return [];
    return shipment.deadlines.flatMap((deadline) => {
      if (
        deadline.type === "ETD" ||
        !cases.some(
          (c) =>
            c.email.email_id === deadline.source_case &&
            c.version === deadline.source_version,
        )
      )
        return [];
      const remaining = Date.parse(deadline.at) - now;
      if (!Number.isFinite(remaining) || remaining > 24 * 60 * 60 * 1000)
        return [];
      const level = remaining <= 0 ? "overdue" : "due_soon";
      return [
        {
          id: `${shipment.id}:${deadline.id}:${deadline.source_version}:${level}`,
          shipment_id: shipment.id,
          shipment_version: shipment.version,
          deadline_id: deadline.id,
          source_case: deadline.source_case,
          source_version: deadline.source_version,
          level,
          title: `${deadline.type}: ${shipment.title}`,
          due_at: deadline.at,
          owner: shipment.owner,
          created_at: new Date(now).toISOString(),
          acknowledged_at: null,
        } satisfies OperationalNotification,
      ];
    });
  });
}
export async function refreshNotifications(
  ws: string,
  shipments: Shipment[],
  cases: CaseResult[],
  db = storage().DB,
  now = Date.now(),
) {
  // A changed shipment/source between the read and insert cannot create a current alert.
  for (const row of dueNotifications(shipments, cases, now)) {
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO operational_notifications(workspace,id,shipment_id,shipment_version,payload,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM shipments WHERE workspace=? AND id=? AND version=?) AND EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?)",
        )
        .bind(
          ws,
          row.id,
          row.shipment_id,
          row.shipment_version,
          JSON.stringify(row),
          row.created_at,
          ws,
          row.shipment_id,
          row.shipment_version,
          ws,
          row.source_case,
          row.source_version,
        ),
      db
        .prepare(
          "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
        )
        .bind(
          crypto.randomUUID(),
          ws,
          `shipment:${row.shipment_id}`,
          "DEADLINE_ALERT_CREATED",
          "CargoGuard",
          JSON.stringify({
            summary: row.level,
            deadline_id: row.deadline_id,
            source_case: row.source_case,
            source_version: row.source_version,
          }),
          row.created_at,
        ),
    ]);
  }
  return listNotifications(ws, shipments, cases, db, now);
}
export async function listNotifications(
  ws: string,
  shipments: Shipment[],
  cases: CaseResult[],
  db = storage().DB,
  now = Date.now(),
) {
  const current = new Map(
    dueNotifications(shipments, cases, now).map((n) => [n.id, n]),
  );
  const stored: {
    payload: string;
    acknowledged_at: string | null;
    current_shipment_version: number;
    current_case_version: number;
  }[] = [];
  const ids = [...current.keys()];
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    const rows = await db
      .prepare(
        `SELECT n.payload,n.acknowledged_at,s.version AS current_shipment_version,c.version AS current_case_version FROM operational_notifications n JOIN shipments s ON s.workspace=n.workspace AND s.id=n.shipment_id JOIN cases c ON c.workspace=n.workspace AND c.email_id=json_extract(n.payload,'$.source_case') WHERE n.workspace=? AND n.id IN (${chunk.map(() => "?").join(",")})`,
      )
      .bind(ws, ...chunk)
      .all<(typeof stored)[number]>();
    stored.push(...rows.results);
  }
  return stored
    .flatMap((row) => {
      const value: OperationalNotification = JSON.parse(row.payload),
        live = current.get(value.id);
      if (
        !live ||
        row.current_shipment_version !== live.shipment_version ||
        row.current_case_version !== live.source_version
      )
        return [];
      return [
        {
          ...live,
          created_at: value.created_at,
          acknowledged_at: row.acknowledged_at,
        },
      ];
    })
    .sort((a, b) => Date.parse(a.due_at) - Date.parse(b.due_at));
}
export async function acknowledgeNotification(
  ws: string,
  id: string,
  actor: string,
  db = storage().DB,
) {
  const now = new Date().toISOString();
  const outcome = await db.batch([
    db
      .prepare(
        "UPDATE operational_notifications SET acknowledged_at=? WHERE workspace=? AND id=? AND acknowledged_at IS NULL",
      )
      .bind(now, ws, id),
    db
      .prepare(
        "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        ws,
        "operations",
        "DEADLINE_ALERT_ACKNOWLEDGED",
        actor,
        JSON.stringify({
          summary: "In-app deadline reminder acknowledged",
          notification_id: id,
        }),
        now,
      ),
  ]);
  if (outcome[0].meta.changes !== 1)
    throw new HttpError(
      "Reminder is already acknowledged or unavailable. Refresh the reminders.",
      409,
    );
}
