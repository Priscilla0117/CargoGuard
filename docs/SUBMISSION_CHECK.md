# CargoGuard — verification report

**Application: 3.2.1.** This report records engineering checks and their limits, not a certificate of zero bugs, production readiness or competition marks.

## Source and data scope

The 22 September baseline was `0a2340cc7edcd3a154f420701461094124e5be04`, containing released application commit `15ccb25d737bc233bc15912631a55f954b3f5e50`. The repository is public with `main` as its default branch. Subsequent documentation cleanup is not a new cloud deployment.

Original input integrity: **520 emails and 250 document byte sequences** matched both organiser copies. Reference answers were used by the offline scorer, not the application.

## Local production verification — 22 September 2026

Completed at **08:35 MYT / 00:35 UTC**, Node 24.19.0, new isolated SQLite database. External AI was disabled and no provider reservation was created.

| Check | Result |
| --- | --- |
| Full quality gate | 8/8 passed: typecheck, lint, unit tests, input integrity, evaluation, independent scoring, OCR staging and build |
| Unit tests | 350 passed; zero skipped |
| Core / hardening / governance HTTP | 72 / 35 / 23 passed |
| Release / revision HTTP | 30 / 15 passed |
| Assistant preflight / review-workspace HTTP | 25 / 28 passed |
| Total local HTTP assertions | **228 passed** |
| Actual HTTP export, independently scored | **520/520 exact supplied outputs**, 46/46 defects, 20/20 review cases, zero false-OK decisions |
| Organiser composite | 1.0 on the supplied development corpus; not a judging score |

A separate clean-install check at **08:42 MYT** installed 720 packages into a fresh dependency directory using `npm ci --offline`, applied all five migrations, staged OCR assets and started the development server. Liveness, readiness and the page returned HTTP 200. This used the available package cache on Windows, not a fresh registry download or a macOS/Linux validation run. An initial sandbox cache-permission error was resolved before the successful retry; dependency deprecation warnings were nonfatal.

The actual production tests used the original checkout's installed dependencies. Detailed commands, hashes and aggregate results are in [the verification data](evidence/submission-20260922.json). Reproduce them using [DEVELOPMENT.md](DEVELOPMENT.md#reproduce-the-checks). Malformed PDF fixtures emit expected warnings and remain review cases.

### Later source-tree regression check

At **10:19–10:21 MYT / 02:19–02:21 UTC**, the curated source tree based on `26f92d4b793ad5c20212234c97d13ae228e88183` was tested again in a byte-verified 260-file snapshot. All 25 removed preparation/obsolete files were absent. The unchanged scripts passed the full **8-step gate, 350 unit tests and 228 production HTTP assertions** against a new isolated SQLite database.

The actual HTTP export again matched **520/520 supplied outputs**, including all 46 defect and 20 review cases, with zero false-OK decisions. Runtime files stayed unchanged during verification, and no external AI reservation was created. This reused installed dependencies; it was not another clean install, hosted acceptance run or live LLM test. Nonfatal warnings concerned the nested checkout and intentionally damaged input PDFs. The test server was stopped afterward. Subsequent changes were documentation only.

## Public-service snapshot and earlier acceptance

Read-only checks on **22 September, approximately 08:33–08:34 MYT** returned HTTP 200 for `/api/live`, `/api/health` and the page. The first request took about 26.4 seconds; this is an individual observation, not an uptime or latency benchmark. The optional AI configuration was enabled in a separate read-only check; no new paid model answer was generated.

The **177 hosted checks and 12 controlled local outage checks** are separately dated **21 September** in [CLOUD_RELEASE.md](CLOUD_RELEASE.md). They were not silently relabelled as new hosted tests.

## Evidence boundaries

- Supplied and additional same-generator data informed development; they are not independent real-world holdouts.
- Test counts overlap in purpose and cannot be summed into unique business cases.
- Assistant preflight and mocked adapter tests do not establish live LLM answer quality. The model card and cloud report disclose the limited real-provider tests and failed development attempts.
- There is no Averis employee usability study, measured ROI, sustained-load certification or uptime guarantee.
- Corporate identity/roles, malware screening, formal retention and live corporate-mail/ERP connections remain future work. Browser workspaces and self-entered reviewer names are not enterprise authentication.
- Free-host wake-up, database availability and shared AI allowances can affect service.
