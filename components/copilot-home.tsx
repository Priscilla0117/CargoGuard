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
  Loader2,
  Paperclip,
  Sparkles,
} from "lucide-react";
import {
  COPILOT_STARTERS,
  copilotAnswer,
  type CopilotAnswer,
  type Planned,
} from "@/lib/copilot";
import { requestJson } from "@/lib/client-api";

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
  onOpen: (id: string) => void;
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
              <CalendarClock size={28} />
            </div>
            <h3>Plan your day and find anything</h3>
            <p>
              Ask in your own words — about today&apos;s work, deadlines, an
              order or PO number, a customer, or who you are waiting on. Every
              answer shows the emails it comes from.
            </p>
          </div>
        )}
        <div className="cg-copilot-chips" aria-label="Suggested questions">
          {(turns.length
            ? turns[turns.length - 1].answer.suggestions
            : COPILOT_STARTERS
          ).map((text) => (
            <button key={text} type="button" onClick={() => ask(text)}>
              {text}
            </button>
          ))}
        </div>
        <div aria-live="polite" aria-relevant="additions">
          {turns.map((turn, index) => (
            <article className="cg-copilot-turn" key={index}>
              <p className="cg-copilot-question">{turn.question}</p>
              <div className="cg-copilot-answer">
                <h4>{turn.answer.title}</h4>
                <p>{turn.answer.text}</p>
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
                      <li key={item.id}>
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
            placeholder="For example: what is due this week? or 5RFR-36541"
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
