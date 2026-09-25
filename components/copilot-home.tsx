"use client";
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  CircleHelp,
  Copy,
  FileText,
  Lightbulb,
  Loader2,
  Paperclip,
  PenLine,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import {
  copilotAnswer,
  copilotStarterGroups,
  type CopilotAnswer,
  type Planned,
} from "@/lib/copilot";
import { requestJson } from "@/lib/client-api";
import { draftReply, suggestedIntent } from "@/lib/reply";
import { FIELD_LABELS, type CaseResult, type Field } from "@/lib/types";

type AiAnswer = { answer: string; email_ids: string[]; label: string };
export interface CopilotTurn {
  question: string;
  answer: CopilotAnswer;
  ai?: AiAnswer | { error: string } | "loading";
}
export interface CopilotMemory {
  question: string;
  turns: CopilotTurn[];
  consent: boolean;
}
export const EMPTY_COPILOT: CopilotMemory = {
  question: "",
  turns: [],
  consent: false,
};

export function CopilotHome({
  rows,
  now,
  visible,
  workspaceReady,
  memory,
  setMemory,
  onOpen,
  onAttach,
}: {
  rows: Planned[];
  now: number;
  visible: boolean;
  workspaceReady: boolean;
  memory: CopilotMemory;
  setMemory: Dispatch<SetStateAction<CopilotMemory>>;
  /** Open an email; `tab` is "reply", "documents" or the comparison. */
  onOpen: (id: string, tab?: string) => void;
  onAttach: (question: string) => void;
}) {
  const { question, turns } = memory;
  const latest = useRef<HTMLDivElement>(null);
  const [ai, setAi] = useState<{ available: boolean; label: string } | null>(
    null,
  );
  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ available: boolean; label: string }>("/api/copilot", {
      signal: controller.signal,
    })
      .then((data) => setAi(data))
      .catch(() => {
        if (!controller.signal.aborted)
          setAi({ available: false, label: "AI" });
      });
    return () => controller.abort();
  }, []);
  const subjects = new Map(
    rows.map(({ row }) => [row.email.email_id, row.email.subject]),
  );
  const scroll = () =>
    requestAnimationFrame(() =>
      latest.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );

  function ask(text: string) {
    if (text.trim().length < 2) return;
    const answer = copilotAnswer(text, rows, now);
    setMemory((previous) => ({
      ...previous,
      question: "",
      turns: [...previous.turns.slice(-9), { question: text, answer }],
    }));
    scroll();
  }
  async function askAi(index: number) {
    const turn = turns[index];
    if (!turn || turn.ai === "loading") return;
    const set = (value: CopilotTurn["ai"]) =>
      setMemory((previous) => ({
        ...previous,
        consent: true,
        turns: previous.turns.map((item, i) =>
          i === index ? { ...item, ai: value } : item,
        ),
      }));
    set("loading");
    scroll();
    try {
      const data = await requestJson<AiAnswer>("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: turn.question, consent: true }),
      });
      set(data);
    } catch (failure) {
      set({
        error:
          failure instanceof Error
            ? failure.message
            : "AI answers are unavailable right now.",
      });
    }
    scroll();
  }

  return (
    <section
      className="assistant-home cg-copilot"
      hidden={!visible}
      aria-label="Ask CargoGuard"
    >
      <div className="assistant-chat-scroll">
        {!turns.length && (
          <div className="cg-copilot-welcome">
            <div className="cg-copilot-icon">
              <ShieldCheck size={28} />
            </div>
            <h3>How can I help at the desk?</h3>
            <p>
              Plan your day, find an order, see what the SI and BL say, get a
              correction email ready, write a handover or ask what a shipping
              term means. Every answer comes from your emails and documents.
            </p>
            <div className="cg-copilot-groups">
              {copilotStarterGroups(rows).map((group) => (
                <div key={group.label} className="cg-copilot-group">
                  <span>{group.label}</span>
                  <div className="cg-copilot-chips">
                    {group.items.map((text) => (
                      <button
                        key={text}
                        type="button"
                        onClick={() => ask(text)}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div aria-live="polite" aria-relevant="additions">
          {turns.map((turn, index) => (
            <article className="cg-copilot-turn" key={index}>
              <p className="cg-copilot-question">{turn.question}</p>
              <div className="cg-copilot-answer">
                <h4>{turn.answer.title}</h4>
                <p>{turn.answer.text}</p>
                {turn.answer.tip && (
                  <p className="cg-copilot-tip">
                    <Lightbulb size={16} aria-hidden="true" />
                    <span>{turn.answer.tip}</span>
                  </p>
                )}
                {turn.answer.fetch && (
                  <FetchedAnswer request={turn.answer.fetch} onOpen={onOpen} />
                )}
                {turn.answer.copy && <CopyBlock text={turn.answer.copy} />}
                {turn.answer.facts.length > 0 && (
                  <dl className="cg-copilot-facts">
                    {turn.answer.facts.map((fact) => (
                      <div key={fact.label}>
                        <dt>{fact.label}</dt>
                        <dd>{fact.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {turn.answer.items.length > 0 && (
                  <ol className="cg-copilot-items">
                    {turn.answer.items.map((item) => (
                      <li key={item.id} className="cg-copilot-item">
                        <button
                          type="button"
                          title={item.deadline ?? undefined}
                          onClick={() => onOpen(item.id)}
                        >
                          <span className={`cg-dot ${item.level}`} />
                          <span className="cg-copilot-item-text">
                            <strong>{item.subject}</strong>
                            <span>
                              <b className={`cg-tone-text ${item.tone}`}>
                                {item.status}
                              </b>
                              {item.deadline && !item.deadline_in_why
                                ? ` · ${item.deadline}`
                                : ""}
                              {item.why ? ` · ${item.why}` : ""}
                            </span>
                          </span>
                          <span className="cg-copilot-open">
                            Open <ArrowRight size={16} />
                          </span>
                        </button>
                        {item.actions.length > 0 && (
                          <span className="cg-copilot-actions">
                            {item.actions.includes("reply") && (
                              <button
                                type="button"
                                onClick={() => onOpen(item.id, "reply")}
                              >
                                <PenLine size={14} /> Write reply
                              </button>
                            )}
                            {item.actions.includes("documents") && (
                              <button
                                type="button"
                                onClick={() => onOpen(item.id, "documents")}
                              >
                                <FileText size={14} /> Documents
                              </button>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {turn.answer.more > 0 && (
                  <p className="cg-small cg-muted">
                    …and {turn.answer.more} more in the inbox.
                  </p>
                )}
                <p className="cg-copilot-source">
                  From your {rows.length} saved emails · no AI used
                </p>
                {ai?.available && turn.answer.intent !== "none" && !turn.ai && (
                  <div className="cg-copilot-ai-offer">
                    {!memory.consent && (
                      <p className="cg-small cg-muted">
                        Sends the subjects, senders, statuses and dates of your
                        open emails (no email text or attachments) to {ai.label}
                        .
                      </p>
                    )}
                    <button
                      type="button"
                      className="cg-btn small"
                      onClick={() => void askAi(index)}
                    >
                      <Sparkles size={16} /> Ask {ai.label} for advice
                    </button>
                  </div>
                )}
                {turn.ai === "loading" && (
                  <p className="cg-copilot-ai">
                    <Loader2 size={16} className="cg-spin" /> Asking{" "}
                    {ai?.label ?? "AI"}…
                  </p>
                )}
                {turn.ai && turn.ai !== "loading" && "error" in turn.ai && (
                  <p className="cg-copilot-ai error" role="alert">
                    {turn.ai.error}
                  </p>
                )}
                {turn.ai && turn.ai !== "loading" && "answer" in turn.ai && (
                  <div className="cg-copilot-ai">
                    <span className="cg-copilot-ai-label">
                      <Sparkles size={14} /> {turn.ai.label} advice · checked
                      against your inbox
                    </span>
                    <p>{turn.ai.answer}</p>
                    {turn.ai.email_ids.length > 0 && (
                      <div className="cg-copilot-ai-links">
                        {turn.ai.email_ids.map((id) => (
                          <button
                            key={id}
                            type="button"
                            className="cg-btn small"
                            onClick={() => onOpen(id)}
                          >
                            {subjects.get(id) ?? id} <ArrowRight size={14} />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {index === turns.length - 1 &&
                turn.answer.suggestions.length > 0 && (
                  <div className="cg-copilot-next">
                    <span>You can also ask</span>
                    <div className="cg-copilot-chips">
                      {turn.answer.suggestions.map((text) => (
                        <button
                          key={text}
                          type="button"
                          onClick={() => ask(text)}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
            </article>
          ))}
          <div ref={latest} />
        </div>
      </div>
      <div className="assistant-composer-dock">
        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            ask(question);
          }}
        >
          <label htmlFor="copilot-question">Your question</label>
          <textarea
            id="copilot-question"
            rows={2}
            value={question}
            maxLength={800}
            placeholder="For example: what does the SI say for 5RFR-36541? · write my handover · what is VGM?"
            onChange={(event) =>
              setMemory((previous) => ({
                ...previous,
                question: event.target.value,
              }))
            }
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                ask(question);
              }
            }}
          />
          <div className="assistant-compose-footer">
            {turns.length > 0 && (
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  setMemory((previous) => ({ ...previous, turns: [] }))
                }
                title="Start a new conversation"
              >
                <RotateCcw size={16} />
                New chat
              </button>
            )}
            <button
              type="button"
              className="text-button"
              disabled={!workspaceReady}
              onClick={() => onAttach(question)}
              title="Ask detailed questions about one shipment's documents"
            >
              <Paperclip size={16} />
              Ask about one shipment
            </button>
            <button
              type="submit"
              className="cg-btn primary"
              disabled={question.trim().length < 2}
            >
              Ask <ArrowUp size={16} />
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="cg-copilot-copy">
      <pre>{text}</pre>
      <button
        type="button"
        className="cg-btn small"
        onClick={() => {
          navigator.clipboard
            .writeText(text)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            })
            .catch(() => setCopied(false));
        }}
      >
        {copied ? <CheckCircle2 size={15} /> : <Copy size={15} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function readName() {
  try {
    return (
      localStorage.getItem("cg-signature") ||
      localStorage.getItem("cg-reviewer-name") ||
      ""
    );
  } catch {
    return "";
  }
}
function place(evidence: string) {
  return evidence
    .replace(/^Reviewer confirmed; original source: /, "")
    .replace(/,?\s*y\s*=\s*[\d.]+/gi, "")
    .trim();
}
const WORDS = { match: "Matches", mismatch: "Different", uncertain: "Check" };

/** Loads one email's saved check to show SI/BL values or a ready reply. */
function FetchedAnswer({
  request,
  onOpen,
}: {
  request: NonNullable<CopilotAnswer["fetch"]>;
  onOpen: (id: string, tab?: string) => void;
}) {
  const [state, setState] = useState<{
    result?: CaseResult;
    error?: string;
  }>({});
  useEffect(() => {
    const controller = new AbortController();
    requestJson<{ result: CaseResult }>(
      `/api/cases?id=${encodeURIComponent(request.id)}`,
      { signal: controller.signal, cache: "no-store" },
    )
      .then((data) => setState({ result: data.result }))
      .catch((failure) => {
        if (!controller.signal.aborted)
          setState({
            error:
              failure instanceof Error
                ? failure.message
                : "The email could not be loaded.",
          });
      });
    return () => controller.abort();
  }, [request.id]);
  if (state.error)
    return (
      <p className="cg-copilot-ai error" role="alert">
        {state.error}
      </p>
    );
  if (!state.result)
    return (
      <p className="cg-copilot-loading">
        <Loader2 size={16} className="cg-spin" /> Reading the saved documents…
      </p>
    );
  const result = state.result;
  if (request.mode === "reply") {
    const draft = draftReply(result, {
      intent: suggestedIntent(result),
      tone: "formal",
      signature: readName(),
    });
    const text = `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`;
    return (
      <div className="cg-copilot-reply">
        <CopyBlock text={text} />
        <button
          type="button"
          className="cg-btn primary small"
          onClick={() => onOpen(result.email.email_id, "reply")}
        >
          <PenLine size={15} /> Open in the reply editor
        </button>
      </div>
    );
  }
  const rank = { mismatch: 0, uncertain: 1, match: 2 };
  const rows = result.comparison
    .filter((row) => request.fields.includes(row.field as Field))
    .sort((a, b) => rank[a.result] - rank[b.result]);
  if (!rows.length)
    return (
      <p className="cg-copilot-ai error">
        No SI and draft BL values are saved for this email yet.
      </p>
    );
  return (
    <div className="cg-copilot-values">
      <div className="cg-copilot-values-head" aria-hidden="true">
        <span>Detail</span>
        <span>Shipping Instruction</span>
        <span>Draft BL</span>
      </div>
      {rows.map((row) => (
        <div key={row.field} className={`cg-copilot-value ${row.result}`}>
          <span className="cg-copilot-value-name">
            <strong>{FIELD_LABELS[row.field]}</strong>
            <b className={`cg-fix-pill ${row.result} strong`}>
              {row.result === "match" ? (
                <CheckCircle2 size={12} />
              ) : row.result === "mismatch" ? (
                <TriangleAlert size={12} />
              ) : (
                <CircleHelp size={12} />
              )}
              {WORDS[row.result]}
            </b>
          </span>
          {(["si", "bl"] as const).map((side) => (
            <span key={side} className="cg-copilot-value-cell">
              <em className="cg-sr">
                {side === "si" ? "Shipping Instruction" : "Draft BL"}:
              </em>
              {row[side].raw || "Not found"}
              {row[side].evidence && (
                <small>
                  {side === "si" ? "SI" : "BL"} · {place(row[side].evidence)}
                </small>
              )}
            </span>
          ))}
        </div>
      ))}
      <button
        type="button"
        className="cg-btn small"
        onClick={() => onOpen(result.email.email_id)}
      >
        Open the SI vs BL check <ArrowRight size={15} />
      </button>
    </div>
  );
}
