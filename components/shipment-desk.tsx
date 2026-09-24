"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { WorkspaceNav } from "./workspace-nav";
import { requestJson } from "@/lib/client-api";
import {
  approvedComparison,
  amendmentCandidates,
  deadlineCandidates,
  deadlineTypes,
  referenceCandidates,
  shipmentStatus,
  type Shipment,
} from "@/lib/shipments";
import type { CaseResult, CaseSummary, Field } from "@/lib/types";
import { FIELDS, FIELD_LABELS } from "@/lib/types";
import { checkDocumentIntegrity } from "@/lib/integrity-checks";
import { IntegrityChecks } from "./integrity-checks";
import { NotificationCenter } from "./notification-center";
import { MicrosoftTaskDraft } from "./outlook-pane";
import type { SiTemplate } from "@/lib/si-templates";
import "@/app/shipment-desk.css";
import "@/app/integrity-checks.css";

type BoardShipment = Shipment & {
  effective_state: string;
  next_deadline: { at: string; type: string } | null;
};
type Detail = {
  shipment: Shipment;
  cases: CaseResult[];
  history: {
    version: number;
    action: string;
    actor: string;
    created_at: string;
    payload: string;
  }[];
};
function values(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(
    new FormData(event.currentTarget).entries(),
  ) as Record<string, string>;
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ShipmentDesk() {
  const [board, setBoard] = useState<BoardShipment[]>([]),
    [templates, setTemplates] = useState<SiTemplate[]>([]),
    [inbox, setInbox] = useState<CaseSummary[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [queueFilter, setQueueFilter] = useState("all"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [caseId, setCaseId] = useState(""),
    [candidate, setCandidate] = useState<CaseResult | null>(null),
    [actor, setActor] = useState("Demo reviewer"),
    [identity, setIdentity] = useState<{
      id: string;
      display_name: string;
      role: string;
    } | null>(null),
    [now, setNow] = useState(Date.now),
    [tab, setTab] = useState("documents");
  const detailTicket = useRef(0),
    selectedRef = useRef(selected);
  function choose(id: string) {
    selectedRef.current = id;
    setSelected(id);
    setDetail(null);
    setCandidate(null);
  }
  const refresh = useCallback(async () => {
    const [b, i, t] = await Promise.all([
      requestJson<{ shipments: BoardShipment[]; identity: typeof identity }>(
        "/api/shipments",
      ),
      requestJson<{ cases: CaseSummary[] }>("/api/inbox"),
      requestJson<{ templates: SiTemplate[] }>("/api/si-templates"),
    ]);
    setBoard(b.shipments);
    setTemplates(t.templates);
    setIdentity(b.identity);
    if (b.identity) setActor(b.identity.display_name);
    setInbox(i.cases);
    setLoaded(true);
  }, []);
  const open = useCallback(async (id: string) => {
    const ticket = ++detailTicket.current;
    const data = await requestJson<Detail>(
      `/api/shipments?id=${encodeURIComponent(id)}`,
    );
    if (ticket === detailTicket.current && selectedRef.current === id) {
      setDetail(data);
      setCaseId((current) =>
        data.cases.some((c) => c.email.email_id === current)
          ? current
          : (data.shipment.comparison_case_id ??
            data.cases[0]?.email.email_id ??
            ""),
      );
    }
  }, []);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => {
        if (live) return refresh();
      })
      .then(() => {
        if (!live) return;
        const id = new URLSearchParams(window.location.search).get("shipment");
        if (id) {
          selectedRef.current = id;
          setSelected(id);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (selected) open(selected).catch((e) => setError(e.message));
    else detailTicket.current++;
  }, [selected, open]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const act = async (payload: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const id = selectedRef.current;
    try {
      const response = await requestJson<{ shipment: Shipment }>(
        "/api/shipments",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(detail && payload.action !== "create"
              ? { id: detail.shipment.id, version: detail.shipment.version }
              : {}),
            ...payload,
            actor,
          }),
        },
      );
      await refresh();
      if (payload.action === "create") choose(response.shipment.id);
      else if (selectedRef.current === id) await open(id);
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Save failed. Your last confirmed state is retained.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  };
  const current = detail?.cases.find((c) => c.email.email_id === caseId),
    shipment = detail?.shipment;
  const search = query.trim().toLowerCase();
  const overdue = (s: BoardShipment) =>
    s.effective_state !== "completed" &&
    !!s.next_deadline &&
    Date.parse(s.next_deadline.at) < now;
  const queueOptions = [
    { id: "all", label: "All shipments", count: board.length },
    {
      id: "open",
      label: "Open",
      count: board.filter((s) => s.effective_state !== "completed").length,
    },
    { id: "overdue", label: "Overdue", count: board.filter(overdue).length },
    {
      id: "unassigned",
      label: "Unassigned",
      count: board.filter((s) => !s.owner && s.effective_state !== "completed")
        .length,
    },
  ];
  const rows = board
    .filter(
      (s) =>
        queueFilter === "all" ||
        (queueFilter === "open" && s.effective_state !== "completed") ||
        (queueFilter === "overdue" && overdue(s)) ||
        (queueFilter === "unassigned" &&
          !s.owner &&
          s.effective_state !== "completed"),
    )
    .filter(
      (s) =>
        !search ||
        [s.title, s.customer, s.carrier, s.owner, ...s.references]
          .join(" ")
          .toLowerCase()
          .includes(search),
    )
    .sort(
      (a, b) =>
        Number(a.effective_state === "completed") -
          Number(b.effective_state === "completed") ||
        (a.next_deadline ? Date.parse(a.next_deadline.at) : Infinity) -
          (b.next_deadline ? Date.parse(b.next_deadline.at) : Infinity) ||
        a.title.localeCompare(b.title),
    );
  const comparison = detail?.cases.find(
    (c) => c.email.email_id === shipment?.comparison_case_id,
  );
  const overlay =
    comparison && shipment
      ? approvedComparison(shipment, comparison, detail?.cases)
      : null;
  const sourceOptions = detail?.cases.map((c) => (
    <option key={c.email.email_id} value={c.email.email_id}>
      {c.email.email_id} · {c.email.subject}
    </option>
  ));
  return (
    <main
      className="shipment-app"
      id="main-content"
      tabIndex={-1}
      aria-labelledby="shipment-page-title"
    >
      <WorkspaceNav active="/shipments" />
      <header className="shipment-top">
        <div>
          <p className="eyebrow">CARGOGUARD / OPERATIONS</p>
          <h1 id="shipment-page-title">Shipment workspace</h1>
          <p>Keep the evidence, next action and responsible person together.</p>
        </div>
        <div className="shipment-top-actions">
          <button
            onClick={() => {
              setError("");
              refresh()
                .then(() => {
                  if (selected) return open(selected);
                })
                .catch((e) => setError(e.message));
            }}
            disabled={busy}
          >
            Refresh workspace
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="shipment-error">
          {error}{" "}
          <button
            onClick={() => {
              refresh()
                .then(() => {
                  if (selected) return open(selected);
                })
                .then(() => setError(""))
                .catch((e) => setError(e.message));
            }}
          >
            Load latest saved state
          </button>
        </div>
      )}
      {loaded && !identity && (
        <label className="shipment-recorder">
          Recorded by{" "}
          <input
            value={actor}
            maxLength={80}
            onChange={(e) => setActor(e.target.value)}
          />
          <small>
            Self-declared in isolated demo mode. Team mode uses your signed-in
            identity.
          </small>
        </label>
      )}
      <NotificationCenter />
      {busy && (
        <p className="workspace-status" role="status">
          Saving your change and refreshing the shipment evidence…
        </p>
      )}
      <div className="shipment-layout">
        <aside aria-label="Shipment queue" className="shipment-sidebar">
          <div className="shipment-queue-heading">
            <h2>Shipment queue</h2>
            <span>{loaded ? board.length : "…"}</span>
          </div>
          <label>
            Find a shipment
            <input
              placeholder="Reference, customer, owner…"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div
            className="shipment-queue-filters"
            role="group"
            aria-label="Filter shipment queue"
          >
            {queueOptions.map((option) => (
              <button
                key={option.id}
                aria-pressed={queueFilter === option.id}
                disabled={!loaded}
                onClick={() => setQueueFilter(option.id)}
              >
                {option.label}
                <span>{loaded ? option.count : "…"}</span>
              </button>
            ))}
          </div>
          <p className="shipment-queue-count" role="status">
            {loaded
              ? `${rows.length} of ${board.length} shipments · confirmed deadlines first`
              : "Loading shipments…"}
          </p>
          <div className="shipment-list">
            {rows.map((s) => (
              <button
                key={s.id}
                className={selected === s.id ? "selected" : ""}
                aria-pressed={selected === s.id}
                onClick={() => {
                  choose(s.id);
                  setTab("documents");
                }}
              >
                <strong>{s.title}</strong>
                <span>
                  {s.references.join(" · ") || "Reference not recorded"}
                </span>
                <span>
                  {s.owner || "Unassigned"} ·{" "}
                  {s.effective_state.replaceAll("_", " ")}
                </span>
                {s.next_deadline && (
                  <span
                    className={
                      Date.parse(s.next_deadline.at) < now ? "overdue" : ""
                    }
                  >
                    {s.next_deadline.type}:{" "}
                    {new Date(s.next_deadline.at).toLocaleString()} ·{" "}
                    {Date.parse(s.next_deadline.at) < now
                      ? "Overdue"
                      : `${Math.ceil((Date.parse(s.next_deadline.at) - now) / 3600000)}h remaining`}
                  </span>
                )}
              </button>
            ))}
          </div>
          {loaded && !rows.length && (
            <div className="workspace-empty">
              <strong>
                {board.length
                  ? "No shipments match this view"
                  : "Start your first shipment"}
              </strong>
              <p>
                {board.length
                  ? "Try another reference or show the full queue."
                  : "Create a shipment below, then link its processed email cases and documents."}
              </p>
              {board.length > 0 && (
                <button
                  onClick={() => {
                    setQuery("");
                    setQueueFilter("all");
                  }}
                >
                  Clear search and filters
                </button>
              )}
            </div>
          )}
          <details className="shipment-card">
            <summary>+ Create shipment</summary>
            <form
              onSubmit={(e) => {
                const v = values(e);
                act({
                  action: "create",
                  title: v.title,
                  customer: v.customer,
                  carrier: v.carrier,
                  references: v.references
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                });
              }}
            >
              <label>
                Shipment title
                <input
                  name="title"
                  required
                  minLength={2}
                  maxLength={180}
                  placeholder="e.g. Jakarta export · booking ABC123"
                />
              </label>
              <label>
                Confirmed references, comma separated
                <input
                  name="references"
                  maxLength={1000}
                  placeholder="BL, booking or OC references"
                />
              </label>
              <label>
                Customer
                <input name="customer" maxLength={120} />
              </label>
              <label>
                Carrier
                <input name="carrier" maxLength={120} />
              </label>
              <button disabled={busy}>Create shipment</button>
            </form>
          </details>
        </aside>
        <section aria-label="Shipment details">
          {!shipment && (
            <div
              className="shipment-card shipment-welcome"
              role={selected ? "status" : undefined}
            >
              <h2>
                {selected
                  ? "Loading shipment…"
                  : "One place for the correction cycle"}
              </h2>
              <p>
                Select a shipment or create one. Link the request, source
                documents and later replies with their evidence. Conflicting
                references require your review.
              </p>
              {!selected && (
                <ol className="shipment-welcome-steps">
                  <li>
                    <strong>Link the evidence</strong>
                    <span>
                      Keep email, SI and draft BL revisions in one shipment.
                    </span>
                  </li>
                  <li>
                    <strong>Resolve the exception</strong>
                    <span>
                      Record amendments, assign follow-ups and confirm
                      deadlines.
                    </span>
                  </li>
                  <li>
                    <strong>Close with confidence</strong>
                    <span>
                      Review the latest comparison and retain its decision
                      history.
                    </span>
                  </li>
                </ol>
              )}
            </div>
          )}
          {shipment && detail && (
            <>
              <div className="shipment-heading">
                <div>
                  <h2>{shipment.title}</h2>
                  <p>
                    {shipment.references.join(" · ")} · Revision{" "}
                    {shipment.version} ·{" "}
                    {shipmentStatus(shipment, detail.cases).replaceAll(
                      "_",
                      " ",
                    )}
                  </p>
                </div>
                <strong>{shipment.owner || "Unassigned"}</strong>
                <button
                  disabled={busy}
                  onClick={() =>
                    act({
                      action: "assign",
                      owner: identity?.display_name ?? actor,
                      owner_id: identity?.id ?? null,
                      claim: true,
                      reason: "Claimed from shipment workspace",
                    })
                  }
                >
                  Claim shipment
                </button>
              </div>
              <nav className="shipment-tabs" aria-label="Shipment sections">
                {[
                  "documents",
                  "tasks",
                  "instructions",
                  "deadlines",
                  "history",
                ].map((t) => (
                  <button
                    key={t}
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </nav>
              {tab === "documents" && (
                <>
                  <div className="shipment-card">
                    <h3>Linked email and document history</h3>
                    <p>
                      Association is explicit. Booking or subject matches alone
                      do not establish the right shipment.
                    </p>
                    {detail.cases.map((c) => (
                      <div className="shipment-case" key={c.email.email_id}>
                        <div>
                          <Link
                            href={`/?case=${encodeURIComponent(c.email.email_id)}`}
                          >
                            {c.email.email_id} · {c.email.subject}
                          </Link>
                          <p>
                            {c.workflow.replaceAll("_", " ")} · revision{" "}
                            {c.version} · {c.summary}
                          </p>
                          {referenceCandidates(c.email).conflict && (
                            <p className="overdue">
                              Subject and body references conflict. Inspect both
                              before relying on this association.
                            </p>
                          )}
                        </div>
                        <button onClick={() => setCaseId(c.email.email_id)}>
                          Inspect
                        </button>
                        {shipment.comparison_case_id === c.email.email_id ? (
                          <strong>Current comparison</strong>
                        ) : (
                          c.category === "BL_COMPARISON" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                act({
                                  action: "select_comparison",
                                  case_id: c.email.email_id,
                                  case_version: c.version,
                                  reason:
                                    "Selected after inspecting shipment evidence",
                                })
                              }
                            >
                              Use as current comparison
                            </button>
                          )
                        )}
                        <button
                          disabled={busy}
                          onClick={() =>
                            act({
                              action: "link",
                              case_id: c.email.email_id,
                              case_version: c.version,
                              unlink: true,
                              reason:
                                "Removed incorrect association; original case retained",
                            })
                          }
                        >
                          Unlink
                        </button>
                      </div>
                    ))}
                    <form
                      onSubmit={async (e) => {
                        const v = values(e);
                        try {
                          setError("");
                          const data = await requestJson<{
                            result: CaseResult;
                          }>(
                            `/api/shipments?candidate=${encodeURIComponent(v.case_id)}`,
                          );
                          setCandidate(data.result);
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Case could not be loaded.",
                          );
                        }
                      }}
                    >
                      <label>
                        Inspect a processed case before linking
                        <select name="case_id" required>
                          <option value="">Choose a case…</option>
                          {inbox
                            .filter(
                              (c) =>
                                c.result &&
                                !shipment.case_ids.includes(c.email.email_id),
                            )
                            .map((c) => (
                              <option
                                key={c.email.email_id}
                                value={c.email.email_id}
                              >
                                {c.email.email_id} · {c.email.subject}
                              </option>
                            ))}
                        </select>
                      </label>
                      <button disabled={busy}>Inspect proposed link</button>
                    </form>
                    {candidate && (
                      <div className="shipment-proposal">
                        <h4>{candidate.email.subject}</h4>
                        <p>{candidate.email.body}</p>
                        <p>
                          Observed references:{" "}
                          {referenceCandidates(candidate.email)
                            .candidates.map((r) => `${r.value} (${r.source})`)
                            .join("; ") || "None extracted"}
                        </p>
                        {referenceCandidates(candidate.email).conflict && (
                          <strong className="overdue">
                            References conflict. Confirm the correct shipment
                            from source evidence.
                          </strong>
                        )}
                        <form
                          onSubmit={(e) => {
                            const v = values(e);
                            act({
                              action: "link",
                              case_id: candidate.email.email_id,
                              case_version: candidate.version,
                              reason: v.reason,
                            }).then((ok) => {
                              if (ok) setCandidate(null);
                            });
                          }}
                        >
                          <label>
                            Why this email belongs to this shipment
                            <textarea
                              name="reason"
                              required
                              minLength={2}
                              maxLength={600}
                            />
                          </label>
                          <button disabled={busy}>Confirm association</button>
                        </form>
                      </div>
                    )}
                  </div>
                  {current && (
                    <div className="shipment-card">
                      <h3>Independent checks · {current.email.email_id}</h3>
                      <p>
                        Separate from the required seven-field SI comparison. A
                        valid check digit does not prove the physical container
                        exists.
                      </p>
                      <IntegrityChecks
                        assessment={checkDocumentIntegrity(current)}
                      />
                    </div>
                  )}
                  <details className="shipment-card">
                    <summary>Shipment details and handover notes</summary>
                    <form
                      key={shipment.version}
                      onSubmit={(e) => {
                        const v = values(e);
                        act({
                          action: "update",
                          title: v.title,
                          customer: v.customer,
                          carrier: v.carrier,
                          references: v.references
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                          notes: v.notes,
                        });
                      }}
                    >
                      <label>
                        Title
                        <input
                          name="title"
                          defaultValue={shipment.title}
                          required
                          maxLength={180}
                        />
                      </label>
                      <label>
                        Customer
                        <input
                          name="customer"
                          defaultValue={shipment.customer}
                          maxLength={120}
                        />
                      </label>
                      <label>
                        Carrier
                        <input
                          name="carrier"
                          defaultValue={shipment.carrier}
                          maxLength={120}
                        />
                      </label>
                      <label>
                        Confirmed references
                        <input
                          name="references"
                          defaultValue={shipment.references.join(", ")}
                        />
                      </label>
                      <label>
                        Shift notes
                        <textarea
                          name="notes"
                          defaultValue={shipment.notes}
                          maxLength={4000}
                        />
                      </label>
                      <button disabled={busy}>Save details</button>
                    </form>
                    <form
                      onSubmit={(e) => {
                        const v = values(e);
                        act({
                          action: "assign",
                          owner: v.owner,
                          owner_id: v.owner_id || null,
                          claim: false,
                          reason: v.reason,
                        });
                      }}
                    >
                      <label>
                        Reassign to name
                        <input name="owner" required maxLength={80} />
                      </label>
                      {identity && (
                        <label>
                          Team member ID
                          <input name="owner_id" required />
                        </label>
                      )}
                      <label>
                        Handover reason
                        <input name="reason" required maxLength={600} />
                      </label>
                      <button disabled={busy}>Reassign</button>
                    </form>
                  </details>
                  <div className="shipment-card">
                    <h3>Complete document-check work</h3>
                    <p>
                      Requires a selected current comparison, seven valid
                      matches, resolved tasks and no blocking independent
                      findings. Source changes reopen completion. This never
                      authorizes cargo release.
                    </p>
                    <form
                      onSubmit={(e) => {
                        const v = values(e);
                        act({
                          action: "complete",
                          cases: Object.fromEntries(
                            detail.cases.map((c) => [
                              c.email.email_id,
                              c.version,
                            ]),
                          ),
                          acknowledge_advisories: v.ack === "on",
                          reason: v.reason,
                        });
                      }}
                    >
                      <label className="shipment-inline">
                        <input type="checkbox" name="ack" />I inspected any
                        advisory findings and their source evidence.
                      </label>
                      <label>
                        Completion reason
                        <input
                          name="reason"
                          required
                          minLength={5}
                          maxLength={600}
                        />
                      </label>
                      <button disabled={busy}>Complete document check</button>
                    </form>
                    {shipment.state === "completed" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          act({
                            action: "reopen",
                            reason: "Further review requested",
                          })
                        }
                      >
                        Reopen for review
                      </button>
                    )}
                  </div>
                </>
              )}
              {tab === "tasks" && (
                <div className="shipment-card">
                  <h3>Requests and desk tasks</h3>
                  <p>
                    Drafts never imply dispatch. Waiting and done are
                    staff-recorded task states.
                  </p>
                  <form
                    onSubmit={(e) => {
                      const v = values(e),
                        c = detail.cases.find(
                          (c) => c.email.email_id === v.case_id,
                        );
                      if (c)
                        act({
                          action: "task",
                          case_id: c.email.email_id,
                          case_version: c.version,
                          kind: v.kind,
                          ...(v.kind === "si_draft" && v.template_id
                            ? {
                                template_id: v.template_id,
                                template_version: templates.find(
                                  (t) => t.id === v.template_id,
                                )?.version,
                              }
                            : {}),
                        });
                    }}
                  >
                    <label>
                      Source case
                      <select name="case_id" required>
                        {sourceOptions}
                      </select>
                    </label>
                    <label>
                      Task
                      <select name="kind">
                        <option value="missing_documents">
                          Request missing SI / BL
                        </option>
                        <option value="billing">
                          Billing task and acknowledgement
                        </option>
                        <option value="si_draft">
                          SI preparation worksheet
                        </option>
                        <option value="it_report">
                          Suspicious-message report
                        </option>
                        <option value="handover">Shift handover</option>
                      </select>
                    </label>
                    <label>
                      Approved SI template (only used for SI worksheets)
                      <select name="template_id">
                        <option value="">Start a blank worksheet</option>
                        {templates
                          .filter(
                            (t) =>
                              t.state === "approved" &&
                              t.customer.trim().toLocaleLowerCase() ===
                                shipment.customer.trim().toLocaleLowerCase(),
                          )
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} · v{t.version}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button disabled={busy || !detail.cases.length}>
                      Prepare draft
                    </button>
                  </form>
                  {shipment.tasks.map((task) => (
                    <details key={task.id} className="shipment-task">
                      <summary>
                        {task.title} · {task.state} ·{" "}
                        {task.owner || "Unassigned"}
                      </summary>
                      <form
                        key={task.updated_at}
                        onSubmit={(e) => {
                          const v = values(e);
                          act({
                            action: "update_task",
                            task_id: task.id,
                            body: v.body,
                            owner: v.owner,
                            state: v.state,
                            reason: v.reason,
                          });
                        }}
                      >
                        <label>
                          Draft / task notes
                          <textarea
                            name="body"
                            defaultValue={task.body}
                            rows={12}
                            required
                            maxLength={8000}
                          />
                        </label>
                        <label>
                          Responsible person
                          <input
                            name="owner"
                            defaultValue={task.owner}
                            maxLength={80}
                          />
                        </label>
                        <label>
                          State
                          <select name="state" defaultValue={task.state}>
                            <option value="draft">Draft</option>
                            <option value="working">Working</option>
                            <option value="waiting">
                              Waiting — recorded by staff
                            </option>
                            <option value="done">
                              Done — recorded by staff
                            </option>
                          </select>
                        </label>
                        <label>
                          Update reason
                          <input
                            name="reason"
                            required
                            minLength={2}
                            maxLength={600}
                          />
                        </label>
                        <button disabled={busy}>Save task</button>
                        <button
                          type="button"
                          onClick={() =>
                            download(`cargoguard-${task.kind}.txt`, task.body)
                          }
                        >
                          Download saved draft
                        </button>
                      </form>
                      {detail.cases.some(
                        (c) => c.email.email_id === task.case_id,
                      ) && (
                        <MicrosoftTaskDraft
                          shipmentId={shipment.id}
                          shipmentVersion={shipment.version}
                          task={task}
                          caseVersion={
                            detail.cases.find(
                              (c) => c.email.email_id === task.case_id,
                            )!.version
                          }
                        />
                      )}
                    </details>
                  ))}
                </div>
              )}
              {tab === "instructions" && (
                <div className="shipment-card">
                  <h3>Instruction amendments</h3>
                  <p>
                    Email instructions are proposals until approved. The
                    original SI comparison remains unchanged. Obtain a revised
                    SI before closing a remaining original-reference mismatch.
                  </p>
                  <label>
                    Instruction source email
                    <select
                      value={caseId}
                      onChange={(e) => setCaseId(e.target.value)}
                    >
                      {sourceOptions}
                    </select>
                  </label>
                  {current && (
                    <>
                      <details>
                        <summary>Source email text</summary>
                        <pre>{current.email.body}</pre>
                      </details>
                      {amendmentCandidates(current.email).map(
                        (proposal, index) => (
                          <div className="shipment-proposal" key={index}>
                            <strong>
                              Suggested {FIELD_LABELS[proposal.field]}:{" "}
                              {proposal.value}
                            </strong>
                            <blockquote>{proposal.quote}</blockquote>
                            <button
                              disabled={busy}
                              onClick={() =>
                                act({
                                  action: "propose_amendment",
                                  case_id: current.email.email_id,
                                  case_version: current.version,
                                  field: proposal.field,
                                  value: proposal.value,
                                  quote: proposal.quote,
                                })
                              }
                            >
                              Record for approval
                            </button>
                          </div>
                        ),
                      )}
                      <form
                        onSubmit={(e) => {
                          const v = values(e);
                          act({
                            action: "propose_amendment",
                            case_id: current.email.email_id,
                            case_version: current.version,
                            field: v.field as Field,
                            value: v.value,
                            quote: v.quote,
                          });
                        }}
                      >
                        <label>
                          Field
                          <select name="field">
                            {FIELDS.map((f) => (
                              <option key={f} value={f}>
                                {FIELD_LABELS[f]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Proposed value
                          <input name="value" required maxLength={1000} />
                        </label>
                        <label>
                          Exact instruction quote from this email
                          <textarea name="quote" required maxLength={2000} />
                        </label>
                        <button disabled={busy}>Propose amendment</button>
                      </form>
                    </>
                  )}
                  {shipment.amendments.map((a) => (
                    <div className="shipment-proposal" key={a.id}>
                      <strong>
                        {FIELD_LABELS[a.field]} → {a.value} · {a.status}
                      </strong>
                      <blockquote>{a.quote}</blockquote>
                      <p>
                        {a.source_case} v{a.source_version} · proposed by{" "}
                        {a.proposed_by}
                        {a.decided_by ? ` · decided by ${a.decided_by}` : ""}
                      </p>
                      {a.status === "proposed" && (
                        <form
                          onSubmit={(e) => {
                            const v = values(e);
                            act({
                              action: "decide_amendment",
                              amendment_id: a.id,
                              approve: v.decision === "approve",
                              reason: v.reason,
                            });
                          }}
                        >
                          <label>
                            Verified authority, scope and decision reason
                            <input
                              name="reason"
                              required
                              minLength={5}
                              maxLength={600}
                            />
                          </label>
                          <select name="decision">
                            <option value="approve">
                              Approve instruction interpretation
                            </option>
                            <option value="reject">Reject proposal</option>
                          </select>
                          <button disabled={busy}>Record decision</button>
                        </form>
                      )}
                      {a.status === "approved" && (
                        <form
                          onSubmit={(e) => {
                            const v = values(e);
                            act({
                              action: "withdraw_amendment",
                              amendment_id: a.id,
                              reason: v.reason,
                            });
                          }}
                        >
                          <label>
                            Reason for withdrawing this approved instruction
                            <input
                              name="reason"
                              required
                              minLength={5}
                              maxLength={600}
                            />
                          </label>
                          <button disabled={busy}>
                            Withdraw instruction approval
                          </button>
                        </form>
                      )}
                    </div>
                  ))}
                  {overlay?.blocked && <p role="status">{overlay.blocked}</p>}
                  {overlay && overlay.applied.length > 0 && (
                    <>
                      <h4>Comparison against approved instructions</h4>
                      {overlay.blocked && (
                        <p role="status">{overlay.blocked}</p>
                      )}
                      <table>
                        <thead>
                          <tr>
                            <th>Field</th>
                            <th>Effective instruction</th>
                            <th>BL</th>
                            <th>Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {overlay.rows.map((row) => (
                            <tr key={row.field}>
                              <td>{FIELD_LABELS[row.field]}</td>
                              <td>{row.si.raw}</td>
                              <td>{row.bl.raw}</td>
                              <td>{row.result}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}
              {tab === "deadlines" && (
                <div className="shipment-card">
                  <h3>Confirmed deadlines</h3>
                  <p>
                    ETD remains a departure estimate and is excluded from
                    action-deadline priority. Confirm the date, timezone and
                    source before saving. A case revision makes its deadline
                    require reconfirmation.
                  </p>
                  <details>
                    <summary>Deadline phrases found in linked emails</summary>
                    {detail.cases.flatMap((c) =>
                      deadlineCandidates(c.email).map((d, index) => (
                        <blockquote key={`${c.email.email_id}:${index}`}>
                          {d.quote}
                          <small>
                            {" "}
                            — {c.email.email_id}, suggested {d.type}. Confirm
                            the date and timezone below.
                          </small>
                        </blockquote>
                      )),
                    )}
                  </details>
                  <form
                    onSubmit={(e) => {
                      const v = values(e),
                        c = detail.cases.find(
                          (c) => c.email.email_id === v.case_id,
                        );
                      if (c)
                        act({
                          action: "deadline",
                          case_id: c.email.email_id,
                          case_version: c.version,
                          type: v.type,
                          at: v.at,
                          zone: v.zone,
                          quote: v.quote,
                        });
                    }}
                  >
                    <label>
                      Source case
                      <select name="case_id" required>
                        {sourceOptions}
                      </select>
                    </label>
                    <label>
                      Deadline type
                      <select name="type">
                        {deadlineTypes.map((t) => (
                          <option key={t}>{t}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Confirmed date/time with offset
                      <input
                        name="at"
                        placeholder="2026-09-28T15:00:00+08:00"
                        required
                      />
                    </label>
                    <label>
                      IANA timezone
                      <input
                        name="zone"
                        defaultValue={
                          Intl.DateTimeFormat().resolvedOptions().timeZone
                        }
                        required
                      />
                    </label>
                    <label>
                      Exact quote from the email or document
                      <textarea name="quote" required maxLength={1000} />
                    </label>
                    <button disabled={busy || !detail.cases.length}>
                      Confirm deadline
                    </button>
                  </form>
                  {shipment.deadlines.map((d) => (
                    <div className="shipment-proposal" key={d.id}>
                      <strong>
                        {d.type} ·{" "}
                        {new Date(d.at).toLocaleString(undefined, {
                          timeZone: d.zone,
                        })}{" "}
                        ({d.zone})
                      </strong>
                      <blockquote>{d.quote}</blockquote>
                      <p>
                        {d.source_case} v{d.source_version} · confirmed by{" "}
                        {d.confirmed_by}
                        {!detail.cases.some(
                          (c) =>
                            c.email.email_id === d.source_case &&
                            c.version === d.source_version,
                        ) && " · SOURCE CHANGED — reconfirm"}
                      </p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          act({
                            action: "remove_deadline",
                            deadline_id: d.id,
                            reason: "Superseded deadline removed by reviewer",
                          })
                        }
                      >
                        Remove superseded deadline
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {tab === "history" && (
                <div className="shipment-card">
                  <h3>Immutable operational history</h3>
                  <p>
                    Original email comparisons and their source revisions remain
                    in each linked case.
                  </p>
                  {detail.history.map((h) => (
                    <details key={h.version}>
                      <summary>
                        v{h.version} · {h.action} · {h.actor} ·{" "}
                        {new Date(h.created_at).toLocaleString()}
                      </summary>
                      <pre>
                        {JSON.stringify(JSON.parse(h.payload), null, 2)}
                      </pre>
                    </details>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
