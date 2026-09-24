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
    <div className={`mismatch-note ${explanation.kind}`}>
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
    <p className="mismatch-triage" role="note">
      <Lightbulb size={15} aria-hidden="true" />
      <span>
        <strong>
          {clerical} likely clerical slip{clerical === 1 ? "" : "s"}
        </strong>{" "}
        (ask the issuer to correct the BL) ·{" "}
        <strong>
          {material} different value{material === 1 ? "" : "s"}
        </strong>{" "}
        (confirm with the shipper first). The strict verdict is unchanged.
      </span>
    </p>
  );
}
