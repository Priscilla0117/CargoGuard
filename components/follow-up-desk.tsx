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
          <h3>Keep the next action in view</h3>
          <p>
            Record responsibility, a confirmed due time and what happens next.
          </p>
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
