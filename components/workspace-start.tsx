"use client";

import { useId } from "react";
import { ArrowRight, ChevronDown, Upload } from "lucide-react";

export interface WorkspaceStartProps {
  onExample: () => void;
  onImport: () => void;
  busy: boolean;
  ready: boolean;
  hasProcessed: boolean;
  sampleCount: number;
}

export function WorkspaceStart({
  onExample,
  onImport,
  busy,
  ready,
  hasProcessed,
  sampleCount,
}: WorkspaceStartProps) {
  const titleId = useId();
  const hintId = useId();
  const content = (
    <div className="workspace-start-content">
      <div className="workspace-start-heading">
        <h2 id={titleId}>Check shipping documents</h2>
        <p>
          Compare a shipping instruction (SI) with a draft bill of lading (BL).
          See what matches, what differs, and what needs a closer look.
        </p>
      </div>
      <ol
        className="workspace-start-steps"
        aria-label="How to check a shipment"
      >
        <li>
          <span className="workspace-start-number" aria-hidden="true">
            1
          </span>
          <div>
            <h3>Add files</h3>
            <p>Try an example or upload the documents you want to compare.</p>
          </div>
        </li>
        <li>
          <span className="workspace-start-number" aria-hidden="true">
            2
          </span>
          <div>
            <h3>Review differences</h3>
            <p>Check the source documents and correct any misread values.</p>
          </div>
        </li>
        <li>
          <span className="workspace-start-number" aria-hidden="true">
            3
          </span>
          <div>
            <h3>Prepare a reply</h3>
            <p>Draft a request for corrections. Review it before sending.</p>
          </div>
        </li>
      </ol>
      <div className="workspace-start-actions">
        <button
          type="button"
          className="workspace-start-example"
          onClick={onExample}
          disabled={busy || !ready || sampleCount < 1}
          aria-describedby={hintId}
        >
          Try one example <ArrowRight size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="workspace-start-import"
          onClick={onImport}
          disabled={busy || !ready}
        >
          <Upload size={18} aria-hidden="true" /> Upload documents
        </button>
      </div>
      <p className="workspace-start-hint" id={hintId} role="status">
        {!ready
          ? "Loading your workspace…"
          : busy
            ? "A document check is in progress."
            : sampleCount < 1
              ? "No examples are available. Upload documents to begin."
              : "The example uses supplied demo files. You do not need to upload anything."}
      </p>
      <details className="workspace-start-about">
        <summary>About this demo and your saved work</summary>
        <div>
          <p>
            {sampleCount > 0
              ? `This demo includes ${sampleCount} supplied example ${sampleCount === 1 ? "case" : "cases"}. `
              : "This is a demo workspace. "}
            Use example or made-up files when trying your own upload.
          </p>
          <p>
            Your cases are saved in this workspace. This browser uses a cookie
            to find them again. Clearing its cookies or switching browsers may
            open a different workspace, so keep using this browser to return to
            your work.
          </p>
        </div>
      </details>
    </div>
  );

  return hasProcessed ? (
    <details className="workspace-start workspace-start-compact">
      <summary className="workspace-start-toggle">
        Need help getting started?
        <ChevronDown size={20} aria-hidden="true" />
      </summary>
      {content}
    </details>
  ) : (
    <section className="workspace-start" aria-labelledby={titleId}>
      {content}
    </section>
  );
}
