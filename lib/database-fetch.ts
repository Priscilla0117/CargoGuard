/** Bound the actual network request, including response-body consumption.
 * Never replay a database request: a timed-out write may already have committed.
 */
export function databaseFetch(
  timeoutMs = 15000,
  fetcher: typeof fetch = fetch,
): typeof fetch {
  return (input, init) => {
    const inherited = input instanceof Request ? input.signal : undefined;
    const signals = [AbortSignal.timeout(timeoutMs)];
    if (inherited) signals.push(inherited);
    if (init?.signal) signals.push(init.signal);
    return fetcher(input, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.any(signals),
    });
  };
}
