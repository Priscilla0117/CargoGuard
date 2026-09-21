"use client";
import { useState } from "react";
import { ArrowRight, FileText, TriangleAlert } from "lucide-react";
import {
  CHANGE_LABELS,
  revisionDiff,
  revisionSourceUrl,
} from "@/lib/revision-diff";
import { FIELD_LABELS, type CaseResult, type ComparisonRow } from "@/lib/types";

function RevisionValue({
  result,
  row,
}: {
  result: CaseResult;
  row?: ComparisonRow;
}) {
  if (!row)
    return (
      <p className="revision-unavailable">
        No field comparison at this revision
      </p>
    );
  return (
    <div className="revision-values">
      {(["si", "bl"] as const).map((side) => {
        const url = revisionSourceUrl(result, row[side].source);
        return (
          <div key={side}>
            <b>{side === "si" ? "SI" : "BL"}</b>
            <span>
              {row[side].raw || "Missing value"}
              {(row[side].issue || row[side].extraction_issue) && (
                <small>{row[side].issue || row[side].extraction_issue}</small>
              )}
              {url && (
                <a href={url} target="_blank" rel="noreferrer">
                  <FileText size={12} />{" "}
                  {row[side].evidence || "Original source"} · v{result.version}
                </a>
              )}
            </span>
          </div>
        );
      })}
      <small className="revision-verdict">Recorded: {row.result}</small>
    </div>
  );
}

export function RevisionComparison({
  before,
  after,
}: {
  before: CaseResult;
  after: CaseResult;
}) {
  const [showAll, setShowAll] = useState(false);
  let diff;
  try {
    diff = revisionDiff(before, after);
  } catch (error) {
    return (
      <p className="alert error" role="alert">
        {(error as Error).message}
      </p>
    );
  }
  const visible = diff.changes.filter(
    (row) => showAll || row.kind !== "unchanged",
  );
  return (
    <section className="revision-comparison" aria-label="Revision comparison">
      <div className="revision-overview">
        <span>
          <strong>{diff.counts.fixed}</strong>{" "}
          {diff.counts.fixed === 1 ? "field now matches" : "fields now match"}
        </span>
        <span className={diff.counts.new_issue ? "has-issue" : ""}>
          <strong>{diff.counts.new_issue}</strong> new{" "}
          {diff.counts.new_issue === 1 ? "issue" : "issues"}
        </span>
        <span className={diff.remaining ? "has-issue" : ""}>
          <strong>{diff.remaining}</strong> unresolved / not compared
        </span>
      </div>
      <p className="revision-current-status">
        Current case: <strong>{after.status}</strong> ·{" "}
        {after.workflow.replaceAll("_", " ")}. This compares saved checks, not
        cargo-release approval.
      </p>
      {(diff.referenceChanged ||
        diff.categoryChanged ||
        diff.engineChanged ||
        diff.policyChanged) && (
        <div className="revision-warning" role="status">
          <TriangleAlert size={18} />
          <div>
            {diff.referenceChanged && (
              <p>
                <strong>SI reference values changed.</strong> A new match is not
                proof that the issuer corrected the BL. Inspect both revisions.
              </p>
            )}
            {diff.categoryChanged && (
              <p>
                Category changed: {before.category} → {after.category}. Removing
                a comparison does not resolve its previous issues.
              </p>
            )}
            {diff.engineChanged && (
              <p>
                Different check engines:{" "}
                {before.pipeline_version ?? "not recorded"} →{" "}
                {after.pipeline_version ?? "not recorded"}.
              </p>
            )}
            {diff.policyChanged && (
              <p>
                Policy changed: v{before.policy?.version ?? "not recorded"} → v
                {after.policy?.version ?? "not recorded"}. The exact verdict is
                shown separately from business tolerances.
              </p>
            )}
          </div>
        </div>
      )}
      <div className="revision-grid-heading">
        <span>Shipment field</span>
        <span>Earlier · v{before.version}</span>
        <span>Current · v{after.version}</span>
      </div>
      {visible.map((change) => (
        <article key={change.field} className={`revision-field ${change.kind}`}>
          <div className="revision-field-label">
            <h4>{FIELD_LABELS[change.field]}</h4>
            <span>{CHANGE_LABELS[change.kind]}</span>
            {change.referenceChanged && <small>SI reference changed</small>}
          </div>
          <RevisionValue result={before} row={change.before} />
          <RevisionValue result={after} row={change.after} />
        </article>
      ))}
      {!visible.length && (
        <p className="revision-empty">
          All seven field values and outcomes are unchanged.
        </p>
      )}
      {diff.counts.unchanged > 0 && (
        <button
          className="text-button"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll
            ? "Hide unchanged matches"
            : `Show ${diff.counts.unchanged} unchanged matching fields`}{" "}
          <ArrowRight size={14} />
        </button>
      )}
      <p className="revision-footnote">
        Human corrections change extracted values, not the original files.
        Source links open the exact saved revision. Nothing is changed by this
        comparison.
      </p>
    </section>
  );
}
