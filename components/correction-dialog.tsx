"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  FlaskConical,
  Loader2,
  TriangleAlert,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { previewCorrection } from "@/lib/corrections";
import { evidenceHasLocation } from "@/lib/source-location";
import { revisionSourceUrl } from "@/lib/revision-diff";
import { readingSuggestion } from "@/lib/correction-suggestions";
import {
  FIELD_LABELS,
  type CaseResult,
  type ComparisonRow,
  type Field,
} from "@/lib/types";

export interface FieldEdit {
  field: Field;
  side: "si" | "bl";
  value: string;
}

const RESULT_WORDS: Record<ComparisonRow["result"], string> = {
  match: "Matches",
  mismatch: "Different",
  uncertain: "Please check",
};
const STATUS_WORDS: Record<string, string> = {
  OK: "No mismatch",
  MISMATCH: "Mismatch",
  NEEDS_REVIEW: "Needs review",
};

function ResultPill({
  result,
  strong = false,
}: {
  result: ComparisonRow["result"];
  strong?: boolean;
}) {
  const Icon =
    result === "match"
      ? CheckCircle2
      : result === "mismatch"
        ? TriangleAlert
        : CircleHelp;
  return (
    <span className={`cg-fix-pill ${result} ${strong ? "strong" : ""}`}>
      <Icon size={13} aria-hidden="true" />
      {RESULT_WORDS[result]}
    </span>
  );
}

/**
 * Correct one value CargoGuard read from a document, with the effect on all
 * seven checks shown live before anything is saved.
 */
