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
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="cg-dialog cg-proposal-dialog"
        aria-describedby="cg-proposal-intro"
      >
        <div className="cg-dialog-head">
          <div>
            <DialogTitle asChild>
              <h2>Review correction to {FIELD_LABELS[field].toLowerCase()}</h2>
            </DialogTitle>
            <p id="cg-proposal-intro">
              The proposed value is filled from the selected Shipping
              Instruction. Check that this is the latest agreed instruction.
            </p>
          </div>
          <button type="button" className="cg-btn" onClick={onClose}>
            <X size={18} /> Cancel
          </button>
        </div>
        <div className="cg-proposal-body">
          <div className="cg-proposal-values">
            <section aria-label="Current draft BL value">
              <h3>Draft BL currently says</h3>
              <p>{suggestion.current}</p>
              {blUrl && (
                <a href={blUrl} target="_blank" rel="noopener noreferrer">
                  <FileText size={15} /> View original BL
                </a>
              )}
            </section>
            <section
              className="cg-proposal-suggested"
              aria-label="Proposed value from the SI"
            >
              <h3>Proposed value · from the SI</h3>
              <p>{suggestion.value}</p>
              {siUrl && (
                <a href={siUrl} target="_blank" rel="noopener noreferrer">
                  <FileText size={15} /> Check SI · {suggestion.evidence}
                </a>
              )}
            </section>
          </div>
          <p>
            The correction request already includes the current and proposed
            values for the known differences. You can review and edit the email
            before sending.
          </p>
          <button type="button" className="cg-btn primary" onClick={onRequest}>
            Review prefilled correction request <ArrowRight size={18} />
          </button>
          <p className="cg-small cg-muted">
            Nothing is sent or changed here. The discrepancy stays open until a
            revised document is received and checked.
          </p>
          <div className="cg-proposal-reading">
            <h3>Does the original BL already show the right value?</h3>
            <p>
              Then the problem may be how CargoGuard read it. Review the source
              reading instead.
            </p>
            <button type="button" className="cg-btn" onClick={onReading}>
              <Pencil size={16} /> Correct a reading error
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
