"use client";
import "@/app/follow-up.css";
import "@/app/integrity-checks.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronDown,
  Info,
  ListChecks,
  Loader2,
  Mail,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { AppShell } from "./app-shell";
import { useTeamAccess } from "./team-access";
import { PolicyDesk } from "./policy-desk";
import { BatchReview } from "./batch-review";
import { GlobalAssistant } from "./global-assistant";
import type { AssistantMemory } from "./case-assistant";
import { ReportsOverview } from "./reports-overview";
import { AiAvailability } from "./ai-availability";
import { DEFAULT_FILTERS, InboxView, type InboxFilters } from "./inbox-view";
import { AuditDetail, CaseView, tabFor, type CaseTab } from "./case-view";
import type { FieldEdit } from "./compare-table";
import type { MailboxState } from "./reply-composer";
import { ImportDialog, type ImportOutcome } from "./import-dialog";
import { PlanDialog } from "./plan-dialog";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useCargoTools } from "./cargo-tools";
import { requestJson, requestInbox, latencySummary } from "@/lib/client-api";
import { createRequestGate } from "@/lib/request-gate";
import { mergeCaseSummaries } from "@/lib/case-state";
import type { FollowUp } from "@/lib/follow-up";
import type { PolicySnapshot } from "@/lib/policy";
import type { FollowUpMap, WorkspaceView } from "@/lib/work-queue";
import { shiftBrief } from "@/lib/operations";
import { groupThreads } from "@/lib/mail-intel";
import { planFor } from "@/lib/priority";
import { categoryWords } from "@/lib/case-status";
import {
  CATEGORIES,
  PIPELINE_VERSION,
  summaryOf,
  type AuditEvent,
  type CaseResult,
  type CaseSummary,
  type ParsedDocument,
} from "@/lib/types";

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
    <section className="validation-extra policy-preview">
      <h3>Authored operations challenge</h3>
      <p>
        Synthetic, self-authored cases; not a blinded real-world evaluation.
        These {data.cases} cases are separate from the organiser benchmark.
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
      {typeof data.limitations === "string" && <p>{data.limitations}</p>}
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
interface MailStatus extends MailboxState {
  configured: boolean;
  settings?: { auto_sync: boolean; interval_minutes: number };
  last_sync_at?: string | null;
  last_sync_note?: string | null;
}
function download(name: string, data: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const REVIEWER_KEY = "cg-reviewer-name";
function readLocal(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows may block storage; the value still applies to this page.
  }
}

