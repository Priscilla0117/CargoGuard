"use client";
import { useEffect, useRef, useState } from "react";
import {
  MessageSquareText,
  ShieldCheck,
  ArrowUpRight,
  Send,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { requestJson } from "@/lib/client-api";
import type { CaseResult } from "@/lib/types";
import type { AssistantFact, AssistantReply } from "@/lib/assistant";
import {
  assistantDisplayText,
  assistantFieldDisplay,
  relatedAssistantFacts,
} from "@/lib/assistant-display";

function EvidenceFact({
  fact,
  onSource,
}: {
  fact: AssistantFact;
  onSource: (name: string, location: string) => void;
}) {
  const field = assistantFieldDisplay(fact);
  return (
    <div className="assistant-fact">
      <strong>{fact.label}</strong>
      {field ? (
        <>
          <p className="assistant-value">{field.value || "No saved value"}</p>
          <small>
            Saved extraction · {field.method}
            {field.issue ? ` · ${field.issue}` : ""}
          </small>
          {!!field.excerpts.length && (
            <>
              <span className="assistant-excerpt-label">
                Selected original excerpt
              </span>
              {field.excerpts.map((line, index) => (
                <blockquote key={index}>{line}</blockquote>
              ))}
            </>
          )}
          <small>{field.provenance}</small>
        </>
      ) : (
        <pre>{fact.text}</pre>
      )}
      {fact.source && (
        <button
          className="text-button"
          onClick={() => onSource(fact.source!.name, fact.source!.location)}
        >
          Open source evidence <ArrowUpRight size={14} />
        </button>
      )}
    </div>
  );
}

interface Preview {
  requestHash: string;
  packet: unknown;
  facts: AssistantFact[];
  enabled: boolean;
  model: string;
}
const starters = [
  {
    label: "Explain the findings",
    question:
      "Explain the findings in this case in simple English. Which evidence should I check?",
  },
  {
    label: "What is blocking handoff?",
    question: "What prevents handoff of this case, and what should I do next?",
  },
  {
    label: "Draft a correction request",
    question:
      "Draft a polite correction request using only supported differences. Clearly flag missing or uncertain evidence.",
  },
  {
    label: "Prepare a handover",
    question:
      "Give the next reviewer a short handover: current result, unresolved issues and next steps. Do not claim approval.",
  },
];
export function CaseAssistant({
  result,
  onSource,
  onFallback,
}: {
  result: CaseResult;
  onSource: (name: string, location: string) => void;
  onFallback: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const [facts, setFacts] = useState<AssistantFact[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"" | "preview" | "ask">("");
  const [error, setError] = useState("");
  const [cached, setCached] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  useEffect(
    () => () => {
      sequence.current++;
      controller.current?.abort();
    },
    [],
  );
  function editQuestion(text: string) {
    setQuestion(text);
    setPreview(null);
    setConsent(false);
    setError("");
  }
  async function submit(action: "preview" | "ask") {
    if (busy || (action === "ask" && (!consent || !preview?.enabled))) return;
    controller.current?.abort();
    controller.current = new AbortController();
    const current = ++sequence.current;
    setBusy(action);
    setError("");
    const body = {
      action,
      id: result.email.email_id,
      version: result.version,
      question,
      parentId: reply?.id ?? null,
      ...(action === "ask"
        ? {
            requestHash: preview!.requestHash,
            externalProcessingConfirmed: true,
          }
        : {}),
    };
    try {
      if (action === "preview") {
        const response = await requestJson<Preview>("/api/assistant", {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          signal: controller.current.signal,
        });
        if (current !== sequence.current) return;
        setPreview(response);
        setConsent(false);
      } else {
        const response = await requestJson<{
          reply: AssistantReply;
          facts: AssistantFact[];
          cached: boolean;
        }>("/api/assistant", {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          signal: controller.current.signal,
        });
        if (current !== sequence.current) return;
        setReply(response.reply);
        setFacts(response.facts);
        setCached(response.cached);
        setQuestion("");
        setPreview(null);
        setConsent(false);
        requestAnimationFrame(() => answerHeading.current?.focus());
      }
    } catch (failure) {
      if (current === sequence.current) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Request failed. No case decision changed.",
        );
        setConsent(false);
      }
    } finally {
      if (current === sequence.current) setBusy("");
    }
  }
  return (
    <section className="case-assistant" aria-label="Ask CargoGuard">
      <header className="assistant-hero">
        <div className="assistant-mark">
          <MessageSquareText size={24} />
        </div>
        <div>
          <span className="eyebrow">YOUR CASE, EXPLAINED</span>
          <h3>Ask CargoGuard</h3>
          <p>A second pair of eyes. Your evidence stays in control.</p>
        </div>
        <span className="assistant-badge">Optional cloud AI</span>
      </header>
      <div className="assistant-boundary">
        <ShieldCheck size={19} />
        <div>
          <strong>
            Saved result: {result.status} · Revision {result.version}
          </strong>
          <p>
            AI explains; it cannot change this result, send emails or approve
            release. Citations link to supplied evidence, but do not guarantee
            the answer is correct.
          </p>
        </div>
      </div>
      {!reply && (
        <div className="assistant-intro">
          <h4>Where would you like a hand?</h4>
          <p>
            Understand a discrepancy, plan the next step, or prepare a draft for
            human review.
          </p>
        </div>
      )}
      <div className="assistant-starters" aria-label="Suggested AI questions">
        {starters.map((starter) => (
          <button
            key={starter.label}
            disabled={!!busy}
            onClick={() => editQuestion(starter.question)}
          >
            <Sparkles size={14} />
            {starter.label}
            <ArrowUpRight size={14} />
          </button>
        ))}
      </div>
      {reply && (
        <div className="assistant-conversation">
          <h4 ref={answerHeading} tabIndex={-1}>
            Case conversation <span>{reply.turns.length} / 3 turns</span>
          </h4>
          {reply.turns.map((turn, i) => (
            <article className="assistant-turn" key={i}>
              <div className="assistant-question">
                <span>You asked</span>
                <p>{turn.question}</p>
              </div>
              <div className="assistant-answer">
                <span className="assistant-answer-label">
                  CargoGuard · {turn.answer.scope.replaceAll("_", " ")}
                </span>
                {turn.answer.blocks.map((block, j) => (
                  <div className={`assistant-block ${block.kind}`} key={j}>
                    {block.kind === "draft" && (
                      <strong className="assistant-draft-label">
                        DRAFT ONLY · Nothing has been sent
                      </strong>
                    )}
                    {block.kind === "next_step" && (
                      <strong className="assistant-step-label">
                        Suggested next step
                      </strong>
                    )}
                    <p>{assistantDisplayText(block.text, block.citations)}</p>
                    {!!block.citations.length && (
                      <details className="assistant-citations">
                        <summary>
                          Inspect {block.citations.length} evidence reference
                          {block.citations.length !== 1 ? "s" : ""}
                        </summary>
                        {block.citations.map((id) => {
                          const fact = facts.find((item) => item.id === id);
                          return (
                            fact && (
                              <div key={id}>
                                <EvidenceFact fact={fact} onSource={onSource} />
                                {!!relatedAssistantFacts(fact, facts)
                                  .length && (
                                  <div className="assistant-related">
                                    <span>Related saved field evidence</span>
                                    {relatedAssistantFacts(fact, facts).map(
                                      (related) => (
                                        <EvidenceFact
                                          key={related.id}
                                          fact={related}
                                          onSource={onSource}
                                        />
                                      ),
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          );
                        })}
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </article>
          ))}
          <p className="assistant-meta">
            {reply.model} · Last answer {(reply.latency_ms / 1000).toFixed(1)}s
            {cached ? " · Cached, no new AI call" : ""}. Check sources before
            using any advice or draft.
          </p>
          <button
            className="text-button"
            disabled={!!busy}
            onClick={() => {
              setReply(null);
              setFacts([]);
              editQuestion("");
            }}
          >
            <RotateCcw size={14} /> Start a new conversation
          </button>
        </div>
      )}
      <form
        className="assistant-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit("preview");
        }}
      >
        <label htmlFor="assistant-question">
          {reply ? "Ask a follow-up about this case" : "Your question"}
        </label>
        <textarea
          id="assistant-question"
          value={question}
          maxLength={800}
          rows={3}
          disabled={!!busy || (reply?.turns.length ?? 0) >= 3}
          onChange={(event) => editQuestion(event.target.value)}
          placeholder="For example: Why is the gross weight different, and who needs to check it?"
          aria-describedby="assistant-input-note"
        />
        <div className="assistant-compose-footer">
          <small id="assistant-input-note">
            {question.length}/800 · Do not enter passwords, API keys or
            confidential data.
          </small>
          <button
            className="button secondary"
            type="submit"
            disabled={
              !!busy ||
              question.trim().length < 3 ||
              (reply?.turns.length ?? 0) >= 3
            }
          >
            {busy === "preview"
              ? "Preparing preview…"
              : "Preview data to share"}
          </button>
        </div>
      </form>
      {preview && (
        <section className="assistant-consent" aria-label="AI sharing consent">
          <h4>Review before sending to OpenAI</h4>
          <p>
            Your question, the selected case facts below and any previous turns
            in this conversation will be sent to {preview.model}. Email
            headers/body, document filenames, other cases and credentials are
            not automatically included. Excerpts and your own question may still
            contain sensitive information.
          </p>
          <details>
            <summary>
              View the exact case data and conversation to be sent
            </summary>
            <pre className="assistant-payload">
              {JSON.stringify(preview.packet, null, 2)}
            </pre>
          </details>
          <label className="assistant-check">
            <input
              type="checkbox"
              checked={consent}
              disabled={!!busy || !preview.enabled}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              I am authorized to share this preview with OpenAI. I will check
              the evidence before using the answer.
            </span>
          </label>
          {!preview.enabled && (
            <p role="status">
              Cloud AI is not configured. Use Resolution for guidance without an
              AI request.
            </p>
          )}
          <button
            type="button"
            className="button primary"
            disabled={!consent || !preview.enabled || !!busy}
            onClick={() => void submit("ask")}
          >
            <Send size={15} />
            {busy === "ask" ? "Reading the evidence…" : "Send to AI"}
          </button>
        </section>
      )}
      <div aria-live="polite" aria-atomic="true">
        {busy === "ask" && (
          <p className="assistant-progress">
            Checking this revision’s evidence. AI has a 25-second provider
            timeout; a cold server can take longer. No automatic retries.
          </p>
        )}
      </div>
      {error && (
        <div className="assistant-error" role="alert">
          <strong>We could not complete that request</strong>
          <p>{error}</p>
          <button className="text-button" onClick={onFallback}>
            Open Resolution guidance
          </button>
        </div>
      )}
      <footer className="assistant-footer">
        <p>
          Shared with document recovery: 3 AI requests per browser workspace per
          UTC day, 20 across the demo per day, 100 total. A shared token
          allowance can stop requests earlier. Failed requests count too. Judges
          do not need an API key.
        </p>
        <p>
          Conversation cache is workspace-scoped and accessible for 30 minutes;
          expired records are cleaned up on a later chat write. New conversation
          clears this view, not the server cache. OpenAI requests use
          store=false; this is not a promise of zero provider retention.
        </p>
        <button className="text-button" onClick={onFallback}>
          Prefer no AI? Use Evidence Navigator <ArrowUpRight size={14} />
        </button>
      </footer>
    </section>
  );
}
