import {
  ArrowRight,
  CheckCircle2,
  FlaskConical,
  TriangleAlert,
} from "lucide-react";
import { FIELD_LABELS, type CaseResult } from "@/lib/types";
import type { FieldCorrection, previewCorrection } from "@/lib/corrections";

export function CorrectionPreview({
  previous,
  edit,
  preview,
}: {
  previous: CaseResult;
  edit: FieldCorrection;
  preview: ReturnType<typeof previewCorrection>;
}) {
  const fixed = preview.changes.filter(
    (c) => c.before !== "match" && c.after === "match",
  ).length;
  const introduced = preview.changes.filter(
    (c) => c.before === "match" && c.after !== "match",
  ).length;
  const remaining = preview.changes.filter((c) => c.after !== "match").length;
  return (
    <section
      className="correction-preview"
      aria-label="Correction impact preview"
      aria-live="polite"
    >
      <div className="preview-heading">
        <FlaskConical size={18} />
        <div>
          <h3>Before you save</h3>
          <p>All seven checks, recalculated. Nothing saved yet.</p>
        </div>
        <span className="preview-badge">PREVIEW</span>
      </div>
      {preview.error ? (
        <p className="preview-invalid">
          <TriangleAlert size={16} />
          {preview.error}
        </p>
      ) : (
        <>
          <div className="preview-metrics">
            <span>
              <b>{fixed}</b> resolved
            </span>
            <span className={introduced ? "risk" : ""}>
              <b>{introduced}</b> new problems
            </span>
            <span>
              <b>{remaining}</b> still need attention
            </span>
          </div>
          <div className="preview-checks">
            {preview.changes.map((change) => (
              <div
                key={change.field}
                className={change.changed ? "changed" : ""}
              >
                <span>
                  {FIELD_LABELS[change.field]}
                  {change.field !== edit.field && change.changed && (
                    <small>Linked field changed</small>
                  )}
                </span>
                <span className={`check-${change.before}`}>
                  {change.before}
                </span>
                <ArrowRight size={12} />
                <strong className={`check-${change.after}`}>
                  {change.after === "match" && <CheckCircle2 size={12} />}
                  {change.after}
                </strong>
              </div>
            ))}
          </div>
          <p className="preview-verdict">
            Case: {previous.status.replaceAll("_", " ")}{" "}
            <ArrowRight size={13} />{" "}
            <strong>{preview.result?.status.replaceAll("_", " ")}</strong>
          </p>
        </>
      )}
      <p className="preview-safety">
        {edit.side === "si"
          ? "You are changing the SI reference value. Confirm the source carefully. "
          : ""}
        This changes extracted data only—not the original file or shipment
        approval.
      </p>
    </section>
  );
}
