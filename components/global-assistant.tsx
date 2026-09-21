"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  MessageSquareText,
  Search,
  X,
  ArrowLeft,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { CaseAssistant, type AssistantMemory } from "./case-assistant";
import { requestJson } from "@/lib/client-api";
import {
  assistantAvailability,
  assistantCases,
  assistantWorkspaceSummary,
} from "@/lib/assistant-navigation";
import type { CaseResult, CaseSummary } from "@/lib/types";

export function GlobalAssistant({
  cases,
  initialCaseId,
  onOpenCase,
  onUpdated,
  memories,
  setMemories,
}: {
  cases: CaseSummary[];
  initialCaseId: string | null;
  onOpenCase: (id: string, tab: string) => void;
  onUpdated: (results: CaseResult[]) => void;
  memories: Record<string, AssistantMemory>;
  setMemories: Dispatch<SetStateAction<Record<string, AssistantMemory>>>;
}) {
  const [caseId, setCaseId] = useState(initialCaseId);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(8);
  const [choosing, setChoosing] = useState(!initialCaseId);
  const [loaded, setLoaded] = useState<{
    id: string;
    result?: CaseResult;
    error?: string;
  } | null>(null);
  const [source, setSource] = useState<{
    name: string;
    location: string;
  } | null>(null);
  const [open, setOpen] = useState(true);
  const [loadSequence, setLoadSequence] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const sourceHeading = useRef<HTMLHeadingElement>(null);
  const matching = assistantCases(cases, query);
  const counts = assistantWorkspaceSummary(cases);
  const result = loaded?.id === caseId ? loaded.result : undefined;
  const error = loaded?.id === caseId ? loaded.error : undefined;
  const memoryKey = result ? `${result.email.email_id}:${result.version}` : "";
  const remember = useCallback(
    (memory: AssistantMemory) => {
      setMemories((previous) => {
        // Tab-memory only, at most five case revisions. Never localStorage.
        const entries = Object.entries(previous)
          .filter(([key]) => key !== memoryKey)
          .slice(-4);
        return Object.fromEntries([...entries, [memoryKey, memory]]);
      });
    },
    [memoryKey, setMemories],
  );
  useEffect(() => {
    if (!caseId || !open) return;
    const controller = new AbortController();
    requestJson<{ result: CaseResult }>(
      `/api/cases?id=${encodeURIComponent(caseId)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (!controller.signal.aborted)
          setLoaded({ id: caseId, result: data.result });
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setLoaded({
            id: caseId,
            error:
              failure instanceof Error
                ? failure.message
                : "Could not load this case.",
          });
      });
    return () => controller.abort();
  }, [caseId, open, loadSequence]);
  useEffect(() => {
    sourceHeading.current?.focus();
  }, [source]);
  const inspect = (id: string, tab = "comparison") => {
    setOpen(false);
    onOpenCase(id, tab);
  };
  const close = () => {
    setOpen(false);
  };
  const doc = result?.documents.find((item) => item.name === source?.name);
  async function verifyCase() {
    if (!caseId || verifying) return;
    setVerifying(true);
    try {
      const response = await requestJson<{
        results: CaseResult[];
        errors?: { error: string }[];
      }>("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "process",
          ids: [caseId],
          skipSaved: true,
        }),
      });
      const saved = response.results.find(
        (item) => item.email.email_id === caseId,
      );
      if (!saved)
        throw new Error(
          response.errors?.[0]?.error ??
            "Verification did not finish. Try again.",
        );
      onUpdated(response.results);
      setLoaded({ id: caseId, result: saved });
    } catch (failure) {
      setLoaded({
        id: caseId,
        error:
          failure instanceof Error
            ? failure.message
            : "Verification failed. No AI request was made.",
      });
    } finally {
      setVerifying(false);
    }
  }
  return (
    <>
      {!open && (
        <button
          className="assistant-fab"
          aria-label="Open Ask CargoGuard"
          onClick={() => {
            setLoaded(null);
            setOpen(true);
          }}
        >
          <MessageSquareText size={23} />
          <span>Ask CargoGuard</span>
        </button>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent
          className="assistant-panel"
          showCloseButton={false}
          aria-describedby="assistant-panel-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document
              .querySelector<HTMLButtonElement>(".assistant-fab")
              ?.focus();
          }}
        >
          <header className="assistant-panel-header">
            <div>
              <span className="eyebrow">YOUR SHIPPING COPILOT</span>
              <DialogTitle>Ask CargoGuard</DialogTitle>
            </div>
            <button
              className="icon-button"
              aria-label="Close assistant"
              onClick={close}
            >
              <X size={22} />
            </button>
          </header>
          <p
            id="assistant-panel-description"
            className="assistant-panel-description"
          >
            Find any case in this workspace. One shipment’s evidence at a time.
          </p>
          <div className="assistant-panel-scroll">
            {choosing ? (
              <section className="assistant-picker">
                <div className="assistant-workspace-card">
                  <ShieldCheck size={22} />
                  <div>
                    <h3>What needs attention?</h3>
                    <p>Live workspace counts · no AI request</p>
                  </div>
                  <div className="assistant-workspace-counts">
                    <span>
                      <strong>{counts.discrepancies}</strong> discrepancies
                    </span>
                    <span>
                      <strong>{counts.reviews}</strong> need review
                    </span>
                    <span>
                      <strong>{counts.awaiting}</strong> awaiting documents
                    </span>
                  </div>
                  <p>
                    Check discrepancies against the SI reference. Recover
                    unreadable evidence before deciding. Request missing
                    documents; do not assume they match.
                  </p>
                </div>
                <label htmlFor="assistant-case-search">
                  Choose a case to discuss
                </label>
                <div className="assistant-case-search">
                  <Search size={18} />
                  <input
                    id="assistant-case-search"
                    placeholder="Search case ID, subject or sender"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setLimit(8);
                    }}
                  />
                </div>
                <p className="assistant-picker-note">
                  {matching.length} of {counts.total} cases · Search and
                  selection do not contact OpenAI.
                </p>
                {result && (
                  <button
                    className="text-button"
                    onClick={() => setChoosing(false)}
                  >
                    <ArrowLeft size={14} /> Return to {result.email.email_id}
                  </button>
                )}
                <div className="assistant-case-list">
                  {matching.slice(0, limit).map((row) => {
                    const unavailable = assistantAvailability(row);
                    return (
                      <button
                        key={row.email.email_id}
                        onClick={() => {
                          if (unavailable && row.result) {
                            inspect(row.email.email_id);
                            return;
                          }
                          setLoaded(null);
                          setSource(null);
                          setCaseId(row.email.email_id);
                          setLoadSequence((n) => n + 1);
                          setChoosing(false);
                        }}
                      >
                        <span>
                          <strong>{row.email.email_id}</strong>
                          <small>
                            {unavailable ??
                              `${row.result!.workflow.replaceAll("_", " ")} · Revision ${row.result!.version}`}
                          </small>
                        </span>
                        <p>{row.email.subject}</p>
                        <ArrowUpRight size={16} />
                      </button>
                    );
                  })}
                  {!matching.length && (
                    <p role="status">
                      No matching case in this workspace. Try a shorter ID or
                      subject.
                    </p>
                  )}
                </div>
                {matching.length > limit && (
                  <button
                    className="button secondary"
                    disabled={verifying}
                    onClick={() => setLimit((n) => n + 8)}
                  >
                    Show more cases
                  </button>
                )}
                <p className="assistant-picker-note">
                  No case is sent automatically. You will preview the selected
                  evidence and explicitly consent before each AI request. This
                  is a shipping assistant, not an approval authority.
                </p>
              </section>
            ) : (
              <>
                <div className="assistant-context-bar">
                  <div>
                    <strong>{caseId}</strong>
                    <span>
                      {result
                        ? `Revision ${result.version} · ${result.status} · ${result.workflow.replaceAll("_", " ")}`
                        : error
                          ? "Saved evidence unavailable"
                          : "Loading saved evidence…"}
                    </span>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => setChoosing(true)}
                  >
                    Change case
                  </button>
                </div>
                {error && (
                  <div className="assistant-error" role="alert">
                    <p>{error}</p>
                    {!cases.find((row) => row.email.email_id === caseId)
                      ?.result && (
                      <button
                        className="button primary"
                        disabled={verifying}
                        onClick={() => void verifyCase()}
                      >
                        {verifying
                          ? "Verifying documents…"
                          : "Verify this case · no AI request"}
                      </button>
                    )}
                    <button
                      className="text-button"
                      onClick={() => caseId && inspect(caseId)}
                    >
                      Open case to verify or refresh
                    </button>
                  </div>
                )}
                {!result && !error && (
                  <p className="assistant-picker" role="status">
                    Loading only this case. No AI request is being made.
                  </p>
                )}
                {result && (
                  <>
                    <p className="assistant-case-subject">
                      {result.email.subject}
                    </p>
                    {source && doc && (
                      <section className="assistant-source-view">
                        <h3 ref={sourceHeading} tabIndex={-1}>
                          Source evidence · {source.location}
                        </h3>
                        <p>
                          {doc.name} · Revision {result.version}
                        </p>
                        <a
                          target="_blank"
                          rel="noreferrer"
                          href={`/api/document?id=${encodeURIComponent(result.email.email_id)}&name=${encodeURIComponent(doc.name)}&revision=${result.version}`}
                        >
                          Open original document <ArrowUpRight size={14} />
                        </a>
                        {doc.transcription && (
                          <p>
                            These text lines are human-confirmed transcription,
                            not original machine-readable text. Inspect the
                            original image.
                          </p>
                        )}
                        <div className="assistant-source-lines">
                          {doc.lines.map((line, i) => (
                            <p
                              key={i}
                              className={
                                line.location === source.location
                                  ? "source-highlight"
                                  : ""
                              }
                            >
                              <small>{line.location}</small>
                              <span>{line.text}</span>
                            </p>
                          ))}
                        </div>
                        <button
                          className="text-button"
                          onClick={() => setSource(null)}
                        >
                          Close source evidence
                        </button>
                      </section>
                    )}
                    <CaseAssistant
                      key={memoryKey}
                      result={result}
                      initialMemory={memories[memoryKey]}
                      onMemory={remember}
                      onSource={(name, location) =>
                        setSource({ name, location })
                      }
                      onFallback={() =>
                        inspect(result.email.email_id, "resolution")
                      }
                    />
                  </>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
