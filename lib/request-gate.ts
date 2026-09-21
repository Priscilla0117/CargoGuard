/** Prevent a late response from reopening a closed view or replacing a newer choice. */
export function createRequestGate() {
  let generation = 0;
  return {
    next: () => ++generation,
    cancel: () => { generation++; },
    isCurrent: (ticket: number) => ticket === generation,
  };
}
