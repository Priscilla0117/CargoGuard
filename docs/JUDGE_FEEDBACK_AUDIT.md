# Preliminary feedback audit and 3.4.1 refinement

Audited against the judges' supplied feedback on 24 September 2026, starting from final-branch commit `d49d5fc`. The exact examples had been fixed in 3.4.0, but surrounding edge cases and one attachment-reopening workflow still needed correction.

## What is resolved, and what remains

| Judge concern | Starting branch | 3.4.1 outcome and evidence |
|---|---|---|
| Both shippers contain `TBA / TBC` or `TO BE ADVISED (TBA)` | Exact cases already required review | Extended to compact combinations, punctuation, Unicode/invisible formatting, unknown values with addresses/codes, and provisional annotations. Matching unknown text never qualifies as known evidence in the tested cases. |
| Similar unknown-value errors | Some variants could still verify | Reproduced `TO BE ADVISED.`, `NIL.`, `TBA:TBC`, `TBA-TBC`, `T/B/C`, zero-width variants and unconfirmed real-name suffixes; added regressions across all seven fields, with legitimate company-name and `TO ORDER` controls. |
| Hostile text around a known discrepancy | Strong discrepancy-preservation tests already existed | Added fullwidth/invisible-character cases and phishing controls. A software instruction used as the actual field value requires review, preserves raw evidence and cannot clear a genuine mismatch elsewhere. Regex recognition is one signal; deterministic comparison and human-review boundaries remain the protection. |
| Classify before parsing irrelevant attachments | Only spam skipped parsing; confirming SPAM reopened files | Spam remains unopened even after SPAM confirmation. Confident non-comparison messages with entirely obvious unrelated file sets defer parsing. Ambiguous names and mixed sets with SI/BL candidates remain inspected to guard against misrouting. |
| Reopen a misrouted document case | Category confirmation reused unopened placeholders | Confirming a non-SPAM category immediately reopens retained originals and runs the full comparison. Original-byte identity, revision retention and stale-write rejection have HTTP coverage. |
| Unseen independently labelled evaluation | No Averis pilot evidence | Working freeze/run/score tooling now fingerprints sources, labels and engine; reports false clearances, abstention, misroutes, errors and real timing observations. Independent records, supervisor labels and staff observations still have to be collected. |
| Enterprise authentication | Working local team accounts and role checks | Retained and tested. Entra SSO/MFA, provisioning, offboarding and enterprise security acceptance remain deployment work; local team login is not enterprise SSO. |
| Scalable queued processing | Bounded synchronous batches | Still a roadmap item. A durable queue, isolated workers, object storage, retries/dead-letter handling and load testing have not been implemented or claimed. |
| Direct enterprise email/system integration | Graph/Outlook adapter with mocked integration tests | Live tenant acceptance remains pending: no usable test tenant/app identifiers or consent were provided. No real mailbox, Teams or ERP operation is claimed. |

## Employee experience

- Unknown fields explain why confirmation is needed. Their original text remains visible beside its source link; other genuine differences stay visible.
- Deferred attachments say their contents were **not inspected**. They are not represented as successfully parsed or corrupt.
- Independent checks now match the main workspace's visual language: readable count tiles, clear evidence disclosures, source fingerprints, responsive wrapping, keyboard focus and a visible retry state.
- Long lists of checks that lack evidence are grouped under an explicit “checks not completed” disclosure. Counts remain visible, while actual issues remain expanded and easier to find.
- Mismatch explanations describe patterns to investigate. They do not claim to know the issuer's intent or silently change a strict verdict.
- Imported-case headings use a readable label rather than a long internal UUID; the canonical identifier and saved evidence remain unchanged.

## Measured evidence

### Fresh first-run same-generator assessment

Seeds were fixed before generation and each was run once without tuning. The real `processEmail` path received emails and source bytes; only the subsequent scorer received the answer key.

