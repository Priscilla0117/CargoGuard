"use client";
import { useEffect, useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";
import { requestJson } from "@/lib/client-api";

interface Capacity {
  enabled: boolean;
  limits: { globalDailyReservedTokens: number };
  budget: {
    workspaceRemaining: number;
    dailyRemaining: number;
    lifetimeRemaining: number;
    dailyTokensRemaining: number;
    lifetimeTokensRemaining: number;
    busy: boolean;
    resetsAt: string;
  };
}

/** Read-only status: never sends case data or calls an AI provider. */
export function AiAvailability() {
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [revision, refresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    requestJson<Capacity>("/api/assistant", { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) {
          setCapacity(value);
          setError(false);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          setCapacity(null);
          setError(true);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [revision]);
  const budget = capacity?.budget;
  const requests = budget
    ? Math.min(
        budget.workspaceRemaining,
        budget.dailyRemaining,
        budget.lifetimeRemaining,
      )
    : 0;
  const tokens = budget
    ? Math.min(budget.dailyTokensRemaining, budget.lifetimeTokensRemaining)
    : 0;
  const state = loading
    ? "Checking allowance…"
    : error
      ? "Allowance unavailable"
      : !capacity?.enabled
        ? "Cloud AI is not configured"
        : !requests || !tokens
          ? "AI allowance reached"
          : budget?.busy
            ? "AI is helping another request"
            : "Cloud AI is configured";
  return (
    <section className="ai-availability" aria-label="AI availability">
      <div className="availability-heading">
        <span className="feature-icon">
          <Sparkles size={20} />
        </span>
        <div>
          <h3>AI availability</h3>
        </div>
        <button
          className="button secondary availability-refresh"
          aria-label="Refresh AI allowance"
          disabled={loading}
          onClick={() => {
            setLoading(true);
            refresh((v) => v + 1);
          }}
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          Refresh
        </button>
      </div>
      <p className="availability-status" role="status">
        {state}
      </p>
      {!loading && !error && budget && (
        <>
          <div className="availability-stats">
            <div>
              <strong>{requests}</strong>
              <span>request slots left*</span>
            </div>
            <div>
              <strong>{tokens.toLocaleString()}</strong>
              <span>token units left*</span>
            </div>
          </div>
          <p className="availability-note">
            *Snapshot: refresh for latest capacity. Lowest remaining daily /
            lifetime allowance for this workspace. Larger questions can use it
            sooner. This is reserved capacity, not billed usage.
          </p>
          <p className="availability-reset">
            Daily reset · {new Date(budget.resetsAt).toLocaleString()}
            <br />
            {budget.lifetimeRemaining} lifetime requests left · does not reset
            daily
          </p>
        </>
      )}
      <div className="availability-tip">
        Open <strong>Ask CargoGuard</strong> to explain a case or prepare a
        handover. Each question gets a free capacity check before consent.
        Evidence Navigator and manual review work without cloud AI.
      </div>
    </section>
  );
}
