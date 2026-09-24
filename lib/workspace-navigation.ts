import type { WorkspaceView } from "./work-queue";

const views = new Set<WorkspaceView>([
  "inbox",
  "performance",
  "activity",
  "policies",
]);

/** The URL identifies the visible workspace view, including browser history. */
export function parseWorkbenchSearch(params: Pick<URLSearchParams, "get">): {
  view: WorkspaceView;
  caseId: string | null;
} {
  const requestedView = params.get("view");
  const requestedCase = params.get("case");
  return {
    view: views.has(requestedView as WorkspaceView)
      ? (requestedView as WorkspaceView)
      : "inbox",
    caseId:
      requestedCase &&
      requestedCase.length <= 80 &&
      !/[\u0000-\u001f\u007f]/.test(requestedCase)
        ? requestedCase
        : null,
  };
}

/** Only same-origin, canonical workbench URLs are constructed here. */
export function workbenchHref(
  view: WorkspaceView = "inbox",
  caseId?: string | null,
): string {
  const params = new URLSearchParams();
  if (view !== "inbox" && views.has(view)) params.set("view", view);
  if (caseId) params.set("case", caseId);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}
