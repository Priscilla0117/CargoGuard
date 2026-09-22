# Model and validation card

CargoGuard 3.2.1 uses learned email routing, deterministic document comparison, browser-local OCR and optional OpenAI assistance. These components have different responsibilities and evidence; a successful comparison benchmark is not an LLM-accuracy result.

[Architecture](ARCHITECTURE.md) · [Dated cloud/provider evidence](CLOUD_RELEASE.md) · [Latest technical verification](SUBMISSION_CHECK.md)

## Intended use and decision boundary

Route emails into **BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL or SPAM**. Only comparison requests proceed to seven-field shipment comparison, with the Shipping Instruction as reference. Missing, ambiguous or unreadable evidence requires human review.

| Component | Responsibility | Limit |
| --- | --- | --- |
| Learned router | Identify the email's request | May misclassify or abstain; scores are uncalibrated |
| Parsers and exact comparison | Extract source-backed fields, normalize supported values and identify differences | Unknown layouts/units and conflicting values require review |
| Browser OCR | Suggest English text from scanned PDFs | Every field requires inspection and confirmation |
| OpenAI recovery | Propose field mappings from readable source lines | Quotes can be real but semantically wrong; seven confirmations are required |
| OpenAI case assistant | Explain a selected saved case and suggest follow-up wording | Advisory only; cannot change a decision, send email or approve cargo |

## Current learned router

The server runs an offline-trained **multinomial logistic regression model** with TF-IDF word, word-pair and character features in separate subject, opening-request and body channels. Training uses independently authored synthetic examples, not organiser labels or answer-key lookups. Explicit weights are shipped in [routing-model.json](../lib/routing-model.json); inference needs no external API.

- **910 training rows**, plus **182 grouped-by-body validation rows** with **181 correct**. These are generated combinations of authored examples, not 1,092 independent real emails.
- **9,244 features**; canonical LF-formatted model JSON size **776,816 bytes**.
- Canonical model SHA-256: `25b36b744cc49e09b383d01bbc2c6560fe984e4cf1670dc02b674ce5b526be2a`. Git's Windows CRLF conversion can change the checked-out byte hash without changing the JSON model; compare the LF artifact produced by the trainer.
- English-focused; numerical scores are not calibrated probabilities.
- Safety gates escalate weak evidence, negated verification and competing workflows. An agreeing intent rule may corroborate a moderate learned choice, but cannot replace the learned category or bypass a hard ambiguity gate.

The model was refined after a targeted security-incident-reporting error. Repeated challenge results are therefore development evidence.

### Routing evidence and historical baseline

| Dataset / mode | Recorded result | Interpretation |
| --- | --- | --- |
| 520 supplied emails, current model alone | Accuracy 1.0; macro-F1 1.0 | Supplied development data, not untouched holdout accuracy |
| 520 supplied emails, current default router | 513 direct learned decisions; seven agreeing-rule corroborations | These are routing paths, not additional test cases |
| 60-message authored challenge: 50 clear messages | 48/50 raw learned categories correct | Both incorrect choices were escalated by the default safety wrapper |
| Same challenge: ten intentionally ambiguous messages | Nine escalated by the default wrapper | One was not escalated; the model is not perfectly uncertainty-aware |
| Replaced 3.0.1 Naive Bayes model alone, supplied emails | Accuracy 73.27%; macro-F1 0.7282 | Historical baseline, not the current model |
| Replaced 3.0.1 hybrid, supplied emails | Macro-F1 1.0; 391 rule decisions and 129 model decisions | Rules materially drove that older result |

In the current default challenge run, nine of the 50 clear cases also went to review. All 41 accepted clear cases were correct in this small diagnostic set. Abstention reduces accepted errors but creates review work; it does not establish broad real-world safety. The challenge is synthetic and was reused during development.

## Evaluation separation

The application reads supplied email/attachment inputs, authored training artifacts and implementation code. It does **not** import the organiser ground-truth key, metadata labels, stored predictions or an ID-to-answer map. Regression coverage checks that renaming IDs/files does not change predictions.

