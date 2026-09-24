"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileCheck2,
  FilePenLine,
  Mail,
  ShieldCheck,
} from "lucide-react";
import {
  amendmentResolution,
  amendmentResolutionBrief,
} from "@/lib/amendment-resolution";
import type { Shipment } from "@/lib/shipments";
import { FIELD_LABELS, type CaseResult } from "@/lib/types";
import styles from "./amendment-resolution.module.css";

type ResolutionRow = ReturnType<typeof amendmentResolution>["rows"][number];
type Props = {
  shipment: Shipment;
  cases: CaseResult[];
  busy: boolean;
  canReview: boolean;
  act: (payload: Record<string, unknown>) => Promise<boolean | undefined>;
  onDocuments: () => void;
  onTasks: () => void;
};

const stateLabels: Record<
  ReturnType<typeof amendmentResolution>["state"],
  string
> = {
  awaiting_selection: "Choose the source documents",
  awaiting_decisions: "Instruction review needed",
  awaiting_revised_si: "Revised SI needed",
  ready_to_reconcile: "Ready to record revised SI",
  needs_correction: "Document correction needed",
  needs_review: "Review needed",
  ready_for_signoff: "Ready for reviewer sign-off",
  completed: "Document check completed",
};

const rowLabels: Record<ResolutionRow["state"], string> = {
  proposed: "Awaiting approval",
  incorporated: "Recorded in revised SI",
  aligned: "Already supported by SI",
  reconcile: "Ready to record",
  blocked: "Needs attention",
};

function display(value: string | null | undefined) {
  return value?.trim() || "Not available";
}

function ReconciliationForm({
  row,
  comparison,
  busy,
  canReview,
  act,
}: {
  row: ResolutionRow;
  comparison: CaseResult;
  busy: boolean;
  canReview: boolean;
  act: Props["act"];
}) {
  const [reason, setReason] = useState("");
  const [inspected, setInspected] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!inspected || busy || !canReview || !row.can_reconcile) return;
    const saved = await act({
      action: "reconcile_amendment",
      amendment_id: row.amendment_id,
      case_id: comparison.email.email_id,
      case_version: comparison.version,
      reason,
    });
    if (saved) {
      setReason("");
      setInspected(false);
    }
  }
  return (
    <form className={styles.reconcileForm} onSubmit={submit}>
      <label className={styles.confirmation}>
        <input
          type="checkbox"
          checked={inspected}
          onChange={(event) => setInspected(event.target.checked)}
          required
          disabled={busy || !canReview}
        />
        <span>
          I inspected the revised SI and confirmed this approved change.
        </span>
      </label>
      <label>
        Evidence review note
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          minLength={5}
          maxLength={600}
          required
          disabled={busy || !canReview}
          placeholder="Explain how the revised SI implements the instruction"
        />
      </label>
      <button
        className={styles.primaryButton}
        disabled={busy || !canReview || !inspected || reason.trim().length < 5}
        type="submit"
      >
        <ClipboardCheck size={16} aria-hidden="true" />
        Record in revised SI
      </button>
      {!canReview && (
        <p className={styles.helper}>
          A reviewer or administrator must record this decision.
        </p>
      )}
    </form>
  );
}

