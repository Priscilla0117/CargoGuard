"use client";
import { useState } from "react";
import {
  Compass,
  ArrowRight,
  FileText,
  Download,
  ShieldCheck,
} from "lucide-react";
import {
  answerCase,
  amendmentDraft,
  GUIDE_QUESTIONS,
  type GuideQuestion,
} from "@/lib/case-guide";
import { FIELD_LABELS, type CaseResult } from "@/lib/types";
import type { ResolutionStep } from "@/lib/resolution";

export function CaseNavigator({
  result,
  onNavigate,
  onSource,
}: {
  result: CaseResult;
  onNavigate: (target: ResolutionStep["target"]) => void;
  onSource: (name: string, location: string) => void;
}) {
  const [question, setQuestion] = useState<GuideQuestion>("next");
  const answer = answerCase(result, question);
  return (
    <section className="case-navigator" aria-label="Evidence Navigator">
      <div className="navigator-heading">
        <Compass size={23} />
        <div>
          <span className="eyebrow">ASK THIS CASE</span>
          <h3>Evidence Navigator</h3>
        </div>
        <span className="navigator-revision">Revision {result.version}</span>
      </div>
      <p className="navigator-disclosure">
        Case-aware guidance, not an LLM chat. Answers use this saved revision
        only. No external AI request.
      </p>
      <div className="navigator-questions" aria-label="Case questions">
        {(Object.entries(GUIDE_QUESTIONS) as [GuideQuestion, string][]).map(
          ([key, label]) => (
            <button
              key={key}
              aria-pressed={question === key}
              className={question === key ? "active" : ""}
              onClick={() => setQuestion(key)}
            >
              {label}
            </button>
          ),
        )}
      </div>
      <div className="navigator-answer" aria-live="polite" aria-atomic="true">
        <h4>{answer.title}</h4>
        {answer.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>
      {!!answer.rows.length && (
        <div className="navigator-evidence">
          {answer.rows.map((row) => (
            <article key={row.field}>
              <h4>
                {FIELD_LABELS[row.field]} <span>{row.result}</span>
              </h4>
              {(["si", "bl"] as const).map((side) => (
                <div key={side}>
                  <b>{side.toUpperCase()}</b>
                  <span>{row[side].raw || "Missing value"}</span>
                  <button
                    className="text-button"
                    disabled={
                      !result.documents.some(
                        (doc) => doc.name === row[side].source,
                      )
                    }
                    onClick={() =>
                      onSource(row[side].source, row[side].evidence)
                    }
                  >
                    <FileText size={13} />{" "}
                    {row[side].evidence || "Inspect source"}
                  </button>
                </div>
              ))}
            </article>
          ))}
        </div>
      )}
      <button className="text-button" onClick={() => onNavigate(answer.target)}>
        Inspect {answer.target === "history" ? "audit trail" : answer.target}{" "}
        <ArrowRight size={15} />
      </button>
    </section>
  );
}

export function AmendmentStudio({ result }: { result: CaseResult }) {
  const draft = amendmentDraft(result);
  const [checked, setChecked] = useState(false);
  function download() {
    if (!checked || !draft.available) return;
    const url = URL.createObjectURL(
      new Blob([draft.text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${result.email.email_id}-r${result.version}-amendment.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="amendment-studio" aria-label="Correction request draft">
      <span className="eyebrow">REQUEST CORRECTION</span>
      <h3>Correction request draft</h3>
      <p>{draft.reason}</p>
      {draft.available && (
        <>
          <div className="amendment-summary">
            <span>
              {draft.differences} supported difference
              {draft.differences === 1 ? "" : "s"}
            </span>
            <span>
              {draft.unresolved
                ? `${draft.unresolved} unresolved field(s) — partial request`
                : "No uncertain fields recorded"}
            </span>
          </div>
          <label className="amendment-preview-label">
            Draft preview
            <textarea
              readOnly
              rows={12}
              value={draft.text}
              aria-label="Amendment draft preview"
            />
          </label>
          <label className="amendment-confirm">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />{" "}
            I checked these values against the source evidence and will review
            the recipient before sharing.
          </label>
          <button
            className="button primary"
            disabled={!checked}
            onClick={download}
          >
            <Download size={16} /> Download reviewed draft
          </button>
        </>
      )}
      <p className="amendment-safety">
        <ShieldCheck size={16} /> No message is sent and no case is changed.
        Replace the issuer’s corrected source documents to verify the result.
      </p>
    </section>
  );
}
