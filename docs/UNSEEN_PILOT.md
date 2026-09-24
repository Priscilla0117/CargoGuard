# Independent evaluation and supervised pilot

This repository supplies validation tooling and a protocol, **not an independently labelled hold-out dataset or an employee pilot result**. Existing organiser data and same-generator examples are development evidence. No employee time saving, adoption rate, or unseen accuracy is implied by the scripts or their synthetic unit tests.

The evaluator runs the actual `processEmail` path on original local bytes, including routing, parsing, extraction and comparison. It supplies no category override, previous correction, scan confirmation or gold label to that path. It makes no external AI call. Assisted OCR/recovery and operator decisions need the separate supervised pilot below; deterministic results cannot establish their accuracy.

## Assemble and label before running the model

1. Have a data custodian obtain permitted, de-identified source emails and original attachments that were not used to tune this system. Keep these files and labels outside the public repository and deployed inputs. Record permission, origin, collection date and the person responsible. Do not infer consent from the ability to download a file.
2. Assign a stable `shipment_group` to every shipment and all its revisions/forwarded copies. Assign `template_family` by the originating form/layout, including variations of that form. Use the same naming catalogue across development and holdout. Partition entire groups before looking at model results: neither a shipment nor a template family may cross those splits. Include clear cases, real differences, missing values/files, scans, unfamiliar layouts and non-comparison email routes.
3. Two reviewers independently inspect complete originals, without seeing model predictions. Adjudicate disagreements against the originals and retain the initial labels and decision rationale outside the run report. Record reviewer identities or stable pseudonyms and an adjudicator. Human attestation is required; the tool cannot authenticate independence or reviewer identity.
4. Populate the empty templates under `examples/unseen-evaluation/`. They intentionally contain no cases or labels, and cannot be frozen until completed. Do not relabel developer-authored fixtures as independent examples.
5. Freeze the inputs and labels before the first run. Record the resulting manifest SHA-256 with the protocol custodian, outside the evaluation directory. The exclusive-create rule prevents accidental overwrite; hashes detect content changes against that manifest. Hashes do not authenticate a rewritten manifest—retain the custodian's recorded hash.

## Dataset files

Run the commands from the CargoGuard application root. The dataset directory contains `dataset.json`, `labels.json`, email JSON files, and original attachments. All dataset paths use relative forward slashes. Absolute paths, `..`, files outside the root through symlinks, and conflicting source declarations are rejected.

`dataset.json` has these fields:

| Field                                        | Meaning                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `schema_version`                             | `1`                                                                                |
| `ready_for_freeze`                           | Set `true` only after labels and grouping are complete                             |
| `dataset_id`                                 | Stable, real dataset identifier                                                    |
| `provenance.source_description`              | Where the permitted originals came from; known sampling limits                     |
| `provenance.permission_reference`            | Internal record authorizing this use                                               |
| `provenance.collected_by`, `collected_at`    | Custodian and ISO UTC timestamp                                                    |
| `provenance.holdout_independence_attested`   | `true` only when the holdout independence claim has been checked                   |
| `provenance.holdout_not_used_for_tuning`     | `true` only if holdout cases did not inform rules, prompts, thresholds or training |
| `provenance.holdout_frozen_before_model_run` | `true` only before inspecting predictions on this holdout                          |
| `cases`                                      | Nonempty array of the case records below                                           |

Each case has `id`, `split` (`development` or `holdout`), `shipment_group`, `template_family`, `email_file`, and `missing_attachments` (an array, normally empty). These are identifiers supplied by the custodian, not values generated from the predicted category. A development-only catalogue may set holdout attestations to false; a dataset containing holdout cases must attest all three.

Each email JSON has `email_id` matching its case ID, `from`, `subject`, `body`, and `attachments`, an array of original attachment paths. Optional `received_at` and `imported_at` are allowed. Emails with no attachments use `[]`. If an attachment path represents a genuinely missing original, list it in that case's `missing_attachments`; the file must be absent. Its absence is frozen and an added file invalidates the manifest. An omitted attachment is different from an existing unreadable attachment: preserve damaged original bytes when those are the evidence.

