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

### Clean installation

Completed **22 September 2026, 08:42 MYT** in a fresh archive of the same `main` baseline, with no reused `node_modules` directory:

- `npm ci --offline --no-audit --no-fund` installed **720 packages** from the lockfile and available package cache in 65.9 seconds.
- All five database migrations passed against a new local database, and browser OCR assets staged successfully.
- The development server started on a separate localhost port; `/api/live`, `/api/health` and `/` returned HTTP 200. The assistant configuration confirmed external AI was disabled.
- The test server was stopped, and its port was confirmed no longer listening.

Environment: Windows, Node 24.19.0, npm 11.9.0. This verifies a clean dependency directory and local setup using cached packages, not a fresh registry download or macOS/Linux test. The first attempt encountered a sandbox cache-permission error; an approved retry succeeded. Three dependency deprecation warnings and a nested-checkout workspace-root warning were nonfatal. No lockfile/setup defect was found; no paid model request or cloud mutation occurred.

## Fresh public-service checks

Read-only checks on 22 September, approximately **08:33–08:34 MYT**:

| Request | Observed result |
| --- | --- |
| `GET /api/live` | HTTP 200, `alive`, engine 3.2.1; explicitly does not check the database |
| `GET /api/health` | HTTP 200, `ready`, engine 3.2.1 |
| `GET /` | HTTP 200, CargoGuard page returned |

The first liveness request took approximately **26.4 seconds**; the following readiness and page requests took approximately 0.13 and 0.31 seconds. These are individual observations, not a latency benchmark or proof of uninterrupted availability. Open [the public demo](https://cargoguard-averis.onrender.com/) before presenting, allow for free-host wake-up, and check a real case in the recording workspace.

This pass did **not** repeat the full hosted write/restart/outage suites, conduct a new visual regression session, or send a paid OpenAI question. It does not certify current provider answer quality or guarantee future allowance. The **177 hosted checks and 12 local outage checks** belong to the dated 21 September release record in [CLOUD_RELEASE.md](CLOUD_RELEASE.md). A provider/configuration preflight is not an actual model answer.

At **08:40 MYT**, a separate read-only `GET /api/assistant` succeeded: OpenAI integration was enabled, with 50 daily and 87 lifetime requests remaining at that instant. A fresh browser workspace had 10 requests available. No provider request was sent. These shared allowances can change as visitors use the demo; configured availability does not prove the next model request will succeed.

## Requirements and rubric coverage

| Required material | Location and status |
| --- | --- |
| Problem-solution alignment | README written response 1; five email categories, SI as reference, seven fields, exact differences and human escalation |
| AI and cloud integration | README response 2 and ARCHITECTURE.md; trained routing, server processing, persistent Turso, optional consented OpenAI and browser-local OCR are distinguished |
| User feedback/testing | README response 3 and the dated evidence above; engineering tests are supplied, but no Averis employee usability study is claimed |
| Coding challenges | README response 4; real ambiguity, dependent-field, outage, payload and LLM-validation challenges with implemented responses |
| Success metrics | README response 5 plus dated reports; supplied-data agreement is separated from unseen accuracy and unmeasured employee savings |
| Scalability plans | README response 6; approved pilot, corporate controls, queues/object storage and enterprise connectors explicitly labelled future work |
| Technical architecture, implementation, challenges and roadmap | README and linked architecture/deployment documentation cover all four required documentation topics |
| Video: introduction, problem, technology, working demo and impact | All five are planned in [the voiceover](RECORDING_VOICEOVER.md) and [runbook](RECORDING_RUNBOOK.md); a script is not proof of the final footage |
| Detailed problem/rubric mapping | [REQUIREMENTS.md](REQUIREMENTS.md) and [requirement-to-proof checklist](REQUIREMENT_PROOF_CHECKLIST.md), including preliminary/final criteria and remaining filming checks |

The supplied rules permit a public README as project documentation. If also submitting a slide deck, check that it tells the same current story. The previously reviewed deck needed wording corrections; this source update does not certify that PDF or any new deck.

## Team actions required before submission

1. **Finish and inspect the real video.** Measure the exported duration: at most five minutes. Check clear audio, readable evidence, a genuine classifier run, extraction, mismatch/no-mismatch reports, human review, saved history and an accurate AI response or honest fallback. Use only approved organiser/synthetic data.
2. **Provide accessible final links.** Add the actual public/unlisted video and deck/documentation URLs to the submission. Verify them signed out. No final video or deck sharing URL was supplied for this check; no placeholder link should be submitted.
3. **Confirm the team declarations.** MozartAI, Ng Ern Chi and Chan Kar Jun must match registration. The team must confirm eligibility, permitted development dates, original work and required third-party/AI assistance acknowledgement. Automated tests cannot certify these.
4. **Check the latest organiser announcements.** The supplied deadline is **22 September 2026, 12:00 p.m.** The final rubric's technology-integration category is marked provisional. Confirm that neither has been superseded.
5. **Submit through the organiser's channel and retain the receipt.** Updating GitHub is not the same as submitting the entry. Recheck the public prototype and its AI availability just before recording/presenting; do not change budgets or paid plans without approval.

### Suggested short project description

CargoGuard helps Averis shipping operations staff turn document-checking emails into evidence-backed reviews. A trained AI model routes five email types, while document parsers extract seven shipment fields and compare the draft Bill of Lading against the Shipping Instruction. Staff can inspect exact differences, select the intended document pair, preview linked corrections and retain review history. Optional consented AI assistance explains a selected case without changing its saved decision. The cloud prototype uses Next.js on Render and persistent Turso storage. Missing or uncertain information remains a human-review task, not shipment approval.

## Limits that must remain visible

The supplied corpus and additional same-generator data informed development; neither establishes unseen real-world accuracy. There is no employee time-saving study, enterprise identity, malware scanner, formal retention system or live corporate mailbox/ERP integration. Free hosting and third-party quotas can interrupt service. These are prototype boundaries and pilot prerequisites, not evidence of guaranteed first place.
