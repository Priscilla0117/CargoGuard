# Operations experience upgrade — 21 September 2026

Historical release record: the later [laptop-first workspace](LAPTOP_WORKSPACE.md)
merges Operations/Inbox/Review into Work queue and adds before/after revision
comparison. Existing operations safeguards and functions remain available there.

This release improves the employee workflow without changing the comparison engine, learned router, external LLM contract, database schema or API allowances. The engine remains **3.1.0**; the Git commit identifies this UI/workflow release. It does not turn a hackathon prototype into a certified enterprise product.

## What changed and why it matters

| Feature | Employee task | Deliberate limit |
| --- | --- | --- |
| Operations desk (new landing view) | Find work by required action: process/recheck, amend, recover evidence, request documents, inspect completed comparisons, other desks | These are work queues, not predicted urgency, assignments or SLAs. Old-engine results cannot enter the completed queue |
| Discrepancy patterns | See which of the seven fields repeatedly differs; choose a topic for a process-improvement discussion | Counts are observations, not causal explanations, supplier ratings or money saved |
| Workspace shift brief | Download all lane counts and case/revision references for handoff | Snapshot only; no automatic email, sharing or dispatch |
| Evidence Navigator | Ask five useful, bounded case questions; jump directly to the supporting source lines | Deterministic case guidance, clearly labelled **not an LLM chat**; no new external data transmission or API spending |
| Amendment Studio | Preview a draft populated from SI/BL differences, check sources, acknowledge review, then download | No sending or case mutation. Partial checks disclose unresolved fields; invalid/missing values are never invented. Reloading/revision changes reset acknowledgement |
| Comparison focus | Hide matching rows while working on differences and uncertainty | The visible field count remains explicit; this does not change any verdict or export |
| Responsive layout and focus states | Use queues and review controls on desktop and phone-width screens, with visible keyboard focus | Not a full accessibility certification or a substitute for an employee usability study |

The final judging rubric gives 25 points to end-to-end functionality and 10 each to user value, UX/differentiation and impact. These changes target the actual work loop: **find → inspect → request correction → replace source → recheck → retain evidence**. They do not earn marks merely by having more buttons or by using an LLM for deterministic questions.

## Why not a general AI chatbot?

The product already has real, consent-gated OpenAI extraction for difficult readable layouts. A general chat could consume the shared recovery allowance, expand the data being sent and give plausible but unsupported shipping advice. This release therefore makes the ordinary case questions instant, source-linked and deterministic. Do not call this navigator a new generative model or present its answers as additional model-evaluation evidence.

No requests were added to the OpenAI API. The existing 20/day, 100/lifetime document-attempt caps and other recovery limits are unchanged. Questions about legal compliance, payment and cargo release are outside the navigator's authority.

## Reproducible evidence

- `tests/operations.test.ts`: 22 targeted tests covering queue partitioning, stale engine handling, malformed comparison rows, supported/partial/blocked drafts, readiness and immutability.
- Complete regression gate: 250 tests across 15 files; typecheck, lint, organiser input integrity, original-corpus evaluation, independent organiser scorer, OCR staging and production build.
- `node --import tsx scripts/test-operations-corpus.ts`: 25,058 assertions over the 2,600 existing development outputs. Checks all five bounded answers, original source values, no input mutation, queue membership and draft eligibility. This is **not** 25,058 independent user scenarios, a new model benchmark or an untouched holdout.
- Original organiser queues: 46 amend, 15 recover, 96 request documents, 63 comparison-complete, 300 routed. The 96 includes five missing-attachment human-review cases plus the 91 awaiting-document cases; the underlying 20-review/91-awaiting verdicts are unchanged. Queues and verdicts answer different questions.
- Partial amendments are possible for the five missing-value cases with known differences. Their unknown fields remain unresolved. A draft is never evidence that an issuer corrected a document.
- Comparison pipeline/model/provider implementation files are unchanged by this release; no provider calls are needed to test these additions.

Browser acceptance and final cloud commit are recorded in `CLOUD_RELEASE.md` after deployment. Validation logs remain in ignored `work/validation`; no cookies or per-case answer keys are published.

## A useful 90-second product demonstration

1. Run the inbox. On Operations desk, explain the actual work queues and select Resolve differences.
2. Open organiser `email_004`. Focus on the two different fields; open their source evidence.
3. Open Resolution. Ask “Which evidence needs attention?” and follow a source link. Ask “Can I hand this over?” to demonstrate that a mismatch cannot be treated as verified.
4. In Amendment Studio inspect the exact SI reference and current draft BL values. The download stays disabled until the reviewer acknowledgement. Download is a draft, not a message sent.
5. With an appropriate synthetic test case, replace the corrected draft BL and show the recomputed result and immutable history. Do not change extracted values merely to make the documents match.

For a manager, show the field-pattern counts and shift brief. Describe a proposed pilot that measures time per reviewed case, repeated amendments and false clearances against source-checked outcomes. **Do not invent a time-saving percentage or claim employee adoption before measuring it.**

## Known boundaries

This is not shared assignment software: browser workspaces remain separate. No live corporate mailbox/ERP integration, SSO/RBAC, SLA/ETA calculation or supplier-risk model was added. Public demonstration data must remain synthetic/organiser material. Free-host cold starts, shared API allowances, expiring database credentials and the model's generalization limits still apply. Neither zero bugs nor first place can be guaranteed.
