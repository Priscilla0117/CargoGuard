const OFFICE_SCRIPT_URL =
  "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";

type NavigationHistory = Pick<History, "pushState" | "replaceState">;

/**
 * Office.js nulls these methods while evaluating. Keep the current functions,
 * including Next's router wrappers, rather than restoring History.prototype.
 * https://learn.microsoft.com/en-us/office/dev/add-ins/develop/referencing-the-javascript-api-for-office-library-from-its-cdn
 */
export function preserveOfficeHistory(history: NavigationHistory): () => void {
  const { pushState, replaceState } = history;
  if (typeof pushState !== "function" || typeof replaceState !== "function") {
    throw new Error(
      "Browser navigation is unavailable. Reload this workspace.",
    );
  }
  return () => {
    // Do not overwrite a newer router wrapper installed during the download.
    if (typeof history.pushState !== "function") history.pushState = pushState;
    if (typeof history.replaceState !== "function")
      history.replaceState = replaceState;
  };
}

const loads = new WeakMap<Document, Promise<void>>();

/**
 * Load once per document. Script handlers deliberately outlive React consumers:
 * leaving Outlook while the CDN request is pending must still restore routing.
 * Restoration is tied to script evaluation, never to Office.onReady, which can
 * remain pending when the page is opened outside an Office host.
 */
export function loadOfficeRuntime(
  browser: Pick<Window, "history">,
  owner: Document,
): Promise<void> {
  const cached = loads.get(owner);
  if (cached) return cached;

  let restore: () => void;
  let script: HTMLScriptElement;
  try {
    restore = preserveOfficeHistory(browser.history);
    script = owner.createElement("script");
  } catch (error) {
    return Promise.reject(error);
  }

  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  loads.set(owner, promise);

  let finished = false;
  const finish = (error?: Error) => {
    if (finished) return;
    finished = true;
    script.removeEventListener("load", loaded);
    script.removeEventListener("error", failed);
    try {
      restore();
    } catch (cause) {
      error =
        cause instanceof Error
          ? cause
          : new Error("Navigation could not be restored.");
    }
    if (error) {
      loads.delete(owner);
      script.remove();
      reject(error);
    } else resolve();
  };
  const loaded = () => finish();
  const failed = () =>
    finish(
      new Error(
        "Office runtime is unavailable. The regular CargoGuard workspace remains available.",
      ),
    );
  script.src = OFFICE_SCRIPT_URL;
  script.async = true;
  script.addEventListener("load", loaded);
  script.addEventListener("error", failed);
  try {
    owner.head.appendChild(script);
  } catch (error) {
    finish(
      error instanceof Error
        ? error
        : new Error("Office runtime could not be loaded."),
    );
  }
  return promise;
}
