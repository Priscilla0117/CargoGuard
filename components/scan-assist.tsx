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

type Draft = Record<Field, { value: string; page: number; confirmed: boolean }>;
const emptyDraft = (): Draft =>
  Object.fromEntries(
    FIELDS.map((f) => [f, { value: "", page: 1, confirmed: false }]),
  ) as Draft;

export function ScanAssist({
  doc,
  result,
  onSaved,
}: {
  doc: ParsedDocument;
  result: CaseResult;
  onSaved: (data: { result: CaseResult; audit: AuditEvent[] }) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft),
    [role, setRole] = useState(""),
    [pages, setPages] = useState<string[]>([]);
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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  async function run() {
    if (controller.current || saveInFlight.current) return;
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
          "OCR timed out. Retry, or replace this source with a readable text-layer copy.",
        ),
      180000,
    );
    const interrupted = new Promise<never>((_, reject) =>
      abort.signal.addEventListener(
        "abort",
        () =>
          reject(
            new Error(
              "OCR stopped or timed out. No saved decision was changed. You can retry or replace the source.",
            ),
          ),
        { once: true },
      ),
    );
    setBusy(true);
    setError("");
    setSaveError("");
    setDraft(emptyDraft());
    setPages([]);
    setRole("");
    setEvidence({});
    setOcrPages([]);
    setSuggested(emptyDraft());
    setText("");
    setProgress("Loading PDF and the local OCR model…");
    try {
      await Promise.race([
        interrupted,
        (async () => {
          const [pdfLib, ocrLib, response] = await Promise.all([
            import("unpdf"),
            import("tesseract.js"),
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
            throw new Error("Scan assistance supports PDFs up to 5 MB.");
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
                "The local OCR worker failed. Retry when the OCR assets are available, or replace the source with a readable copy.",
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
          setDraft(nextDraft);
          setSuggested(nextDraft);
          setEvidence(support);
          setOcrPages(recognized);
          setText(recognizedText);
          acceptingProgress = false;
          setProgress(
            "OCR suggestions ready. Check every field against the original page before saving.",
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
            : "OCR failed. No saved decision was changed. Retry a temporary failure or replace the source.",
        );
        setError(
          abort.signal.aborted
            ? typeof abort.signal.reason === "string"
              ? `${abort.signal.reason} No saved decision was changed.`
              : "OCR stopped. No saved decision was changed. Retry when ready."
            : `OCR could not complete: ${(e as Error).message || "The PDF or OCR worker could not be read."} Retry a temporary failure; use Replace / revised documents for an empty, corrupt or unreadable source. The case remains in review.`,
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
      !role ||
      !FIELDS.every((field) => draft[field].confirmed)
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
      <h3>Scan recovery · human-confirmed OCR</h3>
      <p>
        The OCR model runs in your browser. Document images are not sent to an
        external AI provider. English, up to 5 pages; first use downloads the
        model from this site. Suggestions are never automatically approved.
      </p>
      <div className="scan-actions">
        <button
          className="button secondary"
          disabled={busy || saving}
          onClick={run}
        >
          {error
            ? "Retry OCR"
            : pages.length
              ? "Run OCR again"
              : "Read scan with local OCR"}
        </button>
        {busy && (
          <button
            className="button secondary"
            onClick={() => controller.current?.abort()}
          >
            Stop OCR
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
      {!!pages.length && !busy && !error && (
        <>
          <details className="scan-original-pages">
            <summary>Inspect all original pages ({pages.length})</summary>
            <div className="scan-pages">
              {pages.map((src, i) => (
                <figure key={i}>
                  <figcaption>
                    Original page {i + 1} · {doc.name}
                  </figcaption>
                  {/* Canvas-derived local images must not go through a remote image optimizer. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt={`Original scan, page ${i + 1}`} />
                </figure>
              ))}
            </div>
          </details>
          <form onSubmit={save}>
            <label>
              Confirm document role
              <select
                required
                disabled={saving}
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
                <fieldset key={field} disabled={saving}>
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
                          ? "Edited by reviewer — the original OCR score does not describe this edited value."
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
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            [field]: {
                              ...draft[field],
                              page: Number(e.target.value),
                              confirmed: false,
                            },
                          })
                        }
                      >
                        {pages.map((_, i) => (
                          <option key={i} value={i + 1}>
                            {i + 1}
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
                disabled={saving}
              />
            </label>
            <label>
              Reason / source confirmation
              <textarea
                required
                disabled={saving}
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
                saving || !role || !FIELDS.every((f) => draft[f].confirmed)
              }
              className="button primary full"
            >
              {saving
                ? "Saving confirmed transcription…"
                : "Save all seven confirmed fields & recompute"}
            </button>
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