The organiser clarified that the released Docker ground truth is available for participant self-evaluation. The offline verifier reads an explicitly supplied key, checks exact schema/coverage/outputs, and runs the unmodified organiser scorer. [Aggregate validation](../public/validation.json) contains metrics and hashes, not the answer key.

The current supplied-data result is **520/520 exact outputs**, including **46/46 defect cases** and **20/20 review cases**. Four additional sets from the same organiser generator also matched, producing **2,600 total development outputs**. These share templates and informed fixes; neither result establishes unseen-document accuracy or a hackathon judging score.

The 91 attachment-free comparison requests use the organiser's `OK` export convention but remain visibly **awaiting documents**, not verified pairs.

## Optional source-quoted recovery

For an unfamiliar **readable text layout**, the server sends bounded extracted lines to OpenAI after explicit consent. The model proposes exact line IDs and value quotations; the server reconstructs values and validates source membership and units. It does not accept an LLM-generated verdict, tolerance or normalized number.

The proposal is bound to workspace, case revision, document SHA-256 and text SHA-256, expires after 30 minutes, and is revalidated before save. The reviewer selects the role and confirms all seven fields individually. Accepted recovery creates a labelled human-reviewed revision, never untouched automatic benchmark evidence.

Corrupt files, image-only scans, known invoices/packing lists, oversized text and truncated sources are excluded from this recovery path. A source quote proves that text exists, not that its meaning or field assignment is correct. Wrong-but-real quotations and incomplete company addresses remain possible.

**Dated live evidence, 21 September:** two synthetic development documents ultimately produced 14/14 expected fields after earlier prompt/validator failures were corrected. One additional organiser document was visually checked without saving. Only three distinct documents were live-tested; eight other recovery fixtures were not. Six provider requests included unsuccessful proposals. This is not production field accuracy or comprehensive adversarial validation. See [the full provider-test scope](CLOUD_RELEASE.md#live-provider-evidence).

OpenAI has no browsing, tool execution, automatic emailing or model-chosen endpoint. Bounded contracts and citations do not establish prompt-injection immunity or hallucination-proof behaviour. [Case assistant documentation](CASE_ASSISTANT.md) describes the separate chat workflow.

## OCR and parsing limits

All six supplied image-only PDFs were rendered and OCR-read in the earlier diagnostic. At 180 DPI, **36/42 candidate fields were syntactically usable**: this measures candidate completeness, **not transcription accuracy**. Names, punctuation and numbers still contained mistakes. Mean per-page OCR confidence ranged 69–83/100; browser rendering may produce different text. Confidence alone never clears a scan.

Browser OCR is English-only, limited to five pages and 5 MiB, with a three-minute timeout. Human confirmation must include all seven fields, role and source pages. Corrupt PDFs require replacement.

Other limitations include unfamiliar/unlabelled layouts, multilingual requests, forwarded-thread intent and unfamiliar company/address constructions. Formula/error cells in XLSX require an inspected values-only export. Normalization supports explicit units and a small port-code equivalence list; it does not guess arbitrary aliases or fuzzy company matches. An extraction correction changes saved values, not the authoritative original file.

## Reproduce and extend

From the repository root:

```text
node --import tsx scripts/train-router.ts work/reproduced-model.json
node --import tsx scripts/evaluate-routing.ts /path/to/ground_truth.json tests/fixtures/ai-routing-challenge.json
npm run quality -- --build
```

See [setup and organiser-path overrides](DEVELOPMENT.md#reproduce-the-checks). These are offline/local checks; they do not make paid provider requests. Mocks verify contracts and error handling, not real-model answer quality.

Before production, obtain approved anonymized operational material, freeze independently labelled holdouts before tuning, and measure category errors, extraction accuracy, false clearances and human-review workload by language, format and template. An Averis employee usability study and production ROI measurement remain future work.
