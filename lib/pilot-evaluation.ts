import { z } from "zod";
import type { CaseResult } from "./types";

const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/);
const documentName = z
  .string()
  .min(1)
  .max(160)
  .refine(
    (value) => !/[\\/\x00-\x1f]/.test(value) && value !== "." && value !== "..",
    "Use a plain attachment filename",
  );
export const pilotStudySchema = z
  .object({
    schema_version: z.literal(1),
    study_id: id,
    provenance: z.enum([
      "synthetic_development",
      "independently_labelled_pilot",
    ]),
    labeler_id: id,
    labelled_at: z.string().datetime(),
    protocol: z.string().trim().min(20).max(4000),
    cases: z
      .array(
        z
          .object({
            id,
            email: z
              .object({
                from: z.string().min(1).max(300),
                subject: z.string().max(1000),
                body: z.string().max(30000),
              })
              .strict(),
            documents: z
              .array(
                z
                  .object({
                    name: documentName,
                    file: z.string().min(1).max(500),
                  })
                  .strict(),
              )
              .max(12),
            expected: z.enum(["match", "mismatch", "review"]),
            independent_attention: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict()
  .superRefine((study, context) => {
    if (new Set(study.cases.map((item) => item.id)).size !== study.cases.length)
      context.addIssue({ code: "custom", message: "Case IDs must be unique" });
    for (const item of study.cases)
      if (
        new Set(item.documents.map((doc) => doc.name.toLowerCase())).size !==
        item.documents.length
      )
        context.addIssue({
          code: "custom",
          message: "Attachment names must be unique within a case",
        });
  });
export type PilotStudy = z.infer<typeof pilotStudySchema>;
export interface PilotObservation {
  id: string;
  category: CaseResult["category"] | null;
  workflow: CaseResult["workflow"] | "processing_error";
  batch_eligible: boolean;
}
export const pilotTimingSchema = z
  .array(
    z
      .object({
        case_id: id,
        participant_id: id,
        mode: z.enum(["manual", "assisted"]),
        active_seconds: z.number().finite().positive().max(28800),
      })
      .strict(),
  )
  .max(20000);
export type PilotTiming = z.infer<typeof pilotTimingSchema>[number];
const metric = (count: number, denominator: number) => ({
  count,
  denominator,
  rate: denominator ? count / denominator : null,
});
const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Pure scoring: labels never enter extraction, routing or comparison. */
export function scorePilot(
  study: PilotStudy,
  observations: PilotObservation[],
  suppliedTimings: PilotTiming[] = [],
) {
  const ids = new Set(study.cases.map((item) => item.id));
  if (
    observations.length !== ids.size ||
    new Set(observations.map((item) => item.id)).size !== ids.size ||
    observations.some((item) => !ids.has(item.id))
  )
    throw new Error(
      "Score exactly one observation for every frozen case; no omissions or extras.",
    );
  const timings = pilotTimingSchema.parse(suppliedTimings);
  const timingKeys = new Set<string>();
  for (const timing of timings) {
    const key = JSON.stringify([
      timing.case_id,
      timing.participant_id,
      timing.mode,
    ]);
    if (!ids.has(timing.case_id) || timingKeys.has(key))
      throw new Error(
        "Timing records must name a frozen case without duplicate participant/case/mode entries.",
      );
    timingKeys.add(key);
  }
  const byId = new Map(observations.map((item) => [item.id, item]));
  let verified = 0,
    eligible = 0,
    strictFalse = 0,
    eligibleFalse = 0;
  let abstained = 0,
    errors = 0,
    misrouted = 0,
    exact = 0,
    unsafe = 0;
  const failures: {
    id: string;
    strict_false_clearance: boolean;
    false_batch_eligibility: boolean;
    missed_comparison_route: boolean;
  }[] = [];
  for (const item of study.cases) {
    const actual = byId.get(item.id)!;
    if (
      actual.batch_eligible &&
      (actual.category !== "BL_COMPARISON" || actual.workflow !== "verified")
    )
      throw new Error(
        "Only a verified BL comparison can be eligible for batch sign-off.",
      );
    const clear =
      actual.category === "BL_COMPARISON" && actual.workflow === "verified";
    const wrongClear = clear && item.expected !== "match";
    const wrongEligible =
      actual.batch_eligible &&
      (item.expected !== "match" || item.independent_attention);
    const missedRoute =
      actual.category !== null && actual.category !== "BL_COMPARISON";
    verified += Number(clear);
    eligible += Number(actual.batch_eligible);
    strictFalse += Number(wrongClear);
    eligibleFalse += Number(wrongEligible);
    unsafe += Number(item.expected !== "match");
    errors += Number(actual.workflow === "processing_error");
    abstained += Number(
      ["review", "awaiting_documents", "processing_error"].includes(
        actual.workflow,
      ),
    );
    misrouted += Number(missedRoute);
    const expectedWorkflow = {
      match: "verified",
      mismatch: "discrepancy",
      review: "review",
    }[item.expected];
    exact += Number(
      actual.category === "BL_COMPARISON" &&
        (actual.workflow === expectedWorkflow ||
          (item.expected === "review" &&
            actual.workflow === "awaiting_documents")),
    );
    if (wrongClear || wrongEligible || missedRoute)
      failures.push({
        id: item.id,
        strict_false_clearance: wrongClear,
        false_batch_eligibility: wrongEligible,
        missed_comparison_route: missedRoute,
      });
  }
  const paired = study.cases.flatMap((item) => {
    const manual = median(
      timings
        .filter((t) => t.case_id === item.id && t.mode === "manual")
        .map((t) => t.active_seconds),
    );
    const assisted = median(
      timings
        .filter((t) => t.case_id === item.id && t.mode === "assisted")
        .map((t) => t.active_seconds),
    );
    return manual !== null && assisted !== null
      ? [{ id: item.id, manual, assisted, saved: manual - assisted }]
      : [];
  });
  return {
    cases: ids.size,
    strict_outcome_agreement: metric(exact, ids.size),
    strict_false_clearances_among_verified: metric(strictFalse, verified),
    strict_false_clearances_among_nonmatch_labels: metric(strictFalse, unsafe),
    false_batch_eligibility: metric(eligibleFalse, eligible),
    batch_eligible: metric(eligible, ids.size),
    abstention_workload: metric(abstained, ids.size),
    individual_handling_workload: metric(ids.size - eligible, ids.size),
    misrouted_comparison_cases: metric(misrouted, ids.size),
    processing_errors: metric(errors, ids.size),
    timings: {
      observations: timings.length,
      case_matched_count: paired.length,
      manual_group_median_seconds: median(paired.map((item) => item.manual)),
      assisted_group_median_seconds: median(
        paired.map((item) => item.assisted),
      ),
      median_case_matched_seconds_difference: median(
        paired.map((item) => item.saved),
      ),
      manual_participants: new Set(
        timings.filter((t) => t.mode === "manual").map((t) => t.participant_id),
      ).size,
      assisted_participants: new Set(
        timings
          .filter((t) => t.mode === "assisted")
          .map((t) => t.participant_id),
      ).size,
      unmatched_cases_with_timings:
        new Set(timings.map((t) => t.case_id)).size - paired.length,
      interpretation:
        "Difference between manual and assisted per-case group medians, matched by case, not participant. Use the declared counterbalanced protocol; this is not causal proof of savings. No timings means no time-saving estimate.",
    },
    failures,
  };
}
