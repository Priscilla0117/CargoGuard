"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  GeneralDigest,
  HistoricalAdvisories,
  InsightFilters,
  OperationalAnalytics,
  OperationalSearch,
} from "@/lib/operational-insights";
import { FIELD_LABELS } from "@/lib/types";
import "@/app/insights.css";

interface InsightsResponse {
  as_of: string;
  filters: InsightFilters;
  question: { supported: boolean; explanation: string } | null;
  search: OperationalSearch;
  analytics: OperationalAnalytics;
  digest: GeneralDigest;
  historical_advisories: HistoricalAdvisories;
  scope: string;
}
const rate = (value: number | null) =>
  value === null ? "Not enough evidence" : `${(value * 100).toFixed(1)}%`;
const date = (value: string) => new Date(value).toLocaleString();
export function InsightsDesk() {
  const [data, setData] = useState<InsightsResponse | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [question, setQuestion] = useState("");
  const sequence = useRef(0);
  const latestQuery = useRef("status=open_mismatches");
  async function load(query = "status=open_mismatches") {
    latestQuery.current = query;
    const request = ++sequence.current;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/insights?${query}`, {
        cache: "no-store",
      });
      const value = (await response.json()) as InsightsResponse & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(value.error ?? "Insights failed to load.");
      if (request === sequence.current) setData(value);
    } catch (e) {
      if (request === sequence.current)
        setError(e instanceof Error ? e.message : "Insights failed to load.");
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  useEffect(() => {
    let active = true;
    const request = ++sequence.current;
    fetch("/api/insights?status=open_mismatches", { cache: "no-store" })
      .then(async (response) => {
        const value = (await response.json()) as InsightsResponse & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(value.error ?? "Insights failed to load.");
        if (active && request === sequence.current) setData(value);
      })
      .catch((error: unknown) => {
        if (active && request === sequence.current)
          setError(
            error instanceof Error ? error.message : "Insights failed to load.",
          );
      })
      .finally(() => {
        if (active && request === sequence.current) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);
  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setQuestion("");
    void load(
      new URLSearchParams(
        [...fields.entries()].map(([key, value]) => [key, String(value)]),
      ).toString(),
    );
  }
  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(new URLSearchParams({ q: question }).toString());
  }
  return (
    <main
      className="insights-shell"
      id="main-content"
      tabIndex={-1}
      aria-labelledby="insights-page-title"
    >
      <header>
        <div>
          <p className="insights-eyebrow">Evidence for the next action</p>
          <h1 id="insights-page-title">Workspace insights</h1>
          <p>
            Search saved cases, inspect where discrepancies occur, and read a
            digest linked to the original evidence.
          </p>
        </div>
        <button onClick={() => void load(latestQuery.current)} disabled={busy}>
          Refresh snapshot
        </button>
      </header>
      {error && (
        <p role="alert" className="insights-error">
          {error}{" "}
          <button
            disabled={busy}
            onClick={() => void load(latestQuery.current)}
          >
            Retry this view
          </button>
        </p>
      )}
      {busy && (
        <p role="status" className="workspace-status">
          {data
            ? "Refreshing the saved evidence. The previous snapshot remains visible below…"
            : "Reading saved cases, shipment deadlines and review evidence…"}
        </p>
      )}
      <section
        className="insights-card"
        aria-labelledby="insights-search-heading"
      >
        <h2 id="insights-search-heading">Ask the inbox</h2>
        <p>
          Supported questions become visible filters. Results come from saved
          cases; the system does not generate shipping facts.
        </p>
        <form className="insights-question" onSubmit={ask}>
          <label>
            Question
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={300}
              placeholder="Which Jakarta shipments still have open mismatches?"
              required
            />
          </label>
          <button disabled={busy}>Find cited cases</button>
        </form>
        <div
          className="insights-shortcuts"
          role="group"
          aria-label="Common inbox questions"
        >
          {[
            "Open mismatches",
            "Awaiting documents",
            "Overdue shipments",
            "Unassigned shipments",
            "Invoice queries",
            "General updates",
          ].map((prompt) => (
            <button
              type="button"
              disabled={busy}
              key={prompt}
              onClick={() => {
                setQuestion(prompt);
                void load(new URLSearchParams({ q: prompt }).toString());
              }}
            >
              {prompt}
            </button>
          ))}
        </div>
        <details>
          <summary>Use explicit filters</summary>
          <form
            className="insights-filters"
            onSubmit={search}
            key={JSON.stringify(data?.filters)}
          >
            <label>
              Work status
              <select
                name="status"
                defaultValue={data?.filters.status ?? "open_mismatches"}
              >
                <option value="all">All saved cases</option>
                <option value="open_mismatches">Open mismatches</option>
                <option value="awaiting_documents">Awaiting documents</option>
                <option value="review">Review needed</option>
                <option value="overdue">Overdue shipments</option>
                <option value="unassigned">Unassigned shipments</option>
                <option value="verified">Verified comparisons</option>
              </select>
            </label>
            <label>
              Email category
              <select
                name="category"
                defaultValue={data?.filters.category ?? "all"}
              >
                {[
                  "all",
                  "BL_COMPARISON",
                  "SI_REQUEST",
                  "INVOICE_QUERY",
                  "GENERAL",
                  "SPAM",
                ].map((category) => (
                  <option key={category} value={category}>
                    {category.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Port contains
              <input
                name="port"
                maxLength={100}
                defaultValue={data?.filters.port ?? ""}
              />
            </label>
            <label>
              Exact recorded customer
              <input
                name="customer"
                maxLength={120}
                defaultValue={data?.filters.customer ?? ""}
              />
            </label>
            <label>
              Exact recorded carrier
              <input
                name="carrier"
                maxLength={120}
                defaultValue={data?.filters.carrier ?? ""}
              />
            </label>
            <button disabled={busy}>Apply filters</button>
          </form>
        </details>
        {data && (
          <>
            <div className="insights-filter-summary">
              <strong>Applied filters:</strong>{" "}
              {Object.entries(data.filters)
                .filter(([, value]) => value && value !== "all")
                .map(
                  ([key, value]) =>
                    `${key.replaceAll("_", " ")}: ${value.replaceAll("_", " ")}`,
                )
                .join(" · ") || "All saved cases"}
            </div>
            {data.question && (
              <p role={data.question.supported ? "status" : "alert"}>
                {data.question.explanation}
              </p>
            )}
            <p role="status" className="insights-result-count">
              {data.search.total} matching cases
              {data.search.total > data.search.limit
                ? ` · showing first ${data.search.limit} by deadline`
                : ""}{" "}
              · As of {date(data.as_of)}
            </p>
            <div className="insights-results">
              {data.search.results.map((result) => (
                <article key={result.case_id}>
                  <div>
                    <Link href={result.href}>{result.subject}</Link>
                    <small>
                      {result.case_id} · revision {result.version} ·{" "}
                      {result.category}
                    </small>
                  </div>
                  <span className={`insights-state ${result.workflow}`}>
                    {result.workflow.replaceAll("_", " ")}
                  </span>
                  <p>{result.summary}</p>
                  {result.deadline && (
                    <p className="insights-due">
                      {result.deadline.type}: {date(result.deadline.at)} ·{" "}
                      {result.deadline.zone}
                    </p>
                  )}
                  <div>
                    {result.shipments.map((shipment) => (
                      <Link
                        className="insights-shipment-link"
                        key={shipment.id}
                        href={shipment.href}
                      >
                        {shipment.title} · {shipment.state}
                      </Link>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            {!data.search.results.length && (
              <div className="insights-empty">
                <strong>No saved cases match this view</strong>
                <p>
                  Broaden the filters or return to the work queue to process new
                  evidence.
                </p>
                <button
                  disabled={busy}
                  onClick={() => {
                    setQuestion("");
                    void load("status=all");
                  }}
                >
                  Show all saved cases
                </button>
                <Link href="/">Open work queue</Link>
              </div>
            )}
          </>
        )}
      </section>
      {data && (
        <>
          <section
            className="insights-card"
            aria-labelledby="insights-quality-heading"
          >
            <h2 id="insights-quality-heading">Document discrepancy trends</h2>
            <p>
              Workspace totals. Search filters above do not change these
              metrics.
            </p>
            <div className="insights-metrics">
              <div>
                <span>First-pass discrepancy rate</span>
                <strong>{rate(data.analytics.first_pass.rate)}</strong>
                <small>
                  {data.analytics.first_pass.discrepancies} /{" "}
                  {data.analytics.first_pass.eligible} eligible automatic
                  comparisons
                </small>
              </div>
              <div>
                <span>Current discrepancy rate</span>
                <strong>{rate(data.analytics.current.rate)}</strong>
                <small>
                  {data.analytics.current.discrepancies} /{" "}
                  {data.analytics.current.eligible} eligible saved comparisons
                </small>
              </div>
              <div>
                <span>Previously discrepant, now matching</span>
                <strong>{data.analytics.paired_resolved}</strong>
                <small>
                  Of {data.analytics.paired_discrepant_baselines} discrepant
                  baselines with an eligible current comparison
                </small>
              </div>
            </div>
            <p className="insights-help">{data.analytics.definition}</p>
            <p>
              {data.analytics.recorded_cases} saved cases ·{" "}
              {data.analytics.automatic_baselines} automatic baselines ·{" "}
              {data.analytics.ambiguous_attribution} shipment associations
              excluded from carrier rates because the selected comparison
              appears on multiple cards.
            </p>
            <div className="insights-table-wrap">
              <table>
                <caption>Fields with a detected difference</caption>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>First pass</th>
                    <th>Current</th>
                  </tr>
                </thead>
                <tbody>
                  {data.analytics.fields.map((item) => (
                    <tr key={item.field}>
                      <th>{FIELD_LABELS[item.field]}</th>
                      <td>{item.first_pass}</td>
                      <td>{item.current}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Recorded carrier association</h3>
            {!data.analytics.carriers.length ? (
              <p>
                No carrier attribution yet. Record a carrier on a shipment card
                and select its comparison case.
              </p>
            ) : (
              <div className="insights-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Recorded carrier</th>
                      <th>First pass</th>
                      <th>Current</th>
                      <th>Case evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.analytics.carriers.map((carrier) => (
                      <tr key={carrier.carrier}>
                        <th>{carrier.carrier}</th>
                        <td>
                          {carrier.first_pass.discrepancies}/
                          {carrier.first_pass.eligible} ·{" "}
                          {rate(carrier.first_pass.rate)}
                        </td>
                        <td>
                          {carrier.current.discrepancies}/
                          {carrier.current.eligible} ·{" "}
                          {rate(carrier.current.rate)}
                        </td>
                        <td>
                          {carrier.current.citations
                            .slice(0, 8)
                            .map((citation) => (
                              <Link key={citation.case_id} href={citation.href}>
                                {citation.case_id}{" "}
                              </Link>
                            ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <details>
              <summary>Automatic processing by week (UTC)</summary>
              <p>
                This is processing workload, not email arrivals or a measured
                employee time-saving trend.
              </p>
              <div className="insights-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Week starting</th>
                      <th>Automatic cases</th>
                      <th>Eligible comparisons</th>
                      <th>Discrepant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.analytics.weeks.map((week) => (
                      <tr key={week.week_start}>
                        <th>{week.week_start}</th>
                        <td>{week.automatic_cases}</td>
                        <td>{week.eligible_comparisons}</td>
                        <td>{week.discrepancies}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <section
            className="insights-card"
            aria-labelledby="insights-digest-heading"
          >
            <h2 id="insights-digest-heading">General update digest</h2>
            <p>
              Up to 20 current GENERAL cases outside completed shipment cards,
              ordered by confirmed document deadline then processing time.
              Quotes are untrusted source text; open the source before acting.
            </p>
            <div className="insights-digest">
              {data.digest.map((item) => (
                <article key={item.case_id}>
                  <Link href={item.href}>{item.subject}</Link>
                  <small>
                    {item.case_id} · revision {item.version}
                  </small>
                  <blockquote>{item.quote}</blockquote>
                  {item.deadline && (
                    <p className="insights-due">
                      {item.overdue ? "Overdue · " : ""}
                      {item.deadline.type}: {date(item.deadline.at)}
                    </p>
                  )}
                </article>
              ))}
            </div>
            {!data.digest.length && (
              <p>No saved GENERAL cases need this digest.</p>
            )}
          </section>
          <section className="insights-card">
            <h2>Consignee history advisories</h2>
            <p>
              Compares up to 12 earlier processed, explicitly linked shipments
              sharing the same recorded customer label. Requires at least three
              matching prior observations and 80% agreement. These are review
              prompts, not errors or automatic corrections.
            </p>
            {data.historical_advisories.map((item) => (
              <article
                className="insights-advisory"
                key={`${item.customer}-${item.current.case_id}`}
              >
                <h3>{item.customer}</h3>
                <p>
                  Current SI: <strong>{item.current_value}</strong>
                  <br />
                  Earlier SI value: {item.prior_value} ({item.prior_matches}/
                  {item.prior_total} earlier observations)
                </p>
                <Link href={item.current.href}>
                  Inspect {item.current.case_id}
                </Link>
                <p>
                  Prior sources:{" "}
                  {item.sources.map((source) => (
                    <Link key={source.case_id} href={source.href}>
                      {source.case_id}{" "}
                    </Link>
                  ))}
                </p>
                <small>{item.note}</small>
              </article>
            ))}
            {!data.historical_advisories.length && (
              <p>
                No supported historical deviations. This also occurs when there
                is insufficient comparable history.
              </p>
            )}
          </section>
          <footer>
            <p>{data.scope}</p>
            <p>
              No emails or notifications are sent from this page. Shipment
              release is not authorized by a comparison metric.
            </p>
          </footer>
        </>
      )}
    </main>
  );
}
