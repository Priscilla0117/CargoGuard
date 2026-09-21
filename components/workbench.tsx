"use client";
import { PolicyDesk } from "./policy-desk";
import { WorkspaceGuide } from "./workspace-guide";
import { DecisionHistory } from "./decision-history";
import type { PolicySnapshot } from "@/lib/policy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { requestJson, latencySummary } from "@/lib/client-api";
import { createRequestGate } from "@/lib/request-gate";
import { mergeCaseSummaries } from "@/lib/case-state";
import { ScanAssist } from "@/components/scan-assist";
import { ResolutionDesk } from "@/components/resolution-desk";
import { GlobalAssistant } from "@/components/global-assistant";
import type { AssistantMemory } from "@/components/case-assistant";
import { EvidenceRecovery } from "@/components/evidence-recovery";
import { OperationsDesk } from "@/components/operations-desk";
import { canTranscribe } from "@/lib/transcription";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { useCargoTools } from "@/components/cargo-tools";
import {
  Anchor,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FileCheck2,
  FileText,
  Inbox,
  Layers3,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
  BarChart3,
  History,
  Eye,
  Paperclip,
  ExternalLink,
  CheckCircle2,
  Square,
  Printer,
  Info,
  Compass,
  MessageSquareText,
} from "lucide-react";
import {
  CATEGORIES,
  FIELD_LABELS,
  PIPELINE_VERSION,
  summaryOf,
  type CaseSummary,
  type CaseResult,
  type AuditEvent,
  type Field,
  type ParsedDocument,
} from "@/lib/types";

const categoryNames: Record<string, string> = {
  BL_COMPARISON: "Document verification",
  SI_REQUEST: "Shipping instructions",
  INVOICE_QUERY: "Invoice query",
  GENERAL: "General operations",
  SPAM: "Spam",
};
const statuses: Record<string, string> = {
  verified: "Verified",
  discrepancy: "Discrepancy",
  review: "Needs review",
  awaiting_documents: "Awaiting documents",
  routed: "Routed",
  pending: "Not processed",
};
type View =
  | "operations"
  | "inbox"
  | "review"
  | "performance"
  | "activity"
  | "policies";
