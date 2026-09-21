# CargoGuard 3.1 — AI evidence recovery and learned routing

Release status: deployed on the public Render service, 21 September 2026. Runtime commit `02462456f08c5916c53e6e7d0335ed76adf9e61b`, engine 3.1.0, recovery contract `evidence-selectors-v3`. The real OpenAI connection and 75 recovery-workflow checks passed on two synthetic unfamiliar-layout documents; a third organiser document was checked through the UI. See [CLOUD_RELEASE.md](CLOUD_RELEASE.md) for scope, earlier failures and limitations. Mocked adapter tests are not proof of model quality.

## Why this is more than adding a chatbot

The organiser requires AI as a key component, not an LLM specifically. The old Naive Bayes model was genuine AI but weak on long SI emails: 73.27% category accuracy and 0.7282 macro-F1 on the supplied development set. Its hybrid relied on 391 explicit rule decisions out of 520.

The replacement is an offline-trained multinomial logistic regression model using TF-IDF word, word-pair and character features in separate subject, opening-request and body channels. Training uses independently authored synthetic examples, not organiser labels. It ships explicit, inspectable weights; inference needs no external API, embedding service or answer lookup. The legacy model remains available for reproducible ablation, not as the ordinary router.

The model artifact is `lib/routing-model.json`, SHA-256 `4d20c503c67e65ca28eef50e2db8c12a767cf468ce196a9e812c372eff7228da`. It has 8,935 features and is approximately 751 KB as JSON. Training: 875 rows; grouped-by-body validation: 175 rows, 174 correct. Those rows are generated combinations of authored material, not 1,050 independent real emails. Scores are explicitly uncalibrated. The model is English-focused.

Model-only supplied-set category accuracy and macro-F1 are 1.0, with no category-rule override. This is still development evidence. Safety gates abstain on weak evidence, negated verification and competing workflows. A moderate learned choice may be corroborated by an agreeing explicit intent rule, but a rule cannot replace the learned category or bypass a hard ambiguity gate.

On the original 520 development emails, the final router uses 513 direct learned decisions and 7 agreeing rule corroborations, compared with 391 rule decisions in the previous hybrid. Removing the learned model is not equivalent to keeping a functional default router. This is measurable AI contribution, not a claim that rules are inherently undesirable.

## Evidence Recovery Copilot

The optional OpenAI integration addresses unfamiliar readable text layouts. It proposes the seven required field mappings with exact source line IDs and quotations. The server reconstructs values from those quotations; it never accepts an LLM-generated normalized number, verdict, tolerance or payment instruction.

The source document is treated as untrusted data. The model has no browser, tools, email-sending capability or arbitrary network endpoint. Input and output are bounded; the provider endpoint and model are allowlisted. Corrupt files, image-only scans, known invoices/packing lists, oversized text and truncated sources cannot enter this workflow. Existing local OCR remains the scan path.

The reviewer must choose the role and individually confirm all seven fields. Nothing is checked by default. Null or ambiguous proposals cannot be saved. The proposal is bound to workspace, case revision, document SHA-256 and extracted-text SHA-256, expires after 30 minutes, and is checked again on save. Original source lines are retained. Accepted recovery is a human-reviewed revision and never becomes untouched automatic benchmark evidence.

Grounding proves a quote exists, not that the model understood its meaning. A wrong-but-real quote, incomplete company address or wrong semantic role remains possible. Human review and real-model evaluation are required. Do not describe this feature as hallucination-proof.

## Judge access and costs

Judges use the ordinary public Render link. They do not need an OpenAI account or key. The key belongs to the app owner and stays in Render's server-side environment; it must never appear in Git, browser JavaScript, screenshots, chat or a `NEXT_PUBLIC_` variable.

