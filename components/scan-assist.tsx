"use client";
import { useEffect, useRef, useState } from "react";
import type { Worker } from "tesseract.js";
import { suggestScanFields } from "@/lib/ocr";
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
    [error, setError] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null),
    [text, setText] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  async function run() {
    const abort = new AbortController();
    controller.current = abort;
    let worker: Worker | undefined;
    let pdf:
      | Awaited<ReturnType<typeof import("unpdf").getDocumentProxy>>
      | undefined;
    const deadline = setTimeout(() => abort.abort(), 180000);
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
    setDraft(emptyDraft());
    setPages([]);
    setConfidence(null);
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
          pdf = await pdfLib.getDocumentProxy(bytes);
          if (abort.signal.aborted) {
            await pdf.loadingTask.destroy();
            throw new Error("Stopped.");
          }
          if (pdf.numPages > 5)
            throw new Error(
              "Scan assistance supports at most 5 pages. No partial-page approval is allowed; replace this PDF with a readable text-layer copy.",
            );
          const images: string[] = [];
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
          }
          abort.signal.throwIfAborted();
          setPages(images);
          worker = await ocrLib.createWorker("eng", 1, {
            workerPath: `${location.origin}/ocr/worker.min.js`,
            corePath: `${location.origin}/ocr`,
            langPath: `${location.origin}/ocr`,
            workerBlobURL: false,
            logger: (m) => {
              if (!abort.signal.aborted)
                setProgress(`${m.status} · ${Math.round(m.progress * 100)}%`);
            },
          });
          if (abort.signal.aborted) {
            await worker.terminate();
            throw new Error("Stopped.");
          }
          const lines: ParsedDocument["lines"] = [];
          let totalConfidence = 0;
          for (let n = 0; n < images.length; n++) {
            abort.signal.throwIfAborted();
            const output = await worker.recognize(
              images[n],
              {},
              { text: true },
            );
            totalConfidence += output.data.confidence;
            if (output.data.text.length > 100000)
              throw new Error(
                "OCR output is too large for safe review. Replace the source.",
              );
            lines.push(
              ...output.data.text.split(/\r?\n/).map((text, i) => ({
                text,
                location: `Page ${n + 1}; OCR line ${i + 1}`,
              })),
            );
          }
          abort.signal.throwIfAborted();
          const extracted = suggestScanFields(doc, lines);
          setDraft(
            Object.fromEntries(
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
            ) as Draft,
          );
          setConfidence(Math.round(totalConfidence / images.length));
          setText(lines.map((l) => `${l.location}: ${l.text}`).join("\n"));
          setProgress(
            "OCR suggestions ready. Check every field against the original page before saving.",
          );
        })(),
      ]);
    } catch (e) {
      if (controller.current === abort)
        setError(
          (e as Error).message ||
            "OCR could not complete. No saved decision was changed.",
        );
    } finally {
      clearTimeout(deadline);
      await worker?.terminate().catch(() => {});
      await pdf?.loadingTask.destroy().catch(() => {});
      if (controller.current === abort) {
        setBusy(false);
        controller.current = null;
      }
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
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
      if (mounted.current) onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
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
          Read scan with local OCR
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
        {progress}
      </p>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      {confidence !== null && (
        <p className="alert warning">
          OCR mean confidence: {confidence}/100 — a model signal, not proven
          accuracy. Inspect names, numbers and ports carefully.
        </p>
      )}
      {!!pages.length && !busy && (
        <>
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
          <form onSubmit={save}>
            <label>
              Confirm document role
              <select
                required
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="">Choose from the original heading</option>
                <option value="SI">Shipping Instruction (reference)</option>
                <option value="BL">Draft Bill of Lading</option>
              </select>
            </label>
            {FIELDS.map((field) => (
              <fieldset key={field}>
                <legend>{FIELD_LABELS[field]}</legend>
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
              <input required name="actor" minLength={2} maxLength={80} />
            </label>
            <label>
              Reason / source confirmation
              <textarea
                required
                name="reason"
                minLength={5}
                maxLength={2000}
                rows={2}
                placeholder="Explain what you checked. Reviewer names are self-reported in this prototype."
              />
            </label>
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
