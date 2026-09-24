"use client";
import { useEffect, useRef, useState } from "react";
import { Files, Loader2, ShieldCheck } from "lucide-react";
import { requestJson } from "@/lib/client-api";
import type { AuditEvent, CaseResult } from "@/lib/types";

export function DocumentPairSelector({
  result,
  onSaved,
}: {
  result: CaseResult;
  onSaved: (data: { result: CaseResult; audit: AuditEvent[] }) => void;
}) {
  const [si, setSi] = useState(result.document_selection?.si.name ?? "");
  const [bl, setBl] = useState(result.document_selection?.bl.name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (
    result.category !== "BL_COMPARISON" ||
    (result.documents.length <= 2 && !result.document_selection)
  )
    return null;
  const excluded = result.documents.filter(
    (d) =>
      ![
        result.document_selection?.si.name,
        result.document_selection?.bl.name,
      ].includes(d.name),
  );
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const saved = await requestJson<{
        result: CaseResult;
        audit: AuditEvent[];
      }>("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "select_documents",
          id: result.email.email_id,
          version: result.version,
          si,
          bl,
          actor: data.get("actor"),
          reason: data.get("reason"),
        }),
      });
      if (mounted.current) onSaved(saved);
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <section className="pair-selector">
      <div className="pair-heading">
        <Files size={20} />
        <div>
          <h3>
            {result.document_selection
              ? "Selected comparison pair"
              : "Choose the documents to compare"}
          </h3>
          <p>
            {result.documents.length} attachments retained. Only one SI and one
            draft BL can be checked together.
          </p>
        </div>
      </div>
      {result.document_selection && (
        <div className="selected-pair">
          <p>
            <b>SI</b> {result.document_selection.si.name}
          </p>
          <p>
            <b>BL</b> {result.document_selection.bl.name}
          </p>
          <small>
            Selected by {result.document_selection.actor} · recorded in decision
            history
          </small>
        </div>
      )}
      <details open={!result.document_selection}>
        <summary>
          {result.document_selection
            ? "Change comparison pair"
            : "Select SI and draft BL"}
        </summary>
        <form onSubmit={save}>
          <div className="pair-fields">
            {(["si", "bl"] as const).map((side) => (
              <label key={side}>
                {side === "si"
                  ? "Shipping instruction · reference"
                  : "Draft bill of lading · to check"}
                <select
                  required
                  value={side === "si" ? si : bl}
                  disabled={saving}
                  onChange={(e) =>
                    side === "si"
                      ? setSi(e.target.value)
                      : setBl(e.target.value)
                  }
                  aria-label={`Select ${side.toUpperCase()} attachment`}
                >
                  <option value="">
                    Choose a readable {side.toUpperCase()}…
                  </option>
                  {result.documents
                    .filter(
                      (d) =>
                        d.type === side.toUpperCase() && !d.error && d.sha256,
                    )
                    .map((d) => (
                      <option value={d.name} key={d.name}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
          <p className="pair-help">
            A file missing from these choices needs its source or role confirmed
            first. Use the recovery tools below. Selecting another pair
            preserves confirmed corrections for unchanged sources. Earlier
            decisions remain in history.
          </p>
          <div className="pair-fields">
            <label>
              Reviewer name
              <input
                required
                name="actor"
                minLength={2}
                maxLength={80}
                disabled={saving}
              />
            </label>
            <label>
              Why this pair?
              <input
                required
                name="reason"
                minLength={5}
                maxLength={2000}
                placeholder="For example: latest BL revision, SI unchanged"
                disabled={saving}
              />
            </label>
          </div>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary"
            disabled={
              saving ||
              !si ||
              !bl ||
              si === bl ||
              (si === result.document_selection?.si.name &&
                bl === result.document_selection?.bl.name)
            }
          >
            {saving ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <ShieldCheck size={16} />
            )}
            {saving ? "Saving selection…" : "Confirm pair & compare"}
          </button>
        </form>
      </details>
      {result.document_selection && excluded.length > 0 && (
        <details className="excluded-documents">
          <summary>
            {excluded.length} other attachment{excluded.length === 1 ? "" : "s"}{" "}
            · retained, not verified
          </summary>
          <ul>
            {excluded.map((d) => (
              <li key={d.name}>
                {d.name}{" "}
                <small>
                  ({d.type}
                  {d.error ? ", unreadable" : ""})
                </small>
              </li>
            ))}
          </ul>
          <p>A verified pair does not verify these other attachments.</p>
        </details>
      )}
    </section>
  );
}
