"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { WorkspaceNav } from "./workspace-nav";
import { requestJson } from "@/lib/client-api";
import {
  FIELDS,
  FIELD_LABELS,
  type CaseResult,
  type CaseSummary,
  type Field,
} from "@/lib/types";
import type { LabelRule, RuleImpact } from "@/lib/label-rules";
import "@/app/label-rule.css";

type Registry = {
  rules: LabelRule[];
  approved_last_7_days: number;
  active_rules: number;
  cases_assisted: number;
};
type Preview = {
  rule: LabelRule;
  token: string;
  affected: RuleImpact[];
  newly_verified: number;
  skipped: number;
};
export function LabelRuleDesk() {
  const [registry, setRegistry] = useState<Registry | null>(null),
    [cases, setCases] = useState<CaseSummary[]>([]);
  const [source, setSource] = useState<CaseResult | null>(null),
    [sourceId, setSourceId] = useState("");
  const [sha, setSha] = useState(""),
    [label, setLabel] = useState(""),
    [field, setField] = useState<Field>("port_of_loading");
  const [actor, setActor] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [ack, setAck] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [mayApprove, setMayApprove] = useState(false);
  const [inspection, setInspection] = useState<CaseResult | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      requestJson<Registry>("/api/label-rules", { signal: abort.signal }),
      requestJson<{ cases: CaseSummary[] }>("/api/inbox", {
        signal: abort.signal,
      }),
      requestJson<{
        mode: string;
        user?: { display_name: string; role: string };
      }>("/api/auth", { signal: abort.signal }),
    ])
      .then(([rules, inbox, identity]) => {
        if (abort.signal.aborted) return;
        setRegistry(rules);
        setCases(inbox.cases.filter((row) => row.result));
        setMayApprove(
          identity.mode === "demo" ||
            ["admin", "reviewer"].includes(identity.user?.role ?? ""),
        );
        setActor(identity.user?.display_name ?? "Demo reviewer");
      })
      .catch((error) => {
        if (!abort.signal.aborted) setError(error.message);
      });
    return () => abort.abort();
  }, []);
  async function action(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const doc = source?.documents.find((doc) => doc.sha256 === sha);
  const headings = [
    ...new Set(
      doc?.lines
        .map((line) => line.text.match(/^([^:：]+)[:：]/)?.[1]?.trim())
        .filter(
          (label): label is string =>
            !!label && /^[\p{L}\s/()._-]{2,80}$/u.test(label),
        ) ?? [],
    ),
  ];
  async function decide(rule: LabelRule, actionName: "approve" | "disable") {
    await action(async () => {
      await requestJson("/api/label-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: actionName,
          rule_id: rule.id,
          version: rule.version,
          actor,
          ...(actionName === "approve"
            ? { preview_token: preview?.token, acknowledge_new_verified: ack }
            : {}),
        }),
      });
      setPreview(null);
      setInspection(null);
      setAck(false);
      setRegistry(await requestJson<Registry>("/api/label-rules"));
      setNotice(
        actionName === "approve"
          ? "Approved. Future source processing can use this mapping; saved decisions remain unchanged."
          : "Rule disabled. Reprocess affected cases to remove it from future decisions; previous evidence remains in history.",
      );
    });
  }
  return (
    <main
      className="label-rule-desk"
      id="main-content"
      tabIndex={-1}
      aria-labelledby="rules-page-title"
    >
      <WorkspaceNav active="/rules" />
      <header>
        <p className="workspace-eyebrow">Reviewer-approved learning</p>
        <h1 id="rules-page-title">Learned document headings</h1>
        <p>
          Teach an unfamiliar heading once, after reviewing its impact. Rules
          map labels only; they never change a company, weight, quantity or
          comparison tolerance.
        </p>
        <details className="rule-scope-details">
          <summary>How mapping scope protects your evidence</summary>
          <p>
            Each mapping is limited to the same document role, file format and
            exact set of headings. This template signature does not establish an
            issuer’s identity. Rule-assisted cases remain separately identified
            from untouched benchmark results.
          </p>
        </details>
      </header>
      {error && (
        <p className="alert error" role="alert">
          {error} <a href="/rules">Reload rules</a>
        </p>
      )}
      {notice && (
        <p className="alert success" role="status">
          {notice}
        </p>
      )}
      {!registry && !error && (
        <p className="workspace-status" role="status">
          Loading approved mappings and available source evidence…
        </p>
      )}
      {busy && (
        <p className="workspace-status" role="status">
          Checking the saved evidence and updating this registry…
        </p>
      )}
      {registry && (
        <div className="rule-metrics">
          <p>
            <strong>{registry.approved_last_7_days}</strong> rules approved in
            the last 7 days
          </p>
          <p>
            <strong>{registry.active_rules}</strong> active mappings
          </p>
          <p>
            <strong>{registry.cases_assisted}</strong> saved cases with rule
            evidence
          </p>
        </div>
      )}
      <section>
        <h2>
          <span className="workspace-step" aria-hidden="true">
            1
          </span>
          Propose from an original document
        </h2>
        <p className="rule-help">
          Choose a saved case, inspect its original document, then map the
          unfamiliar heading to one verified field.
        </p>
        {registry && !cases.length && (
          <div className="workspace-empty">
            <strong>Process a document first</strong>
            <p>
              Return to the work queue and process a source case. Its original
              headings will then be available here.
            </p>
            <Link href="/">Open work queue</Link>
          </div>
        )}
        <label>
          Processed source case
          <select
            value={sourceId}
            disabled={busy || !registry || !cases.length}
            onChange={(event) => {
              setSourceId(event.target.value);
              setSource(null);
              setSha("");
              setLabel("");
            }}
          >
            <option value="">Choose a processed case</option>
            {cases.map((row) => (
              <option key={row.email.email_id} value={row.email.email_id}>
                {row.email.email_id} · {row.email.subject}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={busy || !sourceId}
          onClick={() =>
            action(async () => {
              const result = await requestJson<{ result: CaseResult }>(
                `/api/cases?id=${encodeURIComponent(sourceId)}`,
              );
              setSource(result.result);
              setSha("");
              setLabel("");
            })
          }
        >
          Load source evidence
        </button>
        {source && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                await requestJson("/api/label-rules", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "propose",
                    id: source.email.email_id,
                    case_version: source.version,
                    sha256: sha,
                    label,
                    field,
                    actor,
                  }),
                });
                setRegistry(await requestJson<Registry>("/api/label-rules"));
                setNotice(
                  "Proposal saved. A reviewer must preview the impact before approving it.",
                );
                setPreview(null);
              });
            }}
          >
            <label>
              Original source document
              <select
                required
                value={sha}
                disabled={busy}
                onChange={(event) => {
                  setSha(event.target.value);
                  setLabel("");
                }}
              >
                <option value="">Choose SI or BL</option>
                {source.documents
                  .filter(
                    (doc) =>
                      !doc.error &&
                      !doc.transcription &&
                      !doc.recovery &&
                      doc.sha256 &&
                      ["SI", "BL"].includes(doc.type),
                  )
                  .map((doc) => (
                    <option key={doc.name} value={doc.sha256}>
                      {doc.name} · {doc.type}
                    </option>
                  ))}
              </select>
            </label>
            {doc && (
              <>
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`/api/document?id=${encodeURIComponent(source.email.email_id)}&name=${encodeURIComponent(doc.name)}&revision=${source.version}`}
                >
                  Inspect original · revision {source.version}
                </a>
                <label>
                  Exact source heading
                  <select
                    required
                    disabled={busy}
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                  >
                    <option value="">Select an unfamiliar heading</option>
                    {headings.map((heading) => (
                      <option key={heading}>{heading}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              Meaning
              <select
                value={field}
                disabled={busy}
                onChange={(event) => setField(event.target.value as Field)}
              >
                {FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {FIELD_LABELS[field]}
                  </option>
                ))}
              </select>
            </label>
            <button className="button primary" disabled={busy || !label}>
              Save proposal
            </button>
          </form>
        )}
      </section>
      <section>
        <h2>
          <span className="workspace-step" aria-hidden="true">
            2
          </span>
          Preview, approve and manage
        </h2>
        <p>
          Approval and disabling require a reviewer or administrator in team
          mode. Disabling is the rollback operation; existing revisions and
          their original rule evidence remain immutable.
        </p>
        {registry?.rules.length === 0 && (
          <div className="workspace-empty">
            <strong>No custom mappings yet</strong>
            <p>
              Propose an unfamiliar heading from the source evidence above.
              Already recognized headings, including “Load Port”, do not need
              new rules.
            </p>
          </div>
        )}
        {registry?.rules.map((rule) => (
          <article key={rule.id} className="label-rule-card">
            <h3>
              {rule.label} → {FIELD_LABELS[rule.field]}
            </h3>
            <span className={`workspace-badge ${rule.state}`}>
              {rule.state === "active"
                ? "Active mapping"
                : rule.state === "proposed"
                  ? "Awaiting approval"
                  : "Disabled"}
            </span>
            <p>
              Revision {rule.version} · {rule.role} · {rule.format} · template{" "}
              {rule.template_signature.slice(0, 12)}
            </p>
            <p>
              Proposed by {rule.proposed_by}
              {rule.approved_by
                ? ` · Last decision by ${rule.approved_by}`
                : ""}
            </p>
            {rule.state === "proposed" && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    const data = await requestJson<{ preview: Preview }>(
                      `/api/label-rules?preview=${rule.id}`,
                    );
                    setPreview(data.preview);
                    setAck(false);
                  })
                }
              >
                Preview impact
              </button>
            )}
            {rule.state === "active" && (
              <button
                className="button secondary"
                disabled={busy || !mayApprove}
                onClick={() => decide(rule, "disable")}
              >
                Disable mapping
              </button>
            )}
            {preview?.rule.id === rule.id && (
              <div className="rule-preview">
                <h4>Current impact preview</h4>
                <p>
                  {preview.affected.length} matching cases;{" "}
                  {preview.newly_verified} would become verified.{" "}
                  {preview.skipped} older-engine or manually corrected cases
                  were excluded from this automatic impact preview.
                </p>
                <ul>
                  {preview.affected.map((impact) => (
                    <li key={impact.case_id}>
                      {impact.case_id}: {impact.before} → {impact.after}
                      {impact.newly_verified
                        ? " · newly verified: inspect carefully"
                        : ""}{" "}
                      <button
                        type="button"
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          action(async () => {
                            const data = await requestJson<{
                              result: CaseResult;
                            }>(
                              `/api/cases?id=${encodeURIComponent(impact.case_id)}`,
                            );
                            setInspection(data.result);
                          })
                        }
                      >
                        Inspect case sources
                      </button>
                    </li>
                  ))}
                </ul>
                {inspection && (
                  <aside className="rule-source-inspection">
                    <h4>
                      Source evidence · {inspection.email.email_id} · revision{" "}
                      {inspection.version}
                    </h4>
                    {inspection.documents.map((doc) => (
                      <details key={doc.name}>
                        <summary>
                          {doc.name} · {doc.type}
                        </summary>
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={`/api/document?id=${encodeURIComponent(inspection.email.email_id)}&name=${encodeURIComponent(doc.name)}&revision=${inspection.version}`}
                        >
                          Open original document
                        </a>
                        <pre>
                          {doc.lines
                            .map((line) => `${line.location}: ${line.text}`)
                            .join("\n") ||
                            doc.error ||
                            "No extracted text; inspect the original."}
                        </pre>
                      </details>
                    ))}
                  </aside>
                )}
                <p>
                  Preview recomputes extracted evidence with the proposed
                  mapping. It does not update any case. Verify that all newly
                  verified outcomes are intended.
                </p>
                <label className="rule-ack">
                  <input
                    type="checkbox"
                    checked={ack}
                    onChange={(event) => setAck(event.target.checked)}
                  />
                  I inspected the source heading, scope and impact, including
                  every newly verified case.
                </label>
                <button
                  className="button primary"
                  disabled={busy || !mayApprove || !ack}
                  onClick={() => decide(rule, "approve")}
                >
                  Approve mapping
                </button>
              </div>
            )}
          </article>
        ))}
      </section>
    </main>
  );
}
