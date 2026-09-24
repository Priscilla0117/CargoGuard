# Model and validation card

This card describes the learned router, source recovery, case assistant and OCR in the recorded 3.2.1 baseline. The final-round follow-up extension passed local acceptance; [FINAL_ROUND_VALIDATION.md](FINAL_ROUND_VALIDATION.md) records its scope. The public deployment has not changed, and no new provider-quality result is claimed. Exact historical cloud runtime commits and acceptance are in [CLOUD_RELEASE.md](CLOUD_RELEASE.md).

## Intended use and decision boundary

CargoGuard classifies operational emails as BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL or SPAM. For comparison requests, the SI is the reference for seven fields: shipper, consignee, notify party, loading port, discharge port, container count and gross weight in kilograms. Other categories are routed; missing, unreadable or ambiguous evidence requires review.

AI supports intent classification and source interpretation. Deterministic validation and comparison produce the document result. Staff remain responsible for source inspection and operational decisions. A matching comparison or completed follow-up never authorizes cargo release.

## Current learned email router

The default router is multinomial logistic regression using TF-IDF word, word-pair and character features, with separate subject, opening-request and body channels. It ships inspectable weights and runs without an external API. Training uses independently authored synthetic material; organiser labels are not training inputs.

The recorded 3.2 artifact, `lib/routing-model.json`, has 9,244 features and SHA-256 `25b36b744cc49e09b383d01bbc2c6560fe984e4cf1670dc02b674ce5b526be2a`. Training used 910 generated rows; grouped-by-body validation had 181/182 correct. These are combinations of authored examples, not 1,092 independent real emails. Retraining to a separate file reproduced the artifact hash. Scores are uncalibrated and the model is English-focused.

Safety gates abstain on weak evidence, negated verification and competing workflows. An explicit agreeing rule can corroborate a moderate learned category; it cannot replace the learned category or bypass a hard ambiguity gate. In the original 520-message development run, 513 decisions were directly learned and seven were corroborated by an agreeing rule.

The previous 3.0.1 Naive Bayes baseline remains available for ablation. Its model-only development macro-F1 was 0.7282 and its hybrid used 391 rule-selected categories. Those historical figures do not describe the current default. See [AI_UPGRADE.md](AI_UPGRADE.md) for training and reproduction commands.

## Optional cloud AI and local OCR

**Source recovery:** With consent, bounded readable document text is sent to the configured OpenAI service. The model selects exact source fragments and line IDs. The server reconstructs values and checks source quotations, units, workspace, case revision and source hashes. The reviewer selects the role and confirms all seven fields before a proposal becomes a reviewed revision. A real quotation can still have the wrong semantic role or omit an address; grounding is not proof of interpretation accuracy.

**Case assistant:** A separate consent-gated request sends a previewed, bounded case context. Responses link to supplied evidence. The assistant cannot change a saved decision, send email or approve a shipment. Chat quality is not measured by the organiser's comparison score. Recovery and chat share persistent provider allowances; exhaustion or provider failure leaves manual review available. See [CASE_ASSISTANT.md](CASE_ASSISTANT.md).

**Scanned PDFs:** The pretrained English Tesseract model runs in a browser worker. Images and proposed text remain visible. Every field requires human confirmation, with role, source page and unchanged source hash checked on save. OCR confidence is not calibrated transcription accuracy. Corrupt PDFs require replacement.

## Recorded evaluation and its limits

| Evidence | Recorded result | What it does not establish |
|---|---|---|
| Supplied development corpus, including actual 3.2.1 hosted export | 520/520 exact outputs; 46/46 discrepancy and 20/20 review cases; organiser composite 1.0 | Untouched hold-out accuracy, production reliability or a judging score |
| Four additional same-generator sets, combined with supplied set | 2,600 exact outputs after development fixes | Independent template diversity or real-world generalization |
| Three fresh same-generator first runs on the frozen 23 September engine 3.2.1 | 1,560/1,560 exact outputs; 185/185 discrepancy cases; 60/60 required review cases; zero false verified cases observed | Independent layouts, OCR transcription accuracy, production performance or proof against overfitting |
| Separately authored 60-message routing challenge, rerun during development | 48/50 clear messages correct; both errors escalated; nine of ten ambiguous messages escalated | Perfect ambiguity detection; this is no longer an untouched holdout |
| Live recovery rerun on two unfamiliar-layout development documents | 14/14 expected field values; a third organiser document inspected through the UI | Population field accuracy; only three distinct documents were live-tested in that recovery exercise |
| Six organiser scans, historical OCR diagnostic at 180 DPI | 36/42 candidate fields syntactically usable | Correct transcription: names, punctuation and numbers still contained errors |

The fresh seeds were 314159, 271828 and 161803, fixed before generation and run once each without tuning application, model or generator code. The before/after source manifest was unchanged. [First-run metrics and provenance](../work/validation/enhancement-assessment/SUMMARY.md) retain all inputs, outputs, exact gates and scorer results; these fresh runs remain samples from the same organiser generator.

The initial recovery prompts failed on labels, complete addresses and a unit heading; the successful rerun followed fixes. Failures and provider requests are retained in [AI_UPGRADE.md](AI_UPGRADE.md), not treated as untouched successful tests. Later releases without valid provider requests are not new model-quality evidence.

The supplied workflow has 63 verified pairs, 46 discrepancy pairs, 20 review cases, 91 awaiting-document requests and 300 routed messages. The organiser output convention marks those 91 incomplete requests OK; CargoGuard never displays them as verified. Action queue counts differ because five missing-attachment review cases join the Missing documents queue.

## Evaluation integrity

The application reads email/document inputs, model weights and deterministic logic. It does not import the organiser key, per-ID answers or generated predictions. Offline verification invokes the unmodified organiser scorer with an explicitly supplied key. The user recorded an organiser clarification permitting the released key for participant self-evaluation. Renamed-ID/file regression checks protect against ID-based answer lookup.

Automatic exports admit only provably automatic, current-engine results on the supplied original sources. Human corrections, reviewed recovery, replacement files and operational follow-up cannot improve the automatic benchmark. Public validation publishes aggregate metrics and hashes; private per-case evaluation material stays outside runtime inputs.

Engineering tests cover parser boundaries, stale writes, isolation, immutable revisions, source replacement, dependent corrections, failure handling and output integrity. See dated release records for exact counts and environment. Regression assertions are not independent user cases or a statistical estimate of unseen accuracy.

## Next evaluation and known limitations

- Freeze independently authored or approved, anonymized real-document cases before tuning. Use different authors/templates and keep related email threads and document templates in one split. Preserve the first-run result and label later fixes as development.
- Report classification confusion, discrepancy precision/recall, false-clearance count, review rate and coverage by format/template. Measure workload as well as detection: excessive review can hide a weak system behind safe abstention.
- Expand live-provider testing across complete addresses, conflicting units, misleading labels, wrong-but-real quotations and embedded instructions. Keep deterministic review and explicit confirmation as the decision boundary.
- Measure active review time separately from elapsed waiting time. Pair manual and assisted tasks on comparable documents, counterbalance their order, inspect final source correctness and retain sample counts. Employee savings have not been established.
- English-focused examples/OCR, small port-alias rules, unfamiliar layouts and uncalibrated routing scores limit generalization. Arbitrary fuzzy company matching is not used. Spreadsheet formulas/error cells require inspected values-only copies.
- Public workspaces use capability cookies and self-declared reviewer/owner labels, not corporate identity. Production adoption still needs approved data handling, staff access controls, retention/backup, malware controls and broader operational testing.

Passing these bounded checks cannot guarantee zero future bugs, universal AI accuracy or first place.
