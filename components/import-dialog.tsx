"use client";
import { useRef, useState, type DragEvent } from "react";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { requestJson } from "@/lib/client-api";
import type { CaseResult } from "@/lib/types";

const DOC = /\.(txt|pdf|docx|xlsx)$/i;
const EML = /\.eml$/i;
const MB = 1024 * 1024;
export interface ImportOutcome {
  name: string;
  result?: CaseResult;
  duplicate?: boolean;
  skipped?: { name: string; reason: string }[];
  error?: string;
}
type Picked = { file: File; id: string };

function localNow() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}
function size(bytes: number) {
  return bytes >= MB
    ? `${(bytes / MB).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
function problem(file: File) {
  if (/\.msg$/i.test(file.name))
    return "Outlook .msg files are not supported. In Outlook choose File → Save As → .eml, or drag the attachments here.";
  if (EML.test(file.name))
    return file.size > 20 * MB ? "Email files must be 20 MB or smaller." : "";
  if (!DOC.test(file.name))
    return "Use PDF, Word (.docx), Excel (.xlsx) or .txt";
  if (!file.size) return "This file is empty.";
  if (file.size > 5 * MB) return "Each document must be 5 MB or smaller.";
  return "";
}

export function ImportDialog({
  open,
  replacement,
  reviewerName,
  onReviewerName,
  onClose,
  onFinished,
  practice,
}: {
  open: boolean;
  replacement: { result: CaseResult; mode: "bl" | "all" } | null;
  reviewerName: string;
  onReviewerName: (value: string) => void;
  onClose: () => void;
  onFinished: (outcomes: ImportOutcome[]) => void;
  practice?: () => Promise<void>;
}) {
  const [files, setFiles] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([]);
  const [error, setError] = useState("");
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(
    "Please check the attached Shipping Instruction and draft Bill of Lading.",
  );
  const [received, setReceived] = useState(localNow);
  const [reason, setReason] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const blOnly = replacement?.mode === "bl";
  const finished = outcomes.length > 0 && !error;

  function reset() {
    setFiles([]);
    setOutcomes([]);
    setError("");
    setProgress("");
    setFrom("");
    setSubject("");
    setReason("");
    setReceived(localNow());
  }
  function close() {
    if (busy) return;
    reset();
    onClose();
  }
  function add(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    setOutcomes([]);
    setError("");
    setFiles((current) => {
      if (blOnly)
        return incoming
          .slice(-1)
          .map((file) => ({ file, id: crypto.randomUUID() }));
      const next = [...current];
      for (const file of incoming)
        if (
          !next.some(
            (item) =>
              item.file.name === file.name &&
              item.file.size === file.size &&
              item.file.lastModified === file.lastModified,
          )
        )
          next.push({ file, id: crypto.randomUUID() });
      return next;
    });
  }
  function drop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragging(false);
    add(event.dataTransfer.files);
  }

  const emails = replacement ? [] : files.filter((f) => EML.test(f.file.name));
  const documents = files.filter((f) => !EML.test(f.file.name));
  const bad = files.filter(
    (f) => problem(f.file) || (replacement && EML.test(f.file.name)),
  );
  const docTotal = documents.reduce((sum, f) => sum + f.file.size, 0);
  const tooMany = documents.length > 10 || docTotal > 20 * MB;
  const needsManual =
    !replacement && (documents.length > 0 || emails.length === 0);
  const manualValid =
    !needsManual ||
    (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from.trim()) &&
      subject.trim().length > 0 &&
      body.trim().length > 0);
  const replacementValid =
    !replacement ||
    (reviewerName.trim().length >= 2 &&
      reason.trim().length >= 5 &&
      (blOnly ? documents.length === 1 : documents.length >= 2));
  const canImport =
    !busy &&
    !bad.length &&
    !tooMany &&
    manualValid &&
    replacementValid &&
    (files.length > 0 || (!replacement && needsManual));

  async function upload(form: FormData) {
    return requestJson<{
      result: CaseResult;
      duplicate?: boolean;
      skipped?: { name: string; reason: string }[];
    }>("/api/upload", { method: "POST", body: form });
  }
  async function run() {
    if (!canImport) return;
    setBusy(true);
    setError("");
    const results: ImportOutcome[] = [];
    try {
      if (replacement) {
        setProgress("Reading the new documents…");
        const form = new FormData();
        form.set("id", replacement.result.email.email_id);
        form.set("version", String(replacement.result.version));
        form.set("actor", reviewerName.trim());
        form.set("reason", reason.trim());
        if (blOnly) {
          form.set("mode", "replace_bl");
          form.set("bl", documents[0].file);
        } else for (const f of documents) form.append("files", f.file);
        try {
          const value = await upload(form);
          results.push({ name: replacement.result.email.subject, ...value });
        } catch (e) {
          results.push({
            name: replacement.result.email.subject,
            error: e instanceof Error ? e.message : "Upload failed.",
          });
        }
      } else {
        const total = emails.length + (needsManual ? 1 : 0);
        let step = 0;
        for (const item of emails) {
          step++;
          setProgress(`Importing email ${step} of ${total}: ${item.file.name}`);
          const form = new FormData();
          form.set("eml", item.file);
          try {
            const value = await upload(form);
            results.push({ name: item.file.name, ...value });
          } catch (e) {
            results.push({
              name: item.file.name,
              error: e instanceof Error ? e.message : "Import failed.",
            });
          }
        }
        if (needsManual) {
          step++;
          setProgress(`Importing email ${step} of ${total}: ${subject.trim()}`);
          const form = new FormData();
          form.set("from", from.trim());
          form.set("subject", subject.trim());
          form.set("body", body.trim());
          const when = new Date(received);
          if (Number.isFinite(when.getTime()))
            form.set("received_at", when.toISOString());
          for (const f of documents) form.append("files", f.file);
          try {
            const value = await upload(form);
            results.push({ name: subject.trim(), ...value });
          } catch (e) {
            results.push({
              name: subject.trim(),
              error: e instanceof Error ? e.message : "Import failed.",
            });
          }
        }
      }
    } finally {
      setBusy(false);
      setProgress("");
    }
    setOutcomes(results);
    if (results.some((r) => r.result)) onFinished(results);
    if (results.every((r) => r.result)) {
      setFiles([]);
      setSubject("");
      setReason("");
    } else setError("Some items could not be imported. See the details below.");
  }

  const title = replacement
    ? blOnly
      ? "Upload the corrected draft BL"
      : "Replace the SI and draft BL"
    : "Import emails and documents";
  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="cg-dialog"
      >
        <div className="cg-dialog-head">
          <div>
            <DialogTitle asChild>
              <h2>{title}</h2>
            </DialogTitle>
            <p>
              {replacement
                ? blOnly
                  ? "The saved SI stays the reference. All seven details are checked again against the new BL."
                  : "Choose the new SI and draft BL. The earlier versions stay in History."
                : "Drop saved emails (.eml) or shipping documents. Add files one by one or all at once."}
            </p>
          </div>
          <button
            className="cg-icon-btn"
            aria-label="Close"
            disabled={busy}
            onClick={close}
          >
            <X size={22} />
          </button>
        </div>
        <div className="cg-dialog-body">
          {!finished && (
            <>
              <label
                className={`cg-drop ${dragging ? "dragging" : ""}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={drop}
              >
                <Upload size={30} aria-hidden="true" />
                <strong>
                  {files.length
                    ? "Add more files"
                    : "Choose files or drag them here"}
                </strong>
                <span>
                  {replacement
                    ? blOnly
                      ? "One PDF, Word, Excel or text file · 5 MB"
                      : "PDF, Word, Excel or text · 5 MB each"
                    : "Emails (.eml) · PDF, Word, Excel or text documents (5 MB each, up to 10)"}
                </span>
                <input
                  ref={input}
                  type="file"
                  className="cg-sr"
                  multiple={!blOnly}
                  accept={
                    replacement
                      ? ".txt,.pdf,.docx,.xlsx"
                      : ".eml,.txt,.pdf,.docx,.xlsx"
                  }
                  onChange={(e) => {
                    add(e.target.files);
                    e.target.value = "";
                  }}
                />
              </label>
              {!replacement &&
                practice &&
                !files.length &&
                !outcomes.length && (
                  <p className="cg-small cg-muted" style={{ margin: 0 }}>
                    No emails at hand?{" "}
                    <button
                      type="button"
                      className="cg-link"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError("");
                        setProgress("Loading 28 practice emails…");
                        try {
                          await practice();
                          reset();
                          onClose();
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : "Could not load practice emails.",
                          );
                        } finally {
                          setBusy(false);
                          setProgress("");
                        }
                      }}
                    >
                      Load 28 practice emails
                    </button>{" "}
                    (realistic Averis-style conversations, dated today).
                  </p>
                )}
              {files.length > 0 && (
                <ul className="cg-file-list" aria-label="Chosen files">
                  {files.map((item) => {
                    const issue =
                      problem(item.file) ||
                      (replacement && EML.test(item.file.name)
                        ? "Replace documents with PDF, Word, Excel or text files."
                        : "");
                    return (
                      <li key={item.id} className={issue ? "bad" : ""}>
                        {EML.test(item.file.name) ? (
                          <Mail size={18} aria-hidden="true" />
                        ) : (
                          <FileText size={18} aria-hidden="true" />
                        )}
                        <span title={item.file.name}>
                          {item.file.name}
                          {issue && (
                            <small
                              style={{
                                display: "block",
                                color: "var(--cg-red)",
                              }}
                            >
                              {issue}
                            </small>
                          )}
                        </span>
                        <small>{size(item.file.size)}</small>
                        <button
                          className="cg-icon-btn"
                          aria-label={`Remove ${item.file.name}`}
                          disabled={busy}
                          onClick={() =>
                            setFiles((current) =>
                              current.filter((f) => f.id !== item.id),
                            )
                          }
                        >
                          <X size={18} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!replacement && emails.length > 0 && (
                <p className="cg-notice success" style={{ margin: 0 }}>
                  <Mail size={18} />
                  <span>
                    {emails.length} email file{emails.length === 1 ? "" : "s"} —
                    each becomes its own case with the sender, date and
                    attachments read automatically.
                  </span>
                </p>
              )}
              {tooMany && (
                <p className="cg-notice error" style={{ margin: 0 }}>
                  <TriangleAlert size={18} />
                  <span>
                    Use at most 10 documents and 20 MB in total for one email.
                  </span>
                </p>
              )}
              {needsManual && (
                <fieldset
                  style={{
                    border: 0,
                    padding: 0,
                    margin: 0,
                    display: "grid",
                    gap: 14,
                  }}
                >
                  <legend
                    className="cg-section-title"
                    style={{ marginBottom: 8 }}
                  >
                    {emails.length
                      ? `The ${documents.length} loose document${documents.length === 1 ? "" : "s"} will be one more email:`
                      : "About this email"}
                  </legend>
                  <div className="cg-grid-2">
                    <label className="cg-field">
                      Sender email
                      <input
                        type="email"
                        value={from}
                        placeholder="name@company.com"
                        onChange={(e) => setFrom(e.target.value)}
                        required
                      />
                    </label>
                    <label className="cg-field">
                      Received on
                      <input
                        type="datetime-local"
                        value={received}
                        onChange={(e) => setReceived(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="cg-field">
                    Subject
                    <input
                      value={subject}
                      maxLength={500}
                      placeholder="e.g. TO CONFIRM DOCS _ 5RFR-36541 _ MOMBASA"
                      onChange={(e) => setSubject(e.target.value)}
                      required
                    />
                  </label>
                  <label className="cg-field">
                    Message
                    <textarea
                      rows={4}
                      value={body}
                      maxLength={20000}
                      onChange={(e) => setBody(e.target.value)}
                      required
                    />
                  </label>
                  {documents.length > 2 && (
                    <p className="cg-small cg-muted" style={{ margin: 0 }}>
                      With more than two documents you will pick the exact SI
                      and draft BL in the Documents tab after import.
                    </p>
                  )}
                </fieldset>
              )}
              {replacement && (
                <div className="cg-grid-2">
                  <label className="cg-field">
                    Your name
                    <input
                      value={reviewerName}
                      minLength={2}
                      maxLength={80}
                      onChange={(e) => onReviewerName(e.target.value)}
                      required
                    />
                  </label>
                  <label className="cg-field">
                    Why are you replacing it?
                    <input
                      value={reason}
                      minLength={5}
                      maxLength={2000}
                      placeholder="e.g. Corrected BL received from carrier"
                      onChange={(e) => setReason(e.target.value)}
                      required
                    />
                  </label>
                </div>
              )}
            </>
          )}
          {progress && (
            <p className="cg-notice" role="status" style={{ margin: 0 }}>
              <Loader2 size={18} className="cg-spin" />
              <span>{progress}</span>
            </p>
          )}
          {error && (
            <p className="cg-notice error" role="alert" style={{ margin: 0 }}>
              <TriangleAlert size={18} />
              <span>{error}</span>
            </p>
          )}
          {outcomes.length > 0 && (
            <ul className="cg-file-list" aria-label="Import results">
              {outcomes.map((item, index) => (
                <li key={index} className={item.error ? "bad" : ""}>
                  {item.error ? (
                    <TriangleAlert size={18} color="var(--cg-red)" />
                  ) : (
                    <CheckCircle2 size={18} color="var(--cg-green)" />
                  )}
                  <span title={item.name}>
                    {item.name}
                    <small style={{ display: "block" }}>
                      {item.error
                        ? item.error
                        : item.duplicate
                          ? "Already imported — opened the saved case"
                          : `Imported · ${item.result?.summary ?? ""}`}
                      {item.skipped?.length
                        ? ` · Not imported: ${item.skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}`
                        : ""}
                    </small>
                  </span>
                  <span />
                  <span />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="cg-dialog-foot">
          {finished && !replacement && (
            <button className="cg-btn" onClick={() => setOutcomes([])}>
              Import more
            </button>
          )}
          <button
            className={`cg-btn ${finished ? "primary" : ""}`}
            disabled={busy}
            onClick={close}
          >
            {finished ? "Done" : "Cancel"}
          </button>
          {!finished && (
            <button
              className="cg-btn primary"
              disabled={!canImport}
              onClick={() => void run()}
            >
              {busy ? (
                <Loader2 size={18} className="cg-spin" />
              ) : (
                <Upload size={18} />
              )}
              {busy
                ? "Importing…"
                : replacement
                  ? "Upload and check again"
                  : emails.length + (needsManual ? 1 : 0) > 1
                    ? `Import ${emails.length + (needsManual ? 1 : 0)} emails`
                    : "Import and check"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
