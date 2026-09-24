"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client-api";
import type {
  MicrosoftAlertDelivery,
  MicrosoftAlertPreview,
} from "@/lib/microsoft-notifications";
type AlertState = {
  enabled: boolean;
  reason?: string;
  recipients: string[];
  previews: MicrosoftAlertPreview[];
  deliveries: MicrosoftAlertDelivery[];
};
export function MicrosoftDeadlineAlerts() {
  const [data, setData] = useState<AlertState | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [recipient, setRecipient] = useState(""),
    [selected, setSelected] = useState<MicrosoftAlertPreview | null>(null),
    [reviewed, setReviewed] = useState(false);
  async function load() {
    try {
      const next = await requestJson<AlertState>(
        "/api/microsoft/notifications",
      );
      setData(next);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Cannot load email reminders.",
      );
    }
  }
  useEffect(() => {
    let active = true;
    requestJson<AlertState>("/api/microsoft/notifications")
      .then((next) => {
        if (active) setData(next);
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error
              ? error.message
              : "Cannot load email reminders.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  async function dispatch() {
    if (!selected || !reviewed) return;
    setBusy(true);
    setError("");
    try {
      await requestJson("/api/microsoft/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alert_id: selected.alert_id,
          shipment_version: selected.shipment_version,
          recipient,
          reviewed: true,
        }),
      });
      setSelected(null);
      setReviewed(false);
      await load();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Dispatch outcome is uncertain. Refresh deliveries before retrying.",
      );
      await load();
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="microsoft-task">
      <summary>Send a reviewed deadline reminder</summary>
      <p>
        Opt-in email dispatch to administrator-approved recipients. No
        unattended sending or scheduler is active.
      </p>
      {data && !data.enabled && (
        <p>{data.reason ?? "Microsoft email sending is disabled."}</p>
      )}
      {data?.enabled && (
        <>
          <button type="button" disabled={busy} onClick={() => void load()}>
            Refresh current reminders
          </button>
          <label>
            Approved recipient
            <select
              value={recipient}
              onChange={(event) => {
                setRecipient(event.target.value);
                setReviewed(false);
              }}
              disabled={busy}
            >
              <option value="">Select recipient</option>
              {data.recipients.map((address) => (
                <option key={address}>{address}</option>
              ))}
            </select>
          </label>
          <ul>
            {data.previews.map((alert) => (
              <li key={alert.alert_id}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSelected(alert);
                    setReviewed(false);
                  }}
                >
                  {alert.subject}
                </button>
              </li>
            ))}
          </ul>
          {selected && (
            <div>
              <strong>{selected.subject}</strong>
              <pre>{selected.body}</pre>
              <label className="microsoft-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                <span>I reviewed this reminder and its recipient.</span>
              </label>
              <button
                type="button"
                disabled={busy || !recipient || !reviewed}
                onClick={() => void dispatch()}
              >
                Confirm and dispatch email
              </button>
            </div>
          )}
          <ul>
            {data.deliveries.map((item) => (
              <li key={item.id}>
                {item.status === "submitted"
                  ? "Submitted to Microsoft; delivery not confirmed"
                  : item.status}{" "}
                · {item.recipient} ·{" "}
                {new Date(item.created_at).toLocaleString()}
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p role="alert" className="microsoft-error">
          {error}
        </p>
      )}
    </details>
  );
}
