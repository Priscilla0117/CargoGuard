"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, ShieldCheck, Loader2 } from "lucide-react";
import { requestJson } from "@/lib/client-api";
import {
  FIELDS,
  FIELD_LABELS,
  type Field,
  type ParsedDocument,
  type CaseResult,
  type AuditEvent,
} from "@/lib/types";
import type { RecoveryProposal } from "@/lib/recovery-schema";

interface Availability {
  enabled: boolean;
  provider: string;
  model: string;
  limits?: unknown;
}
const unchecked = () =>
  Object.fromEntries(FIELDS.map((field) => [field, false])) as Record<
    Field,
    boolean
  >;

export function EvidenceRecovery({
  doc,
  result,
  onSaved,
  onEvidence,
}: {
  doc: ParsedDocument;
  result: CaseResult;
  onSaved: (data: { result: CaseResult; audit: AuditEvent[] }) => void;
  onEvidence: (location: string) => void;
}) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [configError, setConfigError] = useState("");
  const [consent, setConsent] = useState(false);
  const [proposal, setProposal] = useState<RecoveryProposal | null>(null);
  const [confirmed, setConfirmed] = useState(unchecked);
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const mounted = useRef(false);
  const action = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const abort = new AbortController();
    requestJson<Availability>("/api/recovery", { signal: abort.signal })
      .then((data) => {
        if (!abort.signal.aborted) setAvailability(data);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setConfigError((e as Error).message);
      });
    return () => {
      mounted.current = false;
      abort.abort();
    };
  }, []);

  async function suggest() {
    if (busy || saving || !consent || !availability?.enabled) return;
    const request = ++action.current;
    setBusy(true);
    setError("");
    setProposal(null);
    setConfirmed(unchecked());
    setRole("");
    setStatus(
      "Requesting a source-linked proposal. No saved decision is changing…",
    );
    try {
      const data = await requestJson<{
        proposal: RecoveryProposal;
        cached: boolean;
      }>("/api/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suggest",
          id: result.email.email_id,
          version: result.version,
          name: doc.name,
          sha256: doc.sha256,
          externalProcessingConfirmed: true,
        }),
      });
      if (!mounted.current || action.current !== request) return;
      setProposal(data.proposal);
      setStatus(
        `${data.cached ? "Saved" : "New"} AI proposal ready. Check the document role and every field against the original source.`,
      );
    } catch (e) {
      if (mounted.current && action.current === request) {
        setError((e as Error).message);
        setStatus(
          "AI recovery did not complete. Your saved comparison is unchanged; manual review remains available.",
        );
      }
    } finally {
      if (mounted.current && action.current === request) setBusy(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !proposal ||
      saving ||
      busy ||
      !role ||
      !FIELDS.every(
        (f) => confirmed[f] && proposal.fields[f] && !proposal.fields[f]?.issue,
      )
    )
      return;
    const request = ++action.current;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setError("");
    try {
      const data = await requestJson<{
        result: CaseResult;
        audit: AuditEvent[];
      }>("/api/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "confirm",
          id: result.email.email_id,
          version: result.version,
          name: doc.name,
          sha256: doc.sha256,
          proposalId: proposal.id,
          role,
          confirmed,
          actor: form.get("actor"),
          reason: form.get("reason"),
        }),
      });
      if (mounted.current && action.current === request) onSaved(data);
    } catch (e) {
      if (mounted.current && action.current === request)
        setError((e as Error).message);
    } finally {
      if (mounted.current && action.current === request) setSaving(false);
    }
  }

  return (
    <section
      className="scan-assist evidence-recovery"
      aria-label="AI evidence recovery"
    >
      <div className="recovery-heading">
        <Sparkles size={19} />
        <h3>Recover fields with AI</h3>
      </div>
      <p>
        For unfamiliar layouts, AI suggests the seven shipment fields with exact
        source quotes. Citation checks prove the text exists, not that the model
        chose the right field. You must confirm each field; AI cannot approve a
        shipment.
      </p>
      {!availability && !configError && (
        <p role="status">Checking AI availability…</p>
      )}
      {configError && (
        <p className="alert warning" role="status">
          AI availability could not be checked. {configError} Manual source
          review still works.
        </p>
      )}
      {availability && !availability.enabled && (
        <p className="alert warning" role="status">
          External AI is not configured on this deployment. No document is sent
          and no simulated answer is shown. Local email routing, OCR and manual
          review remain available.
        </p>
      )}
      {availability?.enabled && (
        <>
          <p>
            <strong>
              Provider: {availability.provider} · Model: {availability.model}
            </strong>
          </p>
          <details>
            <summary>Inspect the text that will be shared</summary>
            <pre className="ocr-text">
              {doc.lines
                .map((line, i) => `L${i + 1} | ${line.location}\n${line.text}`)
                .join("\n\n")}
            </pre>
          </details>
          <label className="recovery-consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy || saving}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I confirm this is organiser/synthetic data and allow this document’s
            extracted text to be sent to {availability.provider}. I have checked
            it contains no confidential information.
          </label>
          <button
            className="button secondary"
            disabled={!consent || busy || saving}
            onClick={suggest}
          >
            {busy ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Sparkles size={16} />
            )}
            {busy
              ? "Reading source evidence…"
              : "Suggest fields from this document"}
          </button>
          <p>
            One document per request. Daily limits protect the public demo.
            Provider errors do not trigger automatic retries or change the case.
          </p>
        </>
      )}
      <p role="status" aria-live="polite">
        {status}
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {proposal && (
        <>
          <p className="alert warning">
            Unconfirmed AI proposal · {proposal.model}. The current verdict is
            unchanged. Proposal expires{" "}
            {new Date(proposal.expires_at).toLocaleString()}.
          </p>
          <details className="recovery-run-details">
            <summary>AI request details</summary>
            <p>
              Provider model: {proposal.resolved_model ?? proposal.model}
              {proposal.latency_ms !== undefined
                ? ` · ${Math.round(proposal.latency_ms)} ms`
                : ""}
              {proposal.usage
                ? ` · ${proposal.usage.input_tokens} input / ${proposal.usage.output_tokens} output tokens`
                : " · Token usage unavailable"}
            </p>
          </details>
          {!!proposal.warnings.length && (
            <ul className="recovery-warnings">
              {proposal.warnings.map((warning, i) => (
                <li key={i}>{warning}</li>
              ))}
            </ul>
          )}
          <form onSubmit={save}>
            <p className="recovery-confirmation-count">
              {FIELDS.filter((field) => confirmed[field]).length} of{" "}
              {FIELDS.length} fields checked against the original
            </p>
            <label>
              Confirm document role from its original heading
              <select
                required
                value={role}
                disabled={saving}
                onChange={(e) => {
                  setRole(e.target.value);
                  setConfirmed(unchecked());
                }}
              >
                <option value="">
                  Choose a role — AI suggests {proposal.role ?? "unknown"}
                </option>
                <option value="SI">Shipping Instruction (reference)</option>
                <option value="BL">Draft Bill of Lading</option>
              </select>
            </label>
            {FIELDS.map((field) => {
              const suggestion = proposal.fields[field];
              return (
                <fieldset key={field}>
                  <legend>{FIELD_LABELS[field]}</legend>
                  {suggestion ? (
                    <>
                      <p className="recovery-value">{suggestion.value}</p>
                      {suggestion.issue && (
                        <p className="alert warning">{suggestion.issue}</p>
                      )}
                      {[
                        ...suggestion.citations,
                        ...(suggestion.unit_citation
                          ? [suggestion.unit_citation]
                          : []),
                      ].map((citation, i) => (
                        <blockquote className="recovery-citation" key={i}>
                          <p>“{citation.quote}”</p>
                          <button
                            type="button"
                            className="source-link"
                            onClick={() =>
                              onEvidence(
                                doc.lines[citation.line - 1]?.location ?? "",
                              )
                            }
                          >
                            View source · L{citation.line} ·{" "}
                            {doc.lines[citation.line - 1]?.location ??
                              "Source line"}
                            {i >= suggestion.citations.length
                              ? " · unit evidence"
                              : ""}
                          </button>
                        </blockquote>
                      ))}
                    </>
                  ) : (
                    <p>
                      No supported value was proposed. Do not guess; inspect the
                      source or request a clearer document.
                    </p>
                  )}
                  <label className="recovery-consent">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed[field]}
                      disabled={
                        saving || !suggestion || !!suggestion.issue || !role
                      }
                      onChange={(e) =>
                        setConfirmed({
                          ...confirmed,
                          [field]: e.target.checked,
                        })
                      }
                    />
                    I checked the complete value, field meaning and units
                    against the original.
                  </label>
                </fieldset>
              );
            })}
            <p>
              If any proposal is wrong or incomplete, do not confirm it. Use the
              existing source correction controls or replace the document with a
              clear, labelled copy. All seven fields must be supported to save
              this recovery.
            </p>
            <label>
              Reviewer name
              <input
                name="actor"
                required
                minLength={2}
                maxLength={80}
                disabled={saving}
              />
            </label>
            <label>
              What did you confirm?
              <textarea
                name="reason"
                required
                minLength={5}
                maxLength={2000}
                rows={2}
                disabled={saving}
              />
            </label>
            <button
              className="button primary full"
              disabled={
                saving ||
                !role ||
                !FIELDS.every(
                  (f) =>
                    confirmed[f] &&
                    proposal.fields[f] &&
                    !proposal.fields[f]?.issue,
                )
              }
            >
              <ShieldCheck size={16} />
              {saving
                ? "Saving confirmed evidence…"
                : "Save confirmed fields & recheck"}
            </button>
            <p>
              Creates a human-reviewed revision, retaining source fingerprints
              and AI provenance. It is excluded from untouched automatic
              benchmark exports.
            </p>
          </form>
        </>
      )}
    </section>
  );
}
