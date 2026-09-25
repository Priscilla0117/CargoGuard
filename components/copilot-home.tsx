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
  CalendarClock,
  Check,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  ListChecks,
  X,
  CircleHelp,
  Copy,
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
import {
  redactSensitive,
  sensitiveFindings,
  sensitiveMessage,
} from "@/lib/assistant-privacy";
import {
  checkedPlan,
  planLabel,
  PlanRejected,
  type QuestionPlan,
} from "@/lib/question-plan";
import { answerPlan } from "@/lib/question-plan-run";
import { draftReply, suggestedIntent } from "@/lib/reply";
import { FIELD_LABELS, type CaseResult, type Field } from "@/lib/types";

export interface CopilotTurn {
  /** Stable id, so a late AI reply can never land on another question. */
  id: string;
  question: string;
  answer: CopilotAnswer;
  /** AI read only the question; `answer` then comes from its checked plan. */
  understood?: { label: string; by: string; instant: CopilotAnswer };
  understanding?: "loading" | { error: string };
  /** The question held a secret: it was removed and never answered. */
  blocked?: boolean;
}
export interface CopilotMemory {
  question: string;
  turns: CopilotTurn[];
  /** Let AI read questions the instant answers do not understand. */
  understand: boolean;
}
export const EMPTY_COPILOT: CopilotMemory = {
  question: "",
  turns: [],
  understand: true,
};
/** Four clear starting points; the order check uses a real order number. */
function starters(rows: Planned[]) {
  const lookup = copilotStarterGroups(rows)
    .flatMap((group) => group.items)
    .find((text) => /^What do the SI and BL say for /.test(text));
  const order = lookup?.match(/for (.+)\?$/)?.[1];
  return [
    {
      text: "What should I do first today?",
      label: "What should I do first?",
      Icon: ListChecks,
    },
    {
      text: "What is due this week?",
      label: "What is due this week?",
      Icon: CalendarClock,
    },
    order
      ? { text: lookup!, label: `Check order ${order}`, Icon: FileSearch }
      : {
          text: "Which documents do not match?",
          label: "Which documents do not match?",
          Icon: FileSearch,
        },
    {
      text: "Write my end-of-day handover",
      label: "Write my handover",
      Icon: ClipboardList,
    },
  ];
}
const STEP_WORDS: Record<
  NonNullable<CopilotAnswer["steps"]>[number]["state"],
  string
