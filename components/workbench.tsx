"use client";
import "@/app/follow-up.css";
import { FollowUpDesk, FOLLOW_UP_LABELS } from "./follow-up-desk";
import { effectiveFollowUp, type FollowUp } from "@/lib/follow-up";
import { PolicyDesk } from "./policy-desk";
import { DecisionHistory } from "./decision-history";
import type { PolicySnapshot } from "@/lib/policy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { WorkspaceNav } from "./workspace-nav";
import { useTeamAccess } from "./team-access";
import { requestJson, requestInbox, latencySummary } from "@/lib/client-api";
import { previewCorrection } from "@/lib/corrections";
import { CorrectionPreview } from "./correction-preview";
import { DocumentPairSelector } from "./document-pair-selector";
import { createRequestGate } from "@/lib/request-gate";
import { mergeCaseSummaries } from "@/lib/case-state";
import { ScanAssist } from "@/components/scan-assist";
import { ResolutionDesk } from "@/components/resolution-desk";
import { GlobalAssistant } from "@/components/global-assistant";
import type { AssistantMemory } from "@/components/case-assistant";
import { EvidenceRecovery } from "@/components/evidence-recovery";
import { WorkloadInsights } from "@/components/workload-insights";
import { AiAvailability } from "@/components/ai-availability";
import { IntegrityChecks } from "./integrity-checks";
import { PortReferenceChecks } from "./port-reference-checks";
import { checkDocumentIntegrity } from "@/lib/integrity-checks";
import { BatchReview } from "./batch-review";
import { MismatchNote, MismatchTriage } from "./mismatch-note";
import { explainMismatches } from "@/lib/mismatch-explainer";
import "@/app/integrity-checks.css";
import {
  QUEUE_FILTERS,
  FOLLOW_UP_FILTERS,
  isFollowUpOverdue,
  type FollowUpMap,
  caseDestination,
  matchesQueue,
  nextQueueCase,
  workQueue,
  type WorkspaceView,
} from "@/lib/work-queue";
import { laneFor, LANE_DETAILS, shiftBrief } from "@/lib/operations";
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
  Settings2,
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
type View = WorkspaceView;
type AuthoredChallenge = {
  cases: number;
  strict_passed: number;
  integrity_passed: number;
  combined_passed: number;
  expected_mismatches: number;
  expected_reviews: number;
  expected_independent_attention: number;
  dataset_sha256: string;
  measured_at: string;
  limitations: string;
};

function AuthoredOperationsChallenge({ report }: { report: unknown }) {
  if (!report || typeof report !== "object" || Array.isArray(report))
    return null;
  const data = report as AuthoredChallenge;
  const counts = [
    data.cases,
    data.strict_passed,
    data.integrity_passed,
    data.combined_passed,
    data.expected_mismatches,
    data.expected_reviews,
    data.expected_independent_attention,
  ];
  if (
    counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    !data.cases ||
    counts.slice(1).some((count) => count > data.cases)
  )
    return null;
  return (
    <section
      className="validation-extra policy-preview"
      aria-labelledby="authored-challenge-title"
    >
      <h3 id="authored-challenge-title">Authored operations challenge</h3>
      <p>
        Synthetic, self-authored cases; not a blinded real-world evaluation.
        These {data.cases} cases are separate from the organiser benchmark
        above.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Check</th>
              <th>Expected outcomes reproduced</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Strict document verification</td>
              <td>
                {data.strict_passed} / {data.cases}
              </td>
            </tr>
            <tr>
              <td>Independent document checks</td>
              <td>
                {data.integrity_passed} / {data.cases}
              </td>
            </tr>
            <tr>
              <td>Both checks together</td>
              <td>
                {data.combined_passed} / {data.cases}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        Expected findings: {data.expected_mismatches} document mismatches,{" "}
        {data.expected_reviews} document reviews and{" "}
        {data.expected_independent_attention} cases needing independent-check
        attention. Independent findings can overlap document outcomes.
      </p>
      {typeof data.limitations === "string" && <p>{data.limitations}</p>}
      <details>
        <summary>Measurement and corpus identity</summary>
        <p>
          Measured{" "}
          {typeof data.measured_at === "string"
            ? data.measured_at
            : "Not recorded"}
        </p>
        <p className="mono" style={{ overflowWrap: "anywhere" }}>
          Dataset SHA-256:{" "}
          {typeof data.dataset_sha256 === "string"
            ? data.dataset_sha256
            : "Not recorded"}
        </p>
      </details>
    </section>
  );
}

