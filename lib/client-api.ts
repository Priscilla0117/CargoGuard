export class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "RequestError";
  }
}
/** No automatic mutation retries: callers must explicitly choose idempotent resume. */
export async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  // Render Free can take 50+ seconds to wake. Do not abort a normal cold start
  // after 45 seconds, especially when the server may already have saved a write.
  const timeout = AbortSignal.timeout(90000);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;
  let response: Response;
  try {
    response = await fetcher(url, { ...options, signal });
  } catch (error) {
    throw new RequestError(
      error instanceof Error && /abort|timeout/i.test(error.name)
        ? "The request timed out. Refresh the workspace to check saved progress before retrying."
        : "Connection interrupted. Saved decisions are retained; refresh before retrying.",
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new RequestError(
      [502, 503, 504].includes(response.status)
        ? "The cloud service is temporarily unavailable or restarting. Wait a moment, then refresh the workspace to check saved progress before repeating an action."
        : "The server returned an unexpected response. Refresh and retry.",
      response.status,
    );
  }
  if (!response.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof data.error === "string"
        ? data.error
        : "The request failed. Please retry.";
    throw new RequestError(message, response.status);
  }
  return data as T;
}
export function latencySummary(samples: number[]) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    count: sorted.length,
    median: Math.round(sorted[Math.floor((sorted.length - 1) / 2)]),
    p95: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]),
  };
}

/** Only the idempotent inbox read gets one transient retry. Never replay writes.
 * One shared deadline includes both attempts and the retry delay.
 */
export async function requestInbox<T>(
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const deadline = AbortSignal.timeout(90000);
  const bounded = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    return await requestJson<T>(
      "/api/inbox",
      { signal: bounded, cache: "no-store" },
      fetcher,
    );
  } catch (error) {
    if (
      bounded.aborted ||
      !(error instanceof RequestError) ||
      ![0, 502, 503, 504].includes(error.status)
    )
      throw error;
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => {
        bounded.removeEventListener("abort", abort);
        resolve();
      }, 350);
      bounded.addEventListener("abort", abort, { once: true });
      if (bounded.aborted) abort();
    });
    return requestJson<T>(
      "/api/inbox",
      { signal: bounded, cache: "no-store" },
      fetcher,
    );
  }
}