> = {
  done: "done",
  active: "in progress",
  problem: "needs fixing",
  waiting: "waiting",
  none: "not started",
};
let turnSequence = 0;
const nextTurnId = () => `turn-${Date.now().toString(36)}-${++turnSequence}`;
type AiStatus = { label: string; understand: boolean };

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
  const [ai, setAi] = useState<AiStatus | null>(null);
  // An AI plan is run on the emails loaded when it arrives, not when asked.
  const current = useRef({ rows, now });
  useEffect(() => {
    current.current = { rows, now };
  }, [rows, now]);
  const lastTurn = useRef<string | undefined>(undefined);
  useEffect(() => {
    lastTurn.current = turns.at(-1)?.id;
  }, [turns]);
  useEffect(() => {
    const controller = new AbortController();
    requestJson<Partial<AiStatus>>("/api/copilot", {
      signal: controller.signal,
    })
      .then((data) =>
        setAi({
          label: data.label || "AI",
          understand: !!data.understand,
        }),
      )
      .catch(() => {
        if (!controller.signal.aborted)
          setAi({ label: "AI", understand: false });
      });
    return () => controller.abort();
  }, []);
  const understandOn = !!ai?.understand && memory.understand !== false;
  const scroll = () =>
    requestAnimationFrame(() =>
      latest.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );

  const updateTurn = (id: string, change: (turn: CopilotTurn) => CopilotTurn) =>
    setMemory((previous) => ({
      ...previous,
      turns: previous.turns.map((item) =>
        item.id === id ? change(item) : item,
      ),
    }));

  function ask(text: string) {
    if (text.trim().length < 2) return;
    const id = nextTurnId();
    const secrets = sensitiveFindings(text);
    if (secrets.length) {
      // The secret is neither answered, sent nor kept in the conversation.
      const blocked: CopilotAnswer = {
        intent: "none",
        title: "Removed for your safety",
        text: sensitiveMessage(secrets),
        items: [],
        more: 0,
        facts: [],
        suggestions: [],
      };
      setMemory((previous) => ({
        ...previous,
        question: "",
        turns: [
          ...previous.turns.slice(-9),
          {
            id,
            question: redactSensitive(text),
            answer: blocked,
            blocked: true,
          },
        ],
      }));
      scroll();
      return;
    }
    const answer = copilotAnswer(text, rows, now);
    const readWithAi =
      answer.intent === "none" && rows.length > 0 && understandOn;
    setMemory((previous) => ({
      ...previous,
      question: "",
      turns: [
        ...previous.turns.slice(-9),
        {
          id,
          question: text,
          answer,
          ...(readWithAi ? { understanding: "loading" as const } : {}),
        },
      ],
    }));
    scroll();
    if (readWithAi) void understand(id, text);
  }
  async function understand(id: string, text: string) {
    updateTurn(id, (turn) => ({ ...turn, understanding: "loading" }));
    scroll();
    try {
      const data = await requestJson<{ plan: QuestionPlan; label: string }>(
        "/api/copilot/understand",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text }),
        },
      );
      // Checked again here: only a valid plan grounded in the question runs.
      const plan = checkedPlan(JSON.stringify(data.plan), text);
      const answer = answerPlan(
        plan,
        current.current.rows,
        current.current.now,
      );
      updateTurn(id, (turn) => ({
        ...turn,
        answer,
        understanding: undefined,
        understood: {
          label: planLabel(plan),
          by: data.label || "AI",
          instant: turn.understood?.instant ?? turn.answer,
        },
      }));
      // Show the start of the new answer, unless the user has moved on.
      if (lastTurn.current === id)
        requestAnimationFrame(() =>
          document
            .getElementById(id)
            ?.scrollIntoView({ block: "start", behavior: "smooth" }),
        );
    } catch (failure) {
      updateTurn(id, (turn) => ({
        ...turn,
        understanding: {
          error:
            failure instanceof PlanRejected
              ? `${failure.message} It was not used; the instant answer is shown instead.`
              : failure instanceof Error
                ? failure.message
                : "AI question reading is unavailable right now.",
        },
      }));
      if (lastTurn.current === id) scroll();
    }
  }
  function showInstant(id: string) {
    updateTurn(id, (turn) =>
      turn.understood
        ? {
            ...turn,
            answer: turn.understood.instant,
            understood: undefined,
            understanding: undefined,
          }
        : turn,
    );
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
            <h3>What do you need?</h3>
            <p>Ask in your own words, or start with one of these.</p>
            <div className="cg-copilot-starters">
              {starters(rows).map(({ text, label, Icon }) => (
                <button key={text} type="button" onClick={() => ask(text)}>
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div aria-live="polite" aria-relevant="additions">
          {turns.map((turn, index) => {
            // While AI reads a question the instant answers did not
            // understand, show that instead of "I am not sure what you mean".
            const reading =
              turn.understanding === "loading" &&
              !turn.understood &&
              turn.answer.intent === "none";
            return (
              <article className="cg-copilot-turn" key={turn.id} id={turn.id}>
                <p className="cg-copilot-question">{turn.question}</p>
                {reading ? (
                  <div className="cg-copilot-answer">
                    <p className="cg-copilot-understanding" role="status">
                      <Loader2 size={16} className="cg-spin" />
                      <span>
                        Reading your question with {ai?.label ?? "AI"}… Only
                        your question is sent, never your emails.
                      </span>
                    </p>
                  </div>
                ) : (
                  <div className="cg-copilot-answer">
                    {turn.understood && (
                      <div
                        className="cg-copilot-understood"
                        title="Only your question was sent to AI. The answer comes from your saved emails."
                      >
                        <Sparkles size={14} aria-hidden="true" />
                        <span>
                          Read by {turn.understood.by} as{" "}
                          <strong>{turn.understood.label}</strong>
                          <span className="cg-sr">
                            . Only your question was sent; the answer comes from
                            your saved emails.
                          </span>
                        </span>
                        <button
                          type="button"
                          className="cg-link-button"
                          onClick={() => showInstant(turn.id)}
                        >
                          Undo
                        </button>
                      </div>
                    )}
                    <h4>{turn.answer.title}</h4>
                    <p>{turn.answer.text}</p>
                    {turn.answer.tip && (
                      <p className="cg-copilot-tip">
                        <Lightbulb size={16} aria-hidden="true" />
                        <span>{turn.answer.tip}</span>
                      </p>
                    )}
                    {turn.answer.fetch && (
                      <FetchedAnswer
                        request={turn.answer.fetch}
                        onOpen={onOpen}
                      />
                    )}
                    {turn.answer.copy && <CopyBlock text={turn.answer.copy} />}
                    {turn.answer.steps && turn.answer.steps.length > 0 && (
                      <ol
                        className="cg-copilot-steps"
                        aria-label="Order progress"
                      >
                        {turn.answer.steps.map((step) => (
                          <li key={step.label} className={step.state}>
                            {step.state === "done" ? (
                              <Check size={13} aria-hidden="true" />
                            ) : step.state === "problem" ? (
                              <X size={13} aria-hidden="true" />
                            ) : (
                              <span
                                className="cg-step-dot"
                                aria-hidden="true"
                              />
                            )}
                            <span>{step.label}</span>
                            <span className="cg-sr">
                              {" "}
                              ({STEP_WORDS[step.state]})
                            </span>
                          </li>
                        ))}
                      </ol>
                    )}
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
                                Open <ArrowRight size={15} />
                              </span>
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                    {turn.answer.more > 0 && (
                      <p className="cg-copilot-more">
                        +{turn.answer.more} more in the inbox
                      </p>
                    )}
                    {!turn.blocked && (
                      <p className="cg-copilot-source">
                        <ShieldCheck size={13} aria-hidden="true" />
                        From your {rows.length} saved emails
                      </p>
                    )}
                    {turn.understanding === "loading" && (
                      <p className="cg-copilot-understanding" role="status">
                        <Loader2 size={16} className="cg-spin" />
                        <span>
                          Reading your question with {ai?.label ?? "AI"}…
                        </span>
                      </p>
                    )}
                    {turn.understanding && turn.understanding !== "loading" && (
                      <p className="cg-copilot-understood error" role="status">
                        <span>{turn.understanding.error}</span>
                        {understandOn && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              void understand(turn.id, turn.question)
                            }
                          >
                            Try again
                          </button>
                        )}
                      </p>
                    )}
                    {understandOn &&
                      !turn.understood &&
                      !turn.understanding &&
                      !turn.blocked &&
                      rows.length > 0 && (
                        <button
                          type="button"
                          className="text-button cg-copilot-reread"
                          onClick={() =>
                            void understand(turn.id, turn.question)
                          }
                        >
                          <Sparkles size={14} aria-hidden="true" />
                          {turn.answer.intent === "none"
                            ? `Try with ${ai?.label ?? "AI"}`
                            : `Not what you meant? Try with ${ai?.label ?? "AI"}`}
                        </button>
                      )}
                  </div>
                )}
                {index === turns.length - 1 &&
                  !reading &&
                  !turn.blocked &&
                  (turn.answer.intent === "none" ||
                    turn.answer.intent === "help") &&
                  turn.answer.suggestions.length > 0 && (
                    <div className="cg-copilot-next">
                      <span>Try</span>
                      <div className="cg-copilot-chips">
                        {turn.answer.suggestions.slice(0, 3).map((text) => (
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
            );
          })}
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
          <label htmlFor="copilot-question" className="cg-sr">
            Your question
          </label>
          <textarea
            id="copilot-question"
            rows={2}
            value={question}
            maxLength={800}
            placeholder="Ask about an order, a PO, due dates or a shipping term…"
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
              onClick={() =>
                // A typed secret is never carried into a shipment chat.
                sensitiveFindings(question).length
                  ? ask(question)
                  : onAttach(question)
              }
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
        {ai?.understand && (
          <p className="cg-copilot-privacy">
            <ShieldCheck size={14} aria-hidden="true" />
            <span>
              {understandOn
                ? `If I don't understand, ${ai.label} reads only your question, never your emails.`
                : "AI help is off. Only instant answers are used."}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                setMemory((previous) => ({
                  ...previous,
                  understand: !understandOn,
                }))
              }
            >
              {understandOn ? "Turn off" : "Turn on"}
            </button>
          </p>
        )}
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
