# CargoGuard — requirements coverage

Coverage is based on the supplied Shipping Document Verification use case, rules, preliminary/final rubrics and organiser clarification permitting offline self-evaluation. Features, measured evidence and future work are distinguished below.

## Core workflow

| Requirement | Implementation | Evidence |
| --- | --- | --- |
| Classify five email types | BL comparison, shipping-instruction request, invoice query, general and spam; learned routing with safety abstention | [Model card](MODEL_CARD.md), routing tests and dated evaluation |
| Only comparison requests proceed to shipment checking | Category-gated seven-field extraction/comparison; other messages remain routed | Processing/pipeline tests |
| Read the supplied formats | TXT, text PDF, DOCX and XLSX from original bytes | Parser tests; unchanged 520 emails and 250 documents |
| SI is the reference | Shipper, consignee, notify party, loading/discharge ports, container count and gross weight | Seven-row report with raw/normalized values and source references |
| Report precise differences or no mismatch | Side-by-side findings, overall outcome and email identity | [Verification report](SUBMISSION_CHECK.md); supplied defect and matching cases |
| Escalate missing or unclear evidence | Incomplete/review states with reasons and next actions | Missing, scan, corrupt-input and ambiguous-value regressions |
| Confirm/correct and update the report | Source-checked edits, all-field scan confirmation, version-checked saves and retained history | [User workflow](REVIEW_WORKSPACE_V32.md), revision and review tests |
| Visible errors, retry and replacement | Controlled failures, explicit reprocessing, replacement validation and non-replayed writes | [Failure/acceptance evidence](CLOUD_RELEASE.md) |
| Meaningful AI and cloud | Trained router; optional consented OpenAI; Render processing and persistent Turso storage | [Architecture](ARCHITECTURE.md), [model evidence](MODEL_CARD.md), [case assistant](CASE_ASSISTANT.md) |

A document match is not shipment-release approval. Extra attachments are retained but not verified; the report covers the selected pair. English OCR produces suggestions that require human confirmation.

## Judging criteria and technical evidence

| Criterion | Evidence in this submission |
| --- | --- |
| Preliminary architecture / final architecture and scalability — 15 | Component responsibilities, data flow, API contracts, transactional persistence and explicit scale limits in ARCHITECTURE.md |
| Preliminary core prototype / final end-to-end functionality — 25 | Classify, extract, compare, inspect evidence, confirm/correct, recheck and inspect history |
| Technology integration — 15 | Learned routing, supported document parsers, real cloud persistence and separately validated optional OpenAI |
| Preliminary feasibility/validation / final robustness — 15 | Reproducible test scripts, independent supplied-corpus scoring, source integrity, version checks, isolation and failure handling |
| Preliminary problem understanding / final effectiveness — 10 | SI-reference comparison and actionable discrepancy/human-review outcomes |
| Preliminary innovation / final UX and differentiation — 10 | Explicit source-pair scope, linked-field previews, retained evidence and case-specific source-linked assistance |
| Preliminary practical value / final impact and future potential — 10 | Proposed supervised pilot with review-time/error measures; corporate controls and capacity work clearly identified as future |

The supplied final rubric marks Technology Integration provisional. These mappings identify evidence, not awarded marks. Supplied-data agreement is not unseen production accuracy, and no employee savings study is claimed.

## Required technical documentation

| Topic | Location |
| --- | --- |
| Technical architecture and implementation | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Setup, reproduction and operating limits | [DEVELOPMENT.md](DEVELOPMENT.md), [DEPLOYMENT.md](DEPLOYMENT.md) |
| Problem-solution alignment | [Written response 1](WRITTEN_RESPONSES.md#1-problem-solution-alignment) |
| AI/cloud integration | [Written response 2](WRITTEN_RESPONSES.md#2-ai-and-cloud-infrastructure-integration) |
| User feedback/testing | [Written response 3](WRITTEN_RESPONSES.md#3-user-feedback-and-testing) |
| Coding challenges | [Written response 4](WRITTEN_RESPONSES.md#4-coding-challenges--challenges-faced) |
| Success metrics | [Written response 5](WRITTEN_RESPONSES.md#5-success-metrics) |
| Scalability/future roadmap | [Written response 6](WRITTEN_RESPONSES.md#6-scalability-plans--future-roadmap) |

Original organiser inputs are runtime examples; answer keys remain offline-only evaluation inputs. Tests and fixtures are retained for reproducibility. Attribution and library notices are part of the source submission.
