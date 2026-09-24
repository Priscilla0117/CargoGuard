"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { requestJson } from "@/lib/client-api";
import type { OperationalNotification } from "@/lib/operational-notifications";
import { MicrosoftDeadlineAlerts } from "./microsoft-deadline-alerts";
export function NotificationCenter() {
  const [rows, setRows] = useState<OperationalNotification[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState<string | null>(null);
  const requests = useRef({ generation: 0, mutating: false });
  const refresh = useCallback(async () => {
    const state = requests.current;
    if (state.mutating) return;
    const ticket = ++state.generation;
    const data = await requestJson<{
      notifications: OperationalNotification[];
    }>("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh" }),
    });
    if (ticket !== state.generation) return;
    setRows(data.notifications);
    setChecked(new Date().toLocaleTimeString());
    setError("");
  }, []);
  useEffect(() => {
    let live = true;
    const state = requests.current;
    const run = () => {
      if (live)
        refresh().catch((e) => {
          if (live) setError(e.message);
        });
    };
    run();
    const timer = setInterval(run, 60000);
    return () => {
      live = false;
      state.generation++;
      clearInterval(timer);
    };
  }, [refresh]);
  async function acknowledge(id: string) {
    const state = requests.current;
    if (state.mutating) return;
    state.mutating = true;
    state.generation++;
    setBusy(true);
    try {
      const data = await requestJson<{
        notifications: OperationalNotification[];
      }>("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "acknowledge", id }),
      });
      setRows(data.notifications);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      state.mutating = false;
      setBusy(false);
    }
  }
  const unread = rows.filter((r) => !r.acknowledged_at);
  return (
    <details className="shipment-card">
      <summary>Deadline reminders · {unread.length} unacknowledged</summary>
      <p>
        Confirmed action deadlines within 24 hours. Checks run every minute
        while this workspace is open{checked ? `; last checked ${checked}` : ""}
        . Acknowledgement does not complete the shipment. External delivery
        requires configured Microsoft access and a reviewed action below.
      </p>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy}
        onClick={() => refresh().catch((e) => setError(e.message))}
      >
        Check reminders now
      </button>
      {rows.length === 0 && (
        <p>No active confirmed deadlines within the next 24 hours.</p>
      )}
      {rows.map((row) => (
        <div className="shipment-proposal" key={row.id}>
          <Link
            href={`/shipments?shipment=${encodeURIComponent(row.shipment_id)}`}
          >
            {row.title}
          </Link>
          <p>
            {row.level === "overdue" ? "Overdue" : "Due within 24 hours"} ·{" "}
            {new Date(row.due_at).toLocaleString()} ·{" "}
            {row.owner || "Unassigned"}
          </p>
          {row.acknowledged_at ? (
            <span>Acknowledged</span>
          ) : (
            <button disabled={busy} onClick={() => acknowledge(row.id)}>
              Acknowledge reminder
            </button>
          )}
        </div>
      ))}
      <MicrosoftDeadlineAlerts />
    </details>
  );
}
