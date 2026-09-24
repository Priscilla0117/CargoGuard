# Frozen, independently labelled pilot evaluation

The runner implements the measurement workflow requested by the preliminary judges. It does not supply Averis documents, independent labels or staff observations. The three examples in `examples/pilot` are synthetic developer checks; do not present their scores as unseen-data accuracy.

## Run the supplied smoke example

From the repository root after `npm ci`:

```sh
node --import tsx scripts/evaluate-pilot.ts freeze examples/pilot/study.json work/pilot/smoke-freeze.json
node --import tsx scripts/evaluate-pilot.ts run examples/pilot/study.json work/pilot/smoke-freeze.json work/pilot/smoke-first-run.json
```

Both commands refuse to overwrite existing evidence. A run reserves its report before processing: interruption leaves an explicitly incomplete record. Use a separately named report for an intentional rerun and retain the first result, including failures.

## Prepare an actual pilot

1. An Averis-authorized study owner selects approved, deidentified SI/BL cases from multiple customers, carriers and layouts. Include clean matches, genuine errors, unknown values, scans, missing/corrupt files, revised documents and ambiguous messages. Keep every input under an ignored local study directory; do not commit customer records.
2. A shipping reviewer who has not seen the system's predictions records each case's expected strict outcome (`match`, `mismatch`, `review`) and whether independent checks should require attention. Resolve label disagreements before freezing. Keep the adjudication record under the same study's governance process.
3. Copy the example schema. Use pseudonymous case/staff identifiers, actual email text and relative source-file paths. Mark `provenance` as `independently_labelled_pilot` only when true. Record label time and the sampling, adjudication and timing protocol. The runner records this declaration; it cannot prove independence or representativeness.
4. Freeze the study before the first prediction. Save the lock with the supervisor. It fingerprints the complete study/labels, every source file, engine version, implementation and dependency lock. Changed labels, documents or engine refuse evaluation under that lock.
5. Run untouched automatic processing and retain the first report. The runner passes only emails and bytes to `processEmail`; no expected answer, human correction, confirmed OCR transcription, learned alias or category override enters inference. Image-only scans therefore measure automatic abstention, not assisted OCR accuracy.
6. Conduct a separate supervised workflow trial. Staff inspect the original sources and retain responsibility for decisions. Record missed errors and final corrected outcomes separately from the untouched automatic report.

For the first small pilot, agree on sample size, safety gates and a manageable review workload with the operations owner before seeing predictions. A result of zero observed false clearances in a small selected sample cannot establish zero production risk.

## What the report measures

| Metric | Definition |
|---|---|
| Strict false clearances among verified | `workflow=verified` BL comparisons whose label is mismatch/review, divided by all strict verified BL comparisons |
| Strict false clearances among nonmatch labels | The same errors divided by all cases labelled mismatch/review |
| False batch eligibility | Cases eligible for batch sign-off despite a mismatch/review label or expected independent attention, divided by all eligible cases |
| Abstention workload | Review, awaiting-documents and processing-error cases divided by all cases |
| Individual handling workload | Cases not eligible for batch sign-off divided by all cases; includes mismatches, misroutes and independent findings |
| Misrouted comparison cases | Study document-check cases routed to a non-comparison category divided by all cases |
| Processing errors | Failed cases retained in the denominator, never silently removed |
| Strict outcome agreement | Expected match/mismatch/review workflow agreement, reported separately from independent checks |

Every rate carries its count and denominator. A zero denominator produces `null`, not an invented zero-error rate. Batch eligibility is a proposal for human sign-off; no automatic cargo release or sanctions clearance is performed.

## Measure staff time without inventing savings

Optional `TIMINGS.json` contains actual observed records:

```json
[
  {"case_id":"case-001","participant_id":"staff-A","mode":"manual","active_seconds":180},
  {"case_id":"case-001","participant_id":"staff-B","mode":"assisted","active_seconds":150}
]
```

The values above explain the format; they are not measured evidence. Replace them with supervised observations. Pass the file as the last `run` argument. Use two counterbalanced groups so a person does not benefit from seeing the same answer twice. Record active checking/correction time using the same start/stop rules in both conditions; exclude unrelated idle time consistently. Document exclusions before analysis.

The report compares manual and assisted group medians for the **same cases**, then reports the median of those per-case time differences. This is case matching, not participant pairing and not causal proof of savings. It reports how many cases have both methods, participant coverage, and unmatched observations. Negative differences remain visible as slowdowns. Duplicate case/participant/mode entries are rejected. Without observations, timing fields remain `null`.

## Constraints

- Local runner: at most 500 cases, 12 attachments per case, 20 MB per file and 256 MB total source bytes. Larger studies should use predeclared cohorts with a documented combined analysis.
- Relative file paths are confined to the real study directory, including symlink resolution.
- No cloud upload, model call, mailbox action, database mutation or source content logging is performed by this runner. Reports contain pseudonymous IDs and aggregate outcomes; the declared study protocol is copied to the report, so keep it free of personal information.
- File checksums make changes detectable; they are not a trusted timestamp, external signature or independent audit. Retain supervisor-held copies and never replace the first failing run with a tuned rerun.
- Corporate SSO, managed background queues, tenant acceptance and staff usability/accuracy evidence are separate deployment workstreams.