interface ApiPayload {
  cases: CaseSummary[];
  audit: AuditEvent[];
  result: CaseResult;
  results: CaseResult[];
  error?: string;
  errors?: { id: string; error: string }[];
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status ${value}`}>
      <span />
      {statuses[value] ?? value}
    </span>
  );
}
function shortSubject(s: string) {
  return s.replace(/^(?:RE[:_]\s*|FW:\s*)+/i, "");
}
function AuditDetail({ detail }: { detail: string }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(detail);
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return <p>{detail}</p>;
  const data = parsed as Record<string, unknown>;
  const summary = data.summary
    ? String(data.summary)
    : data.transcript && typeof data.transcript === "object"
      ? `Seven scan fields confirmed for ${String(data.document ?? "document")}. Source fingerprint retained.`
      : data.field
        ? `${FIELD_LABELS[data.field as Field] ?? String(data.field)} (${String(data.side ?? "").toUpperCase()}): ${String(data.before ?? "")} → ${String(data.after ?? "")}`
        : data.before !== undefined
          ? `Category: ${categoryNames[String(data.before)] ?? String(data.before)} → ${categoryNames[String(data.after)] ?? String(data.after)}`
          : "Decision recorded.";
  return (
    <div className="audit-detail">
      <p>
        {summary}
        {data.reason ? ` Reason: ${String(data.reason)}` : ""}
      </p>
      <details>
        <summary>Recorded evidence</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  );
}
function download(name: string, data: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Workbench() {
  const [assistantMemories, setAssistantMemories] = useState<
    Record<string, AssistantMemory>
  >({});
  const [cases, setCases] = useState<CaseSummary[]>([]),
    [events, setEvents] = useState<AuditEvent[]>([]),
    [loading, setLoading] = useState(true),
    [inboxReady, setInboxReady] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("operations"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [category, setCategory] = useState("all"),
    [limit, setLimit] = useState(30);
  const [selected, setSelected] = useState<CaseResult | null>(null),
    [caseEvents, setCaseEvents] = useState<AuditEvent[]>([]),
    [detailTab, setDetailTab] = useState("comparison"),
    [document, setDocument] = useState<ParsedDocument | null>(null);
  const [assistant, setAssistant] = useState<{
    id: string | null;
    sequence: number;
  } | null>(null);
  const [running, setRunning] = useState(false),
    [progress, setProgress] = useState({ done: 0, total: 0 }),
    [busyId, setBusyId] = useState(""),
    cancel = useRef(false);
  const [replacement, setReplacement] = useState<CaseResult | null>(null);
  const [upload, setUpload] = useState(false),
    [uploading, setUploading] = useState(false),
    [edit, setEdit] = useState<{
      field: Field;
      side: "si" | "bl";
      value: string;
    } | null>(null),
    [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<Record<string, unknown> | null>(
    null,
  );
  const [routeEdit, setRouteEdit] = useState(false),
    [sourceLocation, setSourceLocation] = useState("");
  const [latencies, setLatencies] = useState<number[]>([]),
    [batchMs, setBatchMs] = useState<number | null>(null);
  const [pagination, setPagination] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const highlighted = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    highlighted.current?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [sourceLocation, document, detailTab]);
  const api = useCallback(async (url: string, options?: RequestInit) => {
    const t = performance.now();
    const result = await requestJson<ApiPayload>(url, options);
    setLatencies((prev) => [...prev.slice(-199), performance.now() - t]);
    return result;
  }, []);
  const activeRequest = useRef(createRequestGate());
  const inboxRequests = useRef(createRequestGate());
  function closeCase() {
    activeRequest.current.cancel();
    setSelected(null);
    setDocument(null);
    setCaseEvents([]);
    setEdit(null);
    setRouteEdit(false);
    setBusyId("");
  }
  const load = useCallback(async () => {
    const request = inboxRequests.current.next();
    setLoading(true);
    setError("");
    try {
      const d = await api("/api/inbox");
      if (inboxRequests.current.isCurrent(request)) {
        setCases(d.cases);
        setEvents(d.audit);
        setInboxReady(true);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    let active = true;
    const request = inboxRequests.current.next();
    const started = performance.now();
    requestJson<ApiPayload>("/api/inbox")
      .then((d) => {
        if (active && inboxRequests.current.isCurrent(request)) {
          setCases(d.cases);
          setEvents(d.audit);
          setInboxReady(true);
          setLatencies((prev) => [
            ...prev.slice(-199),
            performance.now() - started,
          ]);
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    fetch("/validation.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (active) setValidation(v as Record<string, unknown> | null);
      })
      .catch(() => {});
    return () => {
      active = false;
      cancel.current = true;
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  const counts = useMemo(() => {
    const c = {
      processed: 0,
      verified: 0,
      discrepancy: 0,
      review: 0,
      awaiting_documents: 0,
      routed: 0,
      comparisons: 0,
      ms: 0,
    };
    for (const row of cases)
      if (row.result) {
        c.processed++;
        c[row.result.workflow]++;
        c.ms += row.result.duration_ms;
        if (
          row.result.workflow === "verified" ||
          row.result.workflow === "discrepancy"
        )
          c.comparisons++;
      }
    return c;
  }, [cases]);
  const pageKey = JSON.stringify([search, filter, category, view]),
    shownLimit = pagination === pageKey ? limit : 30;
  const timing = latencySummary(latencies),
    outdated = cases.filter(
      (c) => c.result && c.result.pipeline_version !== PIPELINE_VERSION,
    ).length;
  const visible = useMemo(
    () =>
      cases
        .filter((c) => {
          const wf = c.result?.workflow ?? "pending";
          if (view === "review" && wf !== "review") return false;
          if (filter !== "all" && wf !== filter) return false;
          if (category !== "all" && c.result?.category !== category)
            return false;
          return `${c.email.subject} ${c.email.from} ${c.email.email_id} ${c.result?.defect_fields.join(" ") ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase());
        })
        .sort((a, b) => {
          const rank: Record<string, number> = {
            discrepancy: 0,
            review: 1,
            verified: 2,
            awaiting_documents: 3,
            pending: 4,
            routed: 5,
          };
          return (
            rank[a.result?.workflow ?? "pending"] -
              rank[b.result?.workflow ?? "pending"] ||
            a.email.email_id.localeCompare(b.email.email_id)
          );
        }),
    [cases, search, filter, category, view],
  );
  const update = (results: CaseResult[]) => {
    inboxRequests.current.cancel();
    setCases((prev) => mergeCaseSummaries(prev, results.map(summaryOf)));
  };
  function launchAssistant(id: string | null = null) {
    closeCase();
    setAssistant((previous) => ({
      id,
      sequence: (previous?.sequence ?? 0) + 1,
    }));
  }
  async function openCase(id: string, tab = "comparison") {
    closeCase();
    const request = activeRequest.current.next();
    setBusyId(id);
    setError("");
    try {
      let result: CaseResult;
      let history: AuditEvent[] = [];
      if (!cases.find((c) => c.email.email_id === id)?.result) {
        const d = await api("/api/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process", ids: [id] }),
        });
        result = d.results[0];
        if (!result)
          throw new Error(
            d.errors?.[0]?.error ??
              "Case could not be processed. Please retry.",
          );
        update(d.results);
      } else {
        const d = await api(`/api/cases?id=${encodeURIComponent(id)}`);
        result = d.result;
        history = d.audit;
      }
      if (activeRequest.current.isCurrent(request)) {
        setSelected(result);
        setDocument(null);
        setSourceLocation("");
        setCaseEvents(history);
        setDetailTab(tab);
        setAttentionOnly(false);
      }
    } catch (e) {
      if (activeRequest.current.isCurrent(request))
        setError((e as Error).message);
    } finally {
      if (activeRequest.current.isCurrent(request)) setBusyId("");
    }
  }
  async function processAll() {
    if (running) {
      cancel.current = true;
      return;
    }
    if (!inboxReady || loading) return;
    const ids = cases
      .filter(
        (c) => !c.result || c.result.pipeline_version !== PIPELINE_VERSION,
      )
      .map((c) => c.email.email_id);
    if (!ids.length) {
      setNotice(
        "All emails use the current engine. Open a case to reprocess its sources.",
      );
      return;
    }
    // This function is invoked only by the Run inbox click handler, never render.
    // eslint-disable-next-line react-hooks/purity -- Measure elapsed time in the event handler.
    const t = performance.now();
    let next = 0,
      done = 0,
      problem = "";
    cancel.current = false;
    setRunning(true);
    setError("");
    setProgress({ done: 0, total: ids.length });
    let policyVersion: number;
    try {
      policyVersion = (
        await requestJson<{ policy: PolicySnapshot }>("/api/policies")
      ).policy.version;
    } catch (e) {
      setError((e as Error).message);
      setRunning(false);
      return;
    }
    const worker = async () => {
      while (next < ids.length && !cancel.current) {
        const batch = ids.slice(next, next + 10);
        next += 10;
        try {
          const d = await api("/api/cases", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "process",
              ids: batch,
              skipSaved: true,
              policyVersion,
            }),
          });
          update(d.results);
          done += d.results.length;
          setProgress({ done, total: ids.length });
          if (d.errors?.length)
            throw new Error(
              d.errors.map((e) => `${e.id}: ${e.error}`).join(" "),
            );
        } catch (e) {
          problem = (e as Error).message;
          cancel.current = true;
        }
      }
    };
    await Promise.all([worker(), worker()]);
    // eslint-disable-next-line react-hooks/purity -- Completion of the same click-triggered async operation.
    setBatchMs(Math.round(performance.now() - t));
    await load();
    setRunning(false);
    if (problem)
      setError(
        problem + " Completed cases are saved. Run the inbox to safely resume.",
      );
    else
      setNotice(
        cancel.current
          ? "Paused after in-flight batches finished. Saved progress is retained."
          : "Inbox processed. Every email has an outcome.",
      );
  }
  async function reprocess() {
    if (!selected) return;
    const request = activeRequest.current.next();
    const id = selected.email.email_id;
    setBusyId(selected.email.email_id);
    setError("");
    try {
      const d = await api("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process",
          ids: [selected.email.email_id],
        }),
      });
      if (!d.results[0])
        throw new Error(
          d.errors?.[0]?.error ??
            "Reprocessing failed. The prior result is retained.",
        );
      update(d.results);
      if (!activeRequest.current.isCurrent(request)) return;
      setSelected(d.results[0]);
      setDocument(null);
      const history = await api(`/api/cases?id=${encodeURIComponent(id)}`);
      if (!activeRequest.current.isCurrent(request)) return;
      setCaseEvents(history.audit);
      setNotice(
        "Reprocessed from current sources and confirmed scan transcripts. Field edits reset; prior corrections remain in the audit trail.",
      );
    } catch (e) {
      if (activeRequest.current.isCurrent(request))
        setError((e as Error).message);
    } finally {
      if (activeRequest.current.isCurrent(request)) setBusyId("");
    }
  }
  async function exportAll(mode = "baseline") {
    try {
      const d = await api(`/api/cases?export=1&mode=${mode}`);
      download(`cargoguard-${mode}.json`, JSON.stringify(d, null, 2));
      setNotice(
        mode === "baseline"
          ? "Untouched automatic baseline downloaded. Human corrections are excluded."
          : "Reviewed evidence downloaded with source, policy and human-review labels.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function uploadCase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = activeRequest.current.next();
    setUploading(true);
    setError("");
    try {
      const d = await api("/api/upload", {
        method: "POST",
        body: (() => {
          const fd = new FormData(event.currentTarget);
          if (replacement) {
            fd.set("id", replacement.email.email_id);
            fd.set("version", String(replacement.version));
          }
          return fd;
        })(),
      });
      update([d.result]);
      if (!activeRequest.current.isCurrent(request)) return;
      setSelected(d.result);
      setDetailTab("comparison");
      setCaseEvents([]);
      setUpload(false);
      setReplacement(null);
      setDocument(null);
      setNotice("Documents processed and securely saved to your workspace.");
    } catch (e) {
      if (activeRequest.current.isCurrent(request))
        setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }
  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !edit) return;
    const request = activeRequest.current.next();
    setSaving(true);
    setError("");
    const fd = new FormData(event.currentTarget);
    try {
      const d = await api("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review",
          id: selected.email.email_id,
          version: selected.version,
          ...edit,
          actor: fd.get("actor"),
          reason: fd.get("reason"),
        }),
      });
      update([d.result]);
      if (!activeRequest.current.isCurrent(request)) return;
      setSelected(d.result);
      setCaseEvents(d.audit);
      setEdit(null);
      setNotice(
        "Correction saved. The comparison and audit trail have been updated.",
      );
    } catch (e) {
      if (activeRequest.current.isCurrent(request))
        setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function saveRoute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const request = activeRequest.current.next();
    setSaving(true);
    setError("");
    const fd = new FormData(event.currentTarget);
    try {
      const d = await api("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "route",
          id: selected.email.email_id,
          version: selected.version,
          category: fd.get("category"),
          actor: fd.get("actor"),
          reason: fd.get("reason"),
        }),
      });
      update([d.result]);
      if (!activeRequest.current.isCurrent(request)) return;
      setSelected(d.result);
      setCaseEvents(d.audit);
      setRouteEdit(false);
      setNotice(
        "Category confirmed. Documents were checked using the confirmed routing.",
      );
    } catch (e) {
      if (activeRequest.current.isCurrent(request))
        setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const nav = (v: View) => {
    setView(v);
    setFilter("all");
    setCategory("all");
    setSearch("");
    closeCase();
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  useCargoTools({ cases, setSearch, setView, setFilter, setCategory });
  return (
    <SidebarProvider className="app-shell">
      <Sidebar collapsible="none" className="sidebar">
        <Link className="brand" href="/" aria-label="CargoGuard home">
          <span className="brand-symbol">
            <ShieldCheck size={25} />
          </span>
          <span>
            CargoGuard<span className="brand-sub">SHIPPING INTELLIGENCE</span>
          </span>
        </Link>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Workspace navigation">
          <button
            className={view === "operations" ? "active" : ""}
            aria-current={view === "operations" ? "page" : undefined}
            onClick={() => nav("operations")}
            aria-label="Operations desk"
          >
            <Compass size={19} />
            Operations desk
          </button>
          <button
            className={view === "policies" ? "active" : ""}
            aria-current={view === "policies" ? "page" : undefined}
            onClick={() => nav("policies")}
          >
            <ShieldCheck size={19} />
            Policy laboratory
          </button>
          <button
            className={view === "inbox" ? "active" : ""}
            aria-current={view === "inbox" ? "page" : undefined}
            onClick={() => nav("inbox")}
          >
            <Inbox size={19} />
            Verification inbox<span>{cases.length || "—"}</span>
          </button>
          <button
            className={view === "review" ? "active" : ""}
            aria-current={view === "review" ? "page" : undefined}
            onClick={() => nav("review")}
          >
            <Eye size={19} />
            Review desk
            {counts.review > 0 && (
              <span className="orange-count">{counts.review}</span>
            )}
          </button>
          <button
            className={view === "performance" ? "active" : ""}
            aria-current={view === "performance" ? "page" : undefined}
            onClick={() => nav("performance")}
          >
            <BarChart3 size={19} />
            Performance
          </button>
          <button
            className={view === "activity" ? "active" : ""}
            aria-current={view === "activity" ? "page" : undefined}
            onClick={() => {
              nav("activity");
              void load();
            }}
          >
            <History size={19} />
            Audit trail
          </button>
        </nav>
        <div className="sidebar-info">
          <span className="eyebrow">CONNECTED INBOX</span>
          <div>
            <Layers3 size={16} /> Organiser sample data
          </div>
          <p>
            520 emails · 250 documents
            <br />
            TXT, PDF, Word & Excel
          </p>
          <div className="sidebar-progress">
            <i
              style={{
                width: `${(counts.processed / Math.max(cases.length, 1)) * 100}%`,
              }}
            />
          </div>
          <small>
            {counts.processed} of {cases.length || 520} processed
          </small>
        </div>
        <div className="sidebar-bottom">
          <div className="averis-word">
            averis
            <span />
          </div>
          <p>
            Built for Averis × Monash
            <br />
            Hackathon 2026
          </p>
          <div className="avatar-line">
            <span className="avatar">OP</span>
            <span>
              Operations workspace<small>Private working session</small>
            </span>
          </div>
        </div>
      </Sidebar>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Operations <ChevronRight size={14} />
            <strong>
              {view === "operations"
                ? "Operations desk"
                : view === "inbox"
                  ? "Document verification"
                  : view === "review"
                    ? "Review desk"
                    : view === "performance"
                      ? "Performance"
                      : view === "policies"
                        ? "Policy laboratory"
                        : "Audit trail"}
            </strong>
          </div>
          <div className="topbar-right">
            <span className="environment">
              <span />
              Cloud workspace
            </span>
            <button
              className="icon-button"
              onClick={() => void load()}
              title="Refresh workspace"
              aria-label="Refresh workspace"
            >
              <RefreshCw size={17} />
            </button>
            <span className="avatar small">OP</span>
          </div>
        </header>
        <main data-workspace-view={view}>
          {error && (
            <div className="alert error" role="alert">
              <TriangleAlert size={18} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={17} />
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <CheckCircle2 size={18} />
              {notice}
              <button
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">SHIPPING OPERATIONS</div>
              <h1>
                {view === "operations"
                  ? "Your next action, made clear."
                  : view === "inbox"
                    ? "Verification inbox"
                    : view === "review"
                      ? "A human eye, where it matters."
                      : view === "performance"
                        ? "Performance & evidence"
                        : view === "policies"
                          ? "Business rules, without hidden exceptions."
                          : "Every decision, accounted for."}
              </h1>
              <p>
                {view === "operations"
                  ? "A focused workspace for shipping operations and evidence-led handoffs."
                  : view === "inbox"
                    ? "Catch the discrepancy. Keep the shipment moving."
                    : view === "review"
                      ? "Resolve uncertain documents with the full source context."
                      : view === "performance"
                        ? "Measured outcomes from your workspace and reproducible validation."
                        : view === "policies"
                          ? "Preview, justify and version every tolerance. Preserve the exact evidence."
                          : "An append-only record of processing and human corrections."}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button secondary"
                disabled={loading || !inboxReady}
                onClick={() => {
                  setReplacement(null);
                  setUpload(true);
                }}
              >
                <Plus size={17} />
                New verification
              </button>
              <button
                className="button primary"
                onClick={processAll}
                disabled={loading || !inboxReady}
              >
                {running ? <Square size={14} /> : <Play size={16} />}{" "}
                {running ? "Pause processing" : "Run inbox"}
              </button>
            </div>
          </div>
          {!inboxReady && !loading && (
            <div className="alert warning" role="status">
              Load the workspace before creating or processing cases. Use
              Refresh to retry.
            </div>
          )}
          {!!outdated && (
            <div className="alert warning">
              <Info size={18} />
              <p>
                {outdated} saved cases use an older engine. Run inbox to upgrade
                them safely. Human field corrections are retained when source
                fingerprints match.
              </p>
            </div>
          )}
          {running && (
            <div className="run-progress" role="status">
              <Loader2 size={17} className="spin" />
              <span>Processing emails and reading documents</span>
              <strong>
                {progress.done} / {progress.total}
              </strong>
              <div>
                <i
                  style={{
                    width: `${(progress.done / Math.max(1, progress.total)) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}
          {view !== "operations" && <WorkspaceGuide view={view} />}
          {(view === "inbox" ||
            view === "review" ||
            view === "performance") && (
            <div className="metric-grid">
              <button
                className="metric"
                onClick={() => {
                  setView("inbox");
                  setFilter("all");
                }}
              >
                <span>
                  Emails processed
                  <Inbox size={18} />
                </span>
                <strong>
                  {counts.processed.toLocaleString()}
                  <small>/ {cases.length || 520}</small>
                </strong>
                <div>
                  <span className="neutral-dot" />
                  {counts.processed === cases.length && cases.length
                    ? "Inbox is up to date"
                    : "Ready for verification"}
                </div>
              </button>
              <button
                className="metric"
                onClick={() => {
                  setView("inbox");
                  setFilter("discrepancy");
                }}
              >
                <span>
                  Discrepancies
                  <TriangleAlert size={18} />
                </span>
                <strong>
                  {counts.discrepancy.toLocaleString()}
                  <small>cases</small>
                </strong>
                <div className="orange-text">
                  {cases.reduce(
                    (s, c) => s + (c.result?.defect_fields.length ?? 0),
                    0,
                  )}{" "}
                  fields need attention
                </div>
              </button>
              <button
                className="metric"
                onClick={() => {
                  setView("inbox");
                  setFilter("verified");
                }}
              >
                <span>
                  Verified documents
                  <FileCheck2 size={18} />
                </span>
                <strong>
                  {counts.verified.toLocaleString()}
                  <small>pairs</small>
                </strong>
                <div className="green-text">
                  <CheckCheck size={14} /> All seven fields matched
                </div>
              </button>
              <button
                className="metric"
                onClick={() => {
                  setView("review");
                  setFilter("all");
                }}
              >
                <span>
                  Human review
                  <Eye size={18} />
                </span>
                <strong>
                  {counts.review.toLocaleString()}
                  <small>cases</small>
                </strong>
                <div>
                  {counts.awaiting_documents} awaiting documents separately
                </div>
              </button>
            </div>
          )}
          {view === "operations" && (
            <OperationsDesk
              cases={cases}
              loading={loading}
              busyId={busyId}
              onOpen={(id) => void openCase(id)}
              onInbox={() => nav("inbox")}
            />
          )}
          {(view === "inbox" || view === "review") && (
            <>
              <div className="section-top">
                <div>
                  <h2>
                    {view === "review" ? "Review queue" : "Shipment requests"}
                    <span className="count-pill">{visible.length}</span>
                  </h2>
                  <p>
                    {view === "review"
                      ? "Missing, unreadable or uncertain data stays visible until resolved."
                      : "Select an email to inspect the comparison and its source evidence."}
                  </p>
                </div>
                <div className="case-actions">
                  <button
                    className="text-button"
                    onClick={() => void exportAll("reviewed")}
                  >
                    Export reviewed evidence
                  </button>
                  <button
                    className="text-button"
                    onClick={() => void exportAll()}
                  >
                    <ArrowDownToLine size={16} />
                    Export automatic baseline
                  </button>
                </div>
              </div>
              <section className="inbox-panel">
                <div className="table-toolbar">
                  <div className="filter-tabs" aria-label="Filter by outcome">
                    {(view === "review"
                      ? [["all", "Needs review"]]
                      : [
                          ["all", "All emails"],
                          ["discrepancy", "Discrepancies"],
                          ["review", "Needs review"],
                          ["verified", "Verified"],
                        ]
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        className={filter === key ? "selected" : ""}
                        onClick={() => setFilter(key)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="table-tools">
                    <label className="search-input">
                      <Search size={16} />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search email, sender, field…"
                        aria-label="Search emails"
                      />
                      {search && (
                        <button
                          onClick={() => setSearch("")}
                          aria-label="Clear search"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </label>
                    <label className="category-filter">
                      <SlidersHorizontal size={16} />
                      <select
                        aria-label="Email category"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="all">All categories</option>
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {categoryNames[c]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                <div className="table-scroll">
                  <Table className="email-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>EMAIL / SHIPMENT</TableHead>
                        <TableHead>CATEGORY</TableHead>
                        <TableHead>DOCUMENTS</TableHead>
                        <TableHead>OUTCOME</TableHead>
                        <TableHead aria-label="Open case" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.slice(0, shownLimit).map((c) => (
                        <TableRow
                          key={c.email.email_id}
                          className={
                            c.result?.workflow === "discrepancy"
                              ? "attention-row"
                              : ""
                          }
                          onClick={() => void openCase(c.email.email_id)}
                        >
                          <TableCell>
                            <button
                              className="email-title"
                              onClick={(e) => {
                                e.stopPropagation();
                                void openCase(c.email.email_id);
                              }}
                            >
                              <span
                                className={`mail-icon ${c.result?.workflow ?? ""}`}
                              >
                                <FileText size={19} />
                              </span>
                              <span>
                                <strong title={c.email.subject}>
                                  {shortSubject(c.email.subject)}
                                </strong>
                                <small>
                                  <span className="mono">
                                    {c.email.email_id.replace("email_", "#")}
                                  </span>
                                  <span className="separator-dot">·</span>
                                  {c.email.from}
                                </small>
                              </span>
                            </button>
                          </TableCell>
                          <TableCell>
                            <span className="category-label">
                              {c.result
                                ? categoryNames[c.result.category]
                                : "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="file-tags">
                              {c.email.attachments.length ? (
                                <>
                                  <Paperclip size={13} />
                                  {[
                                    ...new Set(
                                      c.email.attachments.map((a) =>
                                        a.split(".").pop()?.toUpperCase(),
                                      ),
                                    ),
                                  ].map((f) => (
                                    <span key={f}>{f}</span>
                                  ))}
                                </>
                              ) : (
                                <span className="muted">No attachments</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Status value={c.result?.workflow ?? "pending"} />
                            {!!c.result?.defect_fields.length && (
                              <small className="field-count">
                                {c.result.defect_fields.length}{" "}
                                {c.result.defect_fields.length === 1
                                  ? "field differs"
                                  : "fields differ"}
                              </small>
                            )}
                          </TableCell>
                          <TableCell>
                            {busyId === c.email.email_id ? (
                              <Loader2 size={18} className="spin" />
                            ) : (
                              <ChevronRight size={18} />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {loading ? (
                  <div className="empty-state">
                    <Loader2 className="spin" />
                    <h3>Loading your workspace</h3>
                    <p>Connecting to the inbox and saved results.</p>
                  </div>
                ) : (
                  !visible.length && (
                    <div className="empty-state">
                      <CheckCircle2 size={32} />
                      <h3>
                        {view === "review"
                          ? "No cases in this review queue"
                          : "No matching emails"}
                      </h3>
                      <p>
                        {view === "review"
                          ? "Run the inbox to find documents that need a human decision."
                          : "Try another search or clear the filters."}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => {
                          setSearch("");
                          setFilter("all");
                          setCategory("all");
                        }}
                      >
                        Clear filters
                      </button>
                    </div>
                  )
                )}
                <div className="table-footer">
                  <span>
                    Showing {Math.min(shownLimit, visible.length)} of{" "}
                    {visible.length} emails
                  </span>
                  <div>
                    {shownLimit > 30 && (
                      <button
                        onClick={() => {
                          setPagination(pageKey);
                          setLimit(30);
                        }}
                      >
                        Show fewer
                      </button>
                    )}
                    {visible.length > shownLimit && (
                      <button
                        onClick={() => {
                          setPagination(pageKey);
                          setLimit(shownLimit + 30);
                        }}
                      >
                        Load next 30 <ChevronDown size={14} />
                      </button>
                    )}
                  </div>
                  <span className="evidence-note">
                    <ShieldCheck size={14} /> Every comparison is linked to
                    source evidence
                  </span>
                </div>
              </section>
              <div className="workflow-strip">
                <div>
                  <span>01</span>
                  <Inbox size={17} />
                  <strong>Classify</strong>
                  <small>Five email categories</small>
                </div>
                <ChevronRight size={16} />
                <div>
                  <span>02</span>
                  <FileText size={17} />
                  <strong>Extract</strong>
                  <small>Four document formats</small>
                </div>
                <ChevronRight size={16} />
                <div>
                  <span>03</span>
                  <Layers3 size={17} />
                  <strong>Compare</strong>
                  <small>Seven shipment fields</small>
                </div>
                <ChevronRight size={16} />
                <div>
                  <span>04</span>
                  <ShieldCheck size={17} />
                  <strong>Resolve</strong>
                  <small>Evidence & human review</small>
                </div>
              </div>
            </>
          )}
          {view === "policies" && <PolicyDesk />}
          {view === "performance" && (
            <div className="performance-grid">
              <section className="content-card">
                <div className="card-title">
                  <BarChart3 size={19} />
                  <h2>Current workspace</h2>
                </div>
                <div className="big-rate">
                  {counts.comparisons ? (
                    <>
                      {Math.round((counts.verified / counts.comparisons) * 100)}
                      <span>%</span>
                    </>
                  ) : (
                    "—"
                  )}
                </div>
                <p>
                  Compared pairs with no mismatch detected.
                  <br />
                  This is a clean-pair rate, not an accuracy score.
                </p>
                <div className="distribution">
                  {[
                    "verified",
                    "discrepancy",
                    "review",
                    "awaiting_documents",
                    "routed",
                  ].map((k) => {
                    const n = counts[k as keyof typeof counts];
                    return (
                      <div key={k}>
                        <label>
                          {statuses[k]}
                          <strong>{n}</strong>
                        </label>
                        <div>
                          <i
                            className={k}
                            style={{
                              width: `${(n / Math.max(counts.processed, 1)) * 100}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
              <section className="content-card">
                <div className="card-title">
                  <Sparkles size={19} />
                  <h2>Model & processing</h2>
                </div>
                <dl className="facts">
                  <div>
                    <dt>Classifier</dt>
                    <dd>Learned TF-IDF linear router + safety review</dd>
                  </div>
                  <div>
                    <dt>Training source</dt>
                    <dd>
                      875 authored-data training rows; 175 grouped validation
                      rows
                    </dd>
                  </div>
                  <div>
                    <dt>Comparison</dt>
                    <dd>Typed, deterministic seven-field checks</dd>
                  </div>
                  <div>
                    <dt>Request latency</dt>
                    <dd>
                      {timing
                        ? `Median ${timing.median} ms · p95 ${timing.p95} ms (${timing.count} successful requests in this tab)`
                        : "No measured requests yet"}
                    </dd>
                  </div>
                  <div>
                    <dt>Last batch elapsed</dt>
                    <dd>
                      {batchMs === null
                        ? "Run the inbox to measure"
                        : `${(batchMs / 1000).toFixed(1)} seconds, including network and persistence`}
                    </dd>
                  </div>
                  <div>
                    <dt>Engine version</dt>
                    <dd>
                      {PIPELINE_VERSION} · conservative uncertainty checks
                    </dd>
                  </div>
                  <div>
                    <dt>Storage</dt>
                    <dd>Persistent decision & source storage</dd>
                  </div>
                  <div>
                    <dt>Scans</dt>
                    <dd>
                      Browser-local OCR suggestions + seven-field human
                      confirmation; replacement fallback
                    </dd>
                  </div>
                </dl>
                <div className="info-box">
                  <Info size={17} />
                  <p>
                    Model scores are routing signals, not calibrated
                    probabilities. Document correctness is established by source
                    evidence and field checks.
                  </p>
                </div>
              </section>
              <section className="content-card wide">
                <div className="card-title">
                  <ShieldCheck size={19} />
                  <h2>Reproducible organiser evaluation</h2>
                  <span className="count-pill">520 emails</span>
                </div>
                {validation ? (
                  <>
                    <div className="validation-metrics">
                      {Object.entries(
                        (validation.metrics ?? {}) as Record<string, number>,
                      ).map(([key, value]) => (
                        <div key={key}>
                          <strong>
                            {(value * 100).toFixed(1)}
                            <span>%</span>
                          </strong>
                          <small>{key.replaceAll("_", " ")}</small>
                        </div>
                      ))}
                    </div>
                    <p>{String(validation.note ?? "")}</p>
                    {Array.isArray(validation.challenge_sets) && (
                      <details className="validation-extra">
                        <summary>
                          Extended synthetic development checks (not a held-out
                          benchmark)
                        </summary>
                        <div className="table-scroll">
                          <table>
                            <thead>
                              <tr>
                                <th>Dataset</th>
                                <th>Emails</th>
                                <th>Output differences</th>
                                <th>False clearances</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(
                                validation.challenge_sets as {
                                  name: string;
                                  emails: number;
                                  output_differences: number;
                                  false_clearances: number;
                                }[]
                              ).map((d) => (
                                <tr key={d.name}>
                                  <td>{d.name}</td>
                                  <td>{d.emails}</td>
                                  <td>{d.output_differences}</td>
                                  <td>{d.false_clearances}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p>{String(validation.challenge_limitations ?? "")}</p>
                      </details>
                    )}
                    <p className="muted">
                      Measured {String(validation.generated_at ?? "")} ·{" "}
                      {String(validation.version ?? "development corpus")}
                    </p>
                  </>
                ) : (
                  <p>
                    Evaluation report is not available in this build. Workspace
                    statistics above show actual processed results.
                  </p>
                )}
                <a href="/validation.json" className="text-button" download>
                  <ArrowDownToLine size={16} />
                  Download validation report
                </a>
              </section>
            </div>
          )}
          {view === "activity" && (
            <section className="content-card">
              <div className="card-title">
                <History size={19} />
                <h2>Recent activity</h2>
                <span className="count-pill">Latest 100 events</span>
              </div>
              {!events.length ? (
                <div className="empty-state">
                  <History size={28} />
                  <h3>Your audit trail starts here</h3>
                  <p>
                    Processing and reviewer corrections are recorded
                    automatically.
                  </p>
                </div>
              ) : (
                <div className="timeline">
                  {events.map((e) => (
                    <div key={e.id}>
                      <span className="timeline-icon">
                        {e.action === "FIELD_CORRECTED" ? (
                          <Eye size={16} />
                        ) : (
                          <Check size={16} />
                        )}
                      </span>
                      <div>
                        <strong>
                          {e.action.replaceAll("_", " ").toLowerCase()}{" "}
                          <span className="mono">{e.email_id}</span>
                        </strong>
                        <AuditDetail detail={e.detail} />
                        <small>
                          {e.actor} · {new Date(e.created_at).toLocaleString()}
                        </small>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
          <footer className="page-footer">
            <span>
              CargoGuard <span className="footer-divider">/</span> Shipping
              document verification
            </span>
            <span>SI is the reference. Uncertainty is always visible.</span>
          </footer>
        </main>
      </div>
      <Sheet
        open={!!selected}
        onOpenChange={(v) => {
          if (!v) closeCase();
        }}
      >
        {selected && (
          <SheetContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="case-drawer"
          >
            <SheetTitle className="sr-only">Verification details</SheetTitle>
            <div className="drawer-top">
              <div>
                <span className="eyebrow">VERIFICATION DETAILS</span>
                <h2>
                  {selected.email.email_id.replace("email_", "Shipment #")}
                </h2>
              </div>
              <div className="drawer-tools">
                {selected.comparison.some(
                  (row) => row.result === "mismatch",
                ) && (
                  <button
                    className="button secondary"
                    onClick={() => setDetailTab("resolution")}
                  >
                    Draft amendment
                  </button>
                )}
                <button
                  className="icon-button"
                  onClick={() => window.print()}
                  title="Print report"
                  aria-label="Print report"
                >
                  <Printer size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Close details"
                  onClick={closeCase}
                >
                  <X size={21} />
                </button>
              </div>
            </div>
            <div className="drawer-content">
              {error && (
                <div className="alert error" role="alert">
                  {error}
                </div>
              )}
              <div className="case-summary">
                <Status value={selected.workflow} />
                {selected.reviewed && (
                  <span className="reviewed-tag">
                    <Eye size={13} />
                    Human reviewed
                  </span>
                )}
                <h3>{selected.email.subject}</h3>
                <p>{selected.summary}</p>
                <div className="case-meta">
                  <span>{selected.email.from}</span>
                  <span>Engine {selected.pipeline_version ?? "legacy"}</span>
                  <span>Revision {selected.version}</span>
                </div>
                <div className="case-actions">
                  <button
                    className="button secondary"
                    disabled={running || saving}
                    onClick={() => {
                      setError("");
                      setRouteEdit(true);
                    }}
                  >
                    Confirm category
                  </button>
                  <button
                    className="text-button"
                    disabled={!!busyId}
                    onClick={() => void openCase(selected.email.email_id)}
                  >
                    Reload case
                  </button>
                </div>
              </div>
              <div className="detail-tabs">
                {[
                  "comparison",
                  "resolution",
                  "assistant",
                  "documents",
                  "email",
                  "history",
                ].map((t) => (
                  <button
                    key={t}
                    className={detailTab === t ? "active" : ""}
                    onClick={() =>
                      t === "assistant"
                        ? launchAssistant(selected.email.email_id)
                        : setDetailTab(t)
                    }
                  >
                    {t === "history"
                      ? "Audit trail"
                      : t === "assistant"
                        ? "Ask CargoGuard"
                        : t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
              {detailTab === "resolution" && (
                <ResolutionDesk
                  result={selected}
                  onNavigate={setDetailTab}
                  onSource={(name, location) => {
                    const source = selected.documents.find(
                      (doc) => doc.name === name,
                    );
                    if (source) {
                      setDocument(source);
                      setSourceLocation(location);
                      setDetailTab("documents");
                    }
                  }}
                />
              )}
              {detailTab === "comparison" && (
                <>
                  {selected.comparison.length ? (
                    <>
                      <div className="policy-case-note">
                        <strong>
                          Exact seven-field verdict: {selected.status}
                        </strong>
                        <p>
                          Policy v{selected.policy?.version ?? 0}:{" "}
                          {selected.policy_assessment?.note ??
                            "Exact comparison; no business exception recorded."}
                        </p>
                      </div>
                      <div className="comparison-head">
                        <span>SHIPMENT FIELD</span>
                        <span>
                          SI <small>Reference</small>
                        </span>
                        <span>DRAFT BL</span>
                      </div>
                      <div className="comparison-focus">
                        <label>
                          <input
                            type="checkbox"
                            checked={attentionOnly}
                            onChange={(e) => setAttentionOnly(e.target.checked)}
                          />{" "}
                          Focus on differences & uncertain values
                        </label>
                        <span>
                          {
                            selected.comparison.filter(
                              (row) => !attentionOnly || row.result !== "match",
                            ).length
                          }{" "}
                          of {selected.comparison.length} fields shown
                        </span>
                      </div>
                      {attentionOnly &&
                        selected.comparison.every(
                          (row) => row.result === "match",
                        ) && (
                          <p className="focus-empty">
                            No differences or uncertain fields in this
                            comparison. Uncheck the filter to inspect all seven
                            fields.
                          </p>
                        )}
                      <div className="comparison-rows">
                        {[...selected.comparison]
                          .filter(
                            (row) => !attentionOnly || row.result !== "match",
                          )
                          .sort(
                            (a, b) =>
                              ({ uncertain: 0, mismatch: 1, match: 2 })[
                                a.result
                              ] -
                              { uncertain: 0, mismatch: 1, match: 2 }[b.result],
                          )
                          .map((row) => (
                            <div
                              key={row.field}
                              className={`compare-row ${row.result}`}
                            >
                              <div className="row-label">
                                {row.result === "match" ? (
                                  <CheckCircle2 size={16} />
                                ) : (
                                  <TriangleAlert size={16} />
                                )}
                                <strong>{FIELD_LABELS[row.field]}</strong>
                                <span>
                                  {row.result === "match"
                                    ? "Match"
                                    : row.result === "uncertain"
                                      ? "Needs confirmation"
                                      : "Mismatch"}
                                </span>
                              </div>
                              {(["si", "bl"] as const).map((side) => (
                                <div className="comparison-value" key={side}>
                                  <p>{row[side].raw || "Missing value"}</p>
                                  <small
                                    className={
                                      row[side].issue
                                        ? "field-issue"
                                        : "normalized-value"
                                    }
                                  >
                                    {row[side].issue ??
                                      `Compared as: ${row[side].normalized ?? "Needs confirmation"}`}
                                  </small>
                                  <button
                                    className="source-link"
                                    onClick={() => {
                                      setDocument(
                                        selected.documents.find(
                                          (d) => d.name === row[side].source,
                                        ) ?? null,
                                      );
                                      setSourceLocation(row[side].evidence);
                                      setDetailTab("documents");
                                    }}
                                  >
                                    <FileText size={12} />
                                    {row[side].evidence}
                                  </button>
                                  <button
                                    className="edit-value"
                                    onClick={() =>
                                      setEdit({
                                        field: row.field,
                                        side,
                                        value: row[side].raw,
                                      })
                                    }
                                  >
                                    Correct value
                                  </button>
                                </div>
                              ))}
                            </div>
                          ))}
                      </div>
                      <div className="info-box">
                        <ShieldCheck size={17} />
                        <p>
                          Whitespace and punctuation are normalized. Container
                          counts and weight are compared as numbers. Compound
                          counts are summed only when the whole expression is
                          valid. Missing, conflicting and ambiguous values are
                          never assumed to match.
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="review-context">
                      <Eye size={32} />
                      <h3>
                        {selected.workflow === "awaiting_documents"
                          ? "Waiting for the source documents"
                          : selected.category !== "BL_COMPARISON"
                            ? categoryNames[selected.category]
                            : "Human review required"}
                      </h3>
                      <p>{selected.summary}</p>
                      {selected.review_reason && (
                        <span className="reason-tag">
                          {selected.review_reason.replaceAll("_", " ")}
                        </span>
                      )}
                      <button
                        className="button secondary"
                        onClick={() => setDetailTab("documents")}
                      >
                        Inspect attachments <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                  <div className="classification-card">
                    <div>
                      <Sparkles size={17} />
                      <strong>{categoryNames[selected.category]}</strong>
                    </div>
                    <p>{selected.classification.method}</p>
                    <div className="signal-list">
                      {selected.classification.signals.map((s, i) => (
                        <span key={i}>{s}</span>
                      ))}
                    </div>
                  </div>
                </>
              )}
              {detailTab === "documents" && (
                <div className="document-view">
                  <div className="document-select">
                    {selected.documents.map((d) => (
                      <button
                        key={d.name}
                        className={document?.name === d.name ? "selected" : ""}
                        onClick={() => setDocument(d)}
                      >
                        <FileText size={17} />
                        <span>
                          {d.name}
                          <small>
                            {d.type} · {d.method}
                          </small>
                        </span>
                        <span className="format-pill">
                          {d.format.toUpperCase()}
                        </span>
                      </button>
                    ))}
                  </div>
                  {!selected.documents.length ? (
                    <div className="empty-state">
                      <Paperclip size={28} />
                      <h3>No attachments available</h3>
                      <p>
                        Request both the SI and draft BL before verifying this
                        shipment.
                      </p>
                    </div>
                  ) : (
                    (() => {
                      const d =
                        document &&
                        selected.documents.some((x) => x.name === document.name)
                          ? document
                          : selected.documents[0];
                      return (
                        <>
                          <div className="source-toolbar">
                            <strong
                              title={
                                d.sha256 ? `SHA-256: ${d.sha256}` : undefined
                              }
                            >
                              {d.name}
                            </strong>
                            <a
                              target="_blank"
                              rel="noreferrer"
                              className="text-button"
                              href={`/api/document?id=${encodeURIComponent(selected.email.email_id)}&name=${encodeURIComponent(d.name)}&revision=${selected.version}`}
                            >
                              Open original <ExternalLink size={14} />
                            </a>
                          </div>
                          {canTranscribe(d) && (
                            <ScanAssist
                              key={`${selected.email.email_id}-${d.name}-${selected.version}`}
                              doc={d}
                              result={selected}
                              onSaved={(data) => {
                                setSelected(data.result);
                                setDocument(null);
                                update([data.result]);
                                setCaseEvents(data.audit);
                                setNotice(
                                  "Human-confirmed scan transcription saved with source fingerprint and audit history.",
                                );
                              }}
                            />
                          )}
                          {!d.error &&
                            !!d.sha256 &&
                            d.lines.length > 0 &&
                            d.type !== "OTHER" &&
                            !d.transcription && (
                              <EvidenceRecovery
                                key={`recovery-${selected.email.email_id}-${d.name}-${selected.version}`}
                                doc={d}
                                result={selected}
                                onEvidence={setSourceLocation}
                                onSaved={(data) => {
                                  setSelected(data.result);
                                  setDocument(null);
                                  update([data.result]);
                                  setCaseEvents(data.audit);
                                  setNotice(
                                    "Source-linked recovery confirmed. Strict checks rerun; AI provenance and human review retained.",
                                  );
                                }}
                              />
                            )}
                          {d.error ? (
                            <div className="alert warning">
                              <TriangleAlert size={18} />
                              <p>{d.error}</p>
                            </div>
                          ) : (
                            <div className="source-paper">
                              <div className="paper-heading">
                                <Anchor size={20} />
                                <span>
                                  {d.type === "SI"
                                    ? "SHIPPING INSTRUCTION"
                                    : d.type === "BL"
                                      ? "BILL OF LADING"
                                      : "SOURCE DOCUMENT"}
                                </span>
                              </div>
                              {d.lines
                                .filter((l) => l.text.trim())
                                .map((l, i) => (
                                  <div
                                    className={`source-line ${sourceLocation && sourceLocation.includes(l.location) ? "highlighted-source" : ""}`}
                                    ref={
                                      sourceLocation &&
                                      sourceLocation.includes(l.location)
                                        ? highlighted
                                        : undefined
                                    }
                                    key={i}
                                  >
                                    <span>{l.location}</span>
                                    <p>{l.text}</p>
                                  </div>
                                ))}
                            </div>
                          )}
                        </>
                      );
                    })()
                  )}
                </div>
              )}
              {detailTab === "email" && (
                <div className="email-source">
                  <dl className="facts">
                    <div>
                      <dt>From</dt>
                      <dd>{selected.email.from}</dd>
                    </div>
                    <div>
                      <dt>Subject</dt>
                      <dd>{selected.email.subject}</dd>
                    </div>
                  </dl>
                  <pre>{selected.email.body}</pre>
                </div>
              )}
              {detailTab === "history" && (
                <div className="timeline">
                  <DecisionHistory
                    key={`${selected.email.email_id}-${selected.version}`}
                    result={selected}
                  />
                  {caseEvents.length ? (
                    caseEvents.map((e) => (
                      <div key={e.id}>
                        <span className="timeline-icon">
                          <History size={15} />
                        </span>
                        <div>
                          <strong>{e.action.replaceAll("_", " ")}</strong>
                          <AuditDetail detail={e.detail} />
                          <small>
                            {e.actor} ·{" "}
                            {new Date(e.created_at).toLocaleString()}
                          </small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p>
                      Processing was recorded. Reopen this case to refresh its
                      full audit trail.
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="drawer-footer">
              <button
                className="button secondary"
                disabled={running}
                onClick={() => {
                  setReplacement(selected);
                  setUpload(true);
                }}
              >
                Replace documents
              </button>
              <span>
                <ShieldCheck size={15} />
                Changes are recorded in the audit trail
              </span>
              <button
                className="button secondary"
                disabled={!!busyId || running}
                onClick={reprocess}
                title="Re-read current bytes; retain confirmed scan transcripts and category; reset individual field edits."
              >
                {busyId ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                Reprocess sources
              </button>
            </div>
          </SheetContent>
        )}
      </Sheet>
      <Dialog
        open={upload}
        onOpenChange={(v) => {
          if (!uploading) {
            setUpload(v);
            if (!v) setReplacement(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="modal"
        >
          <div className="modal-heading">
            <div>
              <span className="eyebrow">NEW VERIFICATION</span>
              <DialogTitle>
                {replacement
                  ? "Replace source documents."
                  : "Bring your own documents."}
              </DialogTitle>
            </div>
            <button
              className="icon-button"
              aria-label="Close upload"
              disabled={uploading}
              onClick={() => setUpload(false)}
            >
              <X size={20} />
            </button>
          </div>
          <p>
            Upload an SI and draft BL. The same pipeline used for the organiser
            inbox will process your files.
          </p>
          <p className="info-box">
            Hackathon demo: use organiser or synthetic files only, never
            confidential shipments. Reviewer names are self-declared. Keep this
            browser’s cookies to retain access to your workspace.
          </p>
          <form onSubmit={uploadCase}>
            {error && (
              <p className="alert error" role="alert">
                {error}
              </p>
            )}
            {replacement && (
              <>
                <div className="info-box">
                  Replacing documents for {replacement.email.email_id}. Earlier
                  decisions remain in the audit trail.
                </div>
                <label>
                  Reviewer name
                  <input required name="actor" minLength={2} maxLength={80} />
                </label>
                <label>
                  Reason for replacement
                  <textarea
                    required
                    name="reason"
                    minLength={5}
                    maxLength={2000}
                  />
                </label>
              </>
            )}
            <label hidden={!!replacement}>
              Email subject
              <input
                required={!replacement}
                defaultValue={replacement?.email.subject ?? ""}
                name="subject"
                placeholder="Please verify the draft BL against the SI"
                maxLength={500}
              />
            </label>
            <label hidden={!!replacement}>
              Email message
              <textarea
                required={!replacement}
                name="body"
                rows={3}
                defaultValue="Please compare the attached Shipping Instruction and draft Bill of Lading. Report any discrepancies."
                maxLength={20000}
              />
            </label>
            <label className="upload-zone">
              <ArrowUpRight size={24} />
              <strong>Choose SI & draft BL</strong>
              <span>TXT, PDF, DOCX or XLSX · Up to 5 MB each</span>
              <input
                type="file"
                name="files"
                multiple
                accept=".txt,.pdf,.docx,.xlsx"
              />
            </label>
            <div className="info-box">
              <ShieldCheck size={16} />
              <p>
                Files stay in this workspace. Missing or unreadable data is
                escalated for review.
              </p>
            </div>
            <button className="button primary full" disabled={uploading}>
              {uploading ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <Sparkles size={17} />
              )}{" "}
              {uploading ? "Reading documents…" : "Verify documents"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={routeEdit && !!selected}
        onOpenChange={(v) => {
          if (!saving) setRouteEdit(v);
        }}
      >
        {selected && (
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="modal"
          >
            <div className="modal-heading">
              <DialogTitle>Confirm email category</DialogTitle>
              <button
                disabled={saving}
                className="icon-button"
                aria-label="Close category review"
                onClick={() => setRouteEdit(false)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              Read the current email request and attachments. A category change
              reruns document checks; it is not permission to approve uncertain
              shipment fields. Changing away from document verification removes
              its comparison from the active decision.
            </p>
            <form onSubmit={saveRoute}>
              {error && (
                <p className="alert error" role="alert">
                  {error}
                </p>
              )}
              <label>
                Confirmed category
                <select
                  name="category"
                  defaultValue={selected.category}
                  required
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {categoryNames[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Reviewer name
                <input name="actor" required minLength={2} maxLength={80} />
              </label>
              <label>
                Reason
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={2000}
                  rows={3}
                />
              </label>
              <button disabled={saving} className="button primary full">
                {saving ? "Saving…" : "Confirm category & rerun checks"}
              </button>
            </form>
          </DialogContent>
        )}
      </Dialog>
      <Dialog
        open={!!edit && !!selected}
        onOpenChange={(v) => {
          if (!v && !saving) setEdit(null);
        }}
      >
        {edit && selected && (
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="modal"
          >
            <div className="modal-heading">
              <DialogTitle>
                Confirm {FIELD_LABELS[edit.field].toLowerCase()}
              </DialogTitle>
              <button
                className="icon-button"
                aria-label="Close correction"
                disabled={saving}
                onClick={() => setEdit(null)}
              >
                <X size={20} />
              </button>
            </div>
            <p>
              Update the extracted {edit.side.toUpperCase()} value after
              checking the original source. This does not edit the original
              document.
            </p>
            <form onSubmit={saveEdit}>
              {error && (
                <p className="alert error" role="alert">
                  {error}
                </p>
              )}
              <label>
                Confirmed value
                <textarea
                  required
                  rows={3}
                  value={edit.value}
                  onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                  maxLength={2000}
                />
              </label>
              <label>
                Reviewer name
                <input
                  required
                  name="actor"
                  minLength={2}
                  maxLength={80}
                  placeholder="Your name"
                />
              </label>
              <label>
                Reason for correction
                <textarea
                  required
                  name="reason"
                  minLength={5}
                  maxLength={2000}
                  placeholder="What did you confirm in the source?"
                  rows={2}
                />
              </label>
              <button disabled={saving} className="button primary full">
                {saving ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <CheckCheck size={17} />
                )}
                Save correction & recompute
              </button>
            </form>
          </DialogContent>
        )}
      </Dialog>
      {assistant ? (
        <GlobalAssistant
          key={assistant.sequence}
          cases={cases}
          initialCaseId={assistant.id}
          workspaceReady={inboxReady && !loading}
          onUpdated={update}
          memories={assistantMemories}
          setMemories={setAssistantMemories}
          onOpenCase={(id, tab) => void openCase(id, tab)}
        />
      ) : (
        <button
          className="assistant-fab"
          aria-label="Open Ask CargoGuard"
          onClick={() => launchAssistant()}
        >
          <MessageSquareText size={23} />
          <span>Ask CargoGuard</span>
        </button>
      )}
    </SidebarProvider>
  );
}