Approved usage is limited to the owner's existing API balance; no purchase, subscription upgrade or automatic top-up is part of this release. Application limits are hard upper bounds, not provider quota promises: 20 attempts globally per UTC day, 100 attempts for this database lifetime, 3 per workspace/day, 2 concurrent calls, 100,000 conservatively reserved token units/day, 3,072 maximum output tokens and a 25-second provider timeout. Other limits can stop calls sooner. Failed calls consume quota; restarting Render or resetting cookies does not refund it. Public traffic can exhaust the shared allowance, so check remaining capacity before judging. Do not remove attempt records to bypass the owner's approved cap.

Each request requires explicit consent to share organiser/synthetic extracted text. No confidential operational shipments should be uploaded to this public prototype. `store:false` disables response storage where supported; it is not a zero-retention guarantee. Consult the provider's data controls. A provider failure is displayed honestly; deterministic review remains available and no fixture is substituted as a live AI answer.

Configure these values through Render's Environment page, preserving existing database settings:

```text
CARGO_AI_PROVIDER=openai
CARGO_AI_MODEL=gpt-5.4-mini
CARGO_AI_API_KEY=<enter the restricted project key directly in Render>
```

The key needs permission for the Responses endpoint. Do not enable auto top-up as part of this task. To stop new external calls, remove `CARGO_AI_PROVIDER`. Existing reviewed evidence remains readable.

Official references: [server-side key handling](https://developers.openai.com/api/reference/overview), [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [model and pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini), [data controls](https://developers.openai.com/api/docs/guides/your-data).

## Operational feature

The Resolution tab creates a deterministic, evidence-linked next-action checklist and downloadable handoff. It preserves known differences even when another field is uncertain, distinguishes missing evidence from actual mismatches, and directs staff to request, correct and recheck documents. The packet contains the exact revision, policy note, seven-field evidence and original source hashes. It never sends messages or authorises cargo release.

## Reproducible evidence

```text
node --import tsx scripts/train-router.ts work/validation/ai-v31/reproduced-model.json
node --import tsx scripts/evaluate-routing.ts /path/to/ground_truth.json tests/fixtures/ai-routing-challenge.json
npm run quality -- --build
```

The 60-case challenge was authored separately: 50 clear and 10 deliberately ambiguous messages. The initial learned model classified 48/50 clear cases correctly; both incorrect choices were escalated with safety gates. Eight of ten ambiguous messages were escalated. The trained weights were fixed before evaluation. The final consensus/coverage policy is development work; do not represent its later reruns as a new untouched holdout. This small synthetic challenge is not a statistically representative production benchmark.

The first live provider test of prompt v1 returned labels inside values and omitted party addresses. Numerical validators blocked confirmation; no case was approved. Prompt v2 explicitly requests value-only substrings and complete party/address blocks. Its SI recovery passed, but the transposed BL returned a full unit heading (`total gross kilograms`) that the overly narrow validator rejected. Contract v3 allows a finite, explicit gross-unit heading grammar while still rejecting negation, net/tare units, alternatives, assumptions and conflicting source units. These corrections use development feedback: later reruns are not held-out evidence.

The final live rerun recovered all 14/14 expected fields on the two development documents, with provider latencies of 2,482 ms and 2,449 ms and 3,077 actual tokens combined. It passed source-grounding, no-change-before-confirmation, cache reuse, workspace isolation, consent, unchecked-field rejection, stale-save rejection, audited confirmation and source-identical reprocessing checks. The resulting six discrepancies were retained. A third UI-only organiser-source proposal displayed all seven correct fields with confirmations unchecked and Save disabled; it did not alter the case.

Six provider requests were made during this validation, including the earlier unsuccessful proposals. They count toward the persistent caps. Only these three distinct documents were live-tested: the other eight recovery-challenge fixtures were not evaluated live, and neither rare layouts nor adversarial instructions have comprehensive real-provider validation. This is not a production field-accuracy estimate or a hallucination-proof guarantee. Use [the synthetic demonstration guide](../examples/evidence-recovery/README.md) and inspect every proposed value. Winning the hackathon and zero future bugs cannot be guaranteed.
