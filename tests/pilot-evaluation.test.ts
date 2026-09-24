import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  pilotStudySchema,
  scorePilot,
  type PilotObservation,
} from "../lib/pilot-evaluation";
import { freezePilot, runPilot, studyFile } from "../scripts/evaluate-pilot";

const study = pilotStudySchema.parse({
  schema_version: 1,
  study_id: "test-pilot",
  provenance: "synthetic_development",
  labeler_id: "test-author",
  labelled_at: "2026-01-01T00:00:00Z",
  protocol:
    "Synthetic unit test only, never evidence of staff time or production accuracy.",
  cases: ["match", "mismatch", "review"].map((expected, index) => ({
    id: `case-${index}`,
    email: {
      from: "docs@example.test",
      subject: "Check draft BL against SI",
      body: "Please compare the attached shipping instruction and draft bill of lading.",
    },
    documents: [],
    expected,
    independent_attention: false,
  })),
});
const observed: PilotObservation[] = [
  {
    id: "case-0",
    category: "BL_COMPARISON",
    workflow: "verified",
    batch_eligible: true,
  },
  {
    id: "case-1",
    category: "BL_COMPARISON",
    workflow: "discrepancy",
    batch_eligible: false,
  },
  {
    id: "case-2",
    category: "BL_COMPARISON",
    workflow: "review",
    batch_eligible: false,
  },
];

