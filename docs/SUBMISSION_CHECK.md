# Submission readiness check — 22 September 2026

**Technical verification passed. Final submission is not yet certified complete.** The source, README and public prototype can be inspected; the team must still supply and verify its final video/deck links, declarations and submission receipt. This report distinguishes fresh checks from historical evidence and does not promise a competition result or zero future bugs.

## Source checked

- Repository: [Priscilla0117/CargoGuard](https://github.com/Priscilla0117/CargoGuard), public, default branch `main`, confirmed using the unauthenticated GitHub API on 22 September.
- Runtime baseline: `0a2340cc7edcd3a154f420701461094124e5be04`, the merge of the deployment branch into `main`. Its file tree matched the then-current deployment-branch tip `86f093f`; it includes application release commit `15ccb25d737bc233bc15912631a55f954b3f5e50`.
- Engine: **3.2.1**. The submission-preparation changes after that baseline are documentation only, not a new application release or cloud deployment.
- Original inputs: **520 emails and 250 document byte sequences** matched both supplied organiser folders. Reference answers were used only for offline scoring, not runtime prediction.

## Fresh local verification

Completed **22 September 2026, 08:35 MYT / 00:35 UTC** using Node 24.19.0. A production build ran against a newly created, isolated SQLite database on localhost. OpenAI was disabled and cloud credentials were removed from the test environment. The server was stopped after testing.

| Check | Result |
| --- | --- |
| Full quality gate | 8/8 steps passed: typecheck, lint, unit tests, input integrity, evaluation, independent scoring, OCR asset staging and production build |
| Unit tests | 350 passed; zero skipped |
| Core HTTP | 72 passed |
| Hardening HTTP | 35 passed |
| Governance HTTP | 23 passed |
| Release HTTP | 30 passed |
| Revision HTTP | 15 passed |
| Assistant preflight HTTP | 25 passed |
| Review-workspace HTTP | 28 passed |
| Total HTTP assertions | **228 passed** |
| Actual HTTP baseline export, independently scored | **520/520 exact supplied-corpus outputs**, 46/46 defect cases, 20/20 review cases; zero false-OK decisions |
| Official supplied-corpus composite | 1.0; this is not a hackathon judging score |
| Provider reservations created by these HTTP tests | **0**, verified in the isolated database |

The initial full gate used the checkout's existing installed dependencies. A separate clean-install check also passed, as recorded below. Deliberately malformed PDF fixtures emitted expected parser warnings; the tests correctly retained their review outcomes. Counts overlap in purpose and must not be summed into independent business cases.

Reproduction commands and organiser-path overrides are in [the development guide](DEVELOPMENT.md#reproduce-the-checks), linked from README.md. The machine-readable [sanitised verification summary](evidence/submission-20260922.json) records the exact baseline and aggregate results. Detailed run logs remain in ignored local QA storage; they are not deployed inputs or source-controlled answer keys.
ise identity, malware scanner, formal retention system or live corporate mailbox/ERP integration. Free hosting and third-party quotas can interrupt service. These are prototype boundaries and pilot prerequisites, not evidence of guaranteed first place.
