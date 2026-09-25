"use client";
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { formatReceived } from "./inbox-view";
import { operationsSnapshot } from "@/lib/operations";
import { senderScores } from "@/lib/sender-insights";
import {
  FIELDS,
  FIELD_LABELS,
  type CaseSummary,
  type ReviewReason,
} from "@/lib/types";

type Outcome = "mismatch" | "review" | "missing" | "ok";
const OUTCOME: Record<Outcome, { label: string; order: number }> = {
  mismatch: { label: "Mismatch", order: 0 },
  review: { label: "Needs review", order: 1 },
  missing: { label: "Missing documents", order: 2 },
  ok: { label: "No mismatch detected", order: 3 },
};
const REVIEW_TEXT: Record<ReviewReason, string> = {
  wrong_doc_type: "Choose which file is the SI and which is the BL",
  missing_attachment: "SI or BL not attached",
  unreadable: "A document could not be read",
  missing_value: "A value could not be found",
  uncertain_category: "Confirm the email type",
};

/** Emails whose type a person must confirm first (not yet a document check). */
function typeToConfirm(row: CaseSummary) {
  const r = row.result;
  return !!r && r.classification.needs_review && !r.category_override;
}
function outcomeOf(row: CaseSummary): Outcome | null {
  const r = row.result;
  if (!r || typeToConfirm(row)) return null;
  if (r.workflow === "discrepancy") return "mismatch";
  if (r.workflow === "verified") return "ok";
  if (r.workflow === "awaiting_documents") return "missing";
  if (r.workflow === "review") return "review";
  return null;
}
function attentionOf(row: CaseSummary, outcome: Outcome) {
  const r = row.result!;
  if (outcome === "mismatch")
    return r.defect_fields.map((field) => FIELD_LABELS[field]).join(", ");
  if (outcome === "ok") return "All 7 details match";
  if (r.review_reason) return REVIEW_TEXT[r.review_reason];
  return "Check the documents";
}

/**
 * The report the use case asks for: which email was checked, whether a
 * mismatch was found and exactly what needs attention — nothing else.
 */
