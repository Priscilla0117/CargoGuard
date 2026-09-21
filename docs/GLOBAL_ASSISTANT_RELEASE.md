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
- Assistant evidence packet regression: all 2,600 development cases, 7,198 exact source excerpts; largest packet 8,324 bytes. This tests context construction, not LLM accuracy.
- Final eight-step `scripts/quality-gate.mjs --build` run passed: 272 tests across 17 files, typecheck, lint, bundle integrity, original 520-case evaluation, independent organiser scoring, OCR staging, and production build. No skipped tests. The organiser scorer remains 1.0 on the supplied data; this is not unseen-data performance.

## Limits of the evidence

This turn's work does not establish expanded live LLM accuracy. Earlier live chat acceptance covers one inspected organiser discrepancy answer; blocked follow-ups are not model refusals. Mocks test contracts and failure handling, not semantic truth. The case-ID guard catches explicit standard identifiers, not every indirect reference. Valid source IDs do not guarantee a faithful answer. The public demo still needs human review and is not enterprise SSO/RBAC or a production security certification.

No claim of zero bugs, guaranteed champion ranking, unseen-data accuracy, or measured employee savings is justified by these checks.