`labels.json` has `schema_version: 1`, the same `dataset_id`, `provenance`, and `labels`. Its provenance requires `reviewers` (at least two distinct identifiers), `adjudicator`, `adjudicated: true`, and `labelled_without_model_outputs: true`. Exactly one gold label is required for every case, including development entries:

| Label field     | Required content                                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `case_id`       | Exact case ID                                                                                                                 |
| `category`      | `BL_COMPARISON`, `SI_REQUEST`, `INVOICE_QUERY`, `GENERAL` or `SPAM`                                                           |
| `workflow`      | `verified`, `discrepancy`, `review`, `awaiting_documents` or `routed`                                                         |
| `blocking`      | Whether the independently adjudicated evidence requires withholding document verification                                     |
| `defect_fields` | Array drawn from the seven field keys; empty when no known differences exist                                                  |
| `review_reason` | For `review`: `wrong_doc_type`, `missing_attachment`, `unreadable`, `missing_value` or `uncertain_category`; otherwise `null` |
| `rationale`     | Reviewer explanation grounded in the original source                                                                          |

The seven keys are `shipper`, `consignee`, `notify_party`, `port_of_loading`, `port_of_discharge`, `container_count`, and `gross_weight_kg`. A gold `verified` case must be `BL_COMPARISON`, have no defects, and have `blocking: false`. A gold discrepancy must name its defects. Reviews, discrepancies and awaiting-document comparisons must block verification. Non-comparison routing does not assert that shipment documents are verified. Record ambiguous evidence as review; do not guess a value to complete labels.

## Freeze and run

```powershell
node --import tsx scripts/freeze-evaluation.ts C:/approved-data/cargo-holdout C:/approved-data/manifests/holdout.json --development-manifest C:/approved-data/manifests/development.json
node --import tsx scripts/evaluate-unseen.ts C:/approved-data/cargo-holdout C:/approved-data/manifests/holdout.json C:/approved-data/runs/first-run
```

The paths illustrate command syntax, not an included dataset. First freeze a development catalogue with the same freeze command if one is available. The optional development manifest supplies a hashed snapshot of previously exposed shipment groups, template families and source-byte hashes. All its cases count as prior exposure, regardless of their historical split name. Reused source bytes are rejected even if filenames and group IDs have changed. Without that option, the report explicitly states that overlap with prior development data was **not checked**; metadata grouping still prevents leakage between splits in the current dataset. Group IDs cannot detect renamed semantic duplicates on their own—custodian review remains necessary.

The manifest records hashes for the definition, gold labels, emails and attachments. The runner verifies the complete file inventory before and after evaluation and checks each attachment against its frozen hash when the engine reads it. A changed source or label aborts the run. Only `holdout` cases are scored. The application source fingerprint includes the `lib` source/model files, evaluator scripts and package lock; Node and pipeline versions are recorded. Keep the exact source checkout/build with the result to reproduce it.

The output directory must be new; reports are never overwritten. `report.json` contains aggregate metrics and provenance; `predictions.json` contains case IDs, gold outcomes, engine outcomes and format groups, not original document text. Both can still reveal sensitive case information. Treat them according to the original data permission. A failed run may leave an empty output directory; use a new run directory after correcting inputs.

## Read the metrics with their denominators

Every rate contains `numerator`, `denominator`, and `rate` as a fraction. A zero denominator yields `null`, not 0% error or 100% accuracy. Metrics are reported overall, per template family, per gold category and per attachment format. Mixed-format cases belong to each applicable format group, so those group counts are not additive.

| Metric                                   | Numerator / denominator                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `false_clear_among_gold_blocking`        | Engine `verified` when gold is blocking / all gold-blocking cases                         |
| `error_among_verified`                   | Engine `verified` without gold support for a complete match / all engine-verified cases   |
| `review_fraction`                        | Engine `review` / all evaluated cases                                                     |
| `unnecessary_review_among_gold_verified` | Engine `review` on gold-verified cases / all gold-verified cases                          |
| `routing_errors`                         | Proposed category differs from gold category / all evaluated cases, including abstentions |
| `unreviewed_routing_errors`              | Incorrect category without a review workflow / all evaluated cases                        |