export function ReportsOverview({
  cases,
  loading,
  onOpen,
}: {
  cases: CaseSummary[];
  loading: boolean;
  onOpen: (id: string, order: string[]) => void;
}) {
  const [all, setAll] = useState(false);
  const checks = useMemo(
    () =>
      cases
        .map((row) => ({ row, outcome: outcomeOf(row) }))
        .filter(
          (item): item is { row: CaseSummary; outcome: Outcome } =>
            item.outcome !== null,
        )
        .sort(
          (a, b) =>
            OUTCOME[a.outcome].order - OUTCOME[b.outcome].order ||
            (b.row.email.received_at ?? "").localeCompare(
              a.row.email.received_at ?? "",
            ),
        ),
    [cases],
  );
  const count = (outcome: Outcome) =>
    checks.filter((item) => item.outcome === outcome).length;
  const checked = cases.filter((row) => row.result).length;
  const other = cases.filter(
    (row) => row.result?.workflow === "routed" && !typeToConfirm(row),
  );
  const otherCount = (category: string) =>
    other.filter((row) => row.result?.category === category).length;
  const unconfirmed = cases.filter(typeToConfirm).length;
  const snapshot = operationsSnapshot(cases);
  const fields = [...FIELDS]
    .map((field) => ({ field, n: snapshot.fieldCounts[field] }))
    .sort((a, b) => b.n - a.n);
  const maximum = Math.max(1, ...fields.map((item) => item.n));
  const order = checks.map((item) => item.row.email.email_id);
  const shown = all ? checks : checks.slice(0, 10);
  const wait = loading && !cases.length;
  const n = (value: number) => (wait ? "–" : value.toLocaleString());

  return (
    <div className="cg-report">
      <section className="cg-kpis" aria-label="Summary">
        <div>
          <span>Emails checked</span>
          <strong>{n(checked)}</strong>
          <small>of {n(cases.length)} received</small>
        </div>
        <div className="red">
          <span>Mismatch found</span>
          <strong>{n(count("mismatch"))}</strong>
          <small>BL differs from the SI</small>
        </div>
        <div className="blue">
          <span>Needs review</span>
          <strong>{n(count("review") + count("missing"))}</strong>
          <small>A person must confirm</small>
        </div>
        <div className="green">
          <span>No mismatch detected</span>
          <strong>{n(count("ok"))}</strong>
          <small>All 7 details match</small>
        </div>
      </section>

      <div className="cg-report-grid">
        <section
          className="cg-card cg-report-table"
          aria-label="Document checks"
        >
          <header>
            <h2>Document checks</h2>
            <span>{checks.length} emails with an SI and BL</span>
          </header>
          {checks.length ? (
            <table>
              <thead>
                <tr>
                  <th scope="col">Email</th>
                  <th scope="col">Result</th>
                  <th scope="col">What to check</th>
                  <th scope="col">
                    <span className="cg-sr">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ row, outcome }) => {
                  const received = formatReceived(row.email.received_at);
                  return (
                    <tr
                      key={row.email.email_id}
                      onClick={() => onOpen(row.email.email_id, order)}
                    >
                      <td>
                        <button
                          type="button"
                          className="cg-report-subject"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(row.email.email_id, order);
                          }}
                        >
                          {row.email.subject}
                        </button>
                        <small>
                          {row.email.insight?.sender_name || row.email.from}
                          {received ? ` · ${received.day}` : ""}
                        </small>
                      </td>
                      <td>
                        <span className={`cg-result ${outcome}`}>
                          {OUTCOME[outcome].label}
                        </span>
                      </td>
                      <td className="cg-report-attention">
                        {attentionOf(row, outcome)}
                      </td>
                      <td aria-hidden="true">
                        <ChevronRight size={18} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="cg-report-empty">
              {wait
                ? "Loading…"
                : "No document checks yet. Press “Check new emails” in the inbox."}
            </p>
          )}
          {checks.length > 10 && (
            <button className="cg-report-more" onClick={() => setAll(!all)}>
              {all ? "Show fewer" : `Show all ${checks.length}`}
            </button>
          )}
        </section>

        <aside className="cg-report-side">
          <section
            className="cg-card cg-card-pad"
            aria-label="Common differences"
          >
            <h2>Common differences</h2>
            <ul className="cg-bars">
              {fields.map(({ field, n }) => (
                <li key={field}>
                  <span>{FIELD_LABELS[field]}</span>
                  <b>{n}</b>
                  <i>
                    <em style={{ width: `${(n / maximum) * 100}%` }} />
                  </i>
                </li>
              ))}
            </ul>
          </section>
          <SenderQuality cases={cases} />
          <section className="cg-card cg-card-pad" aria-label="Other emails">
            <h2>Other emails</h2>
            <dl className="cg-report-other">
              <dt>Shipping Instruction requests</dt>
              <dd>{otherCount("SI_REQUEST")}</dd>
              <dt>Invoice questions</dt>
              <dd>{otherCount("INVOICE_QUERY")}</dd>
              <dt>General updates</dt>
              <dd>{otherCount("GENERAL")}</dd>
              <dt>Spam</dt>
              <dd>{otherCount("SPAM")}</dd>
              {unconfirmed > 0 && (
                <>
                  <dt>Email type to confirm</dt>
                  <dd>{unconfirmed}</dd>
                </>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Which companies send drafts with mistakes — something to raise with them. */
function SenderQuality({ cases }: { cases: CaseSummary[] }) {
  const scores = useMemo(
    () => senderScores(cases).filter((score) => score.with_errors > 0),
    [cases],
  );
  if (!scores.length) return null;
  return (
    <section
      className="cg-card cg-card-pad"
      aria-label="Who sends drafts with mistakes"
    >
      <h2>Who sends drafts with mistakes</h2>
      <p className="cg-small cg-muted" style={{ marginTop: 0 }}>
        Per sending company. Use it to ask a forwarder or carrier to check
        before they send.
      </p>
      <ol className="cg-senders">
        {scores.slice(0, 6).map((score) => (
          <li key={score.company}>
            <span>
              <strong>{score.company}</strong>
              <small>
                {score.with_errors} of {score.checked} drafts wrong
                {score.top[0]
                  ? ` · most often ${score.top[0].label.toLowerCase()}`
                  : ""}
                {score.checked < 5 ? " · few emails so far" : ""}
              </small>
            </span>
            <b className={score.rate >= 0.5 ? "bad" : ""}>
              {Math.round(score.rate * 100)}%
            </b>
          </li>
        ))}
      </ol>
    </section>
  );
}