interface ApiPayload {
  workspace?: { mode: string; sample_data: boolean; upload_limit: number };
  loaded_at?: string;
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
  const access = useTeamAccess();
  const [workspaceConfig, setWorkspaceConfig] =
    useState<ApiPayload["workspace"]>();
  const employeeName = access?.user?.display_name ?? "Operations";
  const initials = employeeName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const [followups, setFollowups] = useState<FollowUpMap>({});
  const [followupsReady, setFollowupsReady] = useState(false);
  const [followupsLoading, setFollowupsLoading] = useState(false);
  const [followupsError, setFollowupsError] = useState("");
  const [followupFormKey, setFollowupFormKey] = useState(0);
  const [queueNow, setQueueNow] = useState(() => Date.now());
  const followupRequests = useRef(createRequestGate());
  const followupController = useRef<AbortController | null>(null);
  const loadFollowups = useCallback(async () => {
    const ticket = followupRequests.current.next();
    followupController.current?.abort();
    const controller = new AbortController();
    followupController.current = controller;
    setFollowupsLoading(true);
    try {
      const data = await requestJson<{
        followups: FollowUp[];
        loaded_at: string;
      }>("/api/follow-ups", { signal: controller.signal, cache: "no-store" });
      if (followupRequests.current.isCurrent(ticket)) {
        setFollowups(
          Object.fromEntries(
            data.followups.map((value) => [value.email_id, value]),
          ),
        );
        setFollowupsReady(true);
        setFollowupsError("");
        setQueueNow(Date.now());
        return true;
      }
    } catch (e) {
      if (followupRequests.current.isCurrent(ticket)) {
        setFollowupsError(
          `Follow-up refresh failed. ${e instanceof Error ? e.message : "Please retry."}`,
        );
      }
    } finally {
      if (followupRequests.current.isCurrent(ticket))
        setFollowupsLoading(false);
    }
    return false;
  }, []);
  const [assistantMemories, setAssistantMemories] = useState<
    Record<string, AssistantMemory>
  >({});
  const [cases, setCases] = useState<CaseSummary[]>([]),
    [events, setEvents] = useState<AuditEvent[]>([]),
    [loading, setLoading] = useState(true),
    [inboxReady, setInboxReady] = useState(false),
    [lastSync, setLastSync] = useState<string | null>(null),
    [refreshFailed, setRefreshFailed] = useState(false),
    [intakeFiles, setIntakeFiles] = useState<File[]>([]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("inbox"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [category, setCategory] = useState("all"),
    [limit, setLimit] = useState(30);
  const [selected, setSelected] = useState<CaseResult | null>(null),
    [caseEvents, setCaseEvents] = useState<AuditEvent[]>([]),
    [detailTab, setDetailTab] = useState("comparison"),
    [document, setDocument] = useState<ParsedDocument | null>(null);
  const selectedCaseId = useRef<string | null>(null);
  const explanations = useMemo(
    () => (selected ? explainMismatches(selected.comparison) : {}),
    [selected],
  );
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [auditSearch, setAuditSearch] = useState("");
  const [queueSession, setQueueSession] = useState<string[]>([]);
  const [assistant, setAssistant] = useState<{
    id: string | null;
    sequence: number;
  } | null>(null);
  const [running, setRunning] = useState(false),
    [progress, setProgress] = useState({ done: 0, total: 0 }),
    [busyId, setBusyId] = useState(""),
    cancel = useRef(false);
  const [replacement, setReplacement] = useState<CaseResult | null>(null);
  const [replacementMode, setReplacementMode] = useState<"all" | "bl">("all");
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
  const drawerBody = useRef<HTMLDivElement | null>(null);
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
  const deepLinkHandled = useRef(false);
  const inboxRequests = useRef(createRequestGate());
  const inboxController = useRef<AbortController | null>(null);
  function closeCase() {
    activeRequest.current.cancel();
    selectedCaseId.current = null;
    setSelected(null);
    setDocument(null);
    setCaseEvents([]);
    setEdit(null);
    setRouteEdit(false);
    setBusyId("");
  }
  const load = useCallback(async () => {
    const request = inboxRequests.current.next();
    inboxController.current?.abort();
    const controller = new AbortController();
    inboxController.current = controller;
    try {
      const started = performance.now();
      const d = await requestInbox<ApiPayload>(controller.signal);
      if (inboxRequests.current.isCurrent(request)) {
        setCases(d.cases);
        setWorkspaceConfig(d.workspace);
        setEvents(d.audit);
        setInboxReady(true);
        setLastSync(d.loaded_at ?? new Date().toISOString());
        setRefreshFailed(false);
        void loadFollowups();
        setLatencies((prev) => [
          ...prev.slice(-199),
          performance.now() - started,
        ]);
      }
    } catch (e) {
      if (inboxRequests.current.isCurrent(request)) {
        setError((e as Error).message);
        setRefreshFailed(true);
      }
    } finally {
      if (inboxRequests.current.isCurrent(request)) setLoading(false);
    }
  }, [loadFollowups]);
  function refreshWorkspace() {
    setLoading(true);
    setError("");
    void load();
  }
  useEffect(() => {
    let active = true;
    const gate = inboxRequests.current;
    const followupGate = followupRequests.current;
    const request = gate.next();
    const controller = new AbortController();
    inboxController.current?.abort();
    inboxController.current = controller;
    const started = performance.now();
    requestInbox<ApiPayload>(controller.signal)
      .then((d) => {
        if (active && gate.isCurrent(request)) {
          setCases(d.cases);
          setWorkspaceConfig(d.workspace);
          setEvents(d.audit);
          setInboxReady(true);
          setLastSync(d.loaded_at ?? new Date().toISOString());
          setRefreshFailed(false);
          // Source citations open saved evidence; visiting a link never processes mail.
          if (!deepLinkHandled.current) {
            deepLinkHandled.current = true;
            const id = new URLSearchParams(window.location.search).get("case");
            if (
              id &&
              d.cases.some((c) => c.email.email_id === id && c.result)
            ) {
              const ticket = activeRequest.current.next();
              requestJson<ApiPayload>(
                `/api/cases?id=${encodeURIComponent(id)}`,
                { signal: controller.signal },
              )
                .then((data) => {
                  if (active && activeRequest.current.isCurrent(ticket)) {
                    selectedCaseId.current = id;
                    setSelected(data.result);
                    setCaseEvents(data.audit);
                  }
                })
                .catch((e) => {
                  if (active && activeRequest.current.isCurrent(ticket))
                    setError(e.message);
                });
            } else if (id)
              setError(
                "The cited case is not processed or is unavailable in this workspace.",
              );
          }
          void loadFollowups();
          setLatencies((prev) => [
            ...prev.slice(-199),
            performance.now() - started,
          ]);
        }
      })
      .catch((e) => {
        if (active && gate.isCurrent(request)) {
          setError((e as Error).message);
          setRefreshFailed(true);
        }
      })
      .finally(() => {
        if (active && gate.isCurrent(request)) setLoading(false);
      });
    fetch("/validation.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (active) setValidation(v as Record<string, unknown> | null);
      })
      .catch(() => {});
    return () => {
      active = false;
      gate.cancel();
      inboxController.current?.abort();
      followupGate.cancel();
      followupController.current?.abort();
      cancel.current = true;
    };
  }, [loadFollowups]);
  useEffect(() => {
    const timer = setInterval(() => setQueueNow(Date.now()), 30000);
    return () => clearInterval(timer);
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
    () => workQueue(cases, filter, category, search, followups, queueNow),
    [cases, search, filter, category, followups, queueNow],
  );
  const queueCounts = useMemo(
    () =>
      Object.fromEntries(
        [
          ...QUEUE_FILTERS.map(([key]) => key),
          ...FOLLOW_UP_FILTERS.map(([key]) => key),
          "pending",
          "routed",
        ].map((key) => [
          key,
          cases.filter((row) => matchesQueue(row, key, followups, queueNow))
            .length,
        ]),
      ),
    [cases, followups, queueNow],
  );
  const nextId = selected
    ? nextQueueCase(
        queueSession,
        selected.email.email_id,
        cases.map((row) => row.email.email_id),
      )
    : null;
  function navigateDetail(target: string) {
    drawerBody.current?.scrollTo({ top: 0, behavior: "instant" });
    const destination = caseDestination(target);
    setDetailTab(destination.tab);
    setEmailOpen(destination.email);
    setResolutionOpen(destination.resolution);
  }
  const update = (results: CaseResult[]) => {
    inboxRequests.current.cancel();
    inboxController.current?.abort();
    setLoading(false);
    setCases((prev) => mergeCaseSummaries(prev, results.map(summaryOf)));
  };
  async function followupSaved(value: FollowUp) {
    followupRequests.current.cancel();
    followupController.current?.abort();
    setFollowupsLoading(false);
    setFollowups((current) => ({ ...current, [value.email_id]: value }));
    setNotice("Follow-up saved. The document verdict is unchanged.");
    void load();
    if (selectedCaseId.current !== value.email_id) return;
    const ticket = activeRequest.current.next();
    try {
      const data = await api(
        `/api/cases?id=${encodeURIComponent(value.email_id)}`,
      );
      if (
        activeRequest.current.isCurrent(ticket) &&
        selectedCaseId.current === value.email_id
      ) {
        setSelected((current) =>
          current?.email.email_id === value.email_id ? data.result : current,
        );
        setCaseEvents(data.audit);
      }
    } catch (e) {
      if (activeRequest.current.isCurrent(ticket))
        setError(
          `Follow-up saved; case refresh failed. ${(e as Error).message}`,
        );
    }
  }
  async function reloadFollowupCase(id: string) {
    if (selectedCaseId.current !== id) return;
    const ticket = activeRequest.current.next();
    setBusyId(id);
    setError("");
    try {
      const [data, followupsLoaded] = await Promise.all([
        api(`/api/cases?id=${encodeURIComponent(id)}`),
        loadFollowups(),
      ]);
      if (
        !followupsLoaded ||
        !activeRequest.current.isCurrent(ticket) ||
        selectedCaseId.current !== id
      )
        return;
      // Explicit recovery resets the draft only after both fresh reads succeed.
      update([data.result]);
      setSelected(data.result);
      setCaseEvents(data.audit);
      setFollowupFormKey((value) => value + 1);
      setNotice(
        `Latest case revision ${data.result.version} and saved follow-up loaded.`,
      );
    } catch (e) {
      if (
        activeRequest.current.isCurrent(ticket) &&
        selectedCaseId.current === id
      )
        setError(
          `Latest case could not be loaded; your follow-up edits are retained. ${(e as Error).message}`,
        );
    } finally {
      if (activeRequest.current.isCurrent(ticket)) setBusyId("");
    }
  }
  function launchAssistant(id: string | null = null) {
    closeCase();
    setAssistant((previous) => ({
      id,
      sequence: (previous?.sequence ?? 0) + 1,
    }));
  }
  async function openCase(
    id: string,
    tab = "comparison",
    continueQueue = false,
  ) {
    if (!continueQueue)
      setQueueSession(visible.map((row) => row.email.email_id));
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
        selectedCaseId.current = result.email.email_id;
        setSelected(result);
        setDocument(null);
        setSourceLocation("");
        setCaseEvents(history);
        navigateDetail(tab);
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
            if (replacementMode === "bl") {
              fd.set("mode", "replace_bl");
              fd.delete("subject");
              fd.delete("body");
            }
          }
          return fd;
        })(),
      });
      update([d.result]);
      if (!activeRequest.current.isCurrent(request)) return;
      selectedCaseId.current = d.result.email.email_id;
      setSelected(d.result);
      navigateDetail(
        d.result.documents.length > 2 ? "documents" : "comparison",
      );
      setCaseEvents([]);
      setUpload(false);
      setReplacement(null);
      setDocument(null);
      setNotice(
        replacement && replacementMode === "bl"
          ? "Revised BL saved against the retained SI. All seven fields rechecked; inspect History for new or resolved differences."
          : "Email and attachments saved. Inspect the results before taking action.",
      );
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
    const advance =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "next";
    const following = nextId;
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
      if (advance && following) await openCase(following, "comparison", true);
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
    closeCase();
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  function openQueue(outcome: string) {
    setFilter(outcome);
    setCategory("all");
    setSearch("");
    nav("inbox");
  }
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
        <nav aria-label="Work queue views">
          <button
            className={view === "inbox" ? "active" : ""}
            aria-current={view === "inbox" ? "page" : undefined}
            onClick={() => nav("inbox")}
          >
            <Inbox size={19} />
            Work queue<span>{cases.length || "—"}</span>
          </button>
          <button
            className={
              view === "performance" || view === "activity" ? "active" : ""
            }
            aria-current={
              view === "performance" || view === "activity" ? "page" : undefined
            }
            onClick={() => nav("performance")}
          >
            <BarChart3 size={19} />
            Reports
          </button>
          <button
            className={`settings-nav ${view === "policies" ? "active" : ""}`}
            aria-current={view === "policies" ? "page" : undefined}
            onClick={() => nav("policies")}
          >
            <Settings2 size={19} />
            Settings
          </button>
        </nav>
        <div className="sidebar-info">
          <span className="eyebrow">
            {access?.mode === "team" ? "TEAM WORKSPACE" : "SAMPLE WORKSPACE"}
          </span>
          <div>
            <Layers3 size={16} />{" "}
            {workspaceConfig?.sample_data
              ? "Sample inbox enabled"
              : "Imported shipping records"}
          </div>
          <p>
            {cases.length} cases · {counts.processed} processed
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
            {workspaceConfig
              ? `${workspaceConfig.upload_limit.toLocaleString()} imported-case capacity`
              : "Loading workspace settings…"}
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
            <span className="avatar" aria-hidden="true">
              {initials}
            </span>
            <span>
              {employeeName}
              <small>
                {access?.user
                  ? `${access.user.role} · Shared team`
                  : "Isolated working session"}
              </small>
            </span>
          </div>
        </div>
      </Sidebar>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Operations <ChevronRight size={14} />
            <strong>
              {view === "inbox"
                ? "Work queue"
                : view === "policies"
                  ? "Settings"
                  : "Reports"}
            </strong>
          </div>
          <div className="topbar-right">
            <span
              className={`environment ${refreshFailed ? "sync-failed" : ""}`}
              title={
                lastSync
                  ? `Last complete inbox read: ${new Date(lastSync).toLocaleString()}. This is not a continuous health check.`
                  : "Loading cloud workspace"
              }
            >
              <span />
              {loading
                ? "Syncing workspace…"
                : refreshFailed
                  ? "Refresh unavailable"
                  : lastSync
                    ? `Synced ${new Date(lastSync).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : "Not yet synced"}
            </span>
            <button
              className="icon-button"
              onClick={refreshWorkspace}
              title="Refresh workspace"
              aria-label="Refresh workspace"
              disabled={loading}
            >
              <RefreshCw size={17} />
            </button>
            <span className="avatar small" title={employeeName}>
              {initials}
            </span>
          </div>
        </header>
        <WorkspaceNav active="/" />
        <main id="main-content" tabIndex={-1} data-workspace-view={view}>
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
              <h1>
                {view === "inbox"
                  ? "Work queue"
                  : view === "policies"
                    ? "Workspace settings"
                    : "Reports & evidence"}
              </h1>
              <p>
                {view === "inbox"
                  ? "Inspect the evidence. Resolve the next case."
                  : view === "policies"
                    ? "Versioned policies and cloud AI availability."
                    : "Workspace results, validation and recorded decisions."}
              </p>
            </div>
            {view === "inbox" && (
              <div className="heading-actions">
                <button
                  className="button secondary"
                  disabled={loading || !inboxReady}
                  onClick={() => {
                    setReplacement(null);
                    setIntakeFiles([]);
                    setUpload(true);
                  }}
                >
                  <Plus size={17} />
                  Import email
                </button>
                <button
                  className="button primary"
                  onClick={processAll}
                  disabled={
                    loading ||
                    !inboxReady ||
                    (!running && counts.processed === cases.length && !outdated)
                  }
                >
                  {running ? <Square size={14} /> : <Play size={16} />}{" "}
                  {running
                    ? "Pause processing"
                    : counts.processed === cases.length &&
                        !outdated &&
                        inboxReady
                      ? "Inbox up to date"
                      : "Run inbox"}
                </button>
              </div>
            )}
          </div>
          {!inboxReady && !loading && (
            <div className="alert warning" role="status">
              Load the workspace before creating or processing cases. Use
              Refresh to retry.
            </div>
          )}
          {view === "inbox" &&
            inboxReady &&
            cases.some((item) => item.result?.workflow === "verified") && (
              <BatchReview
                onCompleted={() => {
                  void load();
                  void loadFollowups();
                }}
              />
            )}
          {inboxReady && refreshFailed && (
            <div className="alert warning" role="status">
              Showing previously loaded results. Refresh is unavailable; saved
              changes are not discarded. Retry when the cloud service is ready.
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
          {(view === "performance" || view === "activity") && (
            <div className="report-switch" aria-label="Report sections">
              <button
                className={view === "performance" ? "active" : ""}
                aria-pressed={view === "performance"}
                onClick={() => nav("performance")}
              >
                <BarChart3 size={16} /> Performance
              </button>
              <button
                className={view === "activity" ? "active" : ""}
                aria-pressed={view === "activity"}
                onClick={() => {
                  nav("activity");
                  refreshWorkspace();
                }}
              >
                <History size={16} /> Audit trail
              </button>
            </div>
          )}
          {view === "performance" && (
            <div className="metric-grid">
              <button className="metric" onClick={() => openQueue("all")}>
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
                onClick={() => openQueue("discrepancy")}
              >
                <span>
                  Discrepancies
                  <TriangleAlert size={18} />
                </span>
                <strong>
                  {queueCounts.discrepancy.toLocaleString()}
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
              <button className="metric" onClick={() => openQueue("verified")}>
                <span>
                  Verified documents
                  <FileCheck2 size={18} />
                </span>
                <strong>
                  {queueCounts.verified.toLocaleString()}
                  <small>pairs</small>
                </strong>
                <div className="green-text">
                  <CheckCheck size={14} /> All seven fields matched
                </div>
              </button>
              <button className="metric" onClick={() => openQueue("review")}>
                <span>
                  Recover evidence
                  <Eye size={18} />
                </span>
                <strong>
                  {queueCounts.review.toLocaleString()}
                  <small>cases</small>
                </strong>
                <div>
                  {queueCounts.awaiting_documents} need documents separately
                </div>
              </button>
            </div>
          )}
          {view === "inbox" && (
            <>
              <section className="inbox-panel">
                <div className="table-toolbar">
                  <div className="filter-tabs" aria-label="Filter by outcome">
                    {QUEUE_FILTERS.map(([key, label]) => (
                      <button
                        key={key}
                        className={`queue-card queue-${key} ${filter === key ? "selected" : ""}`}
                        aria-pressed={filter === key}
                        onClick={() => setFilter(key)}
                      >
                        <span className="queue-card-label">
                          {key === "all" ? (
                            <Inbox size={15} />
                          ) : key === "action" ? (
                            <Layers3 size={15} />
                          ) : key === "discrepancy" ? (
                            <TriangleAlert size={15} />
                          ) : key === "review" ? (
                            <Eye size={15} />
                          ) : key === "awaiting_documents" ? (
                            <Paperclip size={15} />
                          ) : (
                            <ShieldCheck size={15} />
                          )}
                          {label}
                        </span>
                        <strong>
                          {loading && !inboxReady ? "—" : queueCounts[key]}
                        </strong>
                      </button>
                    ))}
                  </div>
                  <div className="table-tools">
                    <label className="search-input">
                      <Search size={16} />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search case, owner, reference…"
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
                    <select
                      className="other-queues"
                      aria-label="Additional queues"
                      value={
                        filter === "pending" || filter === "routed"
                          ? filter
                          : ""
                      }
                      onChange={(event) =>
                        setFilter(event.target.value || "all")
                      }
                    >
                      <option value="">Other queues</option>
                      <option value="pending">
                        Process / recheck ({queueCounts.pending})
                      </option>
                      <option value="routed">
                        Other desks ({queueCounts.routed})
                      </option>
                    </select>
                  </div>
                </div>
                <div
                  className="follow-up-filters"
                  aria-label="Filter by follow-up"
                >
                  <span>Follow-up</span>
                  {FOLLOW_UP_FILTERS.map(([key, label]) => (
                    <button
                      key={key}
                      className={filter === key ? "selected" : ""}
                      aria-pressed={filter === key}
                      disabled={!followupsReady}
                      onClick={() => setFilter(filter === key ? "all" : key)}
                    >
                      {label} <b>{followupsReady ? queueCounts[key] : "—"}</b>
                    </button>
                  ))}
                  {followupsLoading && (
                    <span role="status">Refreshing follow-ups…</span>
                  )}
                </div>
                {followupsError && (
                  <div className="follow-up-notice error" role="alert">
                    <span>
                      {followupsError}{" "}
                      {followupsReady
                        ? "Showing the last loaded follow-ups."
                        : "Follow-up queues are unavailable."}
                    </span>
                    <button
                      className="text-button"
                      disabled={followupsLoading}
                      onClick={() => void loadFollowups()}
                    >
                      Retry
                    </button>
                  </div>
                )}
                <div className="queue-caption">
                  <span>
                    {visible.length} matching cases · recorded deadlines, then
                    action
                  </span>
                  <span>
                    Counts above cover this workspace · checked ≠ cargo release
                  </span>
                </div>
                <div className="table-scroll">
                  <Table className="email-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>EMAIL / CASE</TableHead>
                        <TableHead>CATEGORY</TableHead>
                        <TableHead>STATUS</TableHead>
                        <TableHead>NEXT ACTION</TableHead>
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
                                {followups[c.email.email_id]
                                  ?.shipment_reference && (
                                  <span className="queue-follow-up-reference">
                                    Ref:{" "}
                                    {
                                      followups[c.email.email_id]
                                        .shipment_reference
                                    }
                                  </span>
                                )}
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
                            <span className="queue-next-action">
                              {LANE_DETAILS[laneFor(c)].action}
                            </span>
                            <small className="queue-document-count">
                              {c.email.attachments.length} documents
                              {c.result ? ` · v${c.result.version}` : ""}
                            </small>
                            {followups[c.email.email_id] &&
                              (() => {
                                const value = followups[c.email.email_id];
                                const state = effectiveFollowUp(value, c);
                                const overdue = isFollowUpOverdue(
                                  c,
                                  value,
                                  queueNow,
                                );
                                return (
                                  <div className="queue-follow-up">
                                    <span
                                      className={`follow-up-badge ${state}`}
                                    >
                                      {FOLLOW_UP_LABELS[state]}
                                    </span>
                                    <small>{value.owner}</small>
                                    {value.due_at && state !== "completed" && (
                                      <small
                                        className={`follow-up-due ${overdue ? "overdue" : ""}`}
                                      >
                                        {overdue ? "Overdue · " : "Due "}
                                        {new Date(value.due_at).toLocaleString(
                                          undefined,
                                          {
                                            month: "short",
                                            day: "numeric",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                            timeZoneName: "short",
                                          },
                                        )}
                                      </small>
                                    )}
                                  </div>
                                );
                              })()}
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
                        {cases.length
                          ? "No matching cases"
                          : "Your work queue is ready"}
                      </h3>
                      <p>
                        {!cases.length
                          ? "Import an email and its shipping documents to create your first case. Results and source history are saved in this workspace."
                          : counts.processed < cases.length
                            ? "Run the inbox to create results, or clear filters to see unprocessed cases."
                            : "Try another search or clear the filters."}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => {
                          if (!cases.length) {
                            setReplacement(null);
                            setIntakeFiles([]);
                            setUpload(true);
                            return;
                          }
                          setSearch("");
                          setFilter("all");
                          setCategory("all");
                        }}
                      >
                        {cases.length ? "Clear filters" : "Import first email"}
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
              <details className="queue-help">
                <summary>Help & exports</summary>
                <div>
                  <p>
                    Run the inbox to classify five email categories and compare
                    all seven SI / draft BL fields. Open a case to check
                    sources, recover unreadable evidence or prepare an
                    amendment. Use History → What changed? after replacing
                    corrected documents. Nothing is sent or released
                    automatically.
                  </p>
                  <div className="case-actions">
                    <a
                      className="text-button"
                      href="/api/follow-ups?export=1"
                      download
                    >
                      Export follow-up handover
                    </a>
                    <button
                      className="text-button"
                      disabled={loading || !inboxReady}
                      onClick={() =>
                        download(
                          "cargoguard-shift-brief.txt",
                          shiftBrief(cases, new Date().toISOString()),
                          "text/plain;charset=utf-8",
                        )
                      }
                    >
                      Export shift brief
                    </button>
                    <button
                      className="text-button"
                      onClick={() => void exportAll("reviewed")}
                    >
                      Export reviewed evidence
                    </button>
                    {workspaceConfig?.sample_data && (
                      <button
                        className="text-button"
                        onClick={() => void exportAll()}
                      >
                        Export automatic baseline
                      </button>
                    )}
                  </div>
                </div>
              </details>
            </>
          )}
          {view === "policies" && (
            <>
              <PolicyDesk />
              <details className="settings-ai">
                <summary>Cloud AI availability & allowance</summary>
                {inboxReady && !loading && <AiAvailability />}
              </details>
            </>
          )}
          {view === "performance" && (
            <div className="performance-grid">
              <WorkloadInsights cases={cases} />
              <section className="content-card">
                <div className="card-title">
                  <BarChart3 size={19} />
                  <h2>Saved workflow outcomes</h2>
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
                  This is a clean-pair rate, not an accuracy score. Task queues
                  group missing-attachment reviews under Missing documents.
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
                    <AuthoredOperationsChallenge
                      report={validation.authored_operations_challenge}
                    />
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
              <label className="audit-search search-input">
                <Search size={16} />
                <input
                  aria-label="Search audit trail"
                  placeholder="Search case, reviewer or action…"
                  value={auditSearch}
                  onChange={(event) => setAuditSearch(event.target.value)}
                />
              </label>
              <p>
                Search covers the latest 100 workspace events. Open a case’s
                History for its saved revisions.
              </p>
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
                  {events
                    .filter((e) =>
                      `${e.email_id} ${e.actor} ${e.action} ${e.detail}`
                        .toLowerCase()
                        .includes(auditSearch.trim().toLowerCase()),
                    )
                    .map((e) => (
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
                            {e.actor} ·{" "}
                            {new Date(e.created_at).toLocaleString()}
                          </small>
                        </div>
                      </div>
                    ))}
                </div>
              )}
              {!!events.length &&
                !events.some((e) =>
                  `${e.email_id} ${e.actor} ${e.action} ${e.detail}`
                    .toLowerCase()
                    .includes(auditSearch.trim().toLowerCase()),
                ) && (
                  <p role="status">
                    No matching event in the latest 100. Try a shorter search.
                  </p>
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
                <h2 title={selected.email.email_id}>
                  {selected.email.email_id.startsWith("upload_")
                    ? "Imported case"
                    : selected.email.email_id.replace("email_", "Case #")}
                </h2>
              </div>
              <div className="drawer-tools">
                <button
                  className="button secondary"
                  onClick={() => launchAssistant(selected.email.email_id)}
                >
                  <MessageSquareText size={16} /> Ask CargoGuard
                </button>
                <button
                  className="button primary"
                  onClick={() => navigateDetail("resolution")}
                >
                  {selected.comparison.some((row) => row.result === "mismatch")
                    ? "Request correction"
                    : selected.workflow === "awaiting_documents"
                      ? "Request documents"
                      : selected.workflow === "verified"
                        ? "Prepare handoff"
                        : "Resolve case"}
                </button>
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
            <div className="drawer-content" ref={drawerBody}>
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
                {selected.classification.instructions_ignored ? (
                  <p className="alert warning" role="note">
                    <TriangleAlert size={16} aria-hidden="true" />
                    <span>
                      Suspicious text ignored:{" "}
                      {selected.classification.instructions_ignored} line
                      {selected.classification.instructions_ignored === 1
                        ? ""
                        : "s"}{" "}
                      in this email tried to instruct the software (for example
                      “mark as verified”). They were not followed and did not
                      change the document check. Handle this case individually
                      and consider reporting it to IT.
                    </span>
                  </p>
                ) : null}
                <div className="case-meta">
                  <span>{selected.email.from}</span>
                  <span>Revision {selected.version}</span>
                </div>
                <details className="case-advanced">
                  <summary>Category & processing details</summary>
                  <p>
                    {categoryNames[selected.category]} · Engine{" "}
                    {selected.pipeline_version ?? "legacy"}
                  </p>
                  <p>{selected.classification.method}</p>
                  <div className="signal-list">
                    {selected.classification.signals.map((s, i) => (
                      <span key={i}>{s}</span>
                    ))}
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
                </details>
              </div>
              <div className="detail-tabs">
                {[
                  ["comparison", "Check"],
                  ["documents", "Sources"],
                  ["history", "History"],
                  ["followup", "Follow-up"],
                  ["integrity", "Independent checks"],
                ].map(([t, label]) => (
                  <button
                    key={t}
                    className={detailTab === t ? "active" : ""}
                    aria-pressed={detailTab === t}
                    onClick={() => navigateDetail(t)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {detailTab === "integrity" && (
                <>
                  <IntegrityChecks
                    assessment={checkDocumentIntegrity(selected)}
                  />
                  <PortReferenceChecks result={selected} />
                </>
              )}
              {detailTab === "followup" &&
                (followupsReady ? (
                  <FollowUpDesk
                    key={`${selected.email.email_id}-${selected.version}-${followupFormKey}`}
                    result={selected}
                    followup={followups[selected.email.email_id]}
                    ready={followupsReady}
                    refreshing={
                      followupsLoading || busyId === selected.email.email_id
                    }
                    error={followupsError}
                    onRefresh={() => void loadFollowups()}
                    onReloadCase={() =>
                      void reloadFollowupCase(selected.email.email_id)
                    }
                    onReloadValues={() =>
                      setFollowupFormKey((value) => value + 1)
                    }
                    onSaved={(value) => void followupSaved(value)}
                  />
                ) : (
                  <div className="follow-up-notice" role="status">
                    <span>{followupsError || "Loading saved follow-up…"}</span>
                    <button
                      className="text-button"
                      onClick={() => void loadFollowups()}
                      disabled={followupsLoading}
                    >
                      Refresh
                    </button>
                  </div>
                ))}
              {detailTab === "comparison" && resolutionOpen && (
                <div className="case-resolution">
                  <div className="case-resolution-heading">
                    <h3>Next action</h3>
                    <button
                      className="text-button"
                      onClick={() => setResolutionOpen(false)}
                    >
                      Back to field checks
                    </button>
                  </div>
                  <ResolutionDesk
                    result={selected}
                    onNavigate={navigateDetail}
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
                </div>
              )}
              {detailTab === "comparison" && !resolutionOpen && (
                <>
                  {selected.document_selection && (
                    <div className="selected-pair-notice">
                      <ShieldCheck size={17} />
                      <p>
                        <strong>Selected pair only.</strong>{" "}
                        {selected.documents.length - 2} other attachments are
                        retained, not verified.
                      </p>
                      <button
                        className="text-button"
                        onClick={() => setDetailTab("documents")}
                      >
                        View selection <ArrowRight size={14} />
                      </button>
                    </div>
                  )}
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
                      <MismatchTriage explanations={explanations} />
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
                                  {row[side].issue && (
                                    <small className="field-issue">
                                      {row[side].issue}
                                    </small>
                                  )}
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
                                  <details className="value-details">
                                    <summary>Details / correct value</summary>
                                    <small className="normalized-value">
                                      Compared as:{" "}
                                      {row[side].normalized ??
                                        "Needs confirmation"}
                                    </small>
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
                                  </details>
                                </div>
                              ))}
                              {explanations[row.field] && (
                                <MismatchNote
                                  explanation={explanations[row.field]!}
                                />
                              )}
                            </div>
                          ))}
                      </div>
                      <details className="comparison-explainer">
                        <summary>How these fields are compared</summary>
                        <p>
                          Whitespace and punctuation are normalized. Container
                          counts and weight are compared as numbers. Compound
                          counts are summed only when the whole expression is
                          valid. Missing, conflicting and ambiguous values are
                          never assumed to match.
                        </p>
                      </details>
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
                </>
              )}
              {detailTab === "documents" && (
                <div className="document-view">
                  <DocumentPairSelector
                    key={`pair-${selected.email.email_id}-${selected.version}`}
                    result={selected}
                    onSaved={(data) => {
                      setSelected(data.result);
                      setDocument(null);
                      update([data.result]);
                      setCaseEvents(data.audit);
                      setNotice(
                        "Comparison pair saved. Other attachments remain available but are not verified.",
                      );
                      navigateDetail("comparison");
                    }}
                  />
                  <details
                    className="source-email"
                    open={emailOpen}
                    onToggle={(event) => setEmailOpen(event.currentTarget.open)}
                  >
                    <summary>Original email · {selected.email.subject}</summary>
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
                  </details>
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
                              <details
                                className="source-recovery"
                                key={`source-recovery-${selected.email.email_id}-${d.name}-${selected.version}`}
                              >
                                <summary>
                                  Need help extracting these fields? Open AI
                                  recovery
                                </summary>
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
                              </details>
                            )}
                          {d.error ? (
                            <div className="alert warning">
                              <TriangleAlert size={18} />
                              <p>{d.error}</p>
                              <button
                                className="button secondary"
                                disabled={!!busyId || running}
                                onClick={reprocess}
                              >
                                Retry reading source
                              </button>
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
              {detailTab === "history" && (
                <div className="case-history">
                  <DecisionHistory
                    key={`${selected.email.email_id}-${selected.version}`}
                    result={selected}
                  />
                  <details className="case-event-log">
                    <summary>Case activity log</summary>
                    <div className="timeline">
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
                          Processing was recorded. Reopen this case to refresh
                          its full audit trail.
                        </p>
                      )}
                    </div>
                  </details>
                </div>
              )}
            </div>
            <div className="drawer-footer">
              <button
                className="button secondary"
                disabled={running}
                onClick={() => {
                  setReplacement(selected);
                  setReplacementMode("all");
                  setIntakeFiles([]);
                  setUpload(true);
                }}
              >
                Replace documents
              </button>
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
              <button
                className="button primary next-case"
                disabled={!nextId || !!busyId || saving || running || uploading}
                title={
                  nextId
                    ? "Continue in the queue order captured when this case was opened. No approval is recorded."
                    : "End of this queue"
                }
                onClick={() => {
                  if (nextId) void openCase(nextId, "comparison", true);
                }}
              >
                {nextId ? "Next case" : "End of queue"}
                <ArrowRight size={16} />
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
          className="modal intake-modal"
        >
          <div className="modal-heading">
            <div>
              <span className="eyebrow">NEW VERIFICATION</span>
              <DialogTitle>
                {replacement
                  ? replacementMode === "bl"
                    ? "Receive a revised draft BL."
                    : "Replace source documents."
                  : "Bring an email into the queue."}
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
            {replacement
              ? replacementMode === "bl"
                ? "Keep the selected SI as the reference and recheck every field against the new draft BL."
                : "Supply a complete replacement set. Previous source documents and decisions remain available in History."
              : "Paste the message and attach its files. CargoGuard routes the email, checks the documents and keeps every attachment as evidence."}
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
                <div
                  className="replacement-method"
                  role="group"
                  aria-label="Replacement scope"
                >
                  <button
                    type="button"
                    className={replacementMode === "bl" ? "selected" : ""}
                    aria-pressed={replacementMode === "bl"}
                    onClick={() => {
                      setReplacementMode("bl");
                      setIntakeFiles([]);
                    }}
                  >
                    Revised BL only<small>Keep the current SI</small>
                  </button>
                  <button
                    type="button"
                    className={replacementMode === "all" ? "selected" : ""}
                    aria-pressed={replacementMode === "all"}
                    onClick={() => {
                      setReplacementMode("all");
                      setIntakeFiles([]);
                    }}
                  >
                    Full source set<small>Replace SI and BL</small>
                  </button>
                </div>
                <div className="info-box">
                  {replacementMode === "bl"
                    ? `The server retains the selected SI and its original fingerprint for ${replacement.email.email_id}. If the pair is ambiguous, select it in Sources first. Earlier BL versions remain in History.`
                    : `Replacing documents for ${replacement.email.email_id}. Earlier decisions remain in the audit trail.`}
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
            {!replacement && (
              <label>
                Sender email
                <input
                  type="email"
                  name="from"
                  maxLength={254}
                  placeholder="shipping@example.test"
                  defaultValue="demo@example.test"
                  required
                />
              </label>
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
              <strong>
                {replacement && replacementMode === "bl"
                  ? "Choose the revised draft BL"
                  : "Choose email attachments"}
              </strong>
              <span>
                {replacement && replacementMode === "bl"
                  ? "One TXT, PDF, DOCX or XLSX file · 5 MB maximum"
                  : "TXT, PDF, DOCX or XLSX · Up to 10 files · 5 MB each · 20 MB total"}
              </span>
              <input
                type="file"
                key={`${replacement?.email.email_id ?? "new"}-${replacementMode}`}
                name={replacement && replacementMode === "bl" ? "bl" : "files"}
                required={!!replacement}
                multiple={!(replacement && replacementMode === "bl")}
                accept=".txt,.pdf,.docx,.xlsx"
                onChange={(event) =>
                  setIntakeFiles(Array.from(event.target.files ?? []))
                }
              />
            </label>
            {intakeFiles.length > 0 && (
              <div className="intake-file-list">
                <b>
                  {intakeFiles.length} attachment
                  {intakeFiles.length === 1 ? "" : "s"} selected
                </b>
                <ul>
                  {intakeFiles.map((file, index) => (
                    <li key={`${file.name}-${index}`}>
                      <FileText size={14} />
                      <span>{file.name}</span>
                      <small>{Math.ceil(file.size / 1024)} KB</small>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {intakeFiles.length > 2 && (
              <p className="info-box">
                After import, choose the exact SI and draft BL in Sources. Extra
                attachments are retained, never silently included or discarded.
              </p>
            )}
            {(intakeFiles.length > 10 ||
              intakeFiles.some((file) => file.size > 5 * 1024 * 1024) ||
              intakeFiles.reduce((sum, file) => sum + file.size, 0) >
                20 * 1024 * 1024) && (
              <p className="alert error" role="alert">
                Choose at most 10 files, no larger than 5 MB each or 20 MB
                combined.
              </p>
            )}
            <div className="info-box">
              <ShieldCheck size={16} />
              <p>
                Files stay in this workspace. Missing or unreadable data is
                escalated for review.
              </p>
            </div>
            <button
              className="button primary full"
              disabled={
                uploading ||
                intakeFiles.length > 10 ||
                intakeFiles.some((file) => file.size > 5 * 1024 * 1024) ||
                intakeFiles.reduce((sum, file) => sum + file.size, 0) >
                  20 * 1024 * 1024
              }
            >
              {uploading ? (
                <Loader2 size={17} className="spin" />
              ) : (
                <Sparkles size={17} />
              )}{" "}
              {uploading
                ? "Reading documents…"
                : replacement
                  ? replacementMode === "bl"
                    ? "Save revised BL & recheck"
                    : "Replace documents & recheck"
                  : "Import & check email"}
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
            className="modal correction-modal"
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
                  disabled={saving}
                />
              </label>
              <CorrectionPreview
                previous={selected}
                edit={edit}
                preview={previewCorrection(selected, edit)}
              />
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
              <button
                disabled={saving || !!previewCorrection(selected, edit).error}
                className="button primary full"
              >
                {saving ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <CheckCheck size={17} />
                )}
                Save correction & recompute
              </button>
              {nextId && (
                <button
                  type="submit"
                  name="afterSave"
                  value="next"
                  disabled={saving || !!previewCorrection(selected, edit).error}
                  className="button secondary full"
                >
                  Save correction & next case <ArrowRight size={16} />
                </button>
              )}
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
