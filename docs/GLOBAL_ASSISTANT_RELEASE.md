# Floating Ask CargoGuard — 21 September 2026

## Scope

A workspace-wide, case-scoped assistant for shipping employees. Available from every workspace view, with a case picker, in-panel verification for unprocessed cases, pinned case/revision/workflow, optional cloud AI, evidence inspection, and a no-AI Resolution fallback. A separate conversation/question is retained for up to five revisions in this tab's memory. The assistant cannot approve, release, email, change a verdict, or read another workspace.

No LLM model or prompt change. Comparison engine remains 3.1.0. No database migration is needed. No increase to the existing paid request limits and no ledger reset; a tighter persistent lifetime token ceiling is added. The proposed expanded paid test run requires the owner's bounded-spending confirmation.

## Acceptance evidence

- Local browser: opened from Operations without a case-details screen; searched case-insensitively; selected and verified organiser email_004 inside the panel; retained MISMATCH with two differences. Independently selected email_001, which verified OK on its original organiser sources. Neither selection made a provider request.
- Question state remained separate on case switching. Closing/reopening retained the question but removed preview/consent. Visiting Resolution and using its case's Ask CargoGuard shortcut retained that case's question.
- An email_004 question while email_001 was selected was refused before provider dispatch. Consent remained unchecked and sending disabled when AI was not configured locally.
- Desktop 1440×1000 and mobile 390×844 inspected. Found and fixed Tailwind's separate translate property shifting the desktop panel offscreen. Final measured desktop rectangle: x800/y100, 620×880 inside 1440×1000. Mobile: x0/y0, 390×844, no page/panel horizontal overflow. Case context remains sticky while scrolling. Closing restores focus to the floating launcher.
- Local HTTP suites: 72 core, 35 hardening, 23 governance, 30 release, 22 assistant-preflight checks passed (182 total). The assistant preflight performs no valid ask and consumes no provider request.
- Repeated all 182 HTTP checks against `next start` on local port 3053, not just the development server; all passed. Production `/api/health` returned 200/ready. Fresh production browser checks passed for Operations and Performance entry points, zero-result search, Escape dismissal and launcher focus restoration. No warning/error entries were observed in that production browser session. After layout settled, production panel bounds matched the desktop/mobile measurements above.
- Assistant evidence packet regression: all 2,600 development cases, 7,198 exact source excerpts; largest packet 8,324 bytes. This tests context construction, not LLM accuracy.
- Final eight-step `scripts/quality-gate.mjs --build` run passed: 272 tests across 17 files, typecheck, lint, bundle integrity, original 520-case evaluation, independent organiser scoring, OCR staging, and production build. No skipped tests. The organiser scorer remains 1.0 on the supplied data; this is not unseen-data performance.

## Public-cloud acceptance

Runtime commit `0935abcc80fbbed74a3b0b271258b514851edeac`, deployment `dep-daod1c142hec739cgkfg`, on the existing Render Free service. Deployment started at 14:37:36 MYT on 21 September 2026 and succeeded after **15 minutes 20 seconds**. The build succeeded earlier, but startup/health confirmation was delayed; two 90-second read requests and one 15-second Node health request timed out during this interval. The available logs did not establish the cause. No paid upgrade, secret change, health-check weakening, retry deployment or ledger reset was used. Do not represent this as a fast-start or uptime guarantee.

After Render reported Live:

- Public `/api/health`: 200, ready, engine 3.1.0. AI configuration still enabled with `gpt-5.4-mini`; no keys exposed.
- All five hosted HTTP suites passed: **182 checks** total at approximately 14:54 MYT. Hardening suite: 73 requests, median 348 ms, p95 1,297 ms during parallel acceptance testing; not sustained-load evidence.
- Fresh hosted automatic export independently scored: **520/520 exact, all 46 defect cases and 20 review cases correct, zero false-OK decisions, organiser composite 1.0**. Predictions SHA-256 `b0fac824010298e6bfa3b231c0490452916e50f47bc2df76df249321d659333c`. This remains supplied-corpus agreement, not unseen-data accuracy.
- Existing persistence probe: seven checks passed at 14:56 MYT, including the unchanged case/history/policy, exact hashes for both 5 MiB sources and cross-workspace source denial. Private probe cookies stayed out of Git and chat.
- Public browser: floating picker displayed the existing 520-case workspace (46 discrepancies, 20 reviews, 91 awaiting documents), selected email_004 revision 3 correctly, and prepared the consent preview. Consent remained unchecked; no valid ask was submitted. No warning/error entries observed in the checked public browser session.
- Read-only allowance check: 7 historical AI attempts remained counted, 13 global daily requests and 12,384 daily reserved tokens remained. No new provider requests were made during this turn. Limits remain 3/workspace/day, 20 globally/day, 100 lifetime; the proposed increase and expanded real-model testing remain pending owner confirmation.

## Limits of the evidence

This turn's work does not establish expanded live LLM accuracy. Earlier live chat acceptance covers one inspected organiser discrepancy answer; blocked follow-ups are not model refusals. Mocks test contracts and failure handling, not semantic truth. The case-ID guard catches explicit standard identifiers, not every indirect reference. Valid source IDs do not guarantee a faithful answer. The public demo still needs human review and is not enterprise SSO/RBAC or a production security certification.

No claim of zero bugs, guaranteed champion ranking, unseen-data accuracy, or measured employee savings is justified by these checks.
