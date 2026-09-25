/** Match a complete generated location within aggregated/reviewer evidence.
 * Substring matching confuses Line 1 with Line 10, PDF y=50 with y=500,
 * and spreadsheet A1 with A10. Location punctuation is always literal. */
export function evidenceHasLocation(evidence: string, location: string) {
  const exact = location.trim();
  if (!exact) return false;
  const escaped = exact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`,
    "u",
  ).test(evidence);
}
