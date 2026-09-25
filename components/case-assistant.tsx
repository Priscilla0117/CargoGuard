"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ShieldCheck,
  ArrowUpRight,
  Send,
  Sparkles,
  RotateCcw,
} from "lucide-react";
import { requestJson } from "@/lib/client-api";
import { sensitiveFindings, sensitiveMessage } from "@/lib/assistant-privacy";
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

interface Allowance {
  limits: {
    workspaceDailyCalls: number;
    globalDailyCalls: number;
    globalLifetimeCalls: number;
  };
  budget: {
    workspaceRemaining: number;
    dailyRemaining: number;
    lifetimeRemaining: number;
    dailyTokensRemaining: number;
    lifetimeTokensRemaining: number;
    resetsAt: string;
  };
}
interface Preview extends Allowance {
  requestHash: string;
  packet: unknown;
  facts: AssistantFact[];
  enabled: boolean;
  model: string;
  availability: {
    allowed: boolean;
    cached: boolean;
    reservedTokens: number;
    reason: string | null;
  };
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
export interface AssistantMemory {
  question: string;
  reply: AssistantReply | null;
  facts: AssistantFact[];
  cached: boolean;
}
export function CaseAssistant({
  result,
  onSource,
  onFallback,
  initialMemory,
  onMemory,
  sourceContent,
}: {
  result: CaseResult;
  onSource: (name: string, location: string) => void;
  onFallback: () => void;
  initialMemory?: AssistantMemory;
  onMemory?: (memory: AssistantMemory) => void;
  sourceContent?: ReactNode;
}) {
  const [question, setQuestion] = useState(initialMemory?.question ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reply, setReply] = useState<AssistantReply | null>(
    initialMemory?.reply ?? null,
  );
  const [facts, setFacts] = useState<AssistantFact[]>(
    initialMemory?.facts ?? [],
  );
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"" | "preview" | "ask">("");
  const [error, setError] = useState("");
  const [cached, setCached] = useState(initialMemory?.cached ?? false);
  const [allowance, setAllowance] = useState<Allowance | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    requestJson<Allowance>("/api/assistant", { signal: abort.signal })
      .then((value) => {
        if (!abort.signal.aborted) setAllowance(value);
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    onMemory?.({ question, reply, facts, cached });
  }, [question, reply, facts, cached, onMemory]);
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const answerHeading = useRef<HTMLHeadingElement>(null);
  const consentHeading = useRef<HTMLHeadingElement>(null);
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
    if (
      busy ||
      (action === "ask" &&
        (!consent || !preview?.enabled || !preview.availability.allowed))
    )
      return;
    // Typed secrets never leave the browser, not even for a preview.
    const secrets = sensitiveFindings(question);
    if (secrets.length) {
      setError(sensitiveMessage(secrets));
      setConsent(false);
      return;
    }
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
        setAllowance(response);
        setConsent(false);
        requestAnimationFrame(() => consentHeading.current?.focus());
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
      <div className="assistant-chat-scroll">
        <p className="assistant-case-subject">{result.email.subject}</p>
        {sourceContent}
        {!reply && !preview && (
          <div className="assistant-intro">
            <h4>Ready to talk about this shipment.</h4>
            <p>
              Ask below, or try a starting point. I’ll use this case’s saved
              evidence.
            </p>
          </div>
        )}
        {!reply && !preview && (
          <div
            className="assistant-starters"
            aria-label="Suggested AI questions"
          >
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
        )}
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
                                  <EvidenceFact
                                    fact={fact}
                                    onSource={onSource}
                                  />
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
              {reply.model} · Last answer {(reply.latency_ms / 1000).toFixed(1)}
              s{cached ? " · Cached, no new AI call" : ""}. Check sources before
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
        {preview && (
          <section
            className="assistant-consent"
            aria-label="AI sharing consent"
          >
            <h4 ref={consentHeading} tabIndex={-1}>
              One check before sending
            </h4>
            <div
              className={`assistant-capacity ${preview.availability.allowed ? "available" : "unavailable"}`}
              role="status"
            >
              <strong>
                {preview.availability.cached
                  ? "Saved answer available · no new AI request"
                  : preview.availability.allowed
                    ? "This question fits the current allowance"
                    : "AI allowance is not available for this question"}
              </strong>
              <p>
                {preview.availability.reason ??
                  (preview.availability.cached
                    ? "A valid answer is already cached in this workspace. It will be checked again when you continue."
                    : `${preview.availability.reservedTokens.toLocaleString()} token units will be reserved. This is a conservative safety bound, not actual billed usage. Capacity is checked again when sending.`)}
              </p>
              {!preview.availability.allowed && (
                <button className="text-button" onClick={onFallback}>
                  Continue with Evidence Navigator
                </button>
              )}
            </div>
            <p>
              OpenAI will receive your question, this case’s selected evidence
              and earlier turns. Check the exact data below; excerpts may
              contain sensitive information.
            </p>
            <details>
              <summary>
                View the exact case data and conversation to be sent
              </summary>
              <p>
                Model: {preview.model}. Email headers/body, document filenames,
                other cases and credentials are not automatically included. Your
                own question and selected excerpts may still include sensitive
                data.
              </p>
              <pre className="assistant-payload">
                {JSON.stringify(preview.packet, null, 2)}
              </pre>
            </details>
            <label className="assistant-check">
              <input
                type="checkbox"
                checked={consent}
                disabled={
                  !!busy || !preview.enabled || !preview.availability.allowed
                }
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>
                I am authorized to share this preview with OpenAI. I’ll check
                the answer against the evidence.
              </span>
            </label>
            {!preview.enabled && (
              <p role="status">
                Cloud AI is not configured. Use Resolution for guidance without
                an AI request.
              </p>
            )}
            <button
              type="button"
              className="button primary"
              disabled={
                !consent ||
                !preview.enabled ||
                !preview.availability.allowed ||
                !!busy
              }
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
        <details className="assistant-footer">
          <summary>Privacy, AI limits & how this works</summary>
          <p>
            {allowance
              ? `Shared with document recovery: ${allowance.limits.workspaceDailyCalls} requests per workspace per UTC day, ${allowance.limits.globalDailyCalls} across the demo per day, ${allowance.limits.globalLifetimeCalls} lifetime. At the last check: ${allowance.budget.workspaceRemaining} workspace requests, ${allowance.budget.dailyRemaining} shared daily requests, ${allowance.budget.dailyTokensRemaining.toLocaleString()} daily token units and ${allowance.budget.lifetimeRemaining} lifetime requests remained. Daily reset: ${new Date(allowance.budget.resetsAt).toLocaleString()}. `
              : "A shared, server-enforced AI allowance applies. "}
            Token and concurrency limits can stop requests earlier. Failed
            requests count too. Availability is checked again when sending.
            Judges do not need an API key.
          </p>
          <p>
            Conversation cache is workspace-scoped and accessible for 30
            minutes; expired records are cleaned up on a later chat write. New
            conversation clears this view, not the server cache. OpenAI requests
            use store=false; this is not a promise of zero provider retention.
          </p>
          <button className="text-button" onClick={onFallback}>
            Prefer no AI? Use Evidence Navigator <ArrowUpRight size={14} />
          </button>
        </details>
      </div>
      <div className="assistant-composer-dock">
        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void submit("preview");
          }}
        >
          <label htmlFor="assistant-question">
            {reply ? "Ask a follow-up" : "Your question"}
          </label>
          <textarea
            id="assistant-question"
            value={question}
            maxLength={800}
            rows={2}
            disabled={!!busy || (reply?.turns.length ?? 0) >= 3}
            onChange={(event) => editQuestion(event.target.value)}
            placeholder="What should I check in this shipment?"
            aria-describedby="assistant-input-note"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (
                  question.trim().length >= 3 &&
                  (reply?.turns.length ?? 0) < 3
                )
                  void submit("preview");
              }
            }}
          />
          <div className="assistant-compose-footer">
            <small id="assistant-input-note">
              {question.length}/800 · No secrets, please.
            </small>
            <button
              className="button primary"
              type="submit"
              disabled={
                !!busy ||
                question.trim().length < 3 ||
                (reply?.turns.length ?? 0) >= 3
              }
            >
              {busy === "preview" ? "Preparing…" : "Review & send"}
              <Send size={14} />
            </button>
          </div>
        </form>
        <p className="assistant-dock-note">
          <ShieldCheck size={13} />
          AI can be wrong. Check evidence. Nothing is approved or emailed.
        </p>
      </div>
    </section>
  );
}