export default function Workbench({
  initialView = "inbox",
}: {
  initialView?: WorkspaceView;
}) {
  const access = useTeamAccess();
  const employeeName = access?.user?.display_name ?? "";
  const [workspaceConfig, setWorkspaceConfig] =
    useState<ApiPayload["workspace"]>();
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
      const data = await requestJson<{ followups: FollowUp[] }>(
        "/api/follow-ups",
        { signal: controller.signal, cache: "no-store" },
      );
      if (followupRequests.current.isCurrent(ticket)) {
        setFollowups(
          Object.fromEntries(data.followups.map((v) => [v.email_id, v])),
        );
        setFollowupsReady(true);
        setFollowupsError("");
        setQueueNow(Date.now());
        return true;
      }
    } catch (e) {
      if (followupRequests.current.isCurrent(ticket))
        setFollowupsError(
          `Follow-ups could not be refreshed. ${e instanceof Error ? e.message : "Please retry."}`,
        );
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
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [view, setView] = useState<WorkspaceView>(initialView);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const downloadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!downloadOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setDownloadOpen(false);
        return;
      }
      if (!downloadRef.current?.contains(event.target as Node))
        setDownloadOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [downloadOpen]);
  const [filters, setFiltersState] = useState<InboxFilters>(DEFAULT_FILTERS);
  const setFilters = useCallback(
    (update: Partial<InboxFilters>) =>
      setFiltersState((current) => ({ ...current, ...update })),
    [],
  );
  const [selected, setSelected] = useState<CaseResult | null>(null),
    [caseEvents, setCaseEvents] = useState<AuditEvent[]>([]),
    [caseTab, setCaseTab] = useState<CaseTab>("compare"),
    [caseError, setCaseError] = useState(""),
    [document, setDocument] = useState<ParsedDocument | null>(null),
    [sourceLocation, setSourceLocation] = useState("");
  const selectedCaseId = useRef<string | null>(null);
  const [queueOrder, setQueueOrder] = useState<string[]>([]);
  const [auditSearch, setAuditSearch] = useState("");
  const [assistant, setAssistant] = useState<{
    id: string | null;
    sequence: number;
  } | null>(null);
  const [running, setRunning] = useState(false),
    [progress, setProgress] = useState({ done: 0, total: 0 }),
    [busyId, setBusyId] = useState(""),
    cancel = useRef(false);
  const [importState, setImportState] = useState<{
    open: boolean;
    replacement: { result: CaseResult; mode: "bl" | "all" } | null;
  }>({ open: false, replacement: null });
  const [routeEdit, setRouteEdit] = useState(false),
    [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<Record<string, unknown> | null>(
    null,
  );
  const [fieldTest, setFieldTest] = useState<unknown>(null);
  const [latencies, setLatencies] = useState<number[]>([]),
    [batchMs, setBatchMs] = useState<number | null>(null);
  const [reviewerName, setReviewerNameState] = useState("");
  const [mail, setMail] = useState<MailStatus | null>(null);
  const [mailBusy, setMailBusy] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  useEffect(() => {
    // Read browser-only preferences after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReviewerNameState(readLocal(REVIEWER_KEY));
  }, []);
  const effectiveReviewer = reviewerName || employeeName;
  const setReviewerName = useCallback((value: string) => {
    setReviewerNameState(value);
    writeLocal(REVIEWER_KEY, value);
  }, []);

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
    setRouteEdit(false);
    setBusyId("");
    setCaseError("");
  }
  const applyInbox = useCallback((d: ApiPayload) => {
    setCases(d.cases);
    setWorkspaceConfig(d.workspace);
    setEvents(d.audit);
    setInboxReady(true);
    setLastSync(d.loaded_at ?? new Date().toISOString());
    setRefreshFailed(false);
  }, []);
  const load = useCallback(async () => {
    const request = inboxRequests.current.next();
    inboxController.current?.abort();
    const controller = new AbortController();
    inboxController.current = controller;
    try {
      const started = performance.now();
      const d = await requestInbox<ApiPayload>(controller.signal);
      if (inboxRequests.current.isCurrent(request)) {
        applyInbox(d);
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
  }, [loadFollowups, applyInbox]);
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
    requestInbox<ApiPayload>(controller.signal)
      .then((d) => {
        if (!active || !gate.isCurrent(request)) return;
        applyInbox(d);
        // Source citations open saved evidence; visiting a link never processes mail.
        if (!deepLinkHandled.current) {
          deepLinkHandled.current = true;
          const params = new URLSearchParams(window.location.search);
          const id = params.get("case");
          if (id && d.cases.some((c) => c.email.email_id === id && c.result)) {
            const ticket = activeRequest.current.next();
            requestJson<ApiPayload>(`/api/cases?id=${encodeURIComponent(id)}`, {
              signal: controller.signal,
            })
              .then((data) => {
                if (active && activeRequest.current.isCurrent(ticket)) {
                  selectedCaseId.current = id;
                  setSelected(data.result);
                  setCaseEvents(data.audit);
                  setCaseTab(tabFor(params.get("tab") ?? "compare"));
                }
              })
              .catch((e) => {
                if (active && activeRequest.current.isCurrent(ticket))
                  setError(e.message);
              });
          } else if (id)
            setError(
              "The linked email has not been checked yet or is not in this workspace.",
            );
        }
        void loadFollowups();
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
    fetch("/field-test.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (active) setFieldTest(v);
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
  }, [loadFollowups, applyInbox]);
  useEffect(() => {
    const timer = setInterval(() => setQueueNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  // ----- Mailbox connection and automatic import -----
  const loadMail = useCallback(async () => {
    try {
      const value = await requestJson<MailStatus>("/api/mail", {
        cache: "no-store",
      });
      setMail(value);
      return value;
    } catch {
      setMail(null);
      return null;
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMail();
  }, [loadMail]);
  const syncMail = useCallback(
    async (manual: boolean) => {
      setMailBusy(true);
      try {
        const value = await requestJson<{
          imported: string[];
          failed: number;
          busy: boolean;
          note: string;
        }>("/api/mail/sync", { method: "POST" });
        if (value.imported.length) {
          await load();
          setNotice(
            `${value.imported.length} new email${value.imported.length === 1 ? "" : "s"} imported from your mailbox and checked.`,
          );
        } else if (manual) setNotice(value.busy ? value.note : "No new email.");
      } catch (e) {
        if (manual) setError((e as Error).message);
      } finally {
        setMailBusy(false);
        void loadMail();
      }
    },
    [load, loadMail],
  );
  const autoSync =
    mail?.connected && mail.settings?.auto_sync
      ? Math.max(2, mail.settings.interval_minutes)
      : 0;
  useEffect(() => {
    if (!autoSync || !inboxReady) return;
    const first = setTimeout(() => void syncMail(false), 4000);
    const timer = setInterval(() => void syncMail(false), autoSync * 60000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [autoSync, inboxReady, syncMail]);

  // ----- Derived planning data -----
  const plans = useMemo(
    () =>
      new Map(
        cases.map((row) => [
          row.email.email_id,
          planFor(row, followups[row.email.email_id], queueNow),
        ]),
      ),
    [cases, followups, queueNow],
  );
  const planned = useMemo(
    () =>
      cases.map((row) => ({
        row,
        plan: plans.get(row.email.email_id)!,
      })),
    [cases, plans],
  );
  const threads = useMemo(
    () =>
      groupThreads(
        cases.map((row) => ({
          id: row.email.email_id,
          subject: row.email.subject,
          refs: row.email.insight?.refs,
          message_id: row.email.message_id,
          in_reply_to: row.email.in_reply_to,
          references: row.email.references,
          thread_hint: row.email.thread_hint,
          excluded: row.result?.category === "SPAM",
        })),
      ),
    [cases],
  );
  const counts = useMemo(() => {
    const c = {
      processed: 0,
      verified: 0,
      discrepancy: 0,
      review: 0,
      awaiting_documents: 0,
      routed: 0,
      comparisons: 0,
    };
    for (const row of cases)
      if (row.result) {
        c.processed++;
        c[row.result.workflow]++;
        if (["verified", "discrepancy"].includes(row.result.workflow))
          c.comparisons++;
      }
    return c;
  }, [cases]);
  const todoCount = useMemo(
    () => [...plans.values()].filter((plan) => plan.bucket === "todo").length,
    [plans],
  );
  const outdated = cases.filter(
    (c) => !c.result || c.result.pipeline_version !== PIPELINE_VERSION,
  ).length;
  const timing = latencySummary(latencies);
  const position = selected ? queueOrder.indexOf(selected.email.email_id) : -1;
  const available = new Set(cases.map((row) => row.email.email_id));
  const nextId =
    position >= 0
      ? (queueOrder.slice(position + 1).find((id) => available.has(id)) ?? null)
      : null;
  const prevId =
    position > 0
      ? ([...queueOrder.slice(0, position)]
          .reverse()
          .find((id) => available.has(id)) ?? null)
      : null;

  const update = (results: CaseResult[]) => {
    inboxRequests.current.cancel();
    inboxController.current?.abort();
    setLoading(false);
    setCases((prev) => mergeCaseSummaries(prev, results.map(summaryOf)));
  };
  function applyCase(
    data: { result: CaseResult; audit: AuditEvent[] },
    message: string,
  ) {
    setSelected(data.result);
    setCaseEvents(data.audit);
    setDocument(null);
    update([data.result]);
    setNotice(message);
  }
  async function followupSaved(value: FollowUp) {
    followupRequests.current.cancel();
    followupController.current?.abort();
    setFollowupsLoading(false);
    setFollowups((current) => ({ ...current, [value.email_id]: value }));
    setNotice("Follow-up saved.");
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
        setCaseError(
          `Follow-up saved; the email could not be refreshed. ${(e as Error).message}`,
        );
    }
  }
  async function reloadFollowupCase(id: string) {
    if (selectedCaseId.current !== id) return;
    const ticket = activeRequest.current.next();
    setBusyId(id);
    setCaseError("");
    try {
      const [data, loaded] = await Promise.all([
        api(`/api/cases?id=${encodeURIComponent(id)}`),
        loadFollowups(),
      ]);
      if (
        !loaded ||
        !activeRequest.current.isCurrent(ticket) ||
        selectedCaseId.current !== id
      )
        return;
      update([data.result]);
      setSelected(data.result);
      setCaseEvents(data.audit);
      setFollowupFormKey((value) => value + 1);
      setNotice(
        `Latest version (${data.result.version}) and follow-up loaded.`,
      );
    } catch (e) {
      if (
        activeRequest.current.isCurrent(ticket) &&
        selectedCaseId.current === id
      )
        setCaseError(
          `Could not load the latest version; your edits are kept. ${(e as Error).message}`,
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
    tab: CaseTab = "compare",
    order?: string[],
  ) {
    if (order) setQueueOrder(order);
    const request = activeRequest.current.next();
    setBusyId(id);
    setCaseError("");
    setError("");
    try {
      let result: CaseResult;
      let history: AuditEvent[] = [];
      const summary = cases.find((c) => c.email.email_id === id);
      if (
        !summary?.result ||
        summary.result.pipeline_version !== PIPELINE_VERSION
      ) {
        const d = await api("/api/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process", ids: [id] }),
        });
        result = d.results[0];
        if (!result)
          throw new Error(
            d.errors?.[0]?.error ??
              "This email could not be checked. Please retry.",
          );
        update(d.results);
        if (summary?.result) {
          const detail = await api(`/api/cases?id=${encodeURIComponent(id)}`);
          history = detail.audit;
        }
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
        setCaseTab(tab);
      }
    } catch (e) {
      if (activeRequest.current.isCurrent(request)) {
        if (selectedCaseId.current) setCaseError((e as Error).message);
        else setError((e as Error).message);
      }
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
      setNotice("Every email has already been checked.");
      return;
    }
    // Invoked only by the click handler, never during render.
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
        `${problem} Checked emails are saved. Press “Check emails” again to continue.`,
      );
    else
      setNotice(
        cancel.current
          ? "Paused. Emails checked so far are saved."
          : "All emails checked. Start with the email at the top of “To do”.",
      );
  }
  async function reprocess() {
    if (!selected) return;
    const request = activeRequest.current.next();
    const id = selected.email.email_id;
    setBusyId(id);
    setCaseError("");
    try {
      const d = await api("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "process", ids: [id] }),
      });
      if (!d.results[0])
        throw new Error(
          d.errors?.[0]?.error ??
            "Reading failed. The previous result is kept.",
        );
      update(d.results);
      if (!activeRequest.current.isCurrent(request)) return;
      setSelected(d.results[0]);
      setDocument(null);
      const history = await api(`/api/cases?id=${encodeURIComponent(id)}`);
      if (!activeRequest.current.isCurrent(request)) return;
      setCaseEvents(history.audit);
      setNotice("Documents read again. Earlier corrections remain in History.");
    } catch (e) {
      if (activeRequest.current.isCurrent(request))
        setCaseError((e as Error).message);
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
          ? "Automatic results downloaded (human corrections excluded)."
          : "Reviewed results downloaded with source and review labels.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveEdit(edit: FieldEdit, actor: string, reason: string) {
    if (!selected) return false;
    const request = activeRequest.current.next();
    setCaseError("");
    try {
      const d = await api("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "review",
          id: selected.email.email_id,
          version: selected.version,
          ...edit,
          actor,
          reason,
        }),
      });
      update([d.result]);
      if (!activeRequest.current.isCurrent(request)) return false;
      setSelected(d.result);
      setCaseEvents(d.audit);
      setNotice("Correction saved and the check was run again.");
      return true;
    } catch (e) {
      if (activeRequest.current.isCurrent(request))
        setCaseError((e as Error).message);
      return false;
    }
  }
  async function saveRoute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const request = activeRequest.current.next();
    setSaving(true);
    setCaseError("");
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
      setNotice("Email type confirmed. The documents were checked again.");
    } catch (e) {
      if (activeRequest.current.isCurrent(request))
        setCaseError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  function importFinished(outcomes: ImportOutcome[]) {
    const results = outcomes
      .map((item) => item.result)
      .filter((item): item is CaseResult => !!item);
    if (!results.length) return;
    update(results);
    const replaced = importState.replacement;
    if (replaced) {
      const result = results[0];
      selectedCaseId.current = result.email.email_id;
      setSelected(result);
      setDocument(null);
      setCaseTab("compare");
      setImportState({ open: false, replacement: null });
      setNotice(
        "New documents saved and all seven details checked again. Earlier versions are in History.",
      );
      void api(`/api/cases?id=${encodeURIComponent(result.email.email_id)}`)
        .then((d) => {
          if (selectedCaseId.current === result.email.email_id)
            setCaseEvents(d.audit);
        })
        .catch(() => {});
    } else {
      setNotice(
        `${results.length} email${results.length === 1 ? "" : "s"} imported and checked.`,
      );
      void load();
    }
  }
  function openImport() {
    setImportState({ open: true, replacement: null });
  }
  function navigate(next: WorkspaceView) {
    setView(next);
    closeCase();
  }
  useCargoTools({
    cases,
    setSearch: (value) =>
      setFiltersState((current) => ({
        ...current,
        search: typeof value === "function" ? value(current.search) : value,
      })),
    setView: (value) => setView(value),
    setFilter: (value) =>
      setFiltersState((current) => ({
        ...current,
        bucket:
          (typeof value === "function" ? value("all") : value) === "all"
            ? "all"
            : current.bucket,
        reason: "all",
      })),
    setCategory: (value) =>
      setFiltersState((current) => ({
        ...current,
        category: typeof value === "function" ? value(current.category) : value,
      })),
  });

  const activeRoute =
    view === "inbox" ? "/" : view === "policies" ? "/settings" : "/reports";
  const heading =
    view === "inbox"
      ? { title: "Inbox", text: "" }
      : view === "policies"
        ? {
            title: "Settings",
            text: "Your name, comparison rules and tools.",
          }
        : {
            title: "Reports",
            text: "Which emails were checked and what needs attention.",
          };
  const unprocessed = outdated;

  return (
    <AppShell active={activeRoute} inboxCount={todoCount}>
      <main id="main-content" tabIndex={-1} className="cg-page">
        <div className="cg-page-head">
          <div>
            <h1>{heading.title}</h1>
            <p>
              {view === "inbox"
                ? loading && !inboxReady
                  ? "Loading your emails…"
                  : todoCount
                    ? `${todoCount.toLocaleString()} email${todoCount === 1 ? " needs" : "s need"} action · most urgent first`
                    : "You are all caught up."
                : heading.text}
            </p>
          </div>
          {(view === "performance" ||
            view === "accuracy" ||
            view === "activity") && (
            <div className="cg-page-actions">
              <button
                className="cg-btn primary"
                disabled={!inboxReady}
                onClick={() => setPlanOpen(true)}
              >
                <ListChecks size={18} /> Today&apos;s plan
              </button>
              <div className="cg-menu" ref={downloadRef}>
                <button
                  className="cg-btn"
                  aria-haspopup="menu"
                  aria-expanded={downloadOpen}
                  onClick={() => setDownloadOpen(!downloadOpen)}
                >
                  <ArrowDownToLine size={18} /> Download
                  <ChevronDown size={16} />
                </button>
                {downloadOpen && (
                  <div className="cg-menu-list" role="menu">
                    <a
                      role="menuitem"
                      href="/api/follow-ups?export=1"
                      download
                      onClick={() => setDownloadOpen(false)}
                    >
                      Follow-up handover
                    </a>
                    <button
                      role="menuitem"
                      disabled={!inboxReady}
                      onClick={() => {
                        setDownloadOpen(false);
                        download(
                          "cargoguard-shift-brief.txt",
                          shiftBrief(cases, new Date().toISOString()),
                          "text/plain;charset=utf-8",
                        );
                      }}
                    >
                      Shift brief
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setDownloadOpen(false);
                        void exportAll("reviewed");
                      }}
                    >
                      All results (with reviewer corrections)
                    </button>
                    {workspaceConfig?.sample_data && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setDownloadOpen(false);
                          void exportAll();
                        }}
                      >
                        Automatic results only
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {view === "inbox" && (
            <div className="cg-page-actions">
              <button
                className="cg-btn"
                onClick={refreshWorkspace}
                disabled={loading}
                title={
                  lastSync
                    ? `Last refreshed ${new Date(lastSync).toLocaleTimeString()}`
                    : undefined
                }
              >
                <RefreshCw size={18} className={loading ? "cg-spin" : ""} />{" "}
                Refresh
              </button>
              <button
                className="cg-btn"
                disabled={!inboxReady}
                onClick={openImport}
              >
                <Plus size={18} /> Import email
              </button>
              {(unprocessed > 0 || running) && (
                <button
                  className="cg-btn primary"
                  onClick={() => void processAll()}
                  disabled={loading || !inboxReady}
                >
                  {running ? <Square size={16} /> : <Play size={18} />}
                  {running
                    ? "Pause"
                    : `Check ${unprocessed} new email${unprocessed === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          )}
        </div>
        {error && (
          <div className="cg-notice error" role="alert">
            <TriangleAlert size={20} />
            <p>{error}</p>
            <button
              className="cg-icon-btn"
              onClick={() => setError("")}
              aria-label="Dismiss"
            >
              <X size={18} />
            </button>
          </div>
        )}
        {inboxReady && refreshFailed && (
          <div className="cg-notice warn" role="status">
            <Info size={20} />
            <p>
              Showing the last loaded emails. Refresh when the connection is
              back — nothing is lost.
            </p>
          </div>
        )}
        {running && (
          <div className="cg-progress" role="status">
            <Loader2 size={20} className="cg-spin" />
            <span>Reading emails and checking documents…</span>
            <strong>
              {progress.done} / {progress.total}
            </strong>
            <div className="cg-progress-bar">
              <i
                style={{
                  width: `${(progress.done / Math.max(1, progress.total)) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
        {view === "inbox" && (
          <>
            {mail?.connected && (
              <div className="cg-mailbar">
                <Mail size={16} />
                <span>
                  <strong>
                    {mail.provider === "gmail" ? "Gmail" : "Mailbox"}
                  </strong>{" "}
                  {mail.account} ·{" "}
                  {mail.settings?.auto_sync
                    ? `checks every ${mail.settings.interval_minutes} min`
                    : "automatic import is off"}
                  {mail.last_sync_at
                    ? ` · last check ${new Date(mail.last_sync_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                    : ""}
                  {mail.last_sync_note ? ` (${mail.last_sync_note})` : ""}
                </span>
                <button
                  className="cg-btn small"
                  disabled={mailBusy || !inboxReady}
                  onClick={() => void syncMail(true)}
                >
                  {mailBusy ? (
                    <Loader2 size={15} className="cg-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  Check for new email
                </button>
              </div>
            )}
            <InboxView
              cases={cases}
              plans={plans}
              threads={threads}
              filters={filters}
              setFilters={setFilters}
              loading={loading && !inboxReady}
              busyId={busyId}
              now={queueNow}
              onOpen={(id, order) => void openCase(id, "compare", order)}
              onImport={openImport}
              onPlan={() => setPlanOpen(true)}
              doneTools={
                inboxReady && counts.verified > 0 ? (
                  <BatchReview
                    onCompleted={() => {
                      void load();
                      void loadFollowups();
                    }}
                  />
                ) : undefined
              }
            />
          </>
        )}
        {view === "policies" && (
          <div className="cg-panel">
            <section className="cg-card cg-card-pad">
              <h2>Your name</h2>
              <label className="cg-field" style={{ maxWidth: 420 }}>
                Shown on corrections and used to sign replies
                <input
                  value={reviewerName}
                  placeholder={employeeName || "e.g. Najiha"}
                  maxLength={80}
                  onChange={(e) => setReviewerName(e.target.value)}
                />
              </label>
            </section>
            <PolicyDesk />
            <section className="cg-card cg-card-pad">
              <h2>Tools</h2>
              <ul className="cg-tool-list">
                <li>
                  <Link href="/rules">
                    <strong>Label rules</strong>
                    <span>Teach CargoGuard a new document heading</span>
                  </Link>
                </li>
                <li>
                  <Link href="/templates">
                    <strong>SI templates</strong>
                    <span>Saved customer party details</span>
                  </Link>
                </li>
                <li>
                  <Link href="/insights">
                    <strong>Search saved results</strong>
                    <span>Find checked emails by status, port or customer</span>
                  </Link>
                </li>
              </ul>
            </section>
            <details className="cg-details">
              <summary>AI services (optional)</summary>
              <div>{inboxReady && !loading && <AiAvailability />}</div>
            </details>
          </div>
        )}
        {(view === "performance" ||
          view === "accuracy" ||
          view === "activity") && (
          <div className="cg-tabs" role="tablist" style={{ marginBottom: 20 }}>
            <button
              role="tab"
              className="cg-tab"
              aria-selected={view === "performance"}
              onClick={() => navigate("performance")}
            >
              Overview
            </button>
            <button
              role="tab"
              className="cg-tab"
              aria-selected={view === "activity"}
              onClick={() => {
                navigate("activity");
                refreshWorkspace();
              }}
            >
              Activity log
            </button>
            <button
              role="tab"
              className="cg-tab"
              aria-selected={view === "accuracy"}
              onClick={() => navigate("accuracy")}
            >
              Accuracy
            </button>
          </div>
        )}
        {view === "performance" && (
          <ReportsOverview
            cases={cases}
            loading={loading}
            onOpen={(id, order) => void openCase(id, "compare", order)}
          />
        )}
        {view === "accuracy" && (
          <div className="cg-panel">
            <section className="cg-card cg-card-pad">
              <h2>
                <Sparkles size={18} /> How CargoGuard decides
              </h2>
              <dl className="cg-kv">
                <dt>Email type</dt>
                <dd>
                  Trained classifier (TF-IDF linear model) plus safety review
                  rules
                </dd>
                <dt>Document check</dt>
                <dd>Exact, typed comparison of 7 details — no guessing</dd>
                <dt>Conversations</dt>
                <dd>Grouped by order number, reply chain and subject</dd>
                <dt>Priority</dt>
                <dd>
                  Transparent points: problem type, deadlines in the email, age,
                  follow-ups
                </dd>
                <dt>Replies</dt>
                <dd>
                  Written from checked values; optional AI may only change the
                  wording
                </dd>
                <dt>Speed</dt>
                <dd>
                  {timing
                    ? `Median ${timing.median} ms per request (${timing.count} requests)`
                    : "No requests measured yet"}
                  {batchMs !== null
                    ? ` · last full check ${(batchMs / 1000).toFixed(1)} s`
                    : ""}
                </dd>
                <dt>Engine</dt>
                <dd>Version {PIPELINE_VERSION}</dd>
              </dl>
            </section>
            <section className="cg-card cg-card-pad">
              <h2>
                <ShieldCheck size={18} /> Accuracy tests
              </h2>
              {validation ? (
                <>
                  <div className="cg-facts">
                    {Object.entries(
                      (validation.metrics ?? {}) as Record<string, number>,
                    ).map(([key, value]) => (
                      <div className="cg-fact" key={key}>
                        <span>{key.replaceAll("_", " ")}</span>
                        <strong>{(value * 100).toFixed(1)}%</strong>
                      </div>
                    ))}
                  </div>
                  <p className="cg-small cg-muted">
                    {String(validation.note ?? "")}
                  </p>
                  <AuthoredOperationsChallenge
                    report={validation.authored_operations_challenge}
                  />
                </>
              ) : (
                <p className="cg-muted">
                  The accuracy report is not included in this build.
                </p>
              )}
              <FieldTestReport report={fieldTest} />
              <a href="/validation.json" className="cg-btn small" download>
                <ArrowDownToLine size={16} /> Download full report
              </a>
            </section>
          </div>
        )}
        {view === "activity" && (
          <section className="cg-card cg-card-pad">
            <h2>Latest 100 actions</h2>
            <label
              className="cg-search"
              style={{ margin: "8px 0 16px", maxWidth: 480 }}
            >
              <Search size={18} />
              <input
                aria-label="Search activity"
                placeholder="Search email, person or action…"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
              />
            </label>
            {!events.length ? (
              <p className="cg-muted">Nothing recorded yet.</p>
            ) : (
              <ol
                style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 14 }}
              >
                {events
                  .filter((e) =>
                    `${e.email_id} ${e.actor} ${e.action} ${e.detail}`
                      .toLowerCase()
                      .includes(auditSearch.trim().toLowerCase()),
                  )
                  .map((e) => (
                    <li key={e.id}>
                      <strong>
                        {e.action
                          .replaceAll("_", " ")
                          .toLowerCase()
                          .replace(/^\w/, (c) => c.toUpperCase())}
                      </strong>{" "}
                      <button
                        className="cg-link cg-small"
                        onClick={() => {
                          setView("inbox");
                          void openCase(e.email_id, "history");
                        }}
                      >
                        open email
                      </button>
                      <AuditDetail detail={e.detail} />
                      <span className="cg-small cg-muted">
                        {e.actor} · {new Date(e.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
              </ol>
            )}
          </section>
        )}
      </main>
      {notice && (
        <div className="cg-toast" role="status">
          <CheckCircle2 size={20} />
          <span>{notice}</span>
          <button
            className="cg-icon-btn"
            onClick={() => setNotice("")}
            aria-label="Dismiss"
          >
            <X size={18} />
          </button>
        </div>
      )}
      <Sheet open={!!selected} onOpenChange={(open) => !open && closeCase()}>
        {selected && (
          <SheetContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="cg-sheet"
          >
            <SheetTitle className="cg-sr">{selected.email.subject}</SheetTitle>
            <CaseView
              result={selected}
              events={caseEvents}
              cases={cases}
              plans={plans}
              thread={threads.get(selected.email.email_id)}
              tab={caseTab}
              onTab={setCaseTab}
              document={document}
              sourceLocation={sourceLocation}
              onSource={(name, location) => {
                const source = selected.documents.find(
                  (doc) => doc.name === name,
                );
                if (source) setDocument(source);
                setSourceLocation(location);
                setCaseTab("documents");
              }}
              onDocument={(doc) => {
                setDocument(doc);
                setSourceLocation("");
              }}
              mailbox={mail}
              reviewerName={effectiveReviewer}
              onReviewerName={setReviewerName}
              defaultSignature={employeeName}
              busy={!!busyId}
              running={running}
              position={
                position >= 0
                  ? { index: position, total: queueOrder.length }
                  : null
              }
              prevId={prevId}
              nextId={nextId}
              onOpenCase={(id) =>
                void openCase(id, caseTab === "reply" ? "compare" : caseTab)
              }
              onClose={closeCase}
              onSaveEdit={saveEdit}
              onReprocess={() => void reprocess()}
              onReplace={(mode) =>
                setImportState({
                  open: true,
                  replacement: { result: selected, mode },
                })
              }
              onConfirmCategory={() => {
                setCaseError("");
                setRouteEdit(true);
              }}
              onAsk={() => launchAssistant(selected.email.email_id)}
              onUpdated={applyCase}
              onNotice={setNotice}
              onError={setCaseError}
              error={caseError}
              followup={{
                value: followups[selected.email.email_id],
                ready: followupsReady,
                loading: followupsLoading,
                error: followupsError,
                formKey: followupFormKey,
                onRefresh: () => void loadFollowups(),
                onReloadCase: () =>
                  void reloadFollowupCase(selected.email.email_id),
                onReloadValues: () => setFollowupFormKey((v) => v + 1),
                onSaved: (value) => void followupSaved(value),
              }}
            />
          </SheetContent>
        )}
      </Sheet>
      <PlanDialog
        open={planOpen}
        onClose={() => setPlanOpen(false)}
        rows={planned}
        now={queueNow}
        onOpenCase={(id, order) => void openCase(id, "compare", order)}
      />
      <ImportDialog
        open={importState.open}
        replacement={importState.replacement}
        reviewerName={effectiveReviewer}
        onReviewerName={setReviewerName}
        onClose={() => setImportState({ open: false, replacement: null })}
        onFinished={importFinished}
        practice={
          workspaceConfig?.sample_data
            ? async () => {
                const value = await requestJson<{
                  imported: number;
                  skipped: number;
                }>("/api/practice-mailbox", { method: "POST" });
                await load();
                setFilters({ ...DEFAULT_FILTERS });
                setNotice(
                  value.imported
                    ? `${value.imported} practice emails loaded with today's dates. Start with the email at the top.`
                    : "The practice emails are already in your inbox.",
                );
              }
            : undefined
        }
      />
      <Dialog
        open={routeEdit && !!selected}
        onOpenChange={(v) => !saving && setRouteEdit(v)}
      >
        {selected && (
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="cg-dialog"
          >
            <div className="cg-dialog-head">
              <div>
                <DialogTitle asChild>
                  <h2>What is this email about?</h2>
                </DialogTitle>
                <p>
                  Choosing a type runs the checks again. It does not approve any
                  uncertain detail.
                </p>
              </div>
              <button
                disabled={saving}
                className="cg-icon-btn"
                aria-label="Close"
                onClick={() => setRouteEdit(false)}
              >
                <X size={22} />
              </button>
            </div>
            <form onSubmit={saveRoute}>
              <div className="cg-dialog-body">
                {caseError && (
                  <p
                    className="cg-notice error"
                    role="alert"
                    style={{ margin: 0 }}
                  >
                    <TriangleAlert size={18} />
                    <span>{caseError}</span>
                  </p>
                )}
                <label className="cg-field">
                  Email type
                  <select
                    name="category"
                    defaultValue={selected.category}
                    required
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {categoryWords(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="cg-field">
                  Your name
                  <input
                    name="actor"
                    required
                    minLength={2}
                    maxLength={80}
                    defaultValue={effectiveReviewer}
                  />
                </label>
                <label className="cg-field">
                  Reason
                  <textarea
                    name="reason"
                    required
                    minLength={5}
                    maxLength={2000}
                    rows={3}
                    defaultValue="Read the email and confirmed its type"
                  />
                </label>
              </div>
              <div className="cg-dialog-foot">
                <button
                  type="button"
                  className="cg-btn"
                  disabled={saving}
                  onClick={() => setRouteEdit(false)}
                >
                  Cancel
                </button>
                <button disabled={saving} className="cg-btn primary">
                  {saving ? (
                    <Loader2 size={18} className="cg-spin" />
                  ) : (
                    <Check size={18} />
                  )}
                  Save and check again
                </button>
              </div>
            </form>
          </DialogContent>
        )}
      </Dialog>
      {assistant ? (
        <GlobalAssistant
          key={assistant.sequence}
          cases={cases}
          planned={planned}
          now={queueNow}
          initialCaseId={assistant.id}
          workspaceReady={inboxReady && !loading}
          onUpdated={update}
          memories={assistantMemories}
          setMemories={setAssistantMemories}
          onOpenCase={(id, tab) => void openCase(id, tabFor(tab))}
        />
      ) : (
        <button
          className="assistant-fab"
          aria-label="Open the assistant"
          onClick={() => launchAssistant()}
        >
          <MessageSquareText size={23} />
          <span>Ask CargoGuard</span>
        </button>
      )}
    </AppShell>
  );
}

function FieldTestReport({ report }: { report: unknown }) {
  if (!report || typeof report !== "object") return null;
  const data = report as {
    emails?: number;
    measured_at?: string;
    metrics?: Record<string, { correct: number; total: number }>;
    failures?: {
      id: string;
      check: string;
      expected: string;
      actual: string;
    }[];
    note?: string;
  };
  if (!data.metrics) return null;
  return (
    <section style={{ marginTop: 18 }}>
      <h3 className="cg-section-title">
        Our own field-test mailbox ({data.emails} emails)
      </h3>
      <p className="cg-small cg-muted" style={{ marginTop: 0 }}>
        {data.note}
      </p>
      <div className="cg-facts">
        {Object.entries(data.metrics).map(([key, value]) => (
          <div className="cg-fact" key={key}>
            <span>{key.replaceAll("_", " ")}</span>
            <strong>
              {value.correct} / {value.total} (
              {value.total
                ? ((value.correct / value.total) * 100).toFixed(1)
                : "0"}
              %)
            </strong>
          </div>
        ))}
      </div>
      {!!data.failures?.length && (
        <details className="cg-details">
          <summary>
            {data.failures.length} known mistakes (shown honestly)
          </summary>
          <div>
            <ul className="cg-small">
              {data.failures.map((failure) => (
                <li key={`${failure.id}-${failure.check}`}>
                  <strong>{failure.id}</strong> · {failure.check}: expected “
                  {failure.expected}”, got “{failure.actual}”
                </li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}
