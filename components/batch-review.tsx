"use client";
import { useEffect, useId, useRef, useState } from "react";
import { requestJson } from "@/lib/client-api";
import type { BatchCandidate, BatchOutcome } from "@/lib/batch-review";
import { FIELD_LABELS } from "@/lib/types";
import "./batch-review.css";

export function BatchReview({
  onCompleted,
}: { onCompleted?: () => void } = {}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [fresh, setFresh] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState("");
  const [candidates, setCandidates] = useState<BatchCandidate[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [outcomes, setOutcomes] = useState<BatchOutcome[]>([]);
  const [allowed, setAllowed] = useState(false),
    [actor, setActor] = useState("Demo reviewer"),
    [note, setNote] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const panelId = useId();
  const inFlight = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function load() {
    if (inFlight.current) return;
    inFlight.current = true;
    setOpen(true);
    setBusy(true);
    setFresh(false);
    setCandidates([]);
    setAllowed(false);
    setStatus("Loading current eligible document checks…");
    setError("");
    setSelected([]);
    setConfirmed(false);
    try {
      const data = await requestJson<{
        candidates: BatchCandidate[];
        can_complete: boolean;
        actor: string;
      }>("/api/batch-review", { cache: "no-store" });
      if (!mounted.current) return;
      setCandidates(data.candidates);
      setAllowed(data.can_complete);
      setActor(data.actor);
      setFresh(true);
      setStatus(
        `${data.candidates.length} current eligible document checks loaded.`,
      );
    } catch (error) {
      if (mounted.current) {
        setError((error as Error).message);
        setStatus(
          "Current candidates could not be loaded. Refresh to try again.",
        );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      inFlight.current ||
      !fresh ||
      !allowed ||
      !confirmed ||
      !selected.length
    )
      return;
    inFlight.current = true;
    setBusy(true);
    // A partial response or lost connection must never leave the old selection
    // ready to replay. The server rechecks versions; the UI requires a new read.
    setFresh(false);
    setSelected([]);
    setConfirmed(false);
    setOutcomes([]);
    setStatus("Recording document-check decisions…");
    setError("");
    try {
      const data = await requestJson<{ outcomes: BatchOutcome[] }>(
        "/api/batch-review",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: candidates
              .filter((candidate) => selected.includes(candidate.id))
              .map(({ id, case_version, follow_up_version }) => ({
                id,
                case_version,
                follow_up_version,
              })),
            actor,
            note,
            confirmed_document_check_only: confirmed,
          }),
        },
      );
      if (!mounted.current) return;
      setOutcomes(data.outcomes);
      const done = new Set(
        data.outcomes
          .filter(
            (outcome) =>
              outcome.status === "completed" ||
              outcome.status === "already_completed",
          )
          .map((outcome) => outcome.id),
      );
      setCandidates((candidates) =>
        candidates.filter((candidate) => !done.has(candidate.id)),
      );
      setStatus(
        "Batch results received. Refresh candidates before another sign-off.",
      );
      if (done.size) {
        try {
          await onCompleted?.();
        } catch {
          if (mounted.current)
            setError(
              "The batch result is recorded below, but the workspace view could not refresh. Refresh the workspace to see the latest saved decisions.",
            );
        }
      }
    } catch (error) {
      if (mounted.current) {
        setError((error as Error).message);
        setStatus(
          "The batch result could not be confirmed. Refresh candidates to check saved progress before another sign-off.",
        );
      }
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section className="batch-review">
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={load}
      >
        {open ? "Refresh batch candidates" : "Review matched cases in a batch"}
      </button>
      {open && (
        <div id={panelId}>
          <h3>Batch document-check completion</h3>
          <p>
            Only current, source-backed seven-field matches without unresolved
            integrity findings are eligible. OCR, manual corrections, learned
            rules and selected-source cases require individual completion. This
            records human sign-off; it is not unattended processing.
          </p>
          <p role="status" aria-live="polite">
            {status}
          </p>
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          {fresh && !allowed && (
            <p>A reviewer or administrator must complete these checks.</p>
          )}
          {outcomes.length > 0 && (
            <ul aria-live="polite">
              {outcomes.map((outcome) => (
                <li key={outcome.id}>
                  {outcome.id} · {outcome.status}: {outcome.message}
                </li>
              ))}
            </ul>
          )}
          {fresh && !busy && !candidates.length && (
            <p>
              No eligible incomplete document checks. Individual case review
              remains available.
            </p>
          )}
          {!!candidates.length && (
            <form onSubmit={submit}>
              <p>
                {fresh
                  ? `${candidates.length} eligible cases. Select at most 25.`
                  : "These candidate details may have changed. Refresh before selecting cases."}
              </p>
              <div className="batch-candidates">
                {candidates.map((candidate) => (
                  <article key={candidate.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.includes(candidate.id)}
                        disabled={
                          busy ||
                          !fresh ||
                          !allowed ||
                          (selected.length >= 25 &&
                            !selected.includes(candidate.id))
                        }
                        onChange={(event) =>
                          setSelected((previous) =>
                            event.target.checked
                              ? [...previous, candidate.id]
                              : previous.filter((id) => id !== candidate.id),
                          )
                        }
                      />
                      <span>
                        <strong>
                          {candidate.id} · revision {candidate.case_version}
                        </strong>
                        <br />
                        {candidate.subject}
                        <br />
                        Owner: {candidate.owner || actor} ·{" "}
                        {candidate.not_checked} independent checks unavailable
                        from these documents
                      </span>
                    </label>
                    <details>
                      <summary>Inspect seven matched source values</summary>
                      <table>
                        <thead>
                          <tr>
                            <th scope="col">Field</th>
                            <th scope="col">SI</th>
                            <th scope="col">Draft BL</th>
                          </tr>
                        </thead>
                        <tbody>
                          {candidate.values.map((value) => (
                            <tr key={value.field}>
                              <th scope="row">{FIELD_LABELS[value.field]}</th>
                              <td>{value.si}</td>
                              <td>{value.bl}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </article>
                ))}
              </div>
              <label>
                Review / handover note
                <textarea
                  required
                  minLength={10}
                  maxLength={1500}
                  value={note}
                  disabled={busy || !fresh || !allowed}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Explain the scope of the document checks you are signing off."
                />
              </label>
              <label className="batch-attestation">
                <input
                  type="checkbox"
                  required
                  checked={confirmed}
                  disabled={busy || !fresh || !allowed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I confirm these seven-field document checks. Unavailable
                equipment checks remain unchecked. This does not authorize cargo
                release, sanctions clearance or sending a message.
              </label>
              <button
                className="button primary"
                disabled={
                  busy || !fresh || !allowed || !confirmed || !selected.length
                }
              >
                {busy
                  ? "Recording decisions…"
                  : `Complete ${selected.length} document checks`}
              </button>
            </form>
          )}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            Close batch review
          </button>
        </div>
      )}
    </section>
  );
}