Awaiting documents and routing-only outcomes are never counted as verified. Inspect routing errors alongside false clearances: a missed comparison routed elsewhere might not be a false _verified_ result. Discrepancy details remain in the per-case predictions. `processing_latency_ms` is engine time, not employee review time. Median uses the middle value or mean of the middle pair; p95 uses the nearest-rank 95th percentile. Small-group percentiles are unstable and are not uncertainty intervals.

Pre-register sample size, inclusion/exclusion rules, representation by format/template, and safety/operational thresholds before running. Do not choose acceptable thresholds after seeing results. A zero observed false-clear count is not proof of zero risk. Once developers inspect failures or tune on this dataset, keep its results as development evidence and obtain a new frozen independent set for a new generalization claim.

## Supervised operator pilot

Before any live operational use, have an operations owner approve the pilot protocol and data handling. Keep shipment release and amendment authority with the existing staff process. Choose participants who normally perform the work; record role, experience and accessibility needs with appropriate consent. The prototype's browser workspace is not verified staff identity or corporate SSO.

Pre-register tasks such as finding a discrepancy, inspecting the cited original, handling missing evidence, and preparing a reviewable handoff. Compare normal manual work with CargoGuard-assisted work using the same task completion criteria. Counterbalance condition order, include a washout where repeated cases are used, and record exposure so familiarity is not mistaken for time saving. The paired timing format represents the same case and reviewer in both conditions, once per pair; it does not remove learning effects. A matched-case alternative needs a separately specified analysis.

An independent observer measures **active task time** from first inspection through the final recorded decision. Pause the active clock for unrelated interruptions and record those pauses separately. Include source inspection, checking AI suggestions, corrections and rework. Record waiting time separately instead of silently mixing it with active time. Capture each condition's completeness and correctness against the frozen independent labels. Retain incorrect and abandoned tasks; do not silently exclude them from the completion/error report. Stop the pilot and investigate an apparent false clearance before extending its operational use.

Record task success, missed/false differences, correction rounds, source-navigation problems and staff feedback alongside timings. The script does not fabricate or collect these observations. Use the empty `pilot-timings.template.json` after real sessions have occurred. Its provenance fields name the observer, ISO UTC capture timestamp, approved protocol reference, active-time definition, and the attestation `outcomes_independently_adjudicated: true`.

Each `samples` entry requires:

- `pair_id`, `case_id` (an evaluated holdout case) and `reviewer_id`.
- `order`: `manual_first` or `assisted_first`.
- `manual_active_seconds` and `assisted_active_seconds`: positive measured seconds, or `null` when no time was obtained for an incomplete task.
- `manual_complete`, `assisted_complete`, `manual_correct`, `assisted_correct`: independently observed booleans. An incomplete task cannot be marked correct.

```powershell
node --import tsx scripts/evaluate-unseen.ts C:/approved-data/cargo-holdout C:/approved-data/manifests/holdout.json C:/approved-data/runs/with-pilot --timings C:/approved-data/pilot-timings.json
```

The timing input gets its own SHA-256 because observations are collected after dataset freeze. The report exposes manual/assisted median and p95 for completed tasks, completion and correct-completion denominators, unique cases/reviewers, order counts, and exclusions. Paired seconds/fraction saved use only pairs completed correctly in both conditions and retain negative savings. Report all-condition correctness and excluded counts beside that subset; speed from incorrect work is not a benefit. Repeated observations across reviewers are not statistically independent. Without supplied observations, `pilot` is `null` and no time-saving claim is generated.

The added tests use temporary synthetic fixtures solely to verify hash enforcement, split rejection, real pipeline invocation, rate arithmetic and timing denominators. They are not published pilot evidence.
