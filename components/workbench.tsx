"use client";
import { PolicyDesk } from "./policy-desk";
import { DecisionHistory } from "./decision-history";
import type { PolicySnapshot } from "@/lib/policy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { requestJson, requestInbox, latencySummary } from "@/lib/client-api";
import { previewCorrection } from "@/lib/corrections";
import { CorrectionPreview } from "./correction-preview";
import { WorkspaceStart } from "./workspace-start";
import { CorrespondencePanel } from "./correspondence-panel";
import {
  WorkspaceSchedule,
  CaseScheduleEditor,
  calendarDateFor,
  type CalendarKind,
} from "./case-schedule";
import { matchesSchedule, type ScheduleFilter } from "@/lib/case-scheduling";
import { DocumentPairSelector } from "./document-pair-selector";
import { createRequestGate } from "@/lib/request-gate";
import { mergeCaseSummaries } from "@/lib/case-state";
import {
  addIntakeFiles,
  intakeFilesError,
  intakeSubmissionError,
  setIntakeFormFiles,
  type AttachmentUpdateMode,
} from "@/lib/intake-files";
import { ScanAssist } from "@/components/scan-assist";
import { ResolutionDesk } from "@/components/resolution-desk";
import { GlobalAssistant } from "@/components/global-assistant";
import type { AssistantMemory } from "@/components/case-assistant";
import { EvidenceRecovery } from "@/components/evidence-recovery";
import { WorkloadInsights } from "@/components/workload-insights";
import { AiAvailability } from "@/components/ai-availability";
import {
  QUEUE_FILTERS,
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
  Mail,
  PencilLine,
  ArrowLeft,
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
interface ApiPayload {
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
  const [resolutionOpen, setResolutionOpen] = useState(false);
  const [mailboxOpen, setMailboxOpen] = useState(false);
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
  const [replacementDocument, setReplacementDocument] =
    useState<ParsedDocument | null>(null);
  const [attachmentMode, setAttachmentMode] =
    useState<AttachmentUpdateMode>("replace_all");
  const retainedAttachments =
    replacement && attachmentMode !== "replace_all"
      ? replacement.documents.filter(
          (source) =>
            attachmentMode === "append" ||
            source.name !== replacementDocument?.name,
        )
      : [];
  const [addingFiles, setAddingFiles] = useState(false);
  const intakeSelection = useRef(false);
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
  const [scheduleFilter, setScheduleFilter] = useState<ScheduleFilter>("all");
  const [calendarDay, setCalendarDay] = useState("");
  const [calendarKind, setCalendarKind] = useState<CalendarKind>("received");
  const [priorityFilter, setPriorityFilter] = useState("all");
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
  const editTrigger = useRef<HTMLButtonElement | null>(null);
  const editInput = useRef<HTMLTextAreaElement | null>(null);
  const comparisonHeading = useRef<HTMLHeadingElement | null>(null);
  const inboxRequests = useRef(createRequestGate());
  const inboxController = useRef<AbortController | null>(null);
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
    inboxController.current?.abort();
    const controller = new AbortController();
    inboxController.current = controller;
    try {
      const started = performance.now();
      const d = await requestInbox<ApiPayload>(controller.signal);
      if (inboxRequests.current.isCurrent(request)) {
        setCases(d.cases);
        setEvents(d.audit);
        setInboxReady(true);
        setLastSync(d.loaded_at ?? new Date().toISOString());
        setRefreshFailed(false);
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
  }, []);
  function refreshWorkspace() {
    setLoading(true);
    setError("");
    void load();
  }
  useEffect(() => {
    let active = true;
    const gate = inboxRequests.current;
    const request = gate.next();
    const controller = new AbortController();
    inboxController.current?.abort();
    inboxController.current = controller;
    const started = performance.now();
    requestInbox<ApiPayload>(controller.signal)
      .then((d) => {
        if (active && gate.isCurrent(request)) {
          setCases(d.cases);
          setEvents(d.audit);
          setInboxReady(true);
          setLastSync(d.loaded_at ?? new Date().toISOString());
          setRefreshFailed(false);
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
  const pageKey = JSON.stringify([
      search,
      filter,
      category,
      view,
      scheduleFilter,
      calendarDay,
      calendarKind,
      priorityFilter,
    ]),
    shownLimit = pagination === pageKey ? limit : 30;
  const timing = latencySummary(latencies),
    outdated = cases.filter(
      (c) => c.result && c.result.pipeline_version !== PIPELINE_VERSION,
    ).length;
  const visible = useMemo(
    () =>
      workQueue(cases, filter, category, search).filter(
        (row) =>
          matchesSchedule(row, scheduleFilter) &&
          (!calendarDay ||
            calendarDateFor(row, calendarKind) === calendarDay) &&
          (priorityFilter === "all" ||
            (row.scheduling?.priority ?? "normal") === priorityFilter),
      ),
    [
      cases,
      search,
      filter,
      category,
      scheduleFilter,
      calendarDay,
      calendarKind,
      priorityFilter,
    ],
  );
  const queueCounts = useMemo(
    () =>
      Object.fromEntries(
        [...QUEUE_FILTERS.map(([key]) => key), "pending", "routed"].map(
          (key) => [key, cases.filter((row) => matchesQueue(row, key)).length],
        ),
      ),
    [cases],
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
    if (target === "correspondence") {
      setDetailTab(target);
      return;
    }
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
  function launchAssistant(id: string | null = null) {
    closeCase();
    setAssistant((previous) => ({
      id,
      sequence: (previous?.sequence ?? 0) + 1,
    }));
  }
  function startImport() {
    setReplacement(null);
    setReplacementDocument(null);
    setAttachmentMode("replace_all");
    setIntakeFiles([]);
    setUpload(true);
  }
  async function openCase(
    id: string,
    tab = "comparison",
    continueQueue = false,
  ) {
    if (!continueQueue)
      setQueueSession(visible.map((row) => row.email.email_id));
    if (!continueQueue) closeCase();
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
          body: JSON.stringify({
            action: "process",
            ids: [id],
            skipSaved: true,
          }),
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
        navigateDetail(tab);
        setAttentionOnly(false);
      }
    } catch (e) {
      if (activeRequest.current.isCurrent(request))
        setError(
          continueQueue
            ? `Your current case is still open. Could not load the next case: ${(e as Error).message}`
            : (e as Error).message,
        );
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
    // Measure elapsed time inside the check-all click handler.
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
    if (!selected || saving || uploading || busyId) return;
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
  async function chooseIntakeFiles(files: File[]) {
    if (uploading || intakeSelection.current) return;
    intakeSelection.current = true;
    setAddingFiles(true);
    setError("");
    try {
      const added = await addIntakeFiles(
        replacementDocument ? [] : intakeFiles,
        files,
        replacementDocument ? 1 : 10,
      );
      const fileError =
        added.error ??
        intakeFilesError(
          added.files,
          replacementDocument ? 1 : 10,
          retainedAttachments,
        );
      if (fileError) setError(fileError);
      else {
        setIntakeFiles(added.files);
        if (added.duplicates)
          setNotice(
            `${added.duplicates} duplicate attachment${added.duplicates === 1 ? "" : "s"} already selected.`,
          );
      }
    } catch {
      setError(
        "This file could not be read. Your earlier selections are retained; choose it again.",
      );
    } finally {
      intakeSelection.current = false;
      setAddingFiles(false);
    }
  }
  function startReplacement(
    result: CaseResult,
    source: ParsedDocument | null = null,
    mode: AttachmentUpdateMode = source ? "replace_one" : "replace_all",
  ) {
    setReplacement(result);
    setReplacementDocument(source);
    setAttachmentMode(mode);
    setIntakeFiles([]);
    setError("");
    setUpload(true);
  }
  async function uploadCase(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading || addingFiles) return;
    const fileError = intakeSubmissionError(
      intakeFiles,
      replacement ? attachmentMode : "new",
      retainedAttachments,
    );
    if (fileError) {
      setError(fileError);
      return;
    }
    const request = activeRequest.current.next();
    setUploading(true);
    setError("");
    try {
      const d = await api("/api/upload", {
        method: "POST",
        body: (() => {
          const fd = setIntakeFormFiles(
            new FormData(event.currentTarget),
            intakeFiles,
          );
          if (replacement) {
            fd.set("id", replacement.email.email_id);
            fd.set("version", String(replacement.version));
            fd.set("mode", attachmentMode);
            if (replacementDocument) {
              fd.set("mode", "replace_one");
              fd.set("targetName", replacementDocument.name);
              fd.set("targetSha256", replacementDocument.sha256 ?? "");
            }
          }
          return fd;
        })(),
      });
      update([d.result]);
      if (!activeRequest.current.isCurrent(request)) return;
      setSelected(d.result);
      navigateDetail(
        d.result.documents.length > 2 ? "documents" : "comparison",
      );
      setCaseEvents([]);
      setUpload(false);
      setReplacement(null);
      setReplacementDocument(null);
      setAttachmentMode("replace_all");
      setIntakeFiles([]);
      setDocument(null);
      setNotice(
        "Email and attachments saved. Inspect the results before taking action.",
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
    if (!selected || !edit || busyId || saving) return;
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
    if (!selected || busyId || saving) return;
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
        <nav aria-label="Workspace navigation">
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
          <span className="eyebrow">DEMO WORKSPACE</span>
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
              <h1>
                {view === "inbox"
                  ? "Work queue"
                  : view === "policies"
                    ? "Workspace settings"
                    : "Reports & evidence"}
              </h1>
              <p>
                {view === "inbox"
                  ? "Open a case to see what needs checking, or upload your documents."
                  : view === "policies"
                    ? "Versioned policies and cloud AI availability."
                    : "Workspace results, validation and recorded decisions."}
              </p>
            </div>
            {view === "inbox" && (
              <div className="heading-actions">
                <button
                  className="button secondary"
                  onClick={() => setMailboxOpen(true)}
                >
                  <Mail size={17} /> Gmail
                </button>
                <button
                  className="button secondary"
                  disabled={loading || !inboxReady}
                  onClick={startImport}
                >
                  <Plus size={17} />
                  Upload documents
                </button>
                <button
                  className="button secondary"
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
                      : "Check all emails"}
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
                {outdated} saved cases need the latest checks. Choose Check all
                emails to update them. Confirmed corrections stay with unchanged
                source documents.
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
              <WorkspaceStart
                ready={inboxReady && !loading}
                busy={running || !!busyId}
                hasProcessed={counts.processed > 0}
                sampleCount={
                  cases.filter((row) => row.email.email_id.startsWith("email_"))
                    .length
                }
                onExample={() => void openCase("email_313")}
                onImport={startImport}
              />
              <details className="queue-planning">
                <summary>
                  Calendar &amp; priority filters
                  {(scheduleFilter !== "all" ||
                    calendarDay ||
                    priorityFilter !== "all") && <span> · Filters active</span>}
                </summary>
                <WorkspaceSchedule
                  cases={cases}
                  filter={scheduleFilter}
                  onFilter={setScheduleFilter}
                  selectedDay={calendarDay}
                  onDay={setCalendarDay}
                  kind={calendarKind}
                  onKind={setCalendarKind}
                  priority={priorityFilter}
                  onPriority={setPriorityFilter}
                />
              </details>
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
                <div className="queue-caption">
                  <span>
                    {visible.length} matching cases · action cases first
                  </span>
                  <span>
                    Counts above cover this workspace · checked ≠ cargo release
                  </span>
                </div>
                <div className="table-scroll">
                  <Table className="email-table">
                    <TableHeader>
                      <TableRow>
                        <TableHead>EMAIL / SHIPMENT</TableHead>
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
                                {c.scheduling?.priority &&
                                  c.scheduling.priority !== "normal" && (
                                    <span
                                      className={`priority-badge priority-${c.scheduling.priority}`}
                                    >
                                      {c.scheduling.priority}
                                    </span>
                                  )}
                                {c.scheduling?.due_at && (
                                  <small>
                                    Due{" "}
                                    {new Date(
                                      c.scheduling.due_at,
                                    ).toLocaleString("en-GB", {
                                      timeZone: "Asia/Kuala_Lumpur",
                                      day: "2-digit",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}{" "}
                                    MYT
                                  </small>
                                )}
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
                          </TableCell>
                          <TableCell>
                            <button
                              className="queue-open-button"
                              aria-label={`Open case: ${c.email.subject}`}
                              disabled={busyId === c.email.email_id}
                              onClick={(event) => {
                                event.stopPropagation();
                                void openCase(c.email.email_id);
                              }}
                            >
                              {busyId === c.email.email_id ? (
                                <Loader2 size={18} className="spin" />
                              ) : (
                                <>
                                  Open <ChevronRight size={18} />
                                </>
                              )}
                            </button>
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
                      <h3>No matching cases</h3>
                      <p>
                        {counts.processed < cases.length
                          ? "Open a case to check it, or clear filters to see all emails."
                          : "Try another search or clear the filters."}
                      </p>
                      <button
                        className="button secondary"
                        onClick={() => {
                          setSearch("");
                          setFilter("all");
                          setCategory("all");
                          setScheduleFilter("all");
                          setCalendarDay("");
                          setPriorityFilter("all");
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
                    <button
                      className="text-button"
                      onClick={() => void exportAll()}
                    >
                      Export automatic baseline
                    </button>
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
                <h2>
                  {selected.email.email_id.startsWith("email_")
                    ? selected.email.email_id.replace("email_", "Shipment #")
                    : "Document check"}
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
                  className="button secondary"
                  onClick={() => window.print()}
                  title="Print report"
                  aria-label="Print report"
                >
                  <Printer size={18} /> Print
                </button>
                <button
                  className="button secondary back-to-queue"
                  aria-label="Close details"
                  onClick={closeCase}
                >
                  <ArrowLeft size={18} /> Back to queue
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
                <CaseScheduleEditor
                  key={`schedule-${selected.email.email_id}-${cases.find((row) => row.email.email_id === selected.email.email_id)?.scheduling?.version ?? 0}`}
                  id={selected.email.email_id}
                  scheduling={
                    cases.find(
                      (row) => row.email.email_id === selected.email.email_id,
                    )?.scheduling
                  }
                  onSaved={(scheduling) => {
                    inboxRequests.current.cancel();
                    inboxController.current?.abort();
                    setLoading(false);
                    setCases((rows) =>
                      rows.map((row) =>
                        row.email.email_id === selected.email.email_id
                          ? { ...row, scheduling }
                          : row,
                      ),
                    );
                    setNotice(
                      "Priority and dates saved. The verification outcome is unchanged.",
                    );
                  }}
                />
                <div className="case-meta">
                  <span>{selected.email.from}</span>
                  <span>Revision {selected.version}</span>
                </div>
                <details className="case-advanced">
                  <summary>Category & processing details</summary>
                  <p className="full-case-id">
                    Case ID: {selected.email.email_id}
                  </p>
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
                      disabled={running || saving || !!busyId}
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
                  ["correspondence", "Reply & email history"],
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
                      <div className="comparison-intro">
                        <h3 ref={comparisonHeading} tabIndex={-1}>
                          Check the shipment details
                        </h3>
                        <p>
                          Read each value, then use <strong>View source</strong>{" "}
                          to check the original. If CargoGuard read it
                          incorrectly, choose <strong>Correct value</strong>.
                        </p>
                        <p className="comparison-note">
                          Corrections update this check. They do not change the
                          original files.
                        </p>
                      </div>
                      <div className="comparison-focus">
                        <label>
                          <input
                            type="checkbox"
                            checked={attentionOnly}
                            onChange={(e) => setAttentionOnly(e.target.checked)}
                          />{" "}
                          Show only differences and missing information
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
                              role="group"
                              aria-label={FIELD_LABELS[row.field]}
                            >
                              <div className="row-label">
                                {row.result === "match" ? (
                                  <CheckCircle2 size={20} />
                                ) : (
                                  <TriangleAlert size={20} />
                                )}
                                <strong>{FIELD_LABELS[row.field]}</strong>
                                <span>
                                  {row.result === "match"
                                    ? "Match"
                                    : row.result === "uncertain"
                                      ? "Needs confirmation"
                                      : "Different values"}
                                </span>
                              </div>
                              {(["si", "bl"] as const).map((side) => (
                                <div className="comparison-value" key={side}>
                                  <div className="value-document-label">
                                    {side === "si"
                                      ? "Shipping instruction"
                                      : "Draft bill of lading"}
                                    <span>
                                      {side === "si"
                                        ? "Reference · SI"
                                        : "To check · BL"}
                                    </span>
                                  </div>
                                  <p>{row[side].raw || "Missing value"}</p>
                                  {row[side].issue && (
                                    <small className="field-issue">
                                      {row[side].issue}
                                    </small>
                                  )}
                                  <div className="value-actions">
                                    <button
                                      className="value-action source-link"
                                      aria-label={`View source for ${FIELD_LABELS[row.field]} in ${side === "si" ? "shipping instruction" : "draft bill of lading"}`}
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
                                      <FileText size={17} /> View source
                                    </button>
                                    <button
                                      className="value-action correct-value-button"
                                      aria-label={`Correct value for ${FIELD_LABELS[row.field]} in ${side === "si" ? "shipping instruction" : "draft bill of lading"}`}
                                      disabled={!!busyId || saving || running}
                                      onClick={(event) => {
                                        editTrigger.current =
                                          event.currentTarget;
                                        setEdit({
                                          field: row.field,
                                          side,
                                          value: row[side].raw,
                                        });
                                      }}
                                    >
                                      <PencilLine size={17} /> Correct value
                                    </button>
                                  </div>
                                  <span className="value-source-location">
                                    {row[side].evidence}
                                  </span>
                                  <details className="value-details">
                                    <summary>
                                      How this value was compared
                                    </summary>
                                    <p className="normalized-value">
                                      Compared as:{" "}
                                      {row[side].normalized ??
                                        "Needs confirmation"}
                                    </p>
                                  </details>
                                </div>
                              ))}
                            </div>
                          ))}
                      </div>
                      <details className="policy-case-note comparison-rules">
                        <summary>
                          Comparison rules &amp; business tolerances
                        </summary>
                        <p>
                          Exact seven-field verdict: {selected.status}. Policy v
                          {selected.policy?.version ?? 0}:{" "}
                          {selected.policy_assessment?.note ??
                            "Exact comparison; no business exception recorded."}
                        </p>
                      </details>
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
                  <button
                    className="button secondary source-back"
                    autoFocus
                    onClick={() => navigateDetail("comparison")}
                  >
                    <ArrowLeft size={18} /> Back to field checks
                  </button>
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
                            {d.deferred ? "Not inspected" : d.type} · {d.method}
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
                            <button
                              className="button secondary"
                              disabled={
                                running || uploading || !!busyId || !d.sha256
                              }
                              onClick={() => startReplacement(selected, d)}
                            >
                              Replace this document
                            </button>
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
                          {d.deferred ? (
                            <div className="info-box deferred-document">
                              <div>
                                <strong>Not inspected</strong>
                                <p>
                                  This email was routed before its attachments
                                  were parsed. Confirm a document-verification
                                  category to inspect these files.
                                </p>
                                <button
                                  className="button secondary"
                                  disabled={saving || !!busyId || running}
                                  onClick={() => {
                                    setError("");
                                    setRouteEdit(true);
                                  }}
                                >
                                  Confirm category
                                </button>
                              </div>
                            </div>
                          ) : d.error ? (
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
              {detailTab === "correspondence" && (
                <CorrespondencePanel
                  key={`mail-${selected.email.email_id}-${selected.version}`}
                  cases={cases}
                  initialResult={selected}
                  onUpdated={update}
                  onInspectCase={(id, tab) => void openCase(id, tab)}
                  onImported={(result) => void openCase(result.email.email_id)}
                  onUseAttachment={(result, source, file, mode) => {
                    startReplacement(result, source, mode);
                    setIntakeFiles([file]);
                  }}
                />
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
              {detailTab === "documents" && (
                <>
                  <button
                    className="button secondary"
                    disabled={
                      running ||
                      saving ||
                      uploading ||
                      !!busyId ||
                      selected.documents.length >= 10
                    }
                    title="Keep existing sources and add a missing or additional document."
                    onClick={() => startReplacement(selected, null, "append")}
                  >
                    <Plus size={15} /> Add documents
                  </button>
                  <button
                    className="button secondary"
                    disabled={running || saving || uploading || !!busyId}
                    onClick={() => startReplacement(selected)}
                  >
                    Replace documents
                  </button>
                  <button
                    className="button secondary"
                    disabled={!!busyId || running || saving || uploading}
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
                </>
              )}
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
      <Dialog open={mailboxOpen} onOpenChange={setMailboxOpen}>
        <DialogContent
          className="modal mailbox-modal"
          aria-describedby={undefined}
        >
          <DialogTitle>Gmail correspondence</DialogTitle>
          <CorrespondencePanel
            cases={cases}
            onUpdated={update}
            onInspectCase={(id, tab) => {
              setMailboxOpen(false);
              void openCase(id, tab);
            }}
            onImported={(result) => {
              setMailboxOpen(false);
              void openCase(result.email.email_id);
            }}
            onUseAttachment={(result, source, file, mode) => {
              setMailboxOpen(false);
              startReplacement(result, source, mode);
              setIntakeFiles([file]);
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={upload}
        onOpenChange={(v) => {
          if (!uploading && !addingFiles) {
            setUpload(v);
            if (!v) {
              setReplacement(null);
              setReplacementDocument(null);
              setAttachmentMode("replace_all");
            }
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
              <span className="eyebrow">
                {replacement ? "UPDATE DOCUMENTS" : "NEW VERIFICATION"}
              </span>
              <DialogTitle>
                {replacement
                  ? attachmentMode === "append"
                    ? "Add documents to this case."
                    : replacementDocument
                      ? "Replace one source document."
                      : "Replace source documents."
                  : "Upload documents with their email."}
              </DialogTitle>
            </div>
            <button
              className="icon-button"
              aria-label="Close upload"
              disabled={uploading || addingFiles}
              onClick={() => setUpload(false)}
            >
              <X size={20} />
            </button>
          </div>
          <p>
            {replacement
              ? "Review the document update below. CargoGuard rechecks the case and retains earlier revisions in history."
              : "Paste the message and attach its files. CargoGuard routes the email, checks the documents and keeps every attachment as evidence."}
          </p>
          <p className="info-box">
            Hackathon demo: use organiser or synthetic files only, never
            confidential shipments. Reviewer names are self-declared. Keep this
            browser’s cookies to retain access to your workspace.
          </p>
          <form onSubmit={uploadCase}>
            <fieldset
              className="intake-fields"
              disabled={uploading || addingFiles}
            >
              {error && (
                <p className="alert error" role="alert">
                  {error}
                </p>
              )}
              {replacement && (
                <>
                  <div className="info-box">
                    {attachmentMode === "append"
                      ? `Adding documents to ${replacement.email.email_id}. All ${replacement.documents.length} existing attachments stay in this case. Upload only the additional files.`
                      : replacementDocument
                        ? `Replacing ${replacementDocument.name}. The other ${replacement.documents.length - 1} attachment${replacement.documents.length === 2 ? " stays" : "s stay"} in this case.`
                        : `Replacing the complete attachment set for ${replacement.email.email_id}. Include every document you want in the new revision.`}{" "}
                    Earlier files and decisions remain in history.
                  </div>
                  <label>
                    Reviewer name
                    <input required name="actor" minLength={2} maxLength={80} />
                  </label>
                  <label>
                    {attachmentMode === "append"
                      ? "Reason for adding documents"
                      : "Reason for replacement"}
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
                  {replacementDocument
                    ? "Choose the revised document"
                    : "Add email attachments"}
                </strong>
                <span>
                  TXT, PDF, DOCX or XLSX ·{" "}
                  {replacementDocument
                    ? "One file, up to 5 MB"
                    : attachmentMode === "append" && replacement
                      ? `Up to ${10 - retainedAttachments.length} additional files · 5 MB each · 20 MB total including existing documents. Add files in separate selections.`
                      : "Up to 10 files · 5 MB each · 20 MB total. Add files in separate selections."}
                </span>
                <input
                  type="file"
                  name="files"
                  multiple={!replacementDocument}
                  accept=".txt,.pdf,.docx,.xlsx"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    event.target.value = "";
                    if (files.length) void chooseIntakeFiles(files);
                  }}
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
                        <button
                          type="button"
                          className="text-button remove-attachment"
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setIntakeFiles((files) =>
                              files.filter((_, item) => item !== index),
                            )
                          }
                        >
                          <X size={14} /> Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {intakeFiles.length + retainedAttachments.length > 2 && (
                <p className="info-box">
                  After checking, review the selected SI and draft BL in
                  Sources. Extra attachments are retained, never silently
                  included or discarded.
                </p>
              )}
              {intakeFilesError(
                intakeFiles,
                replacementDocument ? 1 : 10,
                retainedAttachments,
              ) && (
                <p className="alert error" role="alert">
                  {intakeFilesError(
                    intakeFiles,
                    replacementDocument ? 1 : 10,
                    retainedAttachments,
                  )}
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
                  addingFiles ||
                  !!intakeSubmissionError(
                    intakeFiles,
                    replacement ? attachmentMode : "new",
                    retainedAttachments,
                  )
                }
              >
                {uploading ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <Sparkles size={17} />
                )}{" "}
                {addingFiles
                  ? "Checking attachments…"
                  : uploading
                    ? "Reading documents…"
                    : replacement
                      ? attachmentMode === "append"
                        ? "Add documents & recheck"
                        : "Replace documents & recheck"
                      : "Import & check email"}
              </button>
            </fieldset>
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
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              editInput.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              if (
                editTrigger.current?.isConnected &&
                !editTrigger.current.disabled
              )
                editTrigger.current.focus();
              else comparisonHeading.current?.focus();
            }}
          >
            <div className="modal-heading">
              <DialogTitle>
                Correct {FIELD_LABELS[edit.field].toLowerCase()}
              </DialogTitle>
              <button
                className="button secondary"
                aria-label="Close correction"
                disabled={saving}
                onClick={() => setEdit(null)}
              >
                <X size={18} /> Cancel
              </button>
            </div>
            <p>
              Correct what CargoGuard read from the{" "}
              {edit.side === "si"
                ? "shipping instruction"
                : "draft bill of lading"}{" "}
              after checking the source. The original file stays unchanged. You
              can review the effect below before saving.
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
                  ref={editInput}
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
                {saving ? "Saving correction…" : "Save correction & recheck"}
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
