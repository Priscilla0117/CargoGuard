/** One probe at a time; no accumulating SQL calls during a dependency outage. */
export function createReadinessCheck(
  probe: () => Promise<unknown>,
  { timeoutMs = 3000, cacheMs = 1000 } = {},
) {
  let pending: Promise<boolean> | undefined;
  let active = false;
  let last: { ready: boolean; at: number } | undefined;
  return async function check(): Promise<boolean> {
    if (pending) return pending;
    if (last && Date.now() - last.at < cacheMs) return last.ready;
    // Even a broken probe that ignores cancellation cannot spawn more work.
    if (active) return false;
    active = true;
    const operation = Promise.resolve()
      .then(probe)
      .then(
        () => true,
        () => false,
      )
      .finally(() => {
        active = false;
      });
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    pending = Promise.race([operation, deadline]).then((ready) => {
      clearTimeout(timer);
      last = { ready, at: Date.now() };
      pending = undefined;
      return ready;
    });
    return pending;
  };
}
