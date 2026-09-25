"use client";

import { useState, type FormEvent } from "react";
import { CalendarClock, Check, Loader2, RefreshCw } from "lucide-react";
import { requestJson } from "@/lib/client-api";
import {
  completionBlocker,
  effectiveFollowUp,
  type FollowUp,
} from "@/lib/follow-up";
import type { CaseResult } from "@/lib/types";

export const FOLLOW_UP_LABELS = {
  open: "Working",
  waiting: "Awaiting reply",
  completed: "Done",
  reopened: "Reopened · case changed",
} as const;

function localInput(iso: string | null | undefined) {
  if (!iso) return "";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function FollowUpDesk({
  result,
  followup,
  ready,
  refreshing,
  error: loadError,
  onRefresh,
  onReloadCase,
  onReloadValues,
  onSaved,
  person = "",
  reference = "",
  markDone = false,
}: {
  result: CaseResult;
  followup?: FollowUp;
  ready: boolean;
  refreshing: boolean;
  error: string;
  onRefresh: () => void;
  onReloadCase: () => void;
  onReloadValues: () => void;
  onSaved: (value: FollowUp) => void;
  /** Name to pre-fill for a new follow-up. */
  person?: string;
  /** Order/booking reference found in the email. */
  reference?: string;
  /** Opened from "Mark as handled": pre-select done when allowed. */
  markDone?: boolean;
}) {
  const effective = followup ? effectiveFollowUp(followup, result) : "open";
  const [state, setState] = useState<FollowUp["state"]>(() =>
    markDone && !completionBlocker(result)
      ? "completed"
      : effective === "reopened"
        ? "open"
        : effective,
  );
  const [due, setDue] = useState(localInput(followup?.due_at));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [editingVersion, setEditingVersion] = useState(followup?.version ?? 0);
  const changedElsewhere = editingVersion !== (followup?.version ?? 0);
  const [zone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const blocker = completionBlocker(result);

  const who = (followup?.owner ?? person).trim() || "Document desk";
  /** One-click updates for the common cases; the full form stays below. */
  async function quick(
    next: FollowUp["state"],
    dueAt: Date | null,
    note: string,
  ) {
    if (saving || refreshing || !ready || loadError || changedElsewhere) return;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const name = who.length >= 2 ? who.slice(0, 80) : "Document desk";
      const data = await requestJson<{ followup: FollowUp }>(
        "/api/follow-ups",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: result.email.email_id,
            case_version: result.version,
            version: editingVersion,
            owner: name,
            shipment_reference: (
              followup?.shipment_reference ?? reference
            ).slice(0, 120),
            due_at: dueAt?.toISOString() ?? null,
            state: next,
            note,
            actor: name,
          }),
        },
      );
      setState(next);
      setDue(localInput(data.followup.due_at));
      setSaved(true);
      setEditingVersion(data.followup.version);
      onSaved(data.followup);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save follow-up.");
    } finally {
      setSaving(false);
    }
  }
  /** 09:00 after `days` working days (Mon–Fri). */
  const at = (days: number) => {
    const date = new Date();
    let left = days;
    while (left > 0) {
      date.setDate(date.getDate() + 1);
      if (date.getDay() !== 0 && date.getDay() !== 6) left--;
    }
    date.setHours(9, 0, 0, 0);
    return date;
  };
  const remind = [
    { label: "Next working day", date: at(1) },
    { label: "In 2 working days", date: at(2) },
    { label: "In a week", date: at(5) },
  ];
  const notYet =
    result.workflow === "discrepancy"
      ? "Not yet — the draft BL still has differences. It is finished when a corrected draft matches the SI."
      : result.workflow === "awaiting_documents" ||
          result.review_reason === "missing_attachment"
        ? "Not yet — the SI or the draft BL is still missing."
        : blocker
          ? `Not yet — ${blocker.charAt(0).toLowerCase()}${blocker.slice(1)}`
          : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || refreshing || !ready || loadError || changedElsewhere) return;
    const form = new FormData(event.currentTarget);
    const dueDate = due ? new Date(due) : null;
    if (
      dueDate &&
      (!Number.isFinite(dueDate.getTime()) ||
        localInput(dueDate.toISOString()) !== due)
    ) {
      setError(
        "Choose a valid local date and time. This time may fall within a clock change.",
      );
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const data = await requestJson<{ followup: FollowUp }>(
        "/api/follow-ups",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: result.email.email_id,
            case_version: result.version,
            version: editingVersion,
            owner: form.get("owner"),
            shipment_reference: form.get("shipment_reference"),
            due_at: dueDate?.toISOString() ?? null,
            state,
            note: form.get("note"),
            actor: form.get("actor"),
          }),
        },
      );
      setSaved(true);
      setEditingVersion(data.followup.version);
      onSaved(data.followup);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save follow-up.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="follow-up-desk" aria-label="Case follow-up">
      <div className="follow-up-heading">
        <CalendarClock size={22} />
        <div>
          <h3>What happens next?</h3>
          <p>Choose one. CargoGuard moves the email to the right list.</p>
        </div>
        {followup && (
          <span className={`follow-up-badge ${effective}`}>
            {FOLLOW_UP_LABELS[effective]}
          </span>
        )}
      </div>
      {effective === "reopened" && (
        <p className="follow-up-reopened">
          <RefreshCw size={16} />
          The saved follow-up no longer covers this case. Review revision{" "}
          {result.version} and confirm the next action.
        </p>
      )}
      {(loadError || !ready) && (
        <div className="follow-up-notice" role={loadError ? "alert" : "status"}>
          <span>{loadError || "Loading saved follow-up…"}</span>
          <button
            type="button"
            className="text-button"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      )}
      {changedElsewhere && (
        <div className="follow-up-notice" role="alert">
          <span>
            A newer follow-up was loaded. Your unsaved text is preserved below.
            Load saved values to discard these edits and continue.
          </span>
          <button
            type="button"
            className="text-button"
            onClick={onReloadValues}
          >
            Load saved values
          </button>
        </div>
      )}
      <div className="follow-up-quick" aria-label="Quick follow-up">
        <div>
          <strong>Waiting for the sender?</strong>
          <span>Remind me if there is no answer:</span>
          <div className="follow-up-quick-row">
            {remind.map((option) => (
              <button
                key={option.label}
                type="button"
                className="cg-btn"
                disabled={saving || refreshing || !ready || !!loadError}
                onClick={() =>
                  void quick(
                    "waiting",
                    option.date,
                    `Waiting for the sender. Chase on ${option.date.toLocaleDateString()} if there is no answer.`,
                  )
                }
              >
                {option.label}
                <small>
                  {option.date.toLocaleDateString([], {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                  })}
                </small>
              </button>
            ))}
          </div>
        </div>
        <div>
          <strong>Finished?</strong>
          <span>
            {blocker ? notYet : "Nothing else is needed for this email."}
          </span>
          <div className="follow-up-quick-row">
            <button
              type="button"
              className="cg-btn primary"
              disabled={
                !!blocker || saving || refreshing || !ready || !!loadError
              }
              onClick={() =>
                void quick(
                  "completed",
                  null,
                  result.category === "SI_REQUEST"
                    ? "SI prepared and sent to the requester."
                    : result.category === "INVOICE_QUERY"
                      ? "Invoice question answered."
                      : "Checked and handled.",
                )
              }
            >
              <Check size={16} /> Mark as done
            </button>
            {followup && effective !== "open" && effective !== "reopened" && (
              <button
                type="button"
                className="cg-btn"
                disabled={saving || refreshing || !ready || !!loadError}
                onClick={() =>
                  void quick("open", null, "Back on my to-do list.")
                }
              >
                Back to To do
              </button>
            )}
          </div>
        </div>
      </div>
      <details className="cg-details follow-up-more">
        <summary>More details (person responsible, exact time, note)</summary>
        <form onSubmit={submit} onChange={() => setSaved(false)}>
          <fieldset
            disabled={
              saving || refreshing || !ready || !!loadError || changedElsewhere
            }
          >
            <div className="follow-up-grid">
              <label>
                Responsible person
                <input
                  name="owner"
                  required
                  minLength={2}
                  maxLength={80}
                  defaultValue={followup?.owner ?? person}
                  placeholder="Who will follow this up?"
                  autoComplete="off"
                />
              </label>
              <label>
                Shipment / booking reference <span>Optional</span>
                <input
                  name="shipment_reference"
                  maxLength={120}
                  defaultValue={followup?.shipment_reference ?? reference}
                  placeholder="Reference confirmed from the source"
                  autoComplete="off"
                />
              </label>
              <label>
                Follow-up due <span>{zone}</span>
                <input
                  type="datetime-local"
                  value={due}
                  onChange={(event) => setDue(event.target.value)}
                  aria-describedby="follow-up-time-note"
                />
                <small id="follow-up-time-note">
                  Leave blank when no due time is confirmed.
                </small>
              </label>
              <label>
                Next-action state
                <select
                  value={state}
                  onChange={(event) =>
                    setState(event.target.value as FollowUp["state"])
                  }
                >
                  <option value="open">Working</option>
                  <option value="waiting">Awaiting reply</option>
                  <option value="completed" disabled={!!blocker}>
                    {result.category === "BL_COMPARISON"
                      ? "Check completed"
                      : "Handled — done"}
                  </option>
                </select>
                <small>
                  {state === "waiting"
                    ? "Records a wait; no message is sent."
                    : "Separate from the seven-field comparison result."}
                </small>
              </label>
            </div>
            <label className="follow-up-note">
              Next action / handover note
              <textarea
                name="note"
                required
                minLength={5}
                maxLength={2000}
                rows={3}
                defaultValue={
                  followup?.note ??
                  (markDone && !completionBlocker(result)
                    ? result.category === "SI_REQUEST"
                      ? "SI prepared and sent to the requester."
                      : result.category === "INVOICE_QUERY"
                        ? "Invoice question answered."
                        : "Handled."
                    : "")
                }
                placeholder="For example: revised BL requested externally; check the port and weight when it arrives."
              />
            </label>
            {blocker && (
              <p className="follow-up-completion-rule">
                <strong>Completion needs a resolved check.</strong> {blocker}
              </p>
            )}
            <div className="follow-up-save-row">
              <label>
                Recorded by
                <input
                  name="actor"
                  required
                  minLength={2}
                  maxLength={80}
                  defaultValue={followup?.actor ?? person}
                  autoComplete="off"
                />
              </label>
              <button
                type="submit"
                className="button primary"
                disabled={state === "completed" && !!blocker}
              >
                {saving ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Check size={16} />
                )}{" "}
                {saving ? "Saving…" : "Save follow-up"}
              </button>
            </div>
          </fieldset>
        </form>
      </details>
      {error && (
        <div className="follow-up-notice error" role="alert">
          <span>
            {error} Load the latest case and saved follow-up to continue.
            Unsaved follow-up edits will reset after both load successfully.
          </span>
          <button
            type="button"
            className="text-button"
            onClick={onReloadCase}
            disabled={saving || refreshing}
          >
            Load latest case
          </button>
        </div>
      )}
      {saved && (
        <p className="follow-up-saved" role="status">
          <Check size={15} /> Follow-up saved.
        </p>
      )}
      <div className="follow-up-footer">
        <span>Names are self-declared within this browser workspace.</span>
        {followup && (
          <span>
            Updated {new Date(followup.updated_at).toLocaleString()} · v
            {followup.version}
          </span>
        )}
      </div>
    </section>
  );
}
