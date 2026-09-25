"use client";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  FileText,
  Loader2,
  Pencil,
  TriangleAlert,
  UserCheck,
} from "lucide-react";
import { previewCorrection } from "@/lib/corrections";
import { FIELD_RISK } from "@/lib/field-risk";
import {
  FIELD_LABELS,
  type CaseResult,
  type ComparisonRow,
  type Field,
} from "@/lib/types";

type Side = "si" | "bl";
export interface FieldEdit {
  field: Field;
  side: Side;
  value: string;
}

const tokenize = (value: string) =>
  value.split(/(\s+|[,;:/()\-.])/).filter((part) => part !== "");
const key = (token: string) => token.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Mark the words in `value` that do not appear in `other`. */
export function highlightDifferences(value: string, other: string) {
  const counts = new Map<string, number>();
  for (const token of tokenize(other)) {
    const k = key(token);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return tokenize(value).map((token) => {
    const k = key(token);
    if (!k) return { text: token, changed: false };
    const left = counts.get(k) ?? 0;
    if (left > 0) {
      counts.set(k, left - 1);
      return { text: token, changed: false };
    }
    return { text: token, changed: true };
  });
}

/** One-line excerpt around the first difference, for summaries. */
export function DiffSnippet({
  value,
  other,
}: {
  value: string;
  other: string;
}) {
  const flat = (text: string) => text.replace(/\s*\n\s*/g, ", ").trim();
  const parts = highlightDifferences(flat(value), flat(other));
  if (!parts.length) return <em>(empty)</em>;
  const first = parts.findIndex((part) => part.changed);
  const total = parts.reduce((n, part) => n + part.text.length, 0);
  let from = 0,
    to = parts.length;
  if (total > 60 && first >= 0) {
    from = Math.max(0, first - 6);
    to = Math.min(parts.length, first + 10);
    // Start and end on whole words ("P.O. BOX", not ".O. BOX").
    while (from > 0 && !/^[\s,;]+$/.test(parts[from - 1].text)) from--;
    while (to < parts.length && !/^[\s,;]+$/.test(parts[to].text)) to++;
  } else if (total > 60) to = Math.min(parts.length, 16);
  return (
    <>
      {from > 0 && "… "}
      {parts
        .slice(from, to)
        .map((part, index) =>
          part.changed ? <mark key={index}>{part.text}</mark> : part.text,
        )}
      {to < parts.length && " …"}
    </>
  );
}

function HighlightedValue({ value, other }: { value: string; other: string }) {
  const parts = highlightDifferences(value, other);
  // When nothing overlaps, highlighting every word adds noise: show plain text.
  if (parts.every((part) => part.changed || !key(part.text)))
    return <>{value}</>;
  return (
    <>
      {parts.map((part, index) =>
        part.changed ? <mark key={index}>{part.text}</mark> : part.text,
      )}
    </>
  );
}

/** "Page 1, y=692" -> "Page 1": coordinates stay in the tooltip. */
function plainEvidence(evidence: string) {
  const text = evidence
    .replace(/^Reviewer confirmed; original source: /, "")
    .replace(/,?\s*y\s*=\s*[\d.]+/gi, "")
    .trim();
  return text ? `See in document · ${text}` : "See in document";
}

const RESULT_TEXT: Record<ComparisonRow["result"], string> = {
  match: "Matches",
  mismatch: "Different",
  uncertain: "Please check",
};
const ORDER: Record<ComparisonRow["result"], number> = {
  mismatch: 0,
  uncertain: 1,
  match: 2,
};

export function CompareTable({
  result,
  reviewerName,
  canEdit,
  onSave,
  onSource,
  onReviewerName,
}: {
  result: CaseResult;
  reviewerName: string;
  canEdit: boolean;
  onSave: (edit: FieldEdit, actor: string, reason: string) => Promise<boolean>;
  onSource: (source: string, location: string) => void;
  onReviewerName: (name: string) => void;
}) {
  const [editing, setEditing] = useState<FieldEdit | null>(null);
  const [reason, setReason] = useState("Checked against the original document");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string>("");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );
  // Problems first, but keep the order stable while the employee works so a
  // corrected row stays where they are looking (and is highlighted).
  const [order] = useState(() =>
    [...result.comparison]
      .sort(
        (a, b) =>
          ORDER[a.result] - ORDER[b.result] ||
          Object.keys(FIELD_LABELS).indexOf(a.field) -
            Object.keys(FIELD_LABELS).indexOf(b.field),
      )
      .map((row) => row.field),
  );
  // Details that already matched when the case opened are folded away so the
  // eye goes to the problems. Rows fixed during this visit stay visible.
  const [initiallyMatching] = useState(
    () =>
      new Set(
        result.comparison
          .filter((row) => row.result === "match")
          .map((row) => row.field),
      ),
  );
  const [showMatches, setShowMatches] = useState(false);
  const rows = useMemo(
    () =>
      [
        ...order,
        ...result.comparison
          .map((row) => row.field)
          .filter((field) => !order.includes(field)),
      ]
        .map((field) => result.comparison.find((row) => row.field === field))
        .filter((row): row is ComparisonRow => !!row),
    [order, result.comparison],
  );
  const preview = editing ? previewCorrection(result, editing) : null;
  const fixed =
    preview?.changes.filter((c) => c.before !== "match" && c.after === "match")
      .length ?? 0;
  const broken =
    preview?.changes.filter((c) => c.before === "match" && c.after !== "match")
      .length ?? 0;
  const unchanged =
    !!editing &&
    editing.value.trim() ===
      (
        result.comparison.find((r) => r.field === editing.field)?.[editing.side]
          .raw ?? ""
      ).trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!editing || !preview || preview.error || unchanged) return;
    setSaving(true);
    const target = `${editing.field}-${editing.side}`;
    const ok = await onSave(editing, reviewerName.trim(), reason.trim());
    setSaving(false);
    if (ok) {
      setEditing(null);
      setFlash(target);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(""), 2600);
    }
  }

  const problems = rows.filter((row) => row.result !== "match").length;
  const foldable =
    initiallyMatching.size < rows.length && initiallyMatching.size > 0;
  const folded = foldable && !showMatches;
  const shown = folded
    ? rows.filter(
        (row) => !(initiallyMatching.has(row.field) && row.result === "match"),
      )
    : rows;
  const hidden = rows.filter(
    (row) => initiallyMatching.has(row.field) && row.result === "match",
  );
  return (
    <section aria-label="Shipping Instruction compared with draft BL">
      <div className="cg-legend" style={{ marginBottom: 10 }}>
        <span>
          <TriangleAlert size={16} color="var(--cg-red)" /> Different — the
          highlighted words are not in the other document
        </span>
        <span>
          <CircleHelp size={16} color="var(--cg-blue)" /> Please check — could
          not be read with certainty
        </span>
        <span>
          <CheckCircle2 size={16} color="var(--cg-green)" /> Matches
        </span>
      </div>
      <div className="cg-compare" role="table">
        <div className="cg-compare-head" role="row">
          <div role="columnheader">Detail</div>
          <div role="columnheader">
            Shipping Instruction (SI)
            <small>Your reference — the correct value</small>
          </div>
          <div role="columnheader">
            Draft Bill of Lading (BL)
            <small>Document being checked</small>
          </div>
        </div>
        {shown.map((row) => (
          <div
            key={row.field}
            role="row"
            className={`cg-compare-row ${row.result}`}
          >
            <div className="cg-field-name" role="rowheader">
              {FIELD_LABELS[row.field]}
              <span
                className={`cg-pill ${row.result === "mismatch" ? "red" : row.result === "uncertain" ? "blue" : "green"}`}
              >
                {row.result === "mismatch" ? (
                  <TriangleAlert size={14} />
                ) : row.result === "uncertain" ? (
                  <CircleHelp size={14} />
                ) : (
                  <CheckCircle2 size={14} />
                )}
                {RESULT_TEXT[row.result]}
              </span>
            </div>
            {(["si", "bl"] as const).map((side) => {
              const value = row[side];
              const other = row[side === "si" ? "bl" : "si"];
              const isEditing =
                editing?.field === row.field && editing.side === side;
              const edited = value.method.startsWith("Human correction");
              return (
                <div
                  key={side}
                  role="cell"
                  data-side={
                    side === "si" ? "Shipping Instruction (SI)" : "Draft BL"
                  }
                  className={`cg-value ${flash === `${row.field}-${side}` ? "cg-flash" : ""}`}
                >
                  {isEditing ? (
                    <form className="cg-editor" onSubmit={submit}>
                      <label className="cg-field">
                        Correct {FIELD_LABELS[row.field].toLowerCase()} (
                        {side === "si" ? "SI" : "BL"})
                        <textarea
                          autoFocus
                          value={editing.value}
                          maxLength={2000}
                          disabled={saving}
                          onChange={(e) =>
                            setEditing({ ...editing, value: e.target.value })
                          }
                        />
                      </label>
                      <div className="cg-editor-row">
                        <label className="cg-field">
                          Your name
                          <input
                            value={reviewerName}
                            required
                            minLength={2}
                            maxLength={80}
                            disabled={saving}
                            onChange={(e) => onReviewerName(e.target.value)}
                          />
                        </label>
                        <label className="cg-field">
                          Reason
                          <input
                            value={reason}
                            required
                            minLength={5}
                            maxLength={2000}
                            disabled={saving}
                            onChange={(e) => setReason(e.target.value)}
                          />
                        </label>
                      </div>
                      {preview && (
                        <p
                          className={`cg-editor-effect ${preview.error ? "bad" : broken ? "bad" : fixed ? "good" : ""}`}
                          role="status"
                        >
                          {preview.error
                            ? preview.error
                            : unchanged
                              ? "Change the value to save a correction."
                              : broken
                                ? `Careful: this would make ${broken} matching detail${broken === 1 ? "" : "s"} different.`
                                : fixed
                                  ? `This fixes ${fixed} difference${fixed === 1 ? "" : "s"}. The check is re-run when you save.`
                                  : "The check is re-run when you save. The original document is not changed."}
                        </p>
                      )}
                      <div className="cg-editor-row">
                        <button
                          className="cg-btn primary"
                          disabled={
                            saving ||
                            !!preview?.error ||
                            unchanged ||
                            reviewerName.trim().length < 2 ||
                            reason.trim().length < 5
                          }
                        >
                          {saving ? (
                            <Loader2 size={18} className="cg-spin" />
                          ) : (
                            <CheckCircle2 size={18} />
                          )}
                          Save correction
                        </button>
                        <button
                          type="button"
                          className="cg-btn"
                          disabled={saving}
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p
                        className={`cg-value-text ${value.raw ? "" : "missing-value"}`}
                      >
                        {!value.raw ? (
                          "Not found in the document"
                        ) : row.result === "mismatch" ? (
                          <HighlightedValue
                            value={value.raw}
                            other={other.raw}
                          />
                        ) : (
                          value.raw
                        )}
                      </p>
                      {value.issue && (
                        <p className="cg-value-issue">{value.issue}</p>
                      )}
                      {row.result === "mismatch" &&
                        side === "bl" &&
                        value.raw.trim().toUpperCase() ===
                          other.raw.trim().toUpperCase() && (
                          <p className="cg-value-issue">
                            Same words on both documents — it differs because
                            the consignee it refers to differs.
                          </p>
                        )}
                      {edited && (
                        <span className="cg-edited">
                          <UserCheck size={13} /> Corrected by a reviewer
                        </span>
                      )}
                      <div className="cg-value-tools">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditing({
                                field: row.field,
                                side,
                                value: value.raw,
                              });
                            }}
                            aria-label={`Edit ${FIELD_LABELS[row.field]} in the ${side === "si" ? "SI" : "draft BL"}`}
                          >
                            <Pencil size={14} /> Edit
                          </button>
                        )}
                        {value.source && (
                          <button
                            type="button"
                            className="cg-source"
                            onClick={() =>
                              onSource(value.source, value.evidence)
                            }
                            title={`Show where this value comes from (${value.evidence})`}
                          >
                            <FileText size={14} />
                            {plainEvidence(value.evidence)}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
            {row.result === "mismatch" && (
              <p className="cg-risk" role="note">
                <TriangleAlert size={15} aria-hidden="true" />
                <span>
                  <strong>If not corrected:</strong>{" "}
                  {FIELD_RISK[row.field].risk}
                </span>
              </p>
            )}
          </div>
        ))}
        {foldable && (
          <button
            type="button"
            className="cg-compare-fold"
            aria-expanded={!folded}
            onClick={() => setShowMatches(!showMatches)}
          >
            <CheckCircle2 size={18} color="var(--cg-green)" />
            <span>
              {folded ? (
                <>
                  <strong>
                    {hidden.length} other detail{hidden.length === 1 ? "" : "s"}{" "}
                    match
                  </strong>{" "}
                  ({hidden.map((row) => FIELD_LABELS[row.field]).join(", ")})
                </>
              ) : (
                <strong>Hide the details that match</strong>
              )}
            </span>
            <span className="cg-spacer" />
            {folded ? "Show them" : "Hide"}
            {folded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        )}
      </div>
      <p className="cg-small cg-muted" style={{ marginTop: 10 }}>
        {problems
          ? `${problems} of ${rows.length} details need attention. Edit a value only if the extracted text is wrong — if the BL itself is wrong, ask the sender to correct it (Reply tab).`
          : `All ${rows.length} details match. Spaces, punctuation and units are compared sensibly; missing values never count as a match.`}
      </p>
    </section>
  );
}