export function AmendmentResolution({
  shipment,
  cases,
  busy,
  canReview,
  act,
  onDocuments,
  onTasks,
}: Props) {
  const model = amendmentResolution(shipment, cases);
  const comparison = cases.find(
    (result) => result.email.email_id === model.comparison_case_id,
  );
  const recorded = model.rows.filter(
    (row) => row.state === "incorporated" || row.state === "aligned",
  ).length;
  const approved = model.rows.filter((row) => row.state !== "proposed").length;
  const pending = model.rows.filter((row) => row.state === "proposed").length;
  const otherIssues = model.issues.filter(
    (issue) => !model.rows.some((row) => row.field === issue.field),
  );
  const existingRequest = shipment.tasks.find(
    (task) => task.kind === "revised_si" && task.state !== "done",
  );
  const allRecorded = approved > 0 && recorded === approved && pending === 0;
  const needsRevisedSi = model.rows.some((row) => row.state === "blocked");
  const ready =
    model.state === "ready_for_signoff" || model.state === "completed";

  function downloadBrief() {
    const content = amendmentResolutionBrief(
      shipment,
      cases,
      new Date().toISOString(),
    );
    const url = URL.createObjectURL(
      new Blob([content], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `cargoguard-amendment-brief-${shipment.id}-v${shipment.version}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section
      className={styles.panel}
      aria-labelledby="amendment-resolution-heading"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>FOLLOW THE CHANGE THROUGH</p>
          <h3 id="amendment-resolution-heading">Amendment resolution</h3>
          <p>
            Trace the instruction into a revised SI, then check the whole BL.
          </p>
        </div>
        <button
          type="button"
          className={styles.downloadButton}
          onClick={downloadBrief}
        >
          <Download size={16} aria-hidden="true" />
          Evidence brief
        </button>
      </header>

      <ol className={styles.journey} aria-label="Amendment resolution stages">
        <li data-complete={approved > 0 && pending === 0}>
          <span className={styles.stepIcon}>
            <Mail size={18} aria-hidden="true" />
          </span>
          <div>
            <strong>1. Approve the instruction</strong>
            <span>
              {approved} approved · {pending} awaiting decision
            </span>
          </div>
        </li>
        <li data-complete={allRecorded}>
          <span className={styles.stepIcon}>
            <FilePenLine size={18} aria-hidden="true" />
          </span>
          <div>
            <strong>2. Confirm the SI evidence</strong>
            <span>
              {recorded} of {approved} approved changes supported
            </span>
          </div>
        </li>
        <li data-complete={model.matched_fields === 7 && !model.issues.length}>
          <span className={styles.stepIcon}>
            <FileCheck2 size={18} aria-hidden="true" />
          </span>
          <div>
            <strong>3. Check the whole BL</strong>
            <span>
              {model.matched_fields} of 7 fields match the selected SI
            </span>
          </div>
        </li>
      </ol>

      <div
        className={`${styles.statusCard} ${ready ? styles.ready : ""}`}
        role="status"
      >
        <div className={styles.statusHeading}>
          <span className={styles.statusLabel}>{stateLabels[model.state]}</span>
          <span>
            {model.open_tasks} open {model.open_tasks === 1 ? "task" : "tasks"}
          </span>
        </div>
        <h4>{model.headline}</h4>
        <p>{model.next_action}</p>
        <div className={styles.actions}>
          {existingRequest ? (
            <button type="button" onClick={onTasks}>
              Open revised-SI request{" "}
              <ArrowRight size={15} aria-hidden="true" />
            </button>
          ) : comparison && approved > recorded && needsRevisedSi ? (
            <button
              type="button"
              disabled={busy || !model.can_request_revised_si}
              onClick={async () => {
                if (
                  await act({
                    action: "task",
                    kind: "revised_si",
                    case_id: comparison.email.email_id,
                    case_version: comparison.version,
                  })
                )
                  onTasks();
              }}
            >
              <Mail size={15} aria-hidden="true" /> Draft revised-SI request
            </button>
          ) : null}
          <button type="button" onClick={onDocuments}>
            {comparison ? "Review linked documents" : "Select a comparison"}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
          {model.open_tasks > 0 && !existingRequest && (
            <button type="button" onClick={onTasks}>
              Review open tasks
            </button>
          )}
        </div>
        {comparison &&
          approved > recorded &&
          needsRevisedSi &&
          !existingRequest && (
            <p className={styles.helper}>
              {model.request_blocker ??
                "The request is saved as an editable desk draft. Creating it does not send an email."}
            </p>
          )}
      </div>

      <div className={styles.sourcePair}>
        <div>
          <span>Selected SI</span>
          <strong>{display(model.si_name)}</strong>
        </div>
        <div>
          <span>Selected BL</span>
          <strong>{display(model.bl_name)}</strong>
        </div>
        <div>
          <span>Comparison evidence</span>
          {comparison ? (
            <Link
              href={`/?case=${encodeURIComponent(comparison.email.email_id)}`}
            >
              {comparison.email.email_id} · v{comparison.version}
            </Link>
          ) : (
            <strong>No comparison selected</strong>
          )}
        </div>
      </div>

      {model.rows.length === 0 ? (
        <div className={styles.empty}>
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <strong>No active amendments</strong>
            <p>
              Use the source email below to record a requested change. Approval
              starts its evidence trail.
            </p>
          </div>
        </div>
      ) : (
        <div className={styles.instructions}>
          {model.rows.map((row) => (
            <article key={row.amendment_id} className={styles.instruction}>
              <div className={styles.instructionHeading}>
                <h4>{FIELD_LABELS[row.field]}</h4>
                <span
                  className={`${styles.pill} ${["incorporated", "aligned"].includes(row.state) ? styles.successPill : ""}`}
                >
                  {["incorporated", "aligned"].includes(row.state) && (
                    <CheckCircle2 size={14} aria-hidden="true" />
                  )}
                  {rowLabels[row.state]}
                </span>
              </div>
              <dl className={styles.values}>
                <div>
                  <dt>
                    {row.state === "proposed"
                      ? "Proposed instruction"
                      : "Approved instruction"}
                  </dt>
                  <dd>{display(row.expected_value)}</dd>
                </div>
                <div>
                  <dt>Current SI</dt>
                  <dd>{display(row.si_value)}</dd>
                </div>
                <div>
                  <dt>Current BL</dt>
                  <dd>{display(row.bl_value)}</dd>
                </div>
              </dl>
              <details className={styles.evidence}>
                <summary>Instruction and decision evidence</summary>
                <blockquote>{row.quote}</blockquote>
                <p>
                  <Link href={`/?case=${encodeURIComponent(row.source_case)}`}>
                    {row.source_case} · v{row.source_version}
                  </Link>
                </p>
                {row.incorporation && (
                  <div className={styles.proof}>
                    <strong>
                      {row.state === "incorporated"
                        ? "Current recorded decision"
                        : "Earlier recorded decision — review its current validity"}
                    </strong>
                    <p>
                      {row.incorporation.actor} · {row.incorporation.at}
                    </p>
                    <p>
                      {row.incorporation.case_id} · v
                      {row.incorporation.case_version} ·{" "}
                      {row.incorporation.si_value}
                    </p>
                    <p>{row.incorporation.si_evidence}</p>
                    <p>{row.incorporation.reason}</p>
                  </div>
                )}
              </details>
              {row.reason && <p className={styles.rowReason}>{row.reason}</p>}
              {row.can_reconcile && comparison && (
                <ReconciliationForm
                  key={`${shipment.version}:${row.amendment_id}:${comparison.email.email_id}:${comparison.version}`}
                  row={row}
                  comparison={comparison}
                  busy={busy}
                  canReview={canReview}
                  act={act}
                />
              )}
            </article>
          ))}
        </div>
      )}

      {model.issues.length > 0 && (
        <aside
          className={styles.otherIssues}
          aria-labelledby="amendment-other-issues"
        >
          <h4 id="amendment-other-issues">Remaining SI–BL differences</h4>
          <p>
            {model.issues.length}{" "}
            {model.issues.length === 1
              ? "field still needs"
              : "fields still need"}{" "}
            attention in the current comparison.
            {model.rows.length > 0 &&
              " Recording an instruction in the SI does not clear a BL discrepancy."}
            {model.rows.length > 0 &&
              otherIssues.length > 0 &&
              ` ${otherIssues.length} ${otherIssues.length === 1 ? "is" : "are"} outside the requested changes.`}
          </p>
          <ul>
            {model.issues.map((issue) => (
              <li key={issue.field}>
                <strong>{FIELD_LABELS[issue.field]}</strong>
                {model.rows.length > 0 &&
                  !model.rows.some((row) => row.field === issue.field) && (
                    <small className={styles.outsideChange}>
                      Outside requested changes
                    </small>
                  )}
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </aside>
      )}
      {model.blockers.length > 0 && (
        <details className={styles.blockers}>
          <summary>
            All sign-off requirements · {model.blockers.length} unresolved
          </summary>
          <ul>
            {model.blockers.map((blocker, index) => (
              <li key={`${index}:${blocker}`}>{blocker}</li>
            ))}
          </ul>
        </details>
      )}
      <p className={styles.footer}>
        Each decision is tied to its source revision. A source change requires a
        fresh check. Document-check completion never authorizes cargo release.
      </p>
    </section>
  );
}