| Seed | Exact expected outputs | Defects caught | Required reviews caught | False verified cases |
|---|---:|---:|---:|---:|
| 219971 | 520/520 | 53/53 | 20/20 | 0 |
| 329983 | 520/520 | 52/52 | 20/20 | 0 |
| 439997 | 520/520 | 49/49 | 20/20 | 0 |

Combined: **1,560/1,560** exact outputs, **154/154** defects, **60/60** required reviews, **0 false clearances among 162 actually verified cases**. The other cases include discrepancies, reviews, requests awaiting documents and non-comparison mail. An organiser `OK` status on a document request is not counted as a verified shipment.

Frozen 29-file source digest: `e763255898c69c5c13bdc850dbbb3bb31b475113bf4fdff9c18586c2caa9e4e8`. Source fingerprints were identical before and after the experiment. Aggregate evidence is in `public/validation.json`; private local first-run inputs, predictions and failures are retained under `work/validation/judge-feedback-341`.

These results measure consistency within the organiser generator, not unseen real-world layouts. The 20-case authored operations challenge and the three pilot-runner examples are developer-authored evidence and are kept separate. Do not combine overlapping test selections or present these as a completed Averis pilot.

### Engineering and workflow checks

The local gate passed TypeScript, ESLint, **624/624 regression tests**, original-data byte integrity, all 520 supplied outputs scored independently, local OCR staging and the production build. Additional runtime checks passed 14 intake assertions over 11 HTTP requests and 49 team/authentication/persistence assertions over 44 HTTP requests. UI review at 1440 px and 390 px found no panel overflow or browser warnings/errors. A real mobile import of matching `TBA:TBC` values displays Needs review and disables completion; the state persisted after restart.

The published evidence follows the completed local gate. CI repeats regression, type/lint, authored challenge, synthetic pilot-runner smoke, production build, team workflow and attachment-intake HTTP checks on the pushed commit.

## The strongest final-round story

“You showed us that matching unknown values were being accepted. We reproduced the defect, fixed the exact examples and nearby variants, and can show the same case being held for review in the running product. We also test what happens next: a misrouted message reopens its original files, a revised draft is fully rechecked, and unresolved evidence cannot be signed off. Public reference checks can find contradictions shared by both documents. Every decision stays linked to source evidence.”

Demonstrate that story in three steps: unknown values held safely; a real mismatch explained and supported by the port register; a corrected revision rechecked and completed only when resolved. Then show the exact-version evaluation and the pilot measurement procedure. This supports reliability, employee value and differentiation with observable behavior, without predicting other teams' features or a winning score.

## Production acceptance plan

| Stage | Required implementation/evidence | Acceptance owner |
|---|---|---|
| Supervised pilot | Independently adjudicated labels frozen before prediction; diverse approved sources; false-clearance/workload measures; counterbalanced observed staff timings; retained failures | Averis operations and study supervisor |
| Enterprise identity | Entra single-tenant authorization-code flow with validated issuer/audience, state/nonce and PKCE; approved role mapping, session policy, MFA, provisioning and offboarding tests | Averis IT/security |
| Reliable asynchronous intake | Durable job records; immutable source objects; idempotency keyed to source hash/version; bounded isolated workers; lease expiry, retry limits, dead-letter review and queue-depth/latency monitoring | Platform/operations team |
| Live integrations | Approved test app/permissions; mailbox-to-case reconciliation; consent and token handling; real import/draft acceptance; reviewed sending; ERP contract tests | Averis IT and process owners |
| Wider deployment | Restore drill, retention/access policies, security testing, representative peak-load measurements and operational ownership | Deployment owner |

The proposed identity flow follows [Microsoft's authorization-code/PKCE guidance](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow). The queue plan uses independently scalable consumers and idempotent processing as described in [Microsoft's competing-consumers pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/competing-consumers). These references support the roadmap; they are not evidence that those integrations are already deployed.

No championship, zero-future-defect claim or enterprise-readiness certificate follows from a regression pass. The concrete advance is stronger safeguards, clearer employee actions and reproducible evidence for the next adoption decision.
