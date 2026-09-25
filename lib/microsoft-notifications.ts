import { z } from "zod";
import { HttpError } from "./http";
import {
  dueNotifications,
  type OperationalNotification,
} from "./operational-notifications";
import {
  graphMessagePath,
  microsoftGraph,
  microsoftRecipient,
} from "./microsoft";
import {
  microsoftAccessToken,
  type MicrosoftContext,
} from "./microsoft-storage";
import type { CaseResult } from "./types";
import type { Shipment } from "./shipments";

export function microsoftAlertConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const values = (env.CARGO_MS_ALERT_RECIPIENTS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const recipients = values.map((v) => microsoftRecipient.safeParse(v));
  const valid =
    recipients.length > 0 &&
    recipients.length <= 10 &&
    recipients.every((v) => v.success);
  return {
    enabled: env.CARGO_MS_ALERTS_ENABLED === "true" && valid,
    recipients: valid
      ? [...new Set(recipients.flatMap((v) => (v.success ? [v.data] : [])))]
      : [],
  };
}
export interface MicrosoftAlertPreview {
  alert_id: string;
  shipment_id: string;
  shipment_version: number;
  source_case: string;
  source_version: number;
  subject: string;
  body: string;
  due_at: string;
  level: string;
}
export interface MicrosoftAlertDelivery {
  id: string;
  notification_id: string;
  recipient: string;
  status: string;
  created_at: string;
}
async function currentAlert(
  context: MicrosoftContext,
  id: string,
): Promise<MicrosoftAlertPreview> {
  const row = await context.db
    .prepare(
      "SELECT n.payload,n.acknowledged_at,s.payload AS shipment_payload,s.version AS shipment_version FROM operational_notifications n JOIN shipments s ON s.workspace=n.workspace AND s.id=n.shipment_id WHERE n.workspace=? AND n.id=?",
    )
    .bind(context.workspace, id)
    .first<{
      payload: string;
      acknowledged_at: string | null;
      shipment_payload: string;
      shipment_version: number;
    }>();
  if (!row || row.acknowledged_at)
    throw new HttpError(
      "The reminder is acknowledged or no longer available.",
      409,
    );
  const stored = JSON.parse(row.payload) as OperationalNotification,
    shipment = {
      ...JSON.parse(row.shipment_payload),
      version: row.shipment_version,
    } as Shipment;
  if (!shipment.case_ids.length || shipment.case_ids.length > 50)
    throw new HttpError("Shipment source links need review.", 409);
  const sources = await context.db
    .prepare(
      `SELECT payload,version FROM cases WHERE workspace=? AND email_id IN (${shipment.case_ids.map(() => "?").join(",")})`,
    )
    .bind(context.workspace, ...shipment.case_ids)
    .all<{ payload: string; version: number }>();
  const cases = sources.results.map(
    (v) => ({ ...JSON.parse(v.payload), version: v.version }) as CaseResult,
  );
  const live = dueNotifications([shipment], cases).find(
    (n) => n.id === stored.id,
  );
  if (!live)
    throw new HttpError(
      "This reminder is no longer current. Refresh the shipment and its deadline.",
      409,
    );
  return {
    alert_id: live.id,
    shipment_id: shipment.id,
    shipment_version: shipment.version,
    source_case: live.source_case,
    source_version: live.source_version,
    due_at: live.due_at,
    level: live.level,
    subject: `${live.level === "overdue" ? "Overdue" : "Due soon"}: ${live.title}`,
    body: `CargoGuard deadline reminder\n\nShipment: ${shipment.title}\nReferences: ${shipment.references.join(", ") || "Not recorded"}\nOwner: ${shipment.owner || "Unassigned"}\nDeadline (UTC): ${live.due_at}\nState: ${live.level === "overdue" ? "Overdue" : "Due within 24 hours"}\n\nOpen the authenticated CargoGuard workspace to review the current evidence and next action.\nShipment revision: ${shipment.version}\nSource case: ${live.source_case}, revision ${live.source_version}\n\nThis reminder does not approve or release a shipment.`,
  };
}
export async function previewMicrosoftAlerts(context: MicrosoftContext) {
  const rows = await context.db
    .prepare(
      "SELECT id FROM operational_notifications WHERE workspace=? AND acknowledged_at IS NULL ORDER BY created_at DESC LIMIT 100",
    )
    .bind(context.workspace)
    .all<{ id: string }>();
  const previews: MicrosoftAlertPreview[] = [];
  for (const row of rows.results) {
    try {
      previews.push(await currentAlert(context, row.id));
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 409)) throw error;
    }
  }
  const deliveries = await context.db
    .prepare(
      "SELECT id,notification_id,recipient,status,created_at FROM microsoft_notification_outbox WHERE workspace=? ORDER BY created_at DESC LIMIT 100",
    )
    .bind(context.workspace)
    .all<MicrosoftAlertDelivery>();
  return { previews, deliveries: deliveries.results };
}
export const microsoftAlertInput = z
  .object({
    alert_id: z.string().min(1).max(300),
    shipment_version: z.number().int().positive().safe(),
    recipient: microsoftRecipient,
    reviewed: z.literal(true),
  })
  .strict();
