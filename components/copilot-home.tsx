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

type AiAnswer = { answer: string; email_ids: string[]; label: string };
export interface CopilotTurn {
  /** Stable id, so a late AI reply can never land on another question. */
  id: string;
  question: string;
  answer: CopilotAnswer;
  ai?: AiAnswer | { error: string } | "loading";
  /** AI read only the question; `answer` then comes from its checked plan. */
  understood?: { label: string; by: string; instant: CopilotAnswer };
  understanding?: "loading" | { error: string };
  /** The question held a secret: it was removed and never answered. */
  blocked?: boolean;
}
export interface CopilotMemory {
  question: string;
  turns: CopilotTurn[];
  consent: boolean;
  /** Let AI read questions the instant answers do not understand. */
  understand: boolean;
}
export const EMPTY_COPILOT: CopilotMemory = {
  question: "",
  turns: [],
  consent: false,
  understand: true,
};
let turnSequence = 0;
const nextTurnId = () => `turn-${Date.now().toString(36)}-${++turnSequence}`;
type AiStatus = { available: boolean; label: string; understand: boolean };

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
          available: !!data.available,
          label: data.label || "AI",
          understand: !!data.understand,
        }),
      )
      .catch(() => {
        if (!controller.signal.aborted)
          setAi({ available: false, label: "AI", understand: false });
      });
    return () => controller.abort();
  }, []);
  const understandOn = !!ai?.understand && memory.understand !== false;
  const subjects = new Map(
    rows.map(({ row }) => [row.email.email_id, row.email.subject]),
  );
  const scroll = () =>
    requestAnimationFrame(() =>
      latest.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
    );

  const updateTurn = (
    id: string,
    change: (turn: CopilotTurn) => CopilotTurn,
    extra: Partial<CopilotMemory> = {},
  ) =>
    setMemory((previous) => ({
      ...previous,
      ...extra,
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
        ai: undefined,
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
            ai: undefined,
          }
        : turn,
    );
  }
  async function askAi(id: string) {
    const turn = turns.find((item) => item.id === id);
    if (!turn || turn.ai === "loading") return;
    const set = (value: CopilotTurn["ai"]) =>
      updateTurn(id, (item) => ({ ...item, ai: value }), { consent: true });
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
                      <div className="cg-copilot-understood">
                        <Sparkles size={15} aria-hidden="true" />
                        <span>
                          {turn.understood.by} read your question as{" "}
                          <strong>{turn.understood.label}</strong>. Only your
                          question was sent; the answer comes from your saved
                          emails.
                        </span>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => showInstant(turn.id)}
                        >
                          Show instant answer
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
                    {!turn.blocked && (
                      <p className="cg-copilot-source">
                        From your {rows.length} saved emails ·{" "}
                        {turn.understood
                          ? `question read by ${turn.understood.by}, no email sent`
                          : "no AI used"}
                      </p>
                    )}
                    {turn.understanding === "loading" && (
                      <p className="cg-copilot-understanding" role="status">
                        <Loader2 size={16} className="cg-spin" />
                        <span>
                          Reading your question with {ai?.label ?? "AI"}… Only
                          your question is sent.
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
                          <Sparkles size={14} />
                          {turn.answer.intent === "none"
                            ? `Let ${ai?.label ?? "AI"} read the question`
                            : `Not what you meant? Let ${ai?.label ?? "AI"} read the question`}
                        </button>
                      )}
                    {ai?.available &&
                      turn.answer.intent !== "none" &&
                      !turn.ai &&
                      turn.understanding !== "loading" && (
                        <div className="cg-copilot-ai-offer">
                          {!memory.consent && (
                            <p className="cg-small cg-muted">
                              Sends the subjects, senders, statuses and dates of
                              your open emails (no email text or attachments) to{" "}
                              {ai.label}.
                            </p>
                          )}
                          <button
                            type="button"
                            className="cg-btn small"
                            onClick={() => void askAi(turn.id)}
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
                    {turn.ai &&
                      turn.ai !== "loading" &&
                      "answer" in turn.ai && (
                        <div className="cg-copilot-ai">
                          <span className="cg-copilot-ai-label">
                            <Sparkles size={14} /> {turn.ai.label} advice ·
                            checked against your inbox
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
                                  {subjects.get(id) ?? id}{" "}
                                  <ArrowRight size={14} />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                )}
                {index === turns.length - 1 &&
                  !reading &&
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
                ? `Instant answers use only your saved emails. When I do not understand, ${ai.label} reads only your question, never your emails.`
                : "AI question reading is off. Only instant answers are used."}
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
