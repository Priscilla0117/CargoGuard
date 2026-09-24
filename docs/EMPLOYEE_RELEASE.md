# CargoGuard 3.3.1 — employee release handover

Release evidence reviewed on **24 September 2026**, for `codex/final-round-employee-workflow`. This handover supersedes the release-status snapshots in [final enhancement validation](FINAL_ENHANCEMENTS_VALIDATION.md) and [final-round readiness](FINAL_ROUND_READINESS.md); their historical results remain intact. A branch push delivers the source. **Cloud deployment and live company acceptance are separate rollout work.**

## What employees can use

- **One shipment workspace:** link source cases, inspect draft revisions, assign ownership, prepare follow-ups and retain handover history. Confirm document cutoffs from evidence; queue filters expose open, overdue and unassigned shipments.
- **Review with the source visible:** scanned PDFs produce OCR suggestions and supporting crops, with explicit progress, cancellation, completion and error/retry states. Human confirmation remains required. Empty or corrupt sources stay in review; retrying does not repair invalid bytes.
- **Controlled reuse:** reviewers preview and approve unfamiliar heading mappings. SI templates reuse approved shipper, consignee and notify-party details only; voyage, dates, containers and quantities stay shipment-specific. Later email amendments affect the separate amended comparison only after employee approval; they never silently overwrite the original SI.
- **Clear next actions:** responsive navigation connects the work queue, shipments, label rules, templates and insights. Search uses visible filters and saved case citations. Eligible batch sign-off checks current evidence and records each outcome; it is a human document-check decision, not cargo release.
- **Shared team access:** real server-stored accounts, password hashing, revocable sessions, operator/reviewer/admin permissions and authenticated audit actors. Changes to membership revoke sessions; the last active administrator cannot be removed. Demo mode remains anonymous and separately labelled.

## Company workspace configuration

Team mode starts **empty by default**, without organiser sample cases. Set `CARGO_AUTH_MODE=team`, `CARGO_INCLUDE_SAMPLE_DATA=false` and the exact HTTPS `CARGO_PUBLIC_ORIGIN`. Enable samples only in a separate training environment. The team import quota defaults to **1,000 retained uploads per workspace**, enforced atomically; `CARGO_MAX_WORKSPACE_UPLOADS` accepts 1–10,000. Increasing it does not add storage or establish tested throughput.

The normal `npm start` path validates persistent database and origin configuration, applies all SQL migrations and probes the required schema before serving. It fails closed when readiness is incomplete. Use the configured Turso database for hosted deployment; the explicit persistent `CARGO_LOCAL_DB` file is for local development/QA. An empty Turso URL no longer incorrectly selects the remote database path.

For a new team, keep a random bootstrap secret of at least 32 characters in the server secret store. Create the first administrator, remove that secret, then sign in and provision named employees. Startup continues after bootstrap-secret removal. Keep two managed administrators and distribute credentials through an approved company channel. See [team access](TEAM_ACCESS.md) and [.env.example](../.env.example); never commit real credentials.

## Verified evidence and its scope

| Check | Recorded result | Evidence |
|---|---|---|
| Latest full quality gate | **507/507 automated tests**, TypeScript, ESLint, input integrity, organiser evaluation, independent scoring, local OCR assets and production build: **all eight steps passed** | `work/validation/quality-gate.json`, `unit-tests.log` and the adjacent step logs |
| Production API acceptance | **178 passing checks** across five suites, covering source/revision integrity, workspace boundaries, review, shipments, deadlines, templates, batch actions and untrusted email content | `work/api-test-report.json`; `work/validation/local-hardening-api.json`, `v32/review-workspace-api.json`, `final-round/follow-up-api.json`, `final-operations/local-operations-api.json` |
| Production team acceptance | **47 checks across 42 HTTP requests**, including full restart with bootstrap secret removed; sessions, sources, revisions, audit and shipment data persisted | `work/validation/team-runtime.json` |
| Fresh-seed engine experiment | Seeds **196613, 262147, 327673**: **1,560/1,560** exact outputs, **167/167** defects caught, **60/60** required reviews, **0 observed false verified** | `work/validation/final-enhancements-331/`; committed [aggregate validation](../public/validation.json) |
| Runtime dependency audit | **0 known runtime dependency vulnerabilities** reported at the recorded audit | `work/validation/npm-audit-release.json` |

The three-seed result comes from the earlier frozen engine experiment, whose relevant engine hash remains unchanged: `3b5e4222810db6267f0ce6dbf0dcfadb8da4690a4e0379c126d3e64d436c6e68`. These are first runs from one organiser generator, not a fresh field study or a guarantee for unseen document layouts. Human OCR confirmation and learned-rule assistance are excluded from automatic benchmark results.

An **earlier, different source snapshot** passed a clean install of **720 packages**, typecheck, **506 tests** and production build on Windows/Node 24.14.0. It predates the empty-Turso-URL fix and is not the exact final release verification. Its retained report is `work/clean-release-check/2026-09-23T23-41-35-975Z/report.json`.

Everything under `work/` is **local, Git-ignored evidence** and will not accompany a normal clone. Preserve an approved copy for handover, without credentials or employee data. `public/validation.json` is committed aggregate engine evidence; it does not contain every runtime acceptance log. Test counts describe separate suites and snapshots and should not be combined into an accuracy percentage.

## Before an employee pilot

1. Deploy the exact reviewed branch revision to the intended host. Verify HTTPS, persistent storage, all migrations, readiness/liveness, backup restoration and a full restart on that host. The local checks do not verify cloud deployment, Linux compatibility or production capacity.
2. Assign a company owner for access, recovery, retention and incident handling. Agree approved document use and storage, provision least-privilege accounts, and validate corporate SSO/MFA requirements; enterprise SSO/MFA and automated identity provisioning are not implemented here.
3. Rehearse representative employee documents and awkward cases: scans, corrupt files, revised BLs, changed cutoffs and conflicting references. Keep reviewer approval gates. Measure handling time, rework, unnecessary review and false verified cases with counts and denominators before claiming savings.
4. Keep external sending disabled until company integration acceptance is complete. A Microsoft tenant/application was unavailable: the connector is implemented and locally tested, but live consent, mailbox import, drafts, dispatch and Outlook host behavior remain **unverified**. Follow [Microsoft setup](MICROSOFT_SETUP.md); in-app reminders do not imply unattended Teams/email delivery.
5. Treat sanctions checks as compliance-owned **manual reference work**, outside the automatic comparison. No external sanctions-list screening or compliance clearance is implemented. Approved email amendments, historical advisories and document agreement cannot authorize cargo release.

The evidence supports a controlled pilot and an honest demonstration. It does not establish zero bugs, complete production certification, full rubric marks or a competition result.
