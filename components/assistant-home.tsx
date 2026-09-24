"use client";
import { useRef, type Dispatch, type SetStateAction } from "react";
import { ArrowUp, MessageSquareText, Paperclip } from "lucide-react";
import { assistantHomeReply, type HomeReply } from "@/lib/assistant-home";
import type { CaseSummary } from "@/lib/types";

export interface HomeMemory {
  question: string;
  turns: { question: string; answer: HomeReply }[];
}

export function AssistantHome({
  cases,
  visible,
  onAttach,
  workspaceReady,
  memory,
  setMemory,
}: {
  cases: CaseSummary[];
  visible: boolean;
  workspaceReady: boolean;
  memory: HomeMemory;
  setMemory: Dispatch<SetStateAction<HomeMemory>>;
  onAttach: (question: string, id?: string) => void;
}) {
  const { question, turns } = memory;
  const setQuestion = (question: string) =>
    setMemory((previous) => ({ ...previous, question }));
  const latest = useRef<HTMLDivElement>(null);
  function ask(text: string) {
    if (text.trim().length < 2) return;
    const answer = assistantHomeReply(text, cases, workspaceReady);
    setMemory((previous) => ({
      question: "",
      turns: [...previous.turns.slice(-9), { question: text, answer }],
    }));
    if (answer.kind === "case") onAttach(text, answer.caseId);
    else
      requestAnimationFrame(() =>
        latest.current?.scrollIntoView({ block: "nearest" }),
      );
  }
  return (
    <section
      className="assistant-home"
      hidden={!visible}
      aria-label="Workspace chat"
    >
      <div className="assistant-chat-scroll">
        <div className="assistant-welcome">
          <div className="assistant-welcome-icon">
            <MessageSquareText size={26} />
          </div>
          <h3>What needs your attention?</h3>
          <p>
            Ask about your queue, or attach a case to explore its saved
            evidence.
          </p>
        </div>
        <div
          className="assistant-quick-prompts"
          aria-label="Workspace suggestions"
        >
          {["What needs attention?", "How does checking work?"].map((text) => (
            <button key={text} onClick={() => ask(text)}>
              {text}
              <ArrowUp size={14} />
            </button>
          ))}
        </div>
        <div
          className="assistant-home-conversation"
          aria-live="polite"
          aria-relevant="additions"
        >
          {turns.map((turn, index) => (
            <article className="assistant-turn" key={index}>
              <div className="assistant-question">
                <span>You</span>
                <p>{turn.question}</p>
              </div>
              <div className="assistant-answer">
                <span className="assistant-answer-label">
                  Workspace guide · no AI request
                </span>
                <p className="assistant-guide-text">{turn.answer.text}</p>
                {turn.answer.kind === "choose" && (
                  <button
                    className="button secondary"
                    onClick={() =>
                      onAttach(turn.answer.carryQuestion ? turn.question : "")
                    }
                  >
                    <Paperclip size={15} />
                    Attach a case
                  </button>
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
          <label htmlFor="assistant-home-question">How can I help?</label>
          <textarea
            id="assistant-home-question"
            rows={2}
            value={question}
            maxLength={800}
            placeholder="Ask a question, or mention email_004…"
            onChange={(event) => setQuestion(event.target.value)}
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
            aria-describedby="assistant-home-note"
          />
          <div className="assistant-compose-footer">
            <button
              type="button"
              className="text-button"
              disabled={!workspaceReady}
              onClick={() => onAttach(question)}
            >
              <Paperclip size={15} />
              Attach a case
            </button>
            <button
              type="submit"
              className="button primary"
              disabled={question.trim().length < 2}
            >
              Continue <ArrowUp size={16} />
            </button>
          </div>
        </form>
        <p className="assistant-dock-note" id="assistant-home-note">
          Local guidance here. Case AI uses OpenAI only after consent. Don’t
          enter secrets.
        </p>
      </div>
    </section>
  );
}
