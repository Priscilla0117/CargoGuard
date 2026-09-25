"use client";
import { useEffect, useRef, useState } from "react";
import type { Worker } from "tesseract.js";
import {
  ocrPage,
  scanSuggestions,
  type FieldScanEvidence,
  type OcrPage,
} from "@/lib/ocr-evidence";
import "./scan-assist.css";
import {
  FIELDS,
  FIELD_LABELS,
  type Field,
  type ParsedDocument,
  type CaseResult,
  type AuditEvent,
} from "@/lib/types";
import { requestJson } from "@/lib/client-api";
import { suggestScanFields } from "@/lib/ocr";
import { unresolvedPdfPages } from "@/lib/pdf-coverage";

type Draft = Record<Field, { value: string; page: number; confirmed: boolean }>;
const emptyDraft = (): Draft =>
  Object.fromEntries(
    FIELDS.map((f) => [f, { value: "", page: 1, confirmed: false }]),
  ) as Draft;

export function ScanAssist({
  doc,
  result,
  onSaved,
  onReplace,
  disabled = false,
}: {
  doc: ParsedDocument;
  result: CaseResult;
  onSaved: (data: { result: CaseResult; audit: AuditEvent[] }) => void;
  onReplace?: () => void;
  disabled?: boolean;
}) {
  const unresolvedPages = unresolvedPdfPages(doc);
  const overPageLimit = (doc.page_count ?? 0) > 5;
  const [draft, setDraft] = useState<Draft>(emptyDraft),
    [role, setRole] = useState(""),
    [pages, setPages] = useState<string[]>([]);
  const [activePage, setActivePage] = useState(unresolvedPages[0] ?? 1),
    [viewedPages, setViewedPages] = useState<number[]>([]),
    [reviewedPages, setReviewedPages] = useState<number[]>([]);
  const [busy, setBusy] = useState(false),
    [saving, setSaving] = useState(false),
    [progress, setProgress] = useState(""),
    [saveError, setSaveError] = useState(""),
    [error, setError] = useState("");
  const [evidence, setEvidence] = useState<
      Partial<Record<Field, FieldScanEvidence>>
    >({}),
    [ocrPages, setOcrPages] = useState<OcrPage[]>([]),
    [suggested, setSuggested] = useState<Draft>(emptyDraft),
    [text, setText] = useState("");
  const controller = useRef<AbortController | null>(null);
  const saveInFlight = useRef(false);
  const mounted = useRef(false);
  const preview = useRef<HTMLDivElement>(null);
  const pagesToInspect = unresolvedPages.length
    ? unresolvedPages
    : pages.map((_, index) => index + 1);
  const pagesConfirmed =
    pagesToInspect.length > 0 &&
    pagesToInspect.every((page) => reviewedPages.includes(page));
  const fieldsConfirmed = FIELDS.every(
    (field) =>
      draft[field].confirmed &&
      !!draft[field].value.trim() &&
      draft[field].page >= 1 &&
      draft[field].page <= pages.length,
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  function showPage(page: number) {
    setActivePage(page);
    setViewedPages((previous) => [...new Set([...previous, page])]);
    preview.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function run(mode: "ocr" | "manual") {
    if (controller.current || saveInFlight.current || disabled || overPageLimit)
      return;
    if (
      pages.length &&
      !window.confirm(
        "Start this review again? Unsaved field edits and page confirmations will be cleared.",
      )
    )
      return;
    // Readable text remains a suggestion even when another page was unreadable.
    // It must never inherit a previous confirmation or an AI recovery value.
    const readable = suggestScanFields(
      { ...doc, recovery: undefined },
      doc.lines,
    );
    const readableDraft = Object.fromEntries(
      FIELDS.map((field) => [
        field,
        {
          value: readable[field].raw.slice(0, 1500),
          page: Number(readable[field].evidence.match(/Page (\d+)/)?.[1] ?? 1),
          confirmed: false,
        },
      ]),
    ) as Draft;
    const abort = new AbortController();
    controller.current = abort;
    let acceptingProgress = true;
    const active = () =>
      mounted.current &&
      controller.current === abort &&
      !abort.signal.aborted &&
      acceptingProgress;
    let worker: Worker | undefined;
    let pdf:
      | Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>
      | undefined;
    const deadline = setTimeout(
      () =>
        abort.abort(
          "Reading timed out. If the original pages loaded, you can finish the review manually. Otherwise retry or replace this source with a readable PDF.",
        ),
      180000,
    );
    const interrupted = new Promise<never>((_, reject) =>
      abort.signal.addEventListener(
        "abort",
        () =>
          reject(
            new Error(
              "Reading stopped or timed out. No saved decision was changed.",
            ),
          ),
        { once: true },
      ),
    );
    setBusy(true);
    setError("");
    setSaveError("");
    setDraft(readableDraft);
    setPages([]);
    setRole("");
    setReviewedPages([]);
    setViewedPages([]);
    setEvidence({});
    setOcrPages([]);
    setSuggested(emptyDraft());
    setText("");
    setProgress("Loading original PDF pages…");
    try {
      await Promise.race([
        interrupted,
        (async () => {
          const [pdfLib, response] = await Promise.all([
            import("unpdf"),
            fetch(
              `/api/document?id=${encodeURIComponent(result.email.email_id)}&name=${encodeURIComponent(doc.name)}&revision=${result.version}`,
              { signal: abort.signal },
            ),
          ]);
          if (!response.ok)
            throw new Error(
              "The original PDF could not be loaded. Reload the case and retry.",
            );
          const bytes = new Uint8Array(await response.arrayBuffer());
          abort.signal.throwIfAborted();
          if (!bytes.length)
            throw new Error(
              "This PDF is empty. Use Replace / revised documents to upload a readable original. The case remains in review.",
            );
          if (bytes.length > 5 * 1024 * 1024)
            throw new Error(
              "This review supports PDFs up to 5 MB. Replace this source with a readable text-layer PDF; partial review cannot clear the case.",
            );
          const hash = Array.from(
            new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
            (b) => b.toString(16).padStart(2, "0"),
          ).join("");
          if (hash !== doc.sha256)
            throw new Error(
              "The source changed. Reload this case before running OCR.",
            );
          abort.signal.throwIfAborted();
          pdf = await pdfLib.getDocumentProxy(bytes);
          if (abort.signal.aborted) {
            await pdf.loadingTask.destroy();
            throw new Error("Stopped.");
          }
          if (!pdf.numPages)
            throw new Error(
              "This PDF contains no pages. Replace it with a readable original.",
            );
          if (pdf.numPages > 5)
            throw new Error(
              "Scan assistance supports at most 5 pages. No partial-page approval is allowed; replace this PDF with a readable text-layer copy.",
            );
          const images: string[] = [];
          const dimensions: { width: number; height: number }[] = [];
          for (let n = 1; n <= pdf.numPages; n++) {
            abort.signal.throwIfAborted();
            setProgress(`Rendering page ${n} of ${pdf.numPages}…`);
            const page = await pdf.getPage(n),
              view = page.getViewport({ scale: 1 });
            const scale = Math.min(
              2.5,
              Math.sqrt(10000000 / (view.width * view.height)),
            );
            images.push(
              await pdfLib.renderPageAsImage(pdf, n, {
                scale,
                toDataURL: true,
              }),
            );
            const rendered = page.getViewport({ scale });
            dimensions.push({
              width: Math.floor(rendered.width),
              height: Math.floor(rendered.height),
            });
          }
          abort.signal.throwIfAborted();
          setPages(images);
          const firstPage = unresolvedPages[0] ?? 1;
          setActivePage(firstPage);
          setViewedPages([firstPage]);
          if (mode === "manual") {
            acceptingProgress = false;
            setProgress(
              "Original pages ready. Check each unread page, then confirm all seven fields and their source pages. Readable text is prefilled where available.",
            );
            return;
          }
          // Only load the OCR dependency after rendering succeeds. A worker or
          // model failure must leave a usable, source-bound manual review.
          const ocrLib = await import("tesseract.js");
          abort.signal.throwIfAborted();
          worker = await ocrLib.createWorker("eng", 1, {
            workerPath: `${location.origin}/ocr/worker.min.js`,
            corePath: `${location.origin}/ocr`,
            langPath: `${location.origin}/ocr`,
            workerBlobURL: false,
            // Tesseract otherwise throws from its message event handler, outside
            // the recognize promise. Surface failure through our controlled path.
            errorHandler: () => {
              if (!active()) return;
              abort.abort(
                "Local OCR could not run. The original pages are available below for manual review, or you can replace the source with a readable copy.",
              );
            },
            logger: (m) => {
              if (active())
                setProgress(`${m.status} · ${Math.round(m.progress * 100)}%`);
            },
          });
          if (abort.signal.aborted) {
            await worker.terminate();
            throw new Error("Stopped.");
          }
          const recognized: OcrPage[] = [];
          for (let n = 0; n < images.length; n++) {
            abort.signal.throwIfAborted();
            const output = await worker.recognize(
              images[n],
              {},
              { text: true, blocks: true },
            );
            abort.signal.throwIfAborted();
            recognized.push(
              ocrPage(
                output.data,
                n + 1,
                dimensions[n].width,
                dimensions[n].height,
              ),
            );
          }
          abort.signal.throwIfAborted();
          const {
            fields: extracted,
            evidence: support,
            text: recognizedText,
          } = scanSuggestions(doc, recognized);
          const nextDraft = Object.fromEntries(
            FIELDS.map((f) => [
              f,
              {
                value: extracted[f].raw.slice(0, 1500),
                page: Number(
                  extracted[f].evidence.match(/Page (\d+)/)?.[1] ?? 1,
                ),
                confirmed: false,
              },
            ]),
          ) as Draft;
          setDraft(
            Object.fromEntries(
              FIELDS.map((field) => [
                field,
                readableDraft[field].value.trim()
                  ? readableDraft[field]
                  : nextDraft[field],
              ]),
            ) as Draft,
          );
          setSuggested(nextDraft);
          setEvidence(support);
          setOcrPages(recognized);
          setText(recognizedText);
          acceptingProgress = false;
          setProgress(
            "OCR suggestions ready. Readable text suggestions were kept. Inspect every unread page and resolve any conflicting values before confirming all seven fields.",
          );
        })(),
      ]);
    } catch (e) {
      acceptingProgress = false;
      if (mounted.current && controller.current === abort) {
        // A terminal attempt must replace the last in-flight status as well as
        // show its error. Late messages from an older worker are gated above.
        setProgress(
          abort.signal.aborted
            ? typeof abort.signal.reason === "string"
              ? abort.signal.reason
              : "OCR stopped. No saved decision was changed. Retry when ready."
            : "Reading could not complete. No saved decision was changed.",
        );
        setError(
          abort.signal.aborted
            ? typeof abort.signal.reason === "string"
              ? `${abort.signal.reason} No saved decision was changed.`
              : "OCR stopped. No saved decision was changed. Retry when ready."
            : `Reading could not complete: ${(e as Error).message || "The PDF or OCR worker could not be read."} If original pages are shown below, you can review them manually. Otherwise retry or replace the source. The case remains in review.`,
        );
      }
    } finally {
      clearTimeout(deadline);
      await worker?.terminate().catch(() => {});
      await pdf?.loadingTask.destroy().catch(() => {});
      if (controller.current === abort) {
        if (mounted.current) setBusy(false);
        controller.current = null;
      }
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      saveInFlight.current ||
      controller.current ||
      disabled ||
      !role ||
      !pagesConfirmed ||
      !fieldsConfirmed
    )
      return;
    saveInFlight.current = true;
    setSaving(true);
    setSaveError("");
    const fd = new FormData(event.currentTarget);
    try {
      const saved = await requestJson<{
        result: CaseResult;
        audit: AuditEvent[];
      }>("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "transcribe",
          id: result.email.email_id,
          version: result.version,
          name: doc.name,
          sha256: doc.sha256,
          role,
          fields: draft,
          reviewed_pages: [...reviewedPages].sort((a, b) => a - b),
          actor: fd.get("actor"),
          reason: fd.get("reason"),
        }),
      });
      // The save may succeed after the reviewer closes or switches the case.
      // Its server-side audit remains, but it must not reopen the old drawer.
      if (mounted.current) {
        try {
          onSaved(saved);
        } catch {
          setSaveError(
            "The transcription was saved, but the case view could not refresh. Reload the case to inspect the saved decision before making another change.",
          );
        }
      }
    } catch (e) {
      if (mounted.current) setSaveError((e as Error).message);
    } finally {
      saveInFlight.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return (
    <section className="scan-assist">
      <h3>Review unread PDF content</h3>
      <p>
        {unresolvedPages.length > 0 && (
          <>
            Check {unresolvedPages.length === 1 ? "page" : "pages"}{" "}
            <strong>{unresolvedPages.join(", ")}</strong>: content on these
            pages could not be verified from readable text.{" "}
          </>
        )}
        Inspect the originals for additional or conflicting shipping details,
        then confirm all seven fields. Readable text and OCR are suggestions;
        neither approves this document.
      </p>
      {!!unresolvedPages.length && (
        <ul
          className="scan-page-reasons"
          aria-label="Why these pages need review"
        >
          {unresolvedPages.map((page) => (
            <li key={page}>
              <strong>Page {page}:</strong>{" "}
              {(Array.isArray(doc.pdf_coverage?.pages)
                ? doc.pdf_coverage.pages.find((entry) => entry?.page === page)
                    ?.reason
                : undefined) ??
                "The original page needs visual inspection before its values can be confirmed."}
            </li>
          ))}
        </ul>
      )}
      <p className="scan-limits">
        Local OCR reads English in your browser. Document images are not sent to
        an external AI provider; first use downloads the model from this site.
        You can also review the pages manually without running OCR. Both paths
        support PDFs up to 5 pages and 5 MB.
      </p>
      {overPageLimit && (
        <p className="alert warning" role="status">
          This PDF has {doc.page_count} pages. Replace it with a readable
          text-layer PDF containing the complete document. Reviewing only the
          first five pages cannot clear the case.
        </p>
      )}
      <div className="scan-actions">
        <button
          className="button secondary"
          disabled={busy || saving || disabled || overPageLimit}
          onClick={() => void run("ocr")}
        >
          {error
            ? "Retry OCR"
            : pages.length
              ? "Run OCR again"
              : "Get local OCR suggestions"}
        </button>
        {!pages.length && (
          <button
            className="button secondary"
            disabled={busy || saving || disabled || overPageLimit}
            onClick={() => void run("manual")}
          >
            Review pages manually
          </button>
        )}
        {onReplace && (
          <button
            className="button secondary"
            disabled={busy || saving || disabled}
            onClick={onReplace}
          >
            Replace with a readable PDF
          </button>
        )}
        {busy && (
          <button
            className="button secondary"
            onClick={() => controller.current?.abort()}
          >
            Stop reading
          </button>
        )}
      </div>
      <p role="status" aria-live="polite">
        {error ? "" : progress}
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {!!Object.keys(evidence).length && (
        <p className="alert warning">
          Each score describes recognition of the highlighted source words, not
          shipment accuracy. Low scores, missing evidence and edited values need
          particular attention. All seven fields still require confirmation.
        </p>
      )}
      {!!pages.length && !busy && (
        <>
          {error && (
            <p className="alert warning">
              Manual review is available: the original PDF pages were loaded and
              checked against the saved source. Enter only values you can read
              clearly. If anything is unreadable or contradictory, leave it
              unconfirmed and request a readable replacement.
            </p>
          )}
          <div className="scan-original-pages" ref={preview}>
            <h4>1. Inspect the original pages</h4>
            <div
              className="scan-page-navigation"
              role="group"
              aria-label="Original PDF pages"
            >
              {pages.map((_, index) => {
                const page = index + 1;
                return (
                  <button
                    type="button"
                    className="button secondary"
                    key={page}
                    aria-pressed={activePage === page}
                    onClick={() => showPage(page)}
                  >
                    Page {page}
                    {pagesToInspect.includes(page) ? " · review needed" : ""}
                  </button>
                );
              })}
            </div>
            <figure className="scan-page-preview">
              <figcaption>
                Original page {activePage} of {pages.length} · {doc.name}
                {" · "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`/api/document?id=${encodeURIComponent(result.email.email_id)}&name=${encodeURIComponent(doc.name)}&revision=${result.version}#page=${activePage}`}
                >
                  Open this page to zoom
                </a>
              </figcaption>
              {/* Canvas-derived local images must not go through a remote image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={pages[activePage - 1]}
                alt={`Original PDF, page ${activePage}`}
              />
            </figure>
            <fieldset
              className="scan-page-checklist"
              disabled={saving || disabled}
            >
              <legend>Confirm each page that needs review</legend>
              <p>
                Open each listed page before confirming. Check for extra
                quantities, addresses, amendments or conflicting values, even
                when the seven fields are already filled in below.
              </p>
              {pagesToInspect.map((page) => (
                <div className="scan-page-check" key={page}>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => showPage(page)}
                  >
                    View page {page}
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      disabled={!viewedPages.includes(page)}
                      checked={reviewedPages.includes(page)}
                      onChange={(event) => {
                        setReviewedPages((previous) =>
                          event.target.checked
                            ? [...new Set([...previous, page])]
                            : previous.filter((value) => value !== page),
                        );
                        // Removing page assurance also withdraws field assurance.
                        if (!event.target.checked)
                          setDraft(
                            (previous) =>
                              Object.fromEntries(
                                FIELDS.map((field) => [
                                  field,
                                  { ...previous[field], confirmed: false },
                                ]),
                              ) as Draft,
                          );
                      }}
                    />
                    I inspected page {page} for additional or conflicting values
                  </label>
                </div>
              ))}
            </fieldset>
          </div>
          <form onSubmit={save}>
            <h4>2. Confirm the seven authoritative values</h4>
            <p>
              Use the original page as evidence. Do not guess, resolve a
              contradiction without clarification, or confirm a value you cannot
              read. Each field needs its own source page and confirmation.
            </p>
            <label>
              Confirm document role
              <select
                required
                disabled={saving || disabled}
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="">Choose from the original heading</option>
                <option value="SI">Shipping Instruction (reference)</option>
                <option value="BL">Draft Bill of Lading</option>
              </select>
            </label>
            {[...FIELDS]
              .sort((a, b) => {
                const attention = (field: Field) =>
                  !evidence[field] ||
                  evidence[field]?.issue ||
                  evidence[field]?.lowest === null ||
                  (evidence[field]?.lowest ?? 0) < 80;
                return Number(!!attention(b)) - Number(!!attention(a));
              })
              .map((field) => (
                <fieldset key={field} disabled={saving || disabled}>
                  <legend>{FIELD_LABELS[field]}</legend>
                  {evidence[field] && (
                    <div className="scan-recognition">
                      <p
                        className={
                          evidence[field]!.issue ||
                          (evidence[field]!.lowest ?? 0) < 80
                            ? "alert warning"
                            : "scan-score"
                        }
                      >
                        {draft[field].value !== suggested[field].value ||
                        draft[field].page !== suggested[field].page
                          ? "The value or page differs from the OCR suggestion. The OCR score does not describe the value below."
                          : evidence[field]!.mean === null
                            ? "Recognition score unavailable — inspect the original page."
                            : `Source-word recognition: ${evidence[field]!.mean}/100 mean; ${evidence[field]!.lowest}/100 lowest (${evidence[field]!.wordCount} words).`}
                        {evidence[field]!.issue && (
                          <> {evidence[field]!.issue}</>
                        )}
                        {!evidence[field]!.issue &&
                          evidence[field]!.lowest !== null &&
                          evidence[field]!.lowest! < 80 &&
                          " Low recognition signal — check carefully."}
                      </p>
                      {suggested[field].value.trim() &&
                        draft[field].value.trim() !==
                          suggested[field].value.trim() && (
                          <p className="scan-alternative">
                            OCR suggested on page {suggested[field].page}:{" "}
                            <q>{suggested[field].value}</q>. Compare both
                            against the original; a difference may be an OCR
                            error or a conflict that needs clarification.
                          </p>
                        )}
                      {evidence[field]!.regions.map((region, i) => {
                        const original = ocrPages.find(
                          (page) => page.page === region.page,
                        );
                        if (!original || !pages[region.page - 1]) return null;
                        const box = region.box;
                        return (
                          <figure
                            className="scan-source-crop"
                            key={`${region.page}-${i}`}
                          >
                            <figcaption>
                              Original source crop · page {region.page} ·{" "}
                              {FIELD_LABELS[field]}
                            </figcaption>
                            <svg
                              viewBox={`${box.x0} ${box.y0} ${box.x1 - box.x0} ${box.y1 - box.y0}`}
                              role="img"
                              aria-label={`${FIELD_LABELS[field]} source words on original page ${region.page}`}
                            >
                              <image
                                href={pages[region.page - 1]}
                                width={original.width}
                                height={original.height}
                              />
                              {region.words.map((word, j) => (
                                <rect
                                  key={j}
                                  x={word.x0}
                                  y={word.y0}
                                  width={word.x1 - word.x0}
                                  height={word.y1 - word.y0}
                                  fill="#ffce4425"
                                  stroke="#af7212"
                                  strokeWidth={1.5}
                                />
                              ))}
                            </svg>
                          </figure>
                        );
                      })}
                    </div>
                  )}
                  <label>
                    Confirmed source value
                    <textarea
                      required
                      maxLength={1500}
                      rows={2}
                      value={draft[field].value}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          [field]: {
                            ...draft[field],
                            value: e.target.value,
                            confirmed: false,
                          },
                        })
                      }
                    />
                  </label>
                  <div className="scan-field-check">
                    <label>
                      Source page
                      <select
                        value={draft[field].page}
                        onChange={(e) => {
                          showPage(Number(e.target.value));
                          setDraft({
                            ...draft,
                            [field]: {
                              ...draft[field],
                              page: Number(e.target.value),
                              confirmed: false,
                            },
                          });
                        }}
                      >
                        {pages.map((_, i) => (
                          <option key={i} value={i + 1}>
                            Page {i + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        required
                        checked={draft[field].confirmed}
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [field]: {
                              ...draft[field],
                              confirmed: e.target.checked,
                            },
                          })
                        }
                      />
                      I checked this field against the original page
                    </label>
                  </div>
                </fieldset>
              ))}
            <label>
              Reviewer name
              <input
                required
                name="actor"
                minLength={2}
                maxLength={80}
                disabled={saving || disabled}
              />
            </label>
            <label>
              Reason / source confirmation
              <textarea
                required
                disabled={saving || disabled}
                name="reason"
                minLength={5}
                maxLength={2000}
                rows={2}
                placeholder="Explain what you checked against the original source."
              />
            </label>
            {saveError && (
              <p className="alert error" role="alert">
                {saveError}
              </p>
            )}
            <button
              disabled={
                saving ||
                disabled ||
                !role ||
                !pagesConfirmed ||
                !fieldsConfirmed
              }
              className="button primary full"
            >
              {saving
                ? "Saving confirmed transcription…"
                : "Save page review and seven fields · recheck"}
            </button>
            <p className="scan-confirmation-status" role="status">
              {
                pagesToInspect.filter((page) => reviewedPages.includes(page))
                  .length
              }
              /{pagesToInspect.length} required pages inspected ·{" "}
              {FIELDS.filter((field) => draft[field].confirmed).length}/7 fields
              confirmed. Saving reruns the comparison; it does not approve or
              change the original PDF.
            </p>
          </form>
          <details>
            <summary>Inspect unconfirmed OCR text</summary>
            <pre className="ocr-text">
              {text ||
                "OCR did not return text. Manually read every value from the original page."}
            </pre>
          </details>
        </>
      )}
    </section>
  );
}
