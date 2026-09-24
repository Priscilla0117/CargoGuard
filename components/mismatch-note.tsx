import { Lightbulb } from "lucide-react";
import type { MismatchExplanation } from "@/lib/mismatch-explainer";
import type { Field } from "@/lib/types";
import "@/app/mismatch-note.css";

const KIND_LABEL = {
  clerical: "Likely clerical slip",
  material: "Different value",
} as const;

/** Plain-language reason for one mismatch. The strict verdict is unchanged. */
export function MismatchNote({
  explanation,
}: {
  explanation: MismatchExplanation;
}) {
  return (
    <div
      className={`mismatch-note ${explanation.kind}`}
      role="note"
      aria-label="Suggested mismatch explanation"
    >
      <Lightbulb size={14} aria-hidden="true" />
      <div>
        <p>
          <span className="mismatch-kind">{KIND_LABEL[explanation.kind]}</span>
          <strong>{explanation.title}</strong>
        </p>
        <small>{explanation.detail}</small>
      </div>
    </div>
  );
}

/** One-line triage of all mismatches: what can be corrected vs what to confirm. */
export function MismatchTriage({
  explanations,
}: {
  explanations: Partial<Record<Field, MismatchExplanation>>;
}) {
  const all = Object.values(explanations);
  if (!all.length) return null;
  const clerical = all.filter((item) => item.kind === "clerical").length;
  const material = all.length - clerical;
  return (
    <aside
      className="mismatch-triage"
      aria-label="Mismatch investigation guide"
    >
      <Lightbulb size={18} aria-hidden="true" />
      <div>
        <div className="mismatch-triage-heading">
          <strong>Where to start the review</strong>
          <span>Comparison verdict unchanged</span>
        </div>
        <ul>
          {clerical > 0 && (
            <li>
              <strong>
                {clerical} possible clerical {clerical === 1 ? "slip" : "slips"}
              </strong>
              <span>
                Check the source before asking the issuer to correct the BL.
              </span>
            </li>
          )}
          {material > 0 && (
            <li>
              <strong>
                {material} different {material === 1 ? "value" : "values"}
              </strong>
              <span>Confirm the intended value with the shipper.</span>
            </li>
          )}
        </ul>
        <p>
          These suggestions describe text patterns; they do not confirm the
          cause or clear a discrepancy.
        </p>
      </div>
    </aside>
  );
}
