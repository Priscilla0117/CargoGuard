# Freeze an independent pilot before measuring it

This tooling prepares and scores evidence. **No independent Averis pilot has been completed by adding it.** The 520 organiser emails and the 28 authored practice emails are development evidence; neither becomes independent merely by renaming a folder.

## Collect and label the cases

An authorised operations lead should select 30–50 distinct, real, anonymised email cases. Include unfamiliar layouts, scans (especially mixed text/scanned amendments), revised BLs and ambiguous requests. Keep complete `.eml` files with their attachments in a private folder outside the application repository. Remove personal/commercial identifiers with the company's approval before distribution.

Have an experienced reviewer label the seven fields and expected case outcomes without seeing CargoGuard's predictions. A second reviewer should adjudicate disagreements. Include related revisions in the same evaluation group and keep the entire group out of training and tuning. Decide inclusion rules before running the system, retain failures and timeouts, and record exclusions before freezing.

Create `dataset.json` next to the email files. Each case has an opaque ID, relative `.eml` filename, coverage tags and the existing five-field comparison contract. This is a schema illustration, **not a completed dataset**:

```json
{
  "schema_version": 1,
  "dataset_id": "operations-pilot-01",
  "kind": "independent_pilot",
  "attestation": {
    "real_anonymized_cases": true,
    "labels_independent_of_system": true,
    "used_for_training_or_tuning": false,
    "labels_frozen_before_predictions": true,
    "labeler_ids": ["reviewer-01", "reviewer-02"]
  },
  "cases": [
    {
      "id": "case-001",
      "file": "mailbox/case-001.eml",
      "strata": ["scan", "amendment", "mixed_pdf"],
      "truth": {
        "category": "BL_COMPARISON",
        "status": "MISMATCH",
        "review_reason": null,
        "has_defect": true,
        "defect_fields": ["gross_weight_kg"]
      }
    }
  ]
}
```

The independent-pilot mode requires 30–50 cases and coverage tags `unfamiliar_layout`, `scan`, `amendment` and `ambiguous_request` somewhere in the set. Use `kind: "development"` or `"synthetic"` for rehearsal; the report retains that designation and does not call it operational accuracy. The tool validates declarations, not their truth. It cannot establish a human labeler's independence, detect every reused example or certify anonymisation.

## Freeze before predictions

```text
node scripts/pilot-evaluation.mjs freeze --dataset /private/pilot/dataset.json --out /private/pilot/freeze.json
```

This records SHA-256 hashes of labels/metadata and every complete email. It rejects duplicate content, escaping paths and existing output files. Keep the freeze file private because it contains the dataset path and opaque case IDs. Give its returned `freeze_sha256` to the supervisor, or record it in an independently timestamped, access-controlled record **before** running the system. Local dates and hashes alone cannot prove when data was created or prevent a deliberate replacement of all artifacts.

Then run a fixed application/engine version against these emails, without tuning on the results. Preserve the raw run outputs privately. Capture the automatic state **before any human correction**. Do not substitute reviewed/fixed results for initial predictions. If a case times out or needs a person, record it explicitly; do not omit it to improve the denominator.

Prepare `predictions.json` using the returned freeze hash:

```json
{
  "freeze_sha256": "REPLACE_WITH_RETURNED_SHA256",
  "engine": "REPLACE_WITH_COMMIT_AND_ENGINE_VERSION",
  "started_at": "REPLACE_WITH_ACTUAL_ISO_TIME",
  "completed_at": "REPLACE_WITH_ACTUAL_ISO_TIME",
  "cases": {
    "case-001": {
      "prediction": {
        "category": "BL_COMPARISON",
        "status": "NEEDS_REVIEW",
        "review_reason": "unreadable",
        "has_defect": false,
        "defect_fields": []
      },
      "needs_human_review": true,
      "manual_seconds": null,
      "assisted_seconds": null
    }
  }
}
```

`needs_human_review` includes uncertain classification and any unresolved document/safety review, even when the five-field outcome is `OK`. The output contract follows the existing evaluation gate, extended to permit `NEEDS_REVIEW` with `review_reason: "uncertain_category"` in any of the five categories. This preserves real routing abstentions. It is not a direct export of the entire case object. `NEEDS_REVIEW` always requires `needs_human_review: true`.

## Measure work, not just matching fields

Measure active employee time from opening the case through the required review and preparation of the next action. Include OCR confirmation, attachment selection, corrections and follow-up preparation. Keep waiting for an external reply separate. Record the same task boundary for manual and assisted checking.

Use different reviewers or counterbalance the order with a suitable delay to reduce memory/practice effects. Pair manual and assisted measurements by case. Keep operator IDs, order of checking and exceptions in a private study log. Missing measurements are `null`, never zero. Do not claim savings from only easy cases while leaving difficult cases unmeasured.

```text
node scripts/pilot-evaluation.mjs score --freeze /private/pilot/freeze.json --predictions /private/pilot/predictions.json --out /private/pilot/report.json
```

Scoring refuses changed labels/emails, the wrong freeze hash, predictions dated before freezing, duplicate dataset IDs, missing/extra prediction IDs, invalid outcome contracts and invalid times. Existing reports are never overwritten. The report contains aggregates and hashes rather than email contents, source paths or per-case IDs.

The report separates:

- **False clearances:** an automatic `BL_COMPARISON/OK` without review when the labelled document case requires a discrepancy or review; denominator is all labelled document cases requiring action.
- **Unsafe routing away from a document check:** a case requiring action routed elsewhere without review, reported separately so it cannot disappear from the evaluation.
- **Missed discrepancies without review:** labelled defect cases receiving neither a mismatch nor human review; denominator is all labelled defect cases.
- **False alarms:** a mismatch on a labelled clean document pair; denominator is labelled clean pairs. Safe abstentions are counted separately.
- **Human-review rate:** all cases requiring a person divided by all cases, including uncertain routing.
- **Handling time:** paired-case totals and means, median paired saving, aggregate saved fraction, and separate counts for missing manual/assisted/both measurements. Negative savings remain negative.

Zero denominators produce `null`, not 100% success. A report showing zero misses in a small set is not proof of production safety. Report the sample composition, remaining failures and timing completeness with the metrics. If these examples drive a fix, retain them as regressions and collect a fresh, independently labelled set for the next unbiased evaluation.
