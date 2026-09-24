"use client";
import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/lib/client-api";
import {
  DEFAULT_POLICY,
  type PolicySnapshot,
  type PolicyRules,
  type previewPolicy,
} from "@/lib/policy";
type Preview = {
  token: string;
  impact: ReturnType<typeof previewPolicy>;
  caseCount: number;
  note: string;
};
export function PolicyDesk() {
  const [policy, setPolicy] = useState<PolicySnapshot>(DEFAULT_POLICY),
    [history, setHistory] = useState<PolicySnapshot[]>([]);
  const [rules, setRules] = useState<PolicyRules>(DEFAULT_POLICY.rules),
    [preview, setPreview] = useState<Preview | null>(null);
  const [actor, setActor] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [loadingPolicy, setLoadingPolicy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const loadInFlight = useRef(false);
  async function load() {
    // The ref closes the gap before React renders a disabled retry button.
    // An older retry must not outlive the first successful load and editor use.
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    setLoadingPolicy(true);
    try {
      const d = await requestJson<{
        policy: PolicySnapshot;
        history: PolicySnapshot[];
      }>("/api/policies");
      setPolicy(d.policy);
      setRules(d.policy.rules);
      setHistory(d.history);
      setLoaded(true);
      setError("");
    } finally {
      loadInFlight.current = false;
      setLoadingPolicy(false);
    }
  }
  useEffect(() => {
    let active = true;
    requestJson<{ policy: PolicySnapshot; history: PolicySnapshot[] }>(
      "/api/policies",
    )
      .then((d) => {
        if (active) {
          setPolicy(d.policy);
          setRules(d.policy.rules);
          setHistory(d.history);
          setLoaded(true);
        }
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function act(action: "preview" | "activate") {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await requestJson<Preview & { policy: PolicySnapshot }>(
        "/api/policies",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "preview"
              ? { action, rules }
              : { action, token: preview?.token, actor, reason },
          ),
        },
      );
      if (action === "preview") setPreview(data);
      else {
        setPreview(null);
        setNotice(data.note);
        await load();
      }
    } catch (e) {
      setError((e as Error).message);
      if (action === "activate") setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="content-card governance-panel">
      <h2>Comparison rules</h2>
      <p>
        All seven details are always checked. A weight tolerance only adds a
        note to small weight differences — it never hides a mismatch. Active
        version: <strong>{loaded ? `v${policy.version}` : "loading…"}</strong>
      </p>
      {error && (
        <p role="alert" className="field-issue">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!loaded && !error && <p role="status">Loading the saved policy…</p>}
      {!loaded && error && (
        <button
          className="button secondary"
          disabled={loadingPolicy}
          onClick={() => void load().catch((e: Error) => setError(e.message))}
        >
          {loadingPolicy ? "Loading policy…" : "Retry loading policy"}
        </button>
      )}
      <div className="policy-inputs">
        <label>
          Weight tolerance in kg (0 = off)
          <input
            type="number"
            disabled={busy || !loaded}
            min="0"
            max="5000"
            step="0.001"
            value={rules.weightToleranceKg}
            onChange={(e) => {
              setRules({ ...rules, weightToleranceKg: Number(e.target.value) });
              setPreview(null);
            }}
          />
        </label>
        <label>
          Weight tolerance in % of the SI (0 = off)
          <input
            type="number"
            disabled={busy || !loaded}
            min="0"
            max="5"
            step="0.01"
            value={rules.weightTolerancePercent}
            onChange={(e) => {
              setRules({
                ...rules,
                weightTolerancePercent: Number(e.target.value),
              });
              setPreview(null);
            }}
          />
        </label>
      </div>
      <div className="case-actions">
        <button
          className="button secondary"
          disabled={busy || !loaded}
          onClick={() => void act("preview")}
        >
          Preview impact
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => {
            setRules({ ...DEFAULT_POLICY.rules });
            setPreview(null);
          }}
        >
          Reset to exact match
        </button>
      </div>
      {preview && (
        <div className="policy-preview">
          <h3>Preview only — no decisions changed</h3>
          <p>
            {preview.caseCount} saved cases inspected; {preview.impact.length}{" "}
            have comparison rows.{" "}
            {preview.impact.filter((i) => i.covered).length} weight differences
            fall within the proposed bounds. Exact mismatch counts are
            unchanged.
          </p>
          {preview.impact
            .filter((i) => i.covered || i.previousCovered)
            .slice(0, 30)
            .map((i) => (
              <p key={i.id}>
                {i.id}: {i.differenceKg ?? "—"} kg difference ·{" "}
                {i.covered ? "within tolerance" : "outside tolerance"} · strict{" "}
                {i.strictStatus}
              </p>
            ))}
          <label>
            Reviewer name
            <input
              maxLength={80}
              value={actor}
              onChange={(e) => setActor(e.target.value)}
            />
          </label>
          <label>
            Business justification
            <textarea
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={
              busy || actor.trim().length < 2 || reason.trim().length < 5
            }
            onClick={() => void act("activate")}
          >
            Record and activate policy
          </button>
          <p>
            Preview expires after 10 minutes. Any saved case or policy change
            requires another preview. Existing results are not rewritten.
          </p>
        </div>
      )}
      <details className="policy-history">
        <summary>Version history</summary>
        {(loaded ? [...history, DEFAULT_POLICY] : []).map((p) => (
          <details key={p.version}>
            <summary>
              v{p.version} · {p.actor} · {p.reason}
            </summary>
            <pre>{JSON.stringify(p, null, 2)}</pre>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setRules({ ...p.rules });
                setPreview(null);
              }}
            >
              Preview these settings as a new version
            </button>
          </details>
        ))}
      </details>
    </section>
  );
}
