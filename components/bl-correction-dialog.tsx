"use client";
import { ArrowRight, FileText, Pencil, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { blAmendmentSuggestion } from "@/lib/correction-suggestions";
import { revisionSourceUrl } from "@/lib/revision-diff";
import { FIELD_LABELS, type CaseResult, type Field } from "@/lib/types";

/** A proposed issuer amendment is never saved as a fact read from the BL. */
export function BLCorrectionDialog({
  result,
  field,
  onClose,
  onReading,
  onRequest,
}: {
  result: CaseResult;
  field: Field;
  onClose: () => void;
  onReading: () => void;
  onRequest: () => void;
}) {
  const suggestion = blAmendmentSuggestion(result, field);
  const row = result.comparison.find((item) => item.field === field);
  if (!suggestion || !row) return null;
  const siUrl = revisionSourceUrl(result, suggestion.source);
  const blUrl = revisionSourceUrl(result, row.bl.source);
  const label = FIELD_LABELS[field].toLowerCase();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="cg-dialog cg-proposal-dialog"
        aria-describedby="cg-proposal-intro"
      >
        <div className="cg-proposal-head">
          <div>
            <DialogTitle asChild>
              <h2>Correct the {label}</h2>
            </DialogTitle>
            <p id="cg-proposal-intro">
              The draft BL does not match the Shipping Instruction.
            </p>
          </div>
          <button
            type="button"
            className="cg-proposal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="cg-proposal-body">
          <div className="cg-proposal-compare">
            <section
              className="cg-proposal-now"
              aria-label="What the draft BL says now"
            >
              <h3>Draft BL says</h3>
              <p>{suggestion.current}</p>
              {blUrl && (
                <a href={blUrl} target="_blank" rel="noopener noreferrer">
                  <FileText size={14} aria-hidden="true" /> Open draft BL
                </a>
              )}
            </section>
            <span className="cg-proposal-arrow" aria-hidden="true">
              <ArrowRight size={20} />
            </span>
            <section
              className="cg-proposal-should"
              aria-label="What it should say, from the SI"
            >
              <h3>Should be · from the SI</h3>
              <p>{suggestion.value}</p>
              {siUrl && (
                <a href={siUrl} target="_blank" rel="noopener noreferrer">
                  <FileText size={14} aria-hidden="true" /> Open SI ·{" "}
                  {suggestion.evidence}
                </a>
              )}
            </section>
          </div>
          <p className="cg-proposal-check">
            Before you continue, make sure this SI is the latest agreed version.
          </p>
          <div className="cg-proposal-next">
            <button
              type="button"
              className="cg-btn primary"
              onClick={onRequest}
            >
              Write correction email <ArrowRight size={18} />
            </button>
            <p>
              Opens a ready-made email to the sender with every difference
              listed. You can edit it before sending. Nothing is sent or changed
              yet.
            </p>
          </div>
        </div>
        <div className="cg-proposal-foot">
          <span>Does the draft BL already show the right value?</span>
          <button type="button" className="cg-link-button" onClick={onReading}>
            <Pencil size={14} aria-hidden="true" /> CargoGuard misread it — fix
            the reading
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
