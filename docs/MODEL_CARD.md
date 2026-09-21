# Model and validation card

## Intended use

Triage shipping-related emails into BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL and SPAM; compare an SI and draft BL across seven required fields. Human staff remain responsible for final operational decisions.

## AI implementation

Multinomial Naive Bayes learns token likelihoods from 64 independently authored intent examples in lib/classifier.ts. It uses smoothing and a vocabulary derived only from those examples. Explicit intent rules supplement the model for operational subject conventions, reminders and scam language. These rules were refined while inspecting the supplied development corpus.

This is a lightweight hybrid classifier, not a large language model. Routing scores are uncalibrated. No API key is needed. It does not call a commercial AI service, and does not claim semantic understanding of arbitrary documents. Current-message intent takes priority over misleading subject lines. Too little evidence, competing scores or contradictory SI/BL attachments trigger category review. Additional scam/administrative rules were refined against the synthetic challenge sets; those sets are consequently development evidence.

An additional pretrained English Tesseract OCR model runs in the browser on image-only PDFs. Its output is a suggestion, never an automatic verification decision. Every field requires human source confirmation. Server-side comparison validates those confirmed values through the same normalizer used for text-layer extraction.

## Evaluation boundary

Application imports: supplied email/attachment inputs, authored examples, deterministic parser and comparison code.

Offline-only evaluation: scripts/verify-evaluation.mjs reads an explicitly supplied organiser ground-truth key, invokes their unmodified scorer and fails nonzero on schema, coverage or output differences. It runs in the quality gate. The application never imports that key, metadata labels, generated predictions or an ID-to-answer mapping. Public validation.json contains aggregate metrics and hashes only. Renaming IDs/files does not change predictions in the regression test.

The organiser explicitly clarified that the released Docker key is for participant self-evaluation and the older README restriction was outdated.

## Measured development result

The final tested development run matches all 520 organiser outputs:

| Measure | Result |
|---|---:|
| Email classification accuracy / macro-F1 | 100% / 1.000 |
| Defect precision / recall / F1 | 1.000 / 1.000 / 1.000 |
| Exact end-to-end defect catch | 46 / 46 |
| Review cases and review reasons | 20 / 20 |
| Organiser automated composite score | 1.000 |

These are development-corpus results, not an untouched hold-out benchmark, not real-world accuracy, and not the hackathon judging score. Rules and parser behavior were adjusted after examining errors. Never present these figures as independent evidence of generalization.

Actual workflow totals: 63 verified pairs, 46 discrepancy pairs, 20 review cases, 91 awaiting-document requests, 300 messages routed elsewhere. The 91 requests have organiser status OK but are never displayed as verified documents.

## Additional evidence

197 regression tests in eleven automatically discovered files cover independent field mutations; whole-expression and 400 generated compound-count checks; unit-bearing labels; placeholders; duplicate labels; misleading subjects and quoted threads; correction dependencies; uncertain routing; bounded parsing; source identity; scan confirmation; policies; immutable storage transactions; reverse-proxy origin safety; malformed requests; client ordering; failing accuracy gates and actual PDF font/CMap resource loading. The earlier 126-test gate omitted an inherited test file; this is corrected and disclosed in DEFENSIBILITY.md. Run `npm run quality` for retained logs and the independent organiser accuracy gate.

72 local API integration checks cover all 520 records through the standard Next.js/Node/libSQL path, exact exported predictions, isolation, cross-origin protection, uploads, corrections, stale saves, audit integrity, replacement, reprocessing and restricted sources. Another 35 hardening checks and 23 governance checks cover race conditions, scan review, quotas, stale policy previews, historical sources and labelled exports. These are local production-build tests, not proof of hosted performance.

These tests are engineering regression coverage, not a statistical estimate of unseen accuracy.

Four additional same-generator datasets (seeds 7, 20260920, 20260921, 8675309; 520 emails each) were evaluated and used for fixes. Version 3 matches every expected output across these and the original set: 2,600 emails, 267/267 exact defect catches and 100/100 review cases. No expected defect/review case was shown as verified. Seed 8675309 originally exposed a v2 promotional-routing mistake and is now development evidence, not a holdout. The same 12 targeted HarborCheck-comparison probes now pass 12/12 versus v2's 9/12; these deliberately chosen diagnostics are not a random benchmark.

The supplied-corpus routing ablation is reproducible with `node --import tsx scripts/ablation.ts /path/to/ground_truth.json`: model-only classification accuracy 73.27%, macro-F1 0.7282; hybrid 100%, macro-F1 1.000. Version 3.0.1 uses an explicit rule for 391/520 records and model-only routing for 129/520. The rules matter; these results must not be described as learned-model-only accuracy. A rules-only baseline and independent real-world benchmark remain future evaluation work.

All six image-only organiser PDFs were rendered and OCR-read with the shipped model. At 180 DPI, 36/42 candidate fields were syntactically usable; that is **candidate completeness, not transcription accuracy**. Company names, punctuation and numbers still contain errors. Mean per-page model confidence ranged 69–83/100 in this diagnostic run. Browser rendering may yield different text. No scan is cleared from confidence alone; page images, manual edits and seven explicit confirmations are required. Malformed PDFs cannot use the scan-confirmation route.

## Known limitations and next evaluation

- Excel formulas/error cells require a recalculated, inspected values-only export. No cached formula result is treated as independently verified. Unsupported or conflicting weight units and extra unknown documents are sent for review.

- OCR is English-only, up to five pages and 5 MB, and may be slow on low-powered devices. Initial model download is several MB. Human-confirmed transcription or readable replacement is required; unattended OCR clearance is intentionally absent.
- Unfamiliar unlabeled layouts may not extract correctly; review/unknown handling needs a much broader real-document benchmark.
- Conservative normalization tolerates spacing, punctuation and explicit numeric units. A small explicit list handles matching optional port codes; unknown or contradictory codes are not stripped. It does not guess arbitrary port aliases or accept fuzzy company-name matches.
- Hand-authored classifier examples are small and English-focused; assess multilingual and forwarded-thread behavior before production.
- A field correction changes extracted data, not the authoritative original file. Reviewers must actually inspect the source.
- Benchmark synthetic inputs are clean compared with operational emails. Obtain approved, anonymized historical examples; freeze a hold-out set before further tuning; measure error by format/template/category and human review workload.
- Extend the measured model-only/hybrid ablation with a rules-only baseline on that future hold-out set. Avoid inflated AI claims.