export async function deliverMicrosoftAlert(
  context: MicrosoftContext,
  raw: z.infer<typeof microsoftAlertInput>,
  settings = microsoftAlertConfiguration(),
) {
  const input = microsoftAlertInput.parse(raw);
  if (
    !context.config.allowSend ||
    !settings.enabled ||
    !settings.recipients.includes(input.recipient)
  )
    throw new HttpError(
      "Deadline email delivery is disabled or the recipient is not approved by the server administrator.",
      403,
    );
  if (!["reviewer", "admin"].includes(context.user.role))
    throw new HttpError(
      "A reviewer or administrator must dispatch deadline reminders.",
      403,
    );
  const prior = await context.db
    .prepare(
      "SELECT id,notification_id,recipient,status,created_at FROM microsoft_notification_outbox WHERE workspace=? AND notification_id=? AND recipient=?",
    )
    .bind(context.workspace, input.alert_id, input.recipient)
    .first<MicrosoftAlertDelivery>();
  if (prior) return { delivery: prior, duplicate: true };
  const preview = await currentAlert(context, input.alert_id);
  if (preview.shipment_version !== input.shipment_version)
    throw new HttpError(
      "Shipment changed since preview. Review the current reminder.",
      409,
    );
  const token = await microsoftAccessToken(context),
    id = crypto.randomUUID(),
    at = new Date().toISOString();
  const reserved = await context.db
    .prepare(
      "INSERT INTO microsoft_notification_outbox(workspace,id,notification_id,recipient,user_id,shipment_id,shipment_version,source_case,source_version,status,payload,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,'creating',?,?,? WHERE EXISTS(SELECT 1 FROM operational_notifications WHERE workspace=? AND id=? AND acknowledged_at IS NULL) AND EXISTS(SELECT 1 FROM shipments WHERE workspace=? AND id=? AND version=?) AND EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?) ON CONFLICT(workspace,notification_id,recipient) DO NOTHING",
    )
    .bind(
      context.workspace,
      id,
      input.alert_id,
      input.recipient,
      context.user.id,
      preview.shipment_id,
      preview.shipment_version,
      preview.source_case,
      preview.source_version,
      JSON.stringify(preview),
      at,
      at,
      context.workspace,
      input.alert_id,
      context.workspace,
      preview.shipment_id,
      preview.shipment_version,
      context.workspace,
      preview.source_case,
      preview.source_version,
    )
    .run();
  if (reserved.meta.changes !== 1)
    throw new HttpError(
      "Reminder changed or is already being dispatched. Refresh deliveries.",
      409,
    );
  const update = async (status: string, graphId: string | null = null) =>
    context.db.batch([
      context.db
        .prepare(
          "UPDATE microsoft_notification_outbox SET status=?,graph_id=COALESCE(?,graph_id),updated_at=? WHERE workspace=? AND id=?",
        )
        .bind(status, graphId, new Date().toISOString(), context.workspace, id),
      context.db
        .prepare(
          "INSERT INTO microsoft_audit(id,workspace,user_id,action,operation_id,created_at) VALUES(?,?,?,?,?,?)",
        )
        .bind(
          crypto.randomUUID(),
          context.workspace,
          context.user.id,
          `ALERT_${status.toUpperCase()}`,
          id,
          new Date().toISOString(),
        ),
    ]);
  let sendReserved = false;
  try {
    const draft = z.object({ id: z.string().min(1).max(1000) }).parse(
      await microsoftGraph(
        token,
        "/me/messages",
        {
          method: "POST",
          body: {
            subject: preview.subject,
            body: { contentType: "Text", content: preview.body },
            toRecipients: [{ emailAddress: { address: input.recipient } }],
            singleValueExtendedProperties: [
              {
                id: "String {b8bff9af-fd19-4cad-8655-68bd96c54f2a} Name CargoGuardOperation",
                value: id,
              },
            ],
          },
        },
        context.fetcher,
      ),
    );
    await update("draft", draft.id);
    let latest: MicrosoftAlertPreview;
    try {
      latest = await currentAlert(context, input.alert_id);
    } catch (error) {
      if (error instanceof HttpError && error.status === 409)
        await update("cancelled");
      throw error;
    }
    if (JSON.stringify(latest) !== JSON.stringify(preview)) {
      await update("cancelled");
      throw new HttpError(
        "Reminder changed during preparation. Nothing was sent; the unsent Outlook draft remains for inspection.",
        409,
      );
    }
    const sending = await context.db
      .prepare(
        "UPDATE microsoft_notification_outbox SET status='sending',updated_at=? WHERE workspace=? AND id=? AND status='draft' AND EXISTS(SELECT 1 FROM operational_notifications WHERE workspace=? AND id=? AND acknowledged_at IS NULL) AND EXISTS(SELECT 1 FROM shipments WHERE workspace=? AND id=? AND version=?) AND EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?)",
      )
      .bind(
        new Date().toISOString(),
        context.workspace,
        id,
        context.workspace,
        input.alert_id,
        context.workspace,
        preview.shipment_id,
        preview.shipment_version,
        context.workspace,
        preview.source_case,
        preview.source_version,
      )
      .run();
    if (sending.meta.changes !== 1) {
      await update("cancelled");
      throw new HttpError(
        "Reminder changed before dispatch. The email was not sent.",
        409,
      );
    }
    sendReserved = true;
    await microsoftGraph(
      token,
      `${graphMessagePath(draft.id)}/send`,
      { method: "POST" },
      context.fetcher,
    );
    await update("submitted");
  } catch (error) {
    const current = await context.db
      .prepare(
        "SELECT status FROM microsoft_notification_outbox WHERE workspace=? AND id=?",
      )
      .bind(context.workspace, id)
      .first<{ status: string }>();
    if (current?.status !== "cancelled")
      await update("unknown").catch(() => undefined);
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      sendReserved
        ? "Microsoft did not confirm delivery submission. Inspect the mailbox; this reminder will not be resent automatically."
        : "Reminder draft creation could not be confirmed. Inspect the mailbox before retrying.",
      503,
    );
  }
  return {
    delivery: {
      id,
      notification_id: input.alert_id,
      recipient: input.recipient,
      status: "submitted",
      created_at: at,
    },
    duplicate: false,
  };
}
