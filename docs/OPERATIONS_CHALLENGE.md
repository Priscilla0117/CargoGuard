# Authored operations challenge

This is a **synthetic, self-authored 20-case engineering challenge**, created on 24 September 2026 for the hackathon. It is independent of the organiser's data generator. It is not external customer data, a blinded test, a statistically representative sample or proof of superiority over other finalists. The author had inspected the engine and regression tests before designing these scenarios.

The complete input texts and expected outcomes are in `tests/fixtures/operations-challenge.json`. The dataset was saved and its expectations fixed before its first pipeline run. Frozen SHA-256: `5e47afd4e501d2a9c9ceff34799f4a4490c6f38877d82c80cc1f215e731a6a52`. Preserve this version and every first-run failure; create a separately identified dataset version if future authoring changes are needed.

## What it measures

Every case supplies a synthetic email and full SI/BL text sources. The runner invokes the actual `parseDocument`, `analyze` and `checkDocumentIntegrity` functions. It does not force the email category or pass expectations into extraction, classification or integrity checks.

The predeclared outcomes are 11 strict matches, 5 strict mismatches and 4 mandatory reviews. Five cases independently require attention, including documents that agree on all seven fields. Scores are separate:

- **Strict comparison:** exact category, status, review reason, defect flag, defect-field set and all seven field outcomes.
- **Independent checks:** exact complete multiset of document/rule/status findings, including `not_checked`, plus the attention flag. Missing or unexpected findings fail the case. Finding order is not significant.
- **Combined:** both dimensions pass. This number must not be blended with organiser accuracy or employee productivity.

The scenarios cover container-total disagreements; tonnes/kilograms and supported optional port codes; matching placeholders; ambiguous company names; ambiguous weight notation; unsupported units; dependent notify-party changes; a draft correction that introduces a new port mistake; invalid and ambiguous container identifiers; complete versus partial container lists; equal-port advisories; and explicitly stated equipment maxima versus unavailable capacity evidence.

Cases 11 and 12 are two independent snapshots of a correction story. They do **not** exercise uploads, persistent revision history or completion. Approved-email reconciliation, roles, stale proofs and persisted handover are measured by separate workflow tests. Plain text does not establish OCR accuracy or robustness across independently sourced PDF layouts.

## Reproduce

From the repository root after `npm ci`:

```powershell
node --import tsx scripts/evaluate-operations-challenge.ts --report work/validation/operations-challenge/first-run.json
node --import tsx --test tests/operations-challenge.test.ts
```

The runner writes only under ignored `work/`, refuses to overwrite an existing report and exits nonzero on a mismatch. The report includes dataset SHA-256, engine and integrity-rule versions, source hashes, exact expected/observed details, and separate counts. Expectations are never corrected automatically. The optional `--dataset` argument supports a separately authored JSON fixture with the same validated schema; such a run has its own checksum and scope.

## Provenance and claims

Company names and emails were invented for this challenge; `example.test` is used for the sender. Container identifiers are illustrative checksum examples in fictional shipment texts. No actual customer record, shipping history, private employee information or external live-system response was used.

BIC describes the check digit as validation of the recording and transmission of a container code. A matching digit cannot establish equipment registration, ownership, physical condition or legal loading compliance. Capacity scenarios use an explicit maximum on the same source row; they do not assume a generic maximum based on container size. [BIC container identification](https://www.bic-code.org/identification-number/).

An accurate pitch is: “We added an authored operations challenge that tests strict document comparison and independent safety checks separately, including errors present in both documents.” Report the measured result with this scope. Do not call it an unseen real-world dataset or a 100% production-accuracy result.

## First run

The first run passed **20/20 strict comparisons**, **20/20 independent-check expectations** and **20/20 combined cases**, using engine **3.3.1** and integrity rules **1.0.0**. It retained all five intended discrepancies, four required reviews and five independent-attention scenarios. No false strict verification or missed independent-attention case was observed in this authored set.

The immutable report is `work/validation/operations-challenge/first-run.json`. Its dataset checksum matches the predeclared checksum above, and the runner confirmed the dataset did not change during execution. No fixture, expected result or engine code was changed after observing these results. Four separate evaluator-contract tests also passed; they prove malformed expectations and missed/extra findings cannot silently receive a passing score. They are not four additional shipment cases.
