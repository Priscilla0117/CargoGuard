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
  ChevronRight,
  Paperclip,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { CaseAssistant, type AssistantMemory } from "./case-assistant";
import { CopilotHome, EMPTY_COPILOT, type CopilotMemory } from "./copilot-home";
import type { Planned } from "@/lib/copilot";
import { requestJson } from "@/lib/client-api";
import {
  assistantAvailability,
  assistantCases,
} from "@/lib/assistant-navigation";
import {
  PIPELINE_VERSION,
  type CaseResult,
  type CaseSummary,
} from "@/lib/types";

export function GlobalAssistant({
  cases,
  planned,
  now,
  workspaceReady,
  initialCaseId,
  onOpenCase,
  onUpdated,
  memories,
  setMemories,
}: {
  cases: CaseSummary[];
  planned: Planned[];
  now: number;
  workspaceReady: boolean;
  initialCaseId: string | null;
  onOpenCase: (id: string, tab: string) => void;
  onUpdated: (results: CaseResult[]) => void;
  memories: Record<string, AssistantMemory>;
  setMemories: Dispatch<SetStateAction<Record<string, AssistantMemory>>>;
}) {
  const [caseId, setCaseId] = useState(initialCaseId);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(8);
  const [choosing, setChoosing] = useState(false);
  const [homeMemory, setHomeMemory] = useState<CopilotMemory>(EMPTY_COPILOT);
  const [pendingQuestion, setPendingQuestion] = useState<{
    id: string | null;
    text: string;
  } | null>(null);
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
  const result = loaded?.id === caseId ? loaded.result : undefined;
  const error = loaded?.id === caseId ? loaded.error : undefined;
  const memoryKey = result ? `${result.email.email_id}:${result.version}` : "";
  const needsVerification = result
    ? result.pipeline_version !== PIPELINE_VERSION
    : !cases.find((row) => row.email.email_id === caseId)?.result;
  const remember = useCallback(
    (memory: AssistantMemory) => {
      setPendingQuestion((previous) =>
        previous?.id === caseId ? null : previous,
      );
      setMemories((previous) => {
        // Tab-memory only, at most five case revisions. Never localStorage.
        const entries = Object.entries(previous)
          .filter(([key]) => key !== memoryKey)
          .slice(-4);
        return Object.fromEntries([...entries, [memoryKey, memory]]);
      });
    },
    [memoryKey, setMemories, caseId],
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
    // A dismissed attachment picker must not become the next launch screen.
    setChoosing(false);
    setSource(null);
  };
  const doc = result?.documents.find((item) => item.name === source?.name);
  function selectCase(id: string) {
    setLoaded(null);
    setSource(null);
    setCaseId(id);
    setPendingQuestion((previous) => (previous ? { ...previous, id } : null));
    setLoadSequence((n) => n + 1);
    setChoosing(false);
  }
  async function verifyCase() {
    if (!caseId || verifying) return;
    const draft = memories[memoryKey]?.question;
    if (draft)
      setPendingQuestion((previous) => previous ?? { id: caseId, text: draft });
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
              <span className="eyebrow">YOUR DOCUMENT DESK ASSISTANT</span>
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
            Plans your day, reads SI and BL values, gets replies ready and
            explains shipping terms — always showing where the answer comes
            from.
          </p>
          <CopilotHome
            rows={planned}
            now={now}
            workspaceReady={workspaceReady}
            memory={homeMemory}
            setMemory={setHomeMemory}
            visible={!caseId && !choosing}
            onOpen={(id, tab) => inspect(id, tab ?? "comparison")}
            onAttach={(question) => {
              setPendingQuestion(
                question.trim() ? { id: null, text: question } : null,
              );
              setQuery("");
              setLimit(8);
              setChoosing(true);
            }}
          />
          {choosing ? (
            <section className="assistant-picker">
              <button
                className="text-button"
                onClick={() => setChoosing(false)}
              >
                <ArrowLeft size={15} />
                Back to chat
              </button>
              <h3>Which shipment?</h3>
              <p className="assistant-picker-note">
                Attach one case. You’ll stay in this conversation.
              </p>
              <label htmlFor="assistant-case-search">Find a case</label>
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
                {matching.length} of {cases.length} cases · No AI request
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
                      onClick={() => selectCase(row.email.email_id)}
                    >
                      <span>
                        <strong>{row.email.email_id}</strong>
                        <small>
                          {unavailable ??
                            `${row.result!.workflow.replaceAll("_", " ")} · Revision ${row.result!.version}`}
                        </small>
                      </span>
                      <p>{row.email.subject}</p>
                      <ChevronRight size={16} />
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
                evidence and explicitly consent before each AI request. This is
                a shipping assistant, not an approval authority.
              </p>
            </section>
          ) : caseId ? (
            <div className="assistant-selected-chat">
              <div className="assistant-context-bar">
                <div>
                  <strong>
                    <Paperclip size={13} />
                    {caseId}
                  </strong>
                  <span>
                    {result
                      ? `Revision ${result.version} · ${result.status} · ${result.workflow.replaceAll("_", " ")}`
                      : error
                        ? "Saved evidence unavailable"
                        : "Loading saved evidence…"}
                  </span>
                </div>
                <div className="assistant-context-actions">
                  <button
                    className="text-button"
                    disabled={verifying}
                    onClick={() => {
                      setCaseId(null);
                      setLoaded(null);
                      setSource(null);
                      setPendingQuestion(null);
                    }}
                  >
                    Workspace chat
                  </button>
                  <button
                    className="button secondary"
                    disabled={verifying}
                    onClick={() => setChoosing(true)}
                  >
                    Change case
                  </button>
                </div>
              </div>
              {(error || (result && needsVerification)) && (
                <div className="assistant-prepare" role="status">
                  <MessageSquareText size={26} />
                  <h3>
                    {needsVerification
                      ? "Let’s prepare this case for chat"
                      : "Could not load the evidence"}
                  </h3>
                  <p>
                    {needsVerification
                      ? "A saved, up-to-date check is needed to answer from evidence. Prepare it here, then continue your question. This does not contact OpenAI."
                      : error}
                  </p>
                  {needsVerification && (
                    <button
                      className="button primary"
                      disabled={verifying}
                      onClick={() => void verifyCase()}
                    >
                      {verifying
                        ? "Verifying documents…"
                        : "Prepare case & continue chat"}
                    </button>
                  )}
                  {!needsVerification && (
                    <button
                      className="button secondary"
                      onClick={() => {
                        setLoaded(null);
                        setLoadSequence((n) => n + 1);
                      }}
                    >
                      Retry loading evidence
                    </button>
                  )}
                  {error &&
                    needsVerification &&
                    error !== "Case has not been processed yet." && (
                      <p role="alert">{error}</p>
                    )}
                </div>
              )}
              {!result && !error && (
                <p className="assistant-picker" role="status">
                  Loading only this case. No AI request is being made.
                </p>
              )}
              {result && !needsVerification && (
                <>
                  <CaseAssistant
                    key={memoryKey}
                    result={result}
                    initialMemory={
                      pendingQuestion?.id === caseId
                        ? {
                            ...(memories[memoryKey] ?? {
                              reply: null,
                              facts: [],
                              cached: false,
                            }),
                            question: pendingQuestion.text,
                          }
                        : memories[memoryKey]
                    }
                    onMemory={remember}
                    onSource={(name, location) => setSource({ name, location })}
                    onFallback={() =>
                      inspect(result.email.email_id, "resolution")
                    }
                    sourceContent={
                      source && doc ? (
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
                              These text lines are human-confirmed
                              transcription, not original machine-readable text.
                              Inspect the original image.
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
                      ) : null
                    }
                  />
                </>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
