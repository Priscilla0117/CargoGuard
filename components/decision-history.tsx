"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/client-api";
import { createRequestGate } from "@/lib/request-gate";
import { FIELD_LABELS, type CaseResult } from "@/lib/types";
import { RevisionComparison } from "./revision-comparison";
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
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [loadingVersion, setLoadingVersion] = useState<number | null>(null);
  const requests = useRef(createRequestGate());
  useEffect(() => {
    const gate = requests.current;
    const request = gate.next();
    requestJson<{ revisions: Revision[] }>(
      `/api/cases?id=${encodeURIComponent(result.email.email_id)}`,
    )
      .then(async (d) => {
        if (!gate.isCurrent(request)) return;
        setHistory(d.revisions);
        const previous = d.revisions
          .filter((r) => r.version < result.version)
          .sort((a, b) => b.version - a.version)[0];
        if (previous) {
          setLoadingVersion(previous.version);
          const saved = await requestJson<{ result: CaseResult }>(
            `/api/cases?id=${encodeURIComponent(result.email.email_id)}&revision=${previous.version}`,
          );
          if (gate.isCurrent(request)) setSnapshot(saved.result);
        }
      })
      .catch((e: Error) => {
        if (gate.isCurrent(request)) setError(e.message);
      })
      .finally(() => {
        if (gate.isCurrent(request)) {
          setLoading(false);
          setLoadingVersion(null);
        }
      });
    return () => {
      gate.cancel();
    };
  }, [result.email.email_id, result.version]);
  async function inspect(version: number) {
    const request = requests.current.next();
    setError("");
    setLoading(false);
    setSnapshot(null);
    setLoadingVersion(version);
    try {
      const d = await requestJson<{ result: CaseResult }>(
        `/api/cases?id=${encodeURIComponent(result.email.email_id)}&revision=${version}`,
      );
      if (requests.current.isCurrent(request)) setSnapshot(d.result);
    } catch (e) {
      if (requests.current.isCurrent(request)) setError((e as Error).message);
    } finally {
      if (requests.current.isCurrent(request)) setLoadingVersion(null);
    }
  }
  return (
    <section className="decision-history">
      <div className="revision-title">
        <div>
          <span className="eyebrow">CASE HISTORY</span>
          <h3>Changes between revisions</h3>
          <p>
            Compare an earlier saved check with revision {result.version}.
            Viewing history does not change the case.
          </p>
        </div>
        {history.some((r) => r.version < result.version) && (
          <label>
            Earlier revision
            <select
              aria-label="Earlier revision"
              value={loadingVersion ?? snapshot?.version ?? ""}
              onChange={(event) => void inspect(Number(event.target.value))}
            >
              <option value="" disabled>
                Select revision
              </option>
              {history
                .filter((r) => r.version < result.version)
                .map((r) => (
                  <option key={r.version} value={r.version}>
                    Revision {r.version} ·{" "}
                    {r.action.replaceAll("_", " ").toLowerCase()}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {loading && loadingVersion === null && (
        <p role="status">Loading saved revisions…</p>
      )}
      {loadingVersion !== null && (
        <p role="status">Loading historical v{loadingVersion}…</p>
      )}
      {!loading &&
        !error &&
        !history.some((r) => r.version < result.version) && (
          <p className="revision-empty">
            This case has no earlier saved revision to compare. After a
            correction or document replacement, the changes will appear here.
          </p>
        )}
      {snapshot && (
        <RevisionComparison
          key={`${snapshot.version}-${result.version}`}
          before={snapshot}
          after={result}
        />
      )}
      {snapshot && (
        <details className="revision-snapshot">
          <summary>
            Earlier check and original files · revision
            {snapshot.version}
          </summary>
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
              <summary>Technical record (JSON)</summary>
              <pre>{JSON.stringify(snapshot, null, 2)}</pre>
            </details>
          </div>
        </details>
      )}
      {!!history.length && (
        <details className="revision-log">
          <summary>
            Saved revision log · latest {history.length} of up to 100
          </summary>
          <ol>
            {history.map((r) => (
              <li key={r.version}>
                <strong>
                  v{r.version} · {r.action.replaceAll("_", " ")}
                </strong>
                <span>
                  {r.actor} · {r.origin} ·{" "}
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
