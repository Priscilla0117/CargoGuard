"use client";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  Printer,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  LEVEL_LABELS,
  comparePlanned,
  planText,
  type Level,
  type Plan,
} from "@/lib/priority";
import { rowStatus } from "@/lib/case-status";
import type { CaseSummary } from "@/lib/types";
import { deadlineText } from "./inbox-view";

const SECTIONS: { level: Level; title: string; hint: string }[] = [
  {
    level: "urgent",
    title: "Do first",
    hint: "Deadlines today or tomorrow, or the sender says it is urgent",
  },
  { level: "high", title: "Next", hint: "Problems to fix soon" },
  { level: "normal", title: "Then", hint: "Normal work" },
  { level: "low", title: "When you have time", hint: "Nothing is pressing" },
];

export function PlanDialog({
  open,
  onClose,
  rows,
  now,
  onOpenCase,
}: {
  open: boolean;
  onClose: () => void;
  rows: { row: CaseSummary; plan: Plan }[];
  now: number;
  onOpenCase: (id: string, order: string[]) => void;
}) {
  const [copied, setCopied] = useState(false);
  const todo = useMemo(
    () =>
      rows
        .filter(({ plan }) => plan.bucket === "todo")
        .sort((a, b) => comparePlanned(a, b, "priority")),
    [rows],
  );
  const waiting = rows.filter(({ plan }) => plan.bucket === "waiting");
  const order = todo.map(({ row }) => row.email.email_id);
  const text = () => planText(rows, new Date(now));
  async function copy() {
    try {
      await navigator.clipboard.writeText(text());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob([text()], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "cargoguard-todays-plan.txt";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  let number = 0;
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="cg-dialog cg-plan-dialog cg-print-area"
      >
        <div className="cg-dialog-head">
          <div>
            <DialogTitle asChild>
              <h2>Today&apos;s plan</h2>
            </DialogTitle>
            <p>
              {new Date(now).toLocaleDateString([], {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}{" "}
              · {todo.length} to do · {waiting.length} waiting for a reply
            </p>
          </div>
          <button
            className="cg-icon-btn cg-no-print"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={22} />
          </button>
        </div>
        <div className="cg-dialog-body">
          {!todo.length && (
            <div className="cg-empty">
              <CheckCircle2 size={30} color="var(--cg-green)" />
              <h3>Nothing to do right now</h3>
              <p>New emails will appear in your plan automatically.</p>
            </div>
          )}
          {SECTIONS.map((section) => {
            const items = todo.filter(
              ({ plan }) => plan.level === section.level,
            );
            if (!items.length) return null;
            const shown = items.slice(0, 15);
            return (
              <section
                key={section.level}
                className={`cg-plan-section ${section.level}`}
              >
                <h3>
                  <span className={`cg-dot ${section.level}`} />
                  {section.title}
                  <span className="cg-plan-count">{items.length}</span>
                </h3>
                <p className="cg-small cg-muted">{section.hint}</p>
                <ol className="cg-plan-list">
                  {shown.map(({ row, plan }) => {
                    number++;
                    const deadline = deadlineText(plan, now);
                    return (
                      <li key={row.email.email_id}>
                        <span className="cg-plan-number">{number}</span>
                        <div>
                          <strong>{row.email.subject}</strong>
                          <span>
                            {rowStatus(row).text} ·{" "}
                            {plan.reasons.slice(0, 3).join(" · ") ||
                              LEVEL_LABELS[plan.level]}
                          </span>
                        </div>
                        {deadline && (
                          <span
                            className={`cg-deadline ${deadline.late ? "late" : ""}`}
                          >
                            {deadline.text}
                          </span>
                        )}
                        <button
                          className="cg-btn small cg-no-print"
                          onClick={() => {
                            onClose();
                            onOpenCase(row.email.email_id, order);
                          }}
                        >
                          Open <ArrowRight size={16} />
                        </button>
                      </li>
                    );
                  })}
                </ol>
                {items.length > shown.length && (
                  <p className="cg-small cg-muted">
                    …and {items.length - shown.length} more in the inbox.
                  </p>
                )}
              </section>
            );
          })}
          {waiting.length > 0 && (
            <section className="cg-plan-section waiting">
              <h3>
                Waiting for a reply
                <span className="cg-plan-count">{waiting.length}</span>
              </h3>
              <ul className="cg-plan-list">
                {waiting.slice(0, 10).map(({ row }) => (
                  <li key={row.email.email_id}>
                    <span className="cg-plan-number">·</span>
                    <div>
                      <strong>{row.email.subject}</strong>
                      <span>No action until they answer</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="cg-small cg-muted">
            Order is based on deadlines written in the emails, urgent words, the
            kind of problem, follow-ups and how long each email has waited.
          </p>
        </div>
        <div className="cg-dialog-foot cg-no-print">
          <button className="cg-btn" onClick={() => void copy()}>
            {copied ? <CheckCircle2 size={18} /> : <Copy size={18} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="cg-btn" onClick={download}>
            <Download size={18} /> Download
          </button>
          <button className="cg-btn primary" onClick={() => window.print()}>
            <Printer size={18} /> Print
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
