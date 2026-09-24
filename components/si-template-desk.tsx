"use client";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import type { SiTemplate } from "@/lib/si-templates";
import type { CaseSummary } from "@/lib/types";
import "@/app/insights.css";
import "@/app/si-template-desk.css";

interface TemplateData {
  templates: SiTemplate[];
  can_approve: boolean;
  actor: string;
}
export function SiTemplateDesk() {
  const [data, setData] = useState<TemplateData | null>(null),
    [cases, setCases] = useState<CaseSummary[]>([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [query, setQuery] = useState(""),
    [stateFilter, setStateFilter] = useState("all");
  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/si-templates", { cache: "no-store" }),
      fetch("/api/inbox", { cache: "no-store" }),
    ])
      .then(async ([templates, inbox]) => {
        const a = (await templates.json()) as TemplateData & { error?: string },
          b = (await inbox.json()) as { cases: CaseSummary[]; error?: string };
        if (!templates.ok || !inbox.ok)
          throw new Error(a.error ?? b.error ?? "Could not load templates.");
        if (active) {
          setData(a);
          setCases(
            b.cases.filter(
              (row) => row.result && row.result.category === "BL_COMPARISON",
            ),
          );
        }
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function save(input: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetch("/api/si-templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...input,
            actor: data?.actor ?? "Demo reviewer",
          }),
        }),
        body = (await response.json()) as {
          template: SiTemplate;
          error?: string;
        };
      if (!response.ok)
        throw new Error(body.error ?? "Template could not be saved.");
      setData((previous) =>
        previous
          ? {
              ...previous,
              templates: [
                body.template,
                ...previous.templates.filter(
                  (template) => template.id !== body.template.id,
                ),
              ],
            }
          : previous,
      );
      setNote(
        "Template saved with an immutable revision. No SI has been sent.",
      );
      return true;
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Template could not be saved.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function propose(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      values = new FormData(form),
      source = cases.find((row) => row.email.email_id === selected);
    if (!source?.result) {
      setError("Choose a processed comparison case with the reference SI.");
      return;
    }
    if (
      await save({
        action: "propose",
        name: values.get("name"),
        customer: values.get("customer"),
        source_case: selected,
        source_version: source.result.version,
      })
    ) {
      form.reset();
      setSelected("");
    }
  }
  const visibleTemplates =
    data?.templates.filter(
      (template) =>
        (stateFilter === "all" || template.state === stateFilter) &&
        `${template.name} ${template.customer}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
    ) ?? [];
  return (
    <main
      className="insights-shell template-desk"
      id="main-content"
      tabIndex={-1}
      aria-labelledby="templates-page-title"
    >
      <header>
        <div>
          <p className="insights-eyebrow">Approved party details only</p>
          <h1 id="templates-page-title">SI template registry</h1>
          <p>
            Propose stable party fields from a saved SI, inspect the evidence,
            and approve a named customer template. Shipment quantities and
            voyage details remain blank.
          </p>
        </div>
      </header>
      {error && (
        <p role="alert" className="insights-error">
          {error}{" "}
          <button type="button" onClick={() => window.location.reload()}>
            Reload latest sources
          </button>
        </p>
      )}
      {note && (
        <p role="status" className="workspace-status">
          {note}
        </p>
      )}
      {!data && !error && (
        <p role="status" className="workspace-status">
          Loading templates and current SI source cases…
        </p>
      )}
      {busy && (
        <p role="status" className="workspace-status">
          Saving the template decision and its evidence revision…
        </p>
      )}
      <section className="insights-card">
        <h2>
          <span className="workspace-step" aria-hidden="true">
            1
          </span>
          Propose a template
        </h2>
        <p className="insights-help">
          Start with a readable SI. Keep reusable party details separate from
          the voyage, dates, containers and quantities of each shipment.
        </p>
        {data && !cases.length && (
          <div className="workspace-empty">
            <strong>A processed SI source is needed</strong>
            <p>
              Process a BL comparison in the work queue, then select its
              reference SI here.
            </p>
            <Link href="/">Open work queue</Link>
          </div>
        )}
        <form className="insights-filters" onSubmit={propose}>
          <label>
            Template name
            <input
              name="name"
              required
              minLength={2}
              maxLength={120}
              placeholder="e.g. Customer · export parties"
              disabled={busy || !data}
            />
          </label>
          <label>
            Recorded customer name
            <input
              name="customer"
              required
              minLength={2}
              maxLength={120}
              placeholder="As recorded on the shipment"
              disabled={busy || !data}
            />
          </label>
          <label>
            Current SI source case
            <select
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
              required
              disabled={busy || !data || !cases.length}
            >
              <option value="">Select processed comparison</option>
              {cases.map((row) => (
                <option key={row.email.email_id} value={row.email.email_id}>
                  {row.email.email_id} · v{row.result!.version} ·{" "}
                  {row.email.subject}
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy || !data || !selected}>
            Propose from source evidence
          </button>
        </form>
        <p className="insights-help">
          Only shipper, consignee and notify party are copied from an
          unambiguous, readable SI. A reviewer must approve the proposal before
          a shipment task can use it. The customer&apos;s recorded name must
          match exactly apart from case and spacing.
        </p>
      </section>
      <section className="insights-card">
        <h2>
          <span className="workspace-step" aria-hidden="true">
            2
          </span>
          Review and manage templates
        </h2>
        {data && (
          <p>
            {
              data.templates.filter((template) => template.state === "approved")
                .length
            }{" "}
            approved ·{" "}
            {
              data.templates.filter((template) => template.state === "proposed")
                .length
            }{" "}
            awaiting approval · An updated source case requires a fresh proposal
            and approval before reuse.
          </p>
        )}
        {data && !data.can_approve && (
          <p className="workspace-status">
            You can propose templates. A reviewer or administrator must approve
            or disable them.
          </p>
        )}
        {data && data.templates.length > 0 && (
          <div className="template-filter-bar">
            <label>
              Find a template
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Template or customer name"
              />
            </label>
            <label>
              Approval state
              <select
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
              >
                <option value="all">All templates</option>
                <option value="proposed">Awaiting approval</option>
                <option value="approved">Approved</option>
                <option value="disabled">Disabled</option>
              </select>
            </label>
            <p role="status">
              {visibleTemplates.length} of {data.templates.length} templates
            </p>
          </div>
        )}
        {visibleTemplates.map((template) => (
          <article
            className="template-card"
            key={`${template.id}-${template.version}`}
          >
            <div className="template-card-heading">
              <h3>{template.name}</h3>
              <span className={`workspace-badge ${template.state}`}>
                {template.state === "proposed"
                  ? "Awaiting approval"
                  : template.state}
              </span>
            </div>
            <p>
              Customer: {template.customer} · template version{" "}
              {template.version}
            </p>
            <Link href={`/?case=${encodeURIComponent(template.source_case)}`}>
              Inspect SI source {template.source_case}, revision{" "}
              {template.source_version}
            </Link>
            <details className="template-source">
              <summary>Source document and fingerprint</summary>
              <small>{template.source_document}</small>
              <code>SHA-256 {template.source_sha256}</code>
            </details>
            <dl className="template-parties">
              {(["shipper", "consignee", "notify_party"] as const).map(
                (field) => (
                  <div key={field}>
                    <dt>
                      <strong>{field.replaceAll("_", " ")}</strong>
                    </dt>
                    <dd>
                      {template.fields[field].raw}
                      <small>Evidence: {template.fields[field].evidence}</small>
                    </dd>
                  </div>
                ),
              )}
            </dl>
            <p className="insights-help">
              Proposed by {template.proposed_by}
              {template.approved_by
                ? ` · approved by ${template.approved_by}`
                : ""}
            </p>
            {data?.can_approve && template.state === "proposed" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void save({
                    action: "approve",
                    id: template.id,
                    version: template.version,
                    confirmed: true,
                  });
                }}
              >
                <label className="template-confirm">
                  <input type="checkbox" required /> I checked these three party
                  fields against the SI for this recorded customer.
                </label>
                <button disabled={busy}>Approve template</button>
              </form>
            )}
            {data?.can_approve && template.state !== "disabled" && (
              <button
                className="template-disable"
                disabled={busy}
                onClick={() =>
                  void save({
                    action: "disable",
                    id: template.id,
                    version: template.version,
                  })
                }
              >
                Disable future use
              </button>
            )}
          </article>
        ))}
        {data && !data.templates.length && (
          <div className="workspace-empty">
            <strong>No saved templates yet</strong>
            <p>
              Use the form above to propose party details from a current SI.
              Once approved, the template becomes available in shipment SI draft
              tasks.
            </p>
          </div>
        )}
        {data && data.templates.length > 0 && !visibleTemplates.length && (
          <div className="workspace-empty">
            <strong>No matching templates</strong>
            <p>Try a different customer name or approval state.</p>
            <button
              onClick={() => {
                setQuery("");
                setStateFilter("all");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </section>
      <footer>
        <p>
          Templates assist preparation only. Confirm every field against the
          current order before issuing an SI. Approval is not cargo-release
          authorization.
        </p>
      </footer>
    </main>
  );
}
