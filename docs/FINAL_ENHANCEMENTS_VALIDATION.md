# CargoGuard 3.3.1 — final enhancement validation

> **Current release handover:** [EMPLOYEE_RELEASE.md](EMPLOYEE_RELEASE.md) records the latest 507-test build, team acceptance and company rollout prerequisites. It supersedes release-status statements in this earlier 497-test snapshot; the historical evidence below remains unchanged.

Validated locally on 24 September 2026 (Asia/Kuala_Lumpur), on `codex/final-round-employee-workflow`. Main was not used for these enhancements. No GitHub push, cloud deployment, Microsoft connection or external message dispatch was performed by this implementation pass. Existing uncommitted work was preserved.

## Verified build and engineering evidence

`node scripts/quality-gate.mjs --build` passed all eight steps: TypeScript, ESLint, **497 automated tests**, supplied-input integrity, organiser evaluation, independent scoring, staged local OCR assets and production build. The original supplied corpus passed **520/520 exact required outputs**. The gate output is in `work/validation/quality-gate.json`; individual logs and the independently scored report are retained alongside it. `node scripts/publish-validation.mjs` verified the frozen engine files and published aggregate evidence to `public/validation.json`.

Five HTTP acceptance scripts passed against the built production server at `http://127.0.0.1:3066`, using independent synthetic workspaces:

| Suite | Passing assertions |
|---|---:|
| `scripts/test-api.mjs` | 72 |
| `scripts/test-hardening-api.mjs` | 35 |
| `scripts/test-review-workspace-api.ts` | 28 |
| `scripts/test-follow-up-api.mjs` | 22 |
| `scripts/test-final-operations-api.ts` | 21 |
| Total | **178** |

The checks cover malformed and oversized input, concurrent updates, source hashes, workspace isolation, scan-confirmation gates, revised BL handling, preserved SI references, stale completion rejection, shipment task/completion flow, deadline reminders, template approval/reuse, cited search, batch completion and phishing instructions remaining untrusted. Unit tests also exercise role enforcement, login/session revocation, rule impact previews, rollback, immutable history, audit-write failure rollback, Microsoft PKCE/encrypted tokens and deduplicated outboxes with ambiguous outcomes.

## Fresh seed evidence

| Previously unused seed | Exact outputs | Defects caught | Review cases caught | False verified observed |
|---|---:|---:|---:|---:|
| 196613 | 520/520 | 60/60 | 20/20 | 0 |
| 262147 | 520/520 | 55/55 | 20/20 | 0 |
| 327673 | 520/520 | 52/52 | 20/20 | 0 |
| Total | **1,560/1,560** | **167/167** | **60/60** | **0** |

Retained evidence and generated inputs are under `work/validation/final-enhancements-331/`. The 27-file evaluation/engine dependency closure was frozen before and after the first runs, SHA-256 `3b5e4222810db6267f0ce6dbf0dcfadb8da4690a4e0379c126d3e64d436c6e68`. No tuning occurred between those runs. The scorer reads the answer key only after the pipeline writes predictions. This demonstrates consistency across new samples from the same generator, not independence from its templates or universal accuracy.

An earlier 3.3.0 three-seed experiment is retained separately. Independent review then found a weight in a Notes section that could be overshadowed by total-weight precedence. The safety fix received a regression test, version 3.3.1 and the three new seeds reported above; the earlier runs were not overwritten or relabelled.

## Employee workflow and browser verification

The browser rehearsal processed all 520 supplied cases and one retained synthetic case, showing current-engine queue counts. On the supplied scanned SI (`email_512`), local Tesseract produced seven suggestions with individual word-confidence signals and original-page crops. A visually checked crop displayed the source weight; saving remained disabled without all seven confirmations. Stop/Retry stays a controlled recovery path and cannot approve a case.

The shipment UI created a synthetic shipment, inspected and linked its case, selected a current comparison, displayed evidence-backed independent checks, and persisted a handover draft. Drafts and unconfigured Microsoft actions remain clearly identified. Sources and cited cases open with their saved revision/history; a changed source invalidates completion, deadlines, template reuse or instruction approval where applicable. In-app reminders check while the page is open. Background delivery is not claimed.

## Practical limits and remaining rollout work

- Configure team mode before using shared employee data; the default demo is deliberately anonymous and isolated. Corporate SSO/MFA and production identity lifecycle are not implemented.
- A Microsoft tenant/app registration is still unavailable. Graph behavior was tested with synthetic transports and real isolated SQL, not a live mailbox. Sending and Outlook framing default to disabled. See `MICROSOFT_SETUP.md` for client-cookie limitations and activation checks.
- Cross-email shipment association requires confirmation, especially where subject/body references conflict. Historical customer values are advisory or explicitly approved templates; they never silently replace shipment facts. Sanctions screening remains a compliance-owned roadmap item.
- Deploy and verify this exact feature branch on the final public host, check signed-out access and persistence, then complete the required deck/video/repository submission. Local engineering checks alone do not satisfy those delivery requirements.
- No finite test suite proves zero bugs, production safety, full rubric marks or first place. The defensible claims are the measured results, retained evidence and visible handling of uncertainty.

The full marking-criterion map and suggested five-minute demonstration are in [FINAL_ROUND_READINESS.md](FINAL_ROUND_READINESS.md).
