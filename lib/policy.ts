import { z } from "zod";
import type { CaseResult, ComparisonRow } from "./types";

// All seven exact checks are mandatory. Policies annotate commercial exceptions;
// they never turn a strict mismatch or an unreadable field into a verified result.
export const policyRules = z
  .object({
    weightToleranceKg: z.number().finite().min(0).max(5000),
    weightTolerancePercent: z.number().finite().min(0).max(5),
  })
  .strict();
export type PolicyRules = z.infer<typeof policyRules>;
export interface PolicySnapshot {
  version: number;
  rules: PolicyRules;
  actor: string;
  reason: string;
  created_at: string;
}
export const DEFAULT_POLICY: PolicySnapshot = {
  version: 0,
  rules: { weightToleranceKg: 0, weightTolerancePercent: 0 },
  actor: "CargoGuard",
  reason: "Organiser standard: all seven fields, exact normalized comparison.",
  created_at: "2026-09-18T00:00:00.000Z",
};
export function assessPolicy(rows: ComparisonRow[], policy: PolicySnapshot) {
  const row = rows.find((r) => r.field === "gross_weight_kg");
  const si = row?.si.normalized,
    bl = row?.bl.normalized;
  const eligible =
    row?.result === "mismatch" &&
    typeof si === "number" &&
    typeof bl === "number" &&
    si > 0 &&
    bl > 0;
  const differenceKg = eligible ? Math.abs(bl - si) : null;
  // Both enabled limits must be satisfied (the more restrictive bound wins).
  const bounds = [
    policy.rules.weightToleranceKg || Infinity,
    typeof si === "number" && policy.rules.weightTolerancePercent > 0
      ? (si * policy.rules.weightTolerancePercent) / 100
      : Infinity,
  ];
  const limitKg = Math.min(...bounds);
  const covered =
    differenceKg !== null &&
    Number.isFinite(limitKg) &&
    differenceKg <= limitKg + 1e-9;
  return {
    differenceKg,
    limitKg: Number.isFinite(limitKg) ? limitKg : 0,
    covered,
    note: covered
      ? "Weight difference is within this policy's tolerance. Strict mismatch remains; this is not shipment-release approval."
      : "No weight exception applies. Exact seven-field verification remains authoritative.",
  };
}
export function withPolicy(
  result: CaseResult,
  policy = result.policy ?? DEFAULT_POLICY,
): CaseResult {
  return {
    ...result,
    policy: structuredClone(policy),
    policy_assessment: assessPolicy(result.comparison, policy),
  };
}
export function previewPolicy(results: CaseResult[], rules: PolicyRules) {
  const policy = { ...DEFAULT_POLICY, rules };
  return results
    .filter((r) => r.comparison.length)
    .map((r) => ({
      id: r.email.email_id,
      version: r.version,
      strictStatus: r.status,
      previousCovered: assessPolicy(r.comparison, r.policy ?? DEFAULT_POLICY)
        .covered,
      ...assessPolicy(r.comparison, policy),
    }));
}
