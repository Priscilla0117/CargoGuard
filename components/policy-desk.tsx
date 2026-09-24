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
      <div className="policy-desk-heading">
        <div>
          <div className="eyebrow">VERIFICATION SETTINGS</div>
          <h2>Verification policy</h2>
        </div>
        <span className="policy-version">
          {loaded ? `Active · v${policy.version}` : "Policy not loaded"}
        </span>
      </div>
      <p className="policy-guidance">
        All seven fields remain mandatory. Tolerances annotate weight
        differences; they never erase a defect, bypass missing data, or approve
        a shipment.
      </p>
      <p className="policy-provenance">
        Each result retains the policy used when it was processed. Reviewer
        names are self-declared in this demo—not authenticated staff identities.
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
      <div className="policy-editor">
        <h3>Tolerance settings</h3>
        <div className="policy-inputs">
          <label>
            Weight tolerance (kg; 0 disables)
            <input
              type="number"
              disabled={busy || !loaded}
              min="0"
              max="5000"
              step="0.001"
              value={rules.weightToleranceKg}
              onChange={(e) => {
                setRules({
                  ...rules,
                  weightToleranceKg: Number(e.target.value),
                });
                setPreview(null);
              }}
            />
          </label>
          <label>
            Weight tolerance (% of SI; 0 disables)
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
        <p>
          If both limits are enabled, both must be met. An unreadable field is
          never eligible.
        </p>
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
            Reset editor to exact checks
          </button>
        </div>
      </div>
      {preview && (
        <div className="policy-preview">
          <div className="policy-section-heading">
            <h3>Impact preview</h3>
            <span className="policy-version">Not activated</span>
          </div>
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
              <p className="policy-impact-row" key={i.id}>
                <strong>{i.id}</strong>
                <span>{i.differenceKg ?? "—"} kg difference</span>
                <span>
                  {i.covered ? "Within tolerance" : "Outside tolerance"}
                </span>
                <span>Exact verdict: {i.strictStatus}</span>
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
      <section className="policy-history" aria-label="Policy version history">
        <h3>Version history</h3>
        {(loaded ? [...history, DEFAULT_POLICY] : []).map((p) => (
          <details key={p.version}>
            <summary>
              <span className="policy-history-label">
                v{p.version} · {p.actor}
              </span>
              <span className="policy-history-reason">{p.reason}</span>
            </summary>
            <dl className="policy-history-facts">
              <div>
                <dt>Weight limit</dt>
                <dd>{p.rules.weightToleranceKg} kg</dd>
              </div>
              <div>
                <dt>Relative limit</dt>
                <dd>{p.rules.weightTolerancePercent}% of SI</dd>
              </div>
              <div>
                <dt>Recorded</dt>
                <dd>
                  <time dateTime={p.created_at}>
                    {new Date(p.created_at).toLocaleString("en-GB", {
                      timeZone: "UTC",
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}{" "}
                    UTC
                  </time>
                </dd>
              </div>
            </dl>
            <p className="policy-history-note">
              A zero limit disables that tolerance. Exact differences remain
              recorded.
            </p>
            <details className="policy-record">
              <summary>Full saved policy record</summary>
              <pre>{JSON.stringify(p, null, 2)}</pre>
            </details>
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
      </section>
    </section>
  );
}