test("pilot metrics retain denominators, review workload and absent timing evidence", () => {
  const result = scorePilot(study, observed);
  assert.deepEqual(result.strict_false_clearances_among_verified, {
    count: 0,
    denominator: 1,
    rate: 0,
  });
  assert.deepEqual(result.strict_false_clearances_among_nonmatch_labels, {
    count: 0,
    denominator: 2,
    rate: 0,
  });
  assert.equal(result.abstention_workload.count, 1);
  assert.equal(result.individual_handling_workload.count, 2);
  assert.equal(result.strict_outcome_agreement.count, 3);
  assert.equal(result.timings.median_case_matched_seconds_difference, null);
  assert.equal(result.timings.observations, 0);
});
test("pilot counts false clearances, misrouting and processing failures instead of dropping cases", () => {
  const result = scorePilot(study, [
    {
      ...observed[0],
      category: "SPAM",
      workflow: "routed",
      batch_eligible: false,
    },
    { ...observed[1], workflow: "verified", batch_eligible: true },
    { ...observed[2], category: null, workflow: "processing_error" },
  ]);
  assert.equal(result.strict_false_clearances_among_verified.count, 1);
  assert.equal(result.false_batch_eligibility.count, 1);
  assert.equal(result.misrouted_comparison_cases.count, 1);
  assert.equal(result.processing_errors.count, 1);
  assert.equal(result.abstention_workload.denominator, 3);
  assert.equal(result.strict_outcome_agreement.count, 0);
});
test("strict matches and independent operational attention are scored separately", () => {
  const copy = structuredClone(study);
  copy.cases[0].independent_attention = true;
  const result = scorePilot(copy, observed);
  assert.equal(result.strict_false_clearances_among_verified.count, 0);
  assert.equal(result.false_batch_eligibility.count, 1);
});
test("no automatic matches yields null false-clearance rate, never a misleading zero", () => {
  const result = scorePilot(
    study,
    observed.map((item) => ({
      ...item,
      workflow: "review",
      batch_eligible: false,
    })),
  );
  assert.equal(result.strict_false_clearances_among_verified.rate, null);
  assert.equal(result.batch_eligible.count, 0);
  assert.equal(result.abstention_workload.rate, 1);
});
test("pilot rejects missing, duplicate, extra and impossible observations", () => {
  for (const rows of [
    observed.slice(1),
    [...observed, observed[0]],
    [observed[0], observed[0], observed[2]],
    [...observed.slice(0, 2), { ...observed[2], id: "extra" }],
    [{ ...observed[0], workflow: "review" as const }, ...observed.slice(1)],
  ])
    assert.throws(() => scorePilot(study, rows));
});
test("timings compare the same cases, preserve slowdowns, and reject inflated duplicate measurements", () => {
  const timings = [
    {
      case_id: "case-0",
      participant_id: "staff-1",
      mode: "manual" as const,
      active_seconds: 100,
    },
    {
      case_id: "case-0",
      participant_id: "staff-2",
      mode: "assisted" as const,
      active_seconds: 120,
    },
    {
      case_id: "case-1",
      participant_id: "staff-1",
      mode: "manual" as const,
      active_seconds: 50,
    },
  ];
  const result = scorePilot(study, observed, timings);
  assert.equal(result.timings.case_matched_count, 1);
  assert.equal(result.timings.median_case_matched_seconds_difference, -20);
  assert.equal(result.timings.unmatched_cases_with_timings, 1);
  assert.equal(result.timings.manual_participants, 1);
  assert.equal(result.timings.assisted_participants, 1);
  assert.throws(() => scorePilot(study, observed, [...timings, timings[0]]));
  assert.throws(() =>
    scorePilot(study, observed, [{ ...timings[0], case_id: "not-in-study" }]),
  );
  assert.throws(() =>
    scorePilot(study, observed, [{ ...timings[0], active_seconds: NaN }]),
  );
});
test("study schema rejects repeated cases and colliding attachment names", () => {
  const copy = structuredClone(study);
  copy.cases.push(copy.cases[0]);
  assert.equal(pilotStudySchema.safeParse(copy).success, false);
  copy.cases.pop();
  copy.cases[0].documents = [
    { name: "SI.txt", file: "one.txt" },
    { name: "si.txt", file: "two.txt" },
  ];
  assert.equal(pilotStudySchema.safeParse(copy).success, false);
});
test("frozen pilot runs real pipeline, preserves first report, rejects modified labels/sources and path escapes", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "cargoguard-pilot-"),
  );
  try {
    const specimen = structuredClone(study);
    specimen.cases = [specimen.cases[0]];
    specimen.cases[0].documents = [
      { name: "si.txt", file: "si.txt" },
      { name: "bl.txt", file: "bl.txt" },
    ];
    const fields =
      "\nShipper: ATLAS EXPORT SDN BHD\nConsignee: HARBOUR BUYER LTD\nNotify party: SAME AS CONSIGNEE\nPort of loading: PORT KLANG\nPort of discharge: SINGAPORE\nContainer count: 2\nGross weight (KG): 42000\n";
    await fs.writeFile(
      path.join(directory, "si.txt"),
      "SHIPPING INSTRUCTION" + fields,
    );
    await fs.writeFile(
      path.join(directory, "bl.txt"),
      "DRAFT BILL OF LADING" + fields,
    );
    const manifest = path.join(directory, "study.json"),
      lock = path.join(directory, "freeze.json"),
      report = path.join(directory, "first-run.json");
    await fs.writeFile(manifest, JSON.stringify(specimen));
    await freezePilot(manifest, lock);
    await assert.rejects(freezePilot(manifest, lock), /EEXIST/);
    const result = await runPilot(manifest, lock, report);
    assert.equal(result.complete, true);
    assert.equal(result.metrics.strict_outcome_agreement.count, 1);
    assert.equal(result.metrics.batch_eligible.count, 1);
    assert.equal(result.provenance, "synthetic_development");
    const originalReport = await fs.readFile(report, "utf8");
    assert.equal(JSON.parse(originalReport).complete, true);
    await assert.rejects(runPilot(manifest, lock, report), /EEXIST/);
    assert.equal(await fs.readFile(report, "utf8"), originalReport);
    await fs.appendFile(path.join(directory, "bl.txt"), "Changed source\n");
    await assert.rejects(
      runPilot(manifest, lock, path.join(directory, "changed.json")),
      /changed/,
    );
    await fs.writeFile(
      path.join(directory, "bl.txt"),
      "DRAFT BILL OF LADING" + fields,
    );
    specimen.cases[0].expected = "review";
    await fs.writeFile(manifest, JSON.stringify(specimen));
    await assert.rejects(
      runPilot(manifest, lock, path.join(directory, "changed-label.json")),
      /changed/,
    );
    await assert.rejects(studyFile(directory, "../"));
    await assert.rejects(studyFile(directory, manifest), /relative/);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
