"use client";
import { useEffect, useState } from "react";
import { requestJson } from "@/lib/client-api";
import { FIELD_LABELS, type CaseResult } from "@/lib/types";
type Revision = {
  version: number;
  origin: string;
  action: string;
  actor: string;
  detail: string;
  created_at: string;
};
export function DecisionHistory({ result }: { result: CaseResult }) {
  const [history, setHistory] = useState<Revision[]>([]),
    [snapshot, setSnapshot] = useState<CaseResult | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    requestJson<{ revisions: Revision[] }>(
      `/api/cases?id=${encodeURIComponent(result.email.email_id)}`,
    )
      .then((d) => {
        if (current) setHistory(d.revisions);
      })
      .catch((e: Error) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [result.email.email_id, result.version]);
  async function inspect(version: number) {
    setError("");
    try {
      const d = await requestJson<{ result: CaseResult }>(
        `/api/cases?id=${encodeURIComponent(result.email.email_id)}&revision=${version}`,
      );
      setSnapshot(d.result);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section className="decision-history">
      <h3>Immutable decision snapshots</h3>
      <p>
        Read-only evidence. Inspecting an earlier revision never restores or
        changes the live case. Latest 100 revisions are listed.
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="revision-list">
        {history.map((r) => (
          <button
            className="button secondary"
            key={r.version}
            onClick={() => void inspect(r.version)}
          >
            v{r.version} · {r.origin} · {r.actor}
          </button>
        ))}
      </div>
      {snapshot && (
        <div className="policy-preview">
          <h4>
            Historical v{snapshot.version} · {snapshot.status}
          </h4>
          <p>{snapshot.summary}</p>
          <p>
            Engine {snapshot.pipeline_version ?? "legacy / not recorded"} ·
            policy v{snapshot.policy?.version ?? "not recorded"}
          </p>
          {snapshot.comparison.map((r) => (
            <p key={r.field}>
              <strong>{FIELD_LABELS[r.field]}</strong>: SI {r.si.raw} → BL{" "}
              {r.bl.raw} ({r.result})
            </p>
          ))}
          <h4>Original sources for this revision</h4>
          {snapshot.documents.map((d) => (
            <p key={d.name}>
              <a
                target="_blank"
                rel="noreferrer"
                href={`/api/document?id=${encodeURIComponent(snapshot.email.email_id)}&name=${encodeURIComponent(d.name)}&revision=${snapshot.version}`}
              >
                {d.name}
              </a>
              <small className="normalized-value">
                SHA-256: {d.sha256 ?? "unavailable"}
              </small>
            </p>
          ))}
          <details>
            <summary>Full snapshot JSON</summary>
            <pre>{JSON.stringify(snapshot, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}
