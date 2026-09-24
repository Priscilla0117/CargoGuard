"use client";

export default function WorkspaceError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main-content" tabIndex={-1} className="workspace-recovery">
      <p className="workspace-eyebrow">Workspace recovery</p>
      <h1>This view could not load</h1>
      <p>
        Try opening this view again, or reload the work queue. Saved cases and
        review decisions are kept on the server.
      </p>
      <div>
        <button className="button primary" onClick={reset}>
          Try this view again
        </button>
        {/* A document navigation also recovers a damaged client router. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a className="button secondary" href="/">
          Reload work queue
        </a>
      </div>
    </main>
  );
}
