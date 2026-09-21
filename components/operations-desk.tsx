"use client";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowDownToLine,
  Compass,
  Search,
  ShieldCheck,
  Loader2,
} from "lucide-react";
import {
  LANES,
  LANE_DETAILS,
  operationsSnapshot,
  shiftBrief,
  type Lane,
} from "@/lib/operations";
import { FIELDS, FIELD_LABELS, type CaseSummary } from "@/lib/types";

export function OperationsDesk({
  cases,
  loading,
  busyId,
  onOpen,
  onInbox,
}: {
  cases: CaseSummary[];
  loading: boolean;
  busyId: string;
  onOpen: (id: string) => void;
  onInbox: () => void;
}) {
  const snapshot = useMemo(() => operationsSnapshot(cases), [cases]);
  const [selectedLane, setLane] = useState<Lane | null>(null);
  const lane =
    selectedLane ??
    LANES.find((key) => snapshot.lanes[key].length > 0) ??
    "amend";
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const rows = snapshot.lanes[lane].filter((row) =>
    `${row.email.email_id} ${row.email.subject} ${row.email.from}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const shown = rows.slice(0, page * 12);
  const maxPattern = Math.max(1, ...Object.values(snapshot.fieldCounts));
  function selectLane(value: Lane) {
    setLane(value);
    setPage(1);
    setQuery("");
  }
  function downloadBrief() {
    const url = URL.createObjectURL(
      new Blob([shiftBrief(cases, new Date().toISOString())], {
        type: "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "cargoguard-shift-brief.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="operations-desk" aria-label="Operations desk">
      <div className="ops-hero">
        <div className="ops-hero-copy">
          <span className="ops-kicker">
            <Compass size={17} /> YOUR WORKSPACE AT A GLANCE
          </span>
          <h2>
            Evidence first.
            <br />A clear next action.
          </h2>
          <p>
            Turn a mixed inbox into a focused work queue. Resolve the blockers,
            request the right correction, and hand over the evidence.
          </p>
          <button className="button ops-light" onClick={onInbox}>
            Open verification inbox <ArrowRight size={16} />
          </button>
        </div>
        <div className="ops-hero-count">
          <strong>{loading ? "—" : snapshot.actionRequired}</strong>
          <span>cases need action</span>
          <small>of {snapshot.total} in this workspace</small>
          <div>
            <ShieldCheck size={16} /> Nothing is released or sent automatically.
          </div>
        </div>
      </div>
      <div className="ops-section-head">
        <div>
          <h2>Choose your next task</h2>
          <p>Grouped by the action needed, not an invented urgency score.</p>
        </div>
        <button
          className="button secondary"
          disabled={loading || !cases.length}
          onClick={downloadBrief}
        >
          <ArrowDownToLine size={16} /> Export shift brief
        </button>
      </div>
      <div className="ops-lanes" aria-label="Work queues">
        {LANES.map((key, i) => (
          <button
            key={key}
            className={`ops-lane ${key} ${lane === key ? "selected" : ""}`}
            aria-pressed={lane === key}
            onClick={() => selectLane(key)}
          >
            <span className="ops-lane-top">
              <small>0{i + 1}</small>
              <strong>{loading ? "—" : snapshot.lanes[key].length}</strong>
            </span>
            <b>{LANE_DETAILS[key].title}</b>
            <span>
              {LANE_DETAILS[key].action} <ArrowRight size={14} />
            </span>
          </button>
        ))}
      </div>
      <div className="ops-columns">
        <section className="ops-queue" aria-label={LANE_DETAILS[lane].title}>
          <div className="ops-queue-head">
            <h3>{LANE_DETAILS[lane].title}</h3>
            <p>{LANE_DETAILS[lane].detail}</p>
            <label className="ops-search">
              <Search size={17} />
              <input
                aria-label="Search current work queue"
                placeholder="Find a case, sender or subject…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>
          {loading ? (
            <p className="ops-empty" role="status">
              Loading your workspace…
            </p>
          ) : !rows.length ? (
            <div className="ops-empty">
              <ShieldCheck size={28} />
              <h4>{query ? "No matching cases" : "No cases in this queue"}</h4>
              <p>
                {query
                  ? "Try a different search or choose another task."
                  : snapshot.lanes.refresh.length
                    ? "Process / recheck has cases waiting. Run inbox to build current results."
                    : "Choose another queue to continue."}
              </p>
            </div>
          ) : (
            <ol className="ops-case-list">
              {shown.map(({ email, result }) => (
                <li key={email.email_id}>
                  <button
                    onClick={() => onOpen(email.email_id)}
                    disabled={!!busyId}
                  >
                    <span className="ops-case-id">
                      {email.email_id}
                      <small>
                        r{result?.version ?? 0}
                        {result?.reviewed ? " · reviewed" : ""}
                      </small>
                    </span>
                    <span className="ops-case-copy">
                      <strong>{email.subject}</strong>
                      <small>
                        {result?.summary ??
                          "Not processed — opening will run this case."}
                      </small>
                    </span>
                    {busyId === email.email_id ? (
                      <Loader2 size={18} className="spin" />
                    ) : (
                      <ArrowRight size={18} />
                    )}
                  </button>
                </li>
              ))}
            </ol>
          )}
          <div className="ops-queue-footer">
            <span>
              {Math.min(shown.length, rows.length)} of {rows.length} · ordered
              by case ID
            </span>
            {shown.length < rows.length && (
              <button className="text-button" onClick={() => setPage(page + 1)}>
                Show 12 more
              </button>
            )}
          </div>
        </section>
        <aside className="ops-insights">
          <div>
            <span className="eyebrow">PREVENT THE NEXT CORRECTION</span>
            <h3>Where drafts differ</h3>
            <p>
              Field patterns in {snapshot.lanes.amend.length} completed
              discrepancy cases.
            </p>
            <div className="ops-patterns">
              {FIELDS.map((field) => (
                <div key={field}>
                  <span>
                    {FIELD_LABELS[field]}
                    <b>{snapshot.fieldCounts[field]}</b>
                  </span>
                  <div>
                    <i
                      style={{
                        width: `${(snapshot.fieldCounts[field] / maxPattern) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <small>
              Current-engine exact verdicts only. Review cases may contain
              further differences. These counts do not establish root causes or
              supplier performance.
            </small>
          </div>
          <div className="ops-playbook">
            <span className="eyebrow">A THREE-STEP RESOLUTION LOOP</span>
            <ol>
              <li>
                <b>Inspect</b>
                <span>Open the case and follow its evidence.</span>
              </li>
              <li>
                <b>Request</b>
                <span>Use Resolution to prepare a checked amendment.</span>
              </li>
              <li>
                <b>Recheck</b>
                <span>Replace the corrected sources; retain the history.</span>
              </li>
            </ol>
            <p>
              Measurable pilot goals: review time, repeat corrections and false
              clearances. No savings are assumed.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