export function CorrectionDialog({
  result,
  edit,
  reviewerName,
  onReviewerName,
  onCancel,
  onSave,
  onSaveNext,
  onReadingHelp,
}: {
  result: CaseResult;
  edit: FieldEdit;
  reviewerName: string;
  onReviewerName: (name: string) => void;
  onCancel: () => void;
  onReadingHelp?: () => void;
  onSave: (edit: FieldEdit, actor: string, reason: string) => Promise<boolean>;
  /** Save and open the next email in the list (when there is one). */
  onSaveNext?: (
    edit: FieldEdit,
    actor: string,
    reason: string,
  ) => Promise<boolean>;
}) {
  const row = result.comparison.find((r) => r.field === edit.field)!;
  const original = row[edit.side].raw;
  const other = row[edit.side === "si" ? "bl" : "si"].raw;
  const source = result.documents.find(
    (doc) => doc.name === row[edit.side].source,
  );
  const originalUrl = source ? revisionSourceUrl(result, source.name) : null;
  const sourceIndex =
    source?.lines.findIndex((line) =>
      evidenceHasLocation(row[edit.side].evidence, line.location),
    ) ?? -1;
  const sourceLines =
    sourceIndex >= 0
      ? source!.lines.slice(Math.max(0, sourceIndex - 1), sourceIndex + 3)
      : [];
  const [suggestion] = useState(() =>
    readingSuggestion(result, edit.field, edit.side),
  );
  const [value, setValue] = useState(() => suggestion?.value ?? edit.value);
  const [reason, setReason] = useState(() =>
    suggestion
      ? "Restored the suggested field reading from the original source after review."
      : "",
  );
  const [sourceChecked, setSourceChecked] = useState(false);
  const [saving, setSaving] = useState<"" | "save" | "next">("");
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const unchanged = value.trim() === original.trim();
  const preview = useMemo(
    () =>
      unchanged
        ? null
        : previewCorrection(result, {
            field: edit.field,
            side: edit.side,
            value,
          }),
    [result, edit.field, edit.side, value, unchanged],
  );
  const changes = preview?.changes ?? [];
  const fixed = changes.filter(
    (c) => c.before !== "match" && c.after === "match",
  ).length;
  const broken = changes.filter(
    (c) => c.before === "match" && c.after !== "match",
  ).length;
  const remaining = changes.filter((c) => c.after !== "match").length;
  const target = changes.find((c) => c.field === edit.field);
  const name = reviewerName.trim();
  const ready =
    !!preview &&
    !preview.error &&
    !unchanged &&
    name.length >= 2 &&
    reason.trim().length >= 5 &&
    sourceChecked &&
    !saving;
  const label = FIELD_LABELS[edit.field];
  const sideName = edit.side === "si" ? "Shipping Instruction" : "draft BL";

  async function save(next: boolean, event?: FormEvent) {
    event?.preventDefault();
    if (!ready) return;
    setSaving(next ? "next" : "save");
    setError("");
    const change = { field: edit.field, side: edit.side, value: value.trim() };
    const ok = await (next && onSaveNext ? onSaveNext : onSave)(
      change,
      name,
      reason.trim(),
    );
    setSaving("");
    if (!ok)
      setError(
        "The correction was not saved. Check the message above the table and try again.",
      );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby="cg-fix-intro"
        className="cg-dialog cg-fix-dialog"
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey))
            void save(false);
        }}
      >
        <div className="cg-dialog-head">
          <div>
            <DialogTitle asChild>
              <h2>Correct the reading of {label.toLowerCase()}</h2>
            </DialogTitle>
            <p id="cg-fix-intro">
              Enter what the {sideName} actually says. The received file stays
              unchanged. A real document error needs a revised document from its
              owner.
            </p>
          </div>
          <button
            type="button"
            className="cg-btn"
            disabled={!!saving}
            onClick={onCancel}
          >
            <X size={18} /> Cancel
          </button>
        </div>
        <form className="cg-fix-body" onSubmit={(e) => void save(false, e)}>
          <div className="cg-fix-form">
            <div className="cg-fix-compare" aria-label="Values now">
              <div>
                <span>Read from the {sideName} now</span>
                <p>{original || "Not found"}</p>
              </div>
              <div>
                <span>
                  {edit.side === "si" ? "Draft BL" : "Shipping Instruction"}{" "}
                  says
                </span>
                <p>{other || "Not found"}</p>
              </div>
            </div>
            {sourceLines.length > 0 && (
              <details className="cg-reading-source" open>
                <summary>
                  {source?.transcription
                    ? "Human-confirmed transcription"
                    : source?.recovery
                      ? "Human-confirmed recovered text"
                      : "Extracted source text"}{" "}
                  · {source?.name}
                </summary>
                <blockquote>
                  {sourceLines.map((line) => line.text).join("\n")}
                </blockquote>
              </details>
            )}
            {originalUrl && (
              <a
                className="cg-btn"
                href={originalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open original in a new tab
              </a>
            )}
            {suggestion && (
              <p className="cg-notice" role="status">
                A reading from the original {sideName} is filled in below.
                Review it against the source, then confirm and save.
              </p>
            )}
            {!suggestion && onReadingHelp && (
              <p className="cg-small cg-muted">
                No different, supported reading is available from this source
                yet.{" "}
                <button
                  type="button"
                  className="cg-btn small"
                  onClick={onReadingHelp}
                >
                  Review document &amp; reading help
                </button>{" "}
                Use OCR or recovery there when available, or enter what you can
                confirm in the original.
              </p>
            )}
            <label className="cg-field">
              Value shown in the original
              <textarea
                ref={input}
                value={value}
                rows={3}
                maxLength={2000}
                disabled={!!saving}
                onChange={(e) => setValue(e.target.value)}
              />
              <small className="cg-muted">
                {suggestion
                  ? "Review the suggested reading. Edit it only if the original shows something else."
                  : "Enter what the original document shows. The SI's expected value belongs in a correction request when the BL itself is wrong."}
              </small>
            </label>
            <label className="cg-check">
              <input
                type="checkbox"
                checked={sourceChecked}
                onChange={(e) => setSourceChecked(e.target.checked)}
                disabled={!!saving}
              />
              I checked the original. I am correcting a reading error, not
              changing the shipping instructions or BL.
            </label>
            <label className="cg-field">
              Your name
              <input
                value={reviewerName}
                minLength={2}
                maxLength={80}
                placeholder="Shown in History"
                disabled={!!saving}
                onChange={(e) => onReviewerName(e.target.value)}
              />
            </label>
            <label className="cg-field">
              Reason
              <textarea
                value={reason}
                rows={2}
                maxLength={2000}
                placeholder="What did you confirm in the original?"
                disabled={!!saving}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && (
              <p className="cg-notice error" role="alert" style={{ margin: 0 }}>
                <TriangleAlert size={18} />
                <span>{error}</span>
              </p>
            )}
            <div className="cg-fix-actions">
              <button className="cg-btn primary" disabled={!ready}>
                {saving === "save" ? (
                  <Loader2 size={18} className="cg-spin" />
                ) : (
                  <CheckCircle2 size={18} />
                )}
                Save reading &amp; recheck
              </button>
              {onSaveNext && (
                <button
                  type="button"
                  className="cg-btn"
                  disabled={!ready}
                  onClick={() => void save(true)}
                >
                  {saving === "next" && (
                    <Loader2 size={18} className="cg-spin" />
                  )}
                  Save &amp; next email <ArrowRight size={18} />
                </button>
              )}
            </div>
            {!ready && !saving && (
              <p className="cg-small cg-muted" style={{ margin: 0 }}>
                {unchanged
                  ? "Change the value to see its effect and save."
                  : preview?.error
                    ? "This value cannot be used — see the preview."
                    : name.length < 2
                      ? "Enter your name (at least 2 letters)."
                      : reason.trim().length < 5
                        ? "Write a short reason (at least 5 characters)."
                        : !sourceChecked
                          ? "Confirm that you checked the original document."
                          : ""}
              </p>
            )}
          </div>
          <section
            className="cg-fix-preview"
            aria-label="Effect of this correction"
            aria-live="polite"
          >
            <div className="cg-fix-preview-head">
              <FlaskConical size={20} aria-hidden="true" />
              <div>
                <h3>Before you save</h3>
                <p>All seven checks, run again. Nothing is saved yet.</p>
              </div>
              <span className="cg-fix-badge">Preview</span>
            </div>
            {unchanged ? (
              <p className="cg-fix-empty">
                Type the confirmed value on the left. The result of every check
                appears here as you type.
              </p>
            ) : preview?.error ? (
              <p className="cg-fix-invalid" role="alert">
                <TriangleAlert size={18} />
                {preview.error}
              </p>
            ) : (
              <>
                {target && (
                  <div
                    className={`cg-fix-verdict ${target.after === "match" ? "good" : broken ? "bad" : "neutral"}`}
                  >
                    <strong>{label}</strong>
                    <span>
                      <ResultPill result={target.before} />
                      <ArrowRight size={16} aria-hidden="true" />
                      <ResultPill result={target.after} strong />
                    </span>
                  </div>
                )}
                <div className="cg-fix-metrics">
                  <span className={fixed ? "good" : ""}>
                    <b>{fixed}</b> fixed
                  </span>
                  <span className={broken ? "bad" : ""}>
                    <b>{broken}</b> new problem{broken === 1 ? "" : "s"}
                  </span>
                  <span className={remaining ? "warn" : "good"}>
                    <b>{remaining}</b> still need attention
                  </span>
                </div>
                {broken > 0 && (
                  <p className="cg-fix-warning" role="alert">
                    <TriangleAlert size={16} />
                    Careful: this would make {broken} matching detail
                    {broken === 1 ? "" : "s"} different. Check the value again.
                  </p>
                )}
                <ul className="cg-fix-rows">
                  {changes.map((change) => (
                    <li
                      key={change.field}
                      className={`${change.field === edit.field ? "current" : ""} ${change.changed ? "changed" : ""}`}
                    >
                      <span>
                        {FIELD_LABELS[change.field]}
                        {change.field !== edit.field && change.changed && (
                          <small>Changes too</small>
                        )}
                      </span>
                      <ResultPill result={change.before} />
                      <ArrowRight size={14} aria-hidden="true" />
                      <ResultPill result={change.after} strong />
                    </li>
                  ))}
                </ul>
                <p className="cg-fix-case">
                  Document check:{" "}
                  <b>{STATUS_WORDS[result.status] ?? result.status}</b>{" "}
                  <ArrowRight size={14} aria-hidden="true" />{" "}
                  <b
                    className={
                      preview?.result?.status === "OK" ? "good" : "bad"
                    }
                  >
                    {STATUS_WORDS[preview?.result?.status ?? ""] ??
                      preview?.result?.status}
                  </b>
                </p>
              </>
            )}
            <p className="cg-fix-safety">
              {edit.side === "si"
                ? "You are correcting the reading of the SI, not changing your shipping instructions. "
                : "If the draft BL really says something wrong, do not change it here — ask the sender to correct the BL (Reply tab). "}
              This changes what CargoGuard read, never the original file. If
              source evidence cannot support the new value, the case stays in
              Needs review. Use source transcription or request a clearer
              document.
            </p>
          </section>
        </form>
      </DialogContent>
    </Dialog>
  );
}
