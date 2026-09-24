# CargoGuard 3.4.1 hosted acceptance — 24 September 2026

The [public CargoGuard application](https://cargoguard-averis.onrender.com/) was deployed and passed the bounded acceptance checks below. These are dated observations, not continuous availability, independent production accuracy or a zero-defect guarantee.

## Release and configuration

- Runtime commit: [`22d1ccfd7acd2adfca8214597e6e5f4f2518159d`](https://github.com/Priscilla0117/CargoGuard/commit/22d1ccfd7acd2adfca8214597e6e5f4f2518159d), engine **3.4.1**.
- Source branch: `codex/final-round-employee-workflow`. Main and older shared history were unchanged; automatic deployment remains off.
- Render service: `cargoguard-averis`; deployment `dep-daqfq97f3r2c73b74f3g`.
- Render reported **Live at 18:39:06 MYT (10:39:06 UTC)**, with a reported deployment duration of **2m45s**.
- All **12 migration files** were ready. Existing environment settings were retained: isolated **demo workspaces with organiser samples**, not an authenticated employee-team deployment.
- At **10:39:51 UTC**, `/api/live` reported `alive`, `/api/health` reported `ready`, both on engine 3.4.1, and `/api/auth` confirmed `demo` mode.
- Database readiness remained healthy after the acceptance checks.

## Hosted checks

All four HTTP suites used newly created, isolated synthetic workspaces. They made no external AI or Microsoft calls and sent no email.

| Check | Assertions passed | Counted requests | Scope |
| --- | ---: | ---: | --- |
| Intake | 14 | 11 | Deferred unrelated attachments, unopened spam, route correction, known discrepancy, source hashes and history |
| Follow-up | 22 | 19 | Saved follow-up, corrected BL, new discrepancy, completion gates, stale writes, handover and workspace isolation |
| Review workspace | 28 | 21 | Synthetic source selection, review workflow and retained evidence |
| Release | 30 | 31 | Readiness, input validation, bounded synthetic upload/review and access boundaries |
| Existing retained data after deployment | 7 | 8 | Unchanged case/policy, historical revision, exact original bytes and cross-workspace denial |
| **Total** | **101** | **90** | **94 workflow assertions plus seven retained-data assertions** |

Request counts follow each harness's counters; they are not a total of all network traffic, browser requests or separate health/asset probes. Assertions overlap in purpose and are not independent employee scenarios. The seven retained-data checks also passed before deployment; that earlier run is not counted again in the total above.

The post-deployment retained-data run completed at **10:39:59 UTC**. The existing synthetic case and policy hashes were unchanged, its historical revision remained available, both retained **5 MiB originals** matched their prior hashes, and another workspace could not retrieve either source.

## Browser and asset observations

A hosted browser walkthrough at **1280 × 720** uploaded two synthetic TXT documents with matching shipper values of `TBA:TBC`. The result was **NEEDS_REVIEW**, with the original source lines visible and the follow-up **Check completed** action disabled. No console warnings or errors appeared in that inspected session.

At **10:44:20 UTC**, all six checked OCR assets returned HTTP 200 to HEAD requests, and the published validation record reported version 3.4.1. This verifies asset availability; it is not a new hosted OCR recognition or accuracy evaluation. Earlier local and generator measurements remain separately described in the [judge-feedback audit](JUDGE_FEEDBACK_AUDIT.md).

## Database changes and rollback

Migrations 0005–0011 add tables, indexes and triggers; migrations 0000–0004 are unchanged. Each new file is applied transactionally and recorded. Startup does not rewrite existing case, policy, revision or attachment payloads. An isolated in-memory SQLite rehearsal preserved **22 existing schema objects** and rows across **nine original tables**, with an `ok` integrity check. The hosted retained-data checks above provide additional, bounded continuity evidence.

**A full database backup and isolated restore were not performed for this deployment.** The retained synthetic records and SQL rehearsal do not substitute for that recovery validation.

The previous successful Render deployment, `dep-daohd12jnfac738vvae0`, runs engine **3.2.1** at commit `15ccb25d737bc233bc15912631a55f954b3f5e50`. Render's Deploys page showed its **enabled Rollback action**, confirming that the application rollback option was available during this inspection. No rollback was executed or acceptance-tested during this release.

To revert the application, select that successful deployment in Render's Deploys page, verify its commit, and use **Rollback**. Availability depends on Render retaining its build artifact; check this before relying on it. Review the configuration Render will reuse and leave automatic deployment off. Follow [Render's rollback procedure](https://render.com/docs/rollbacks).

Preserve the database, added tables and migration-history rows. Do not drop newer tables or overwrite newer records with an older snapshot as part of an application rollback. The older application cannot expose the new operational features, but their data should remain available for a corrected release. After reverting, check liveness, readiness and the seven retained-data assertions again. Application rollback is not database recovery.

## Remaining boundaries

The public service remains for permitted organiser/synthetic data. This acceptance does not claim employee approval, corporate SSO/MFA, live Outlook/Teams connectivity, external AI answer quality, a durable background queue, load-tested capacity or a completed independent staff pilot. No real employee documents or mailboxes were used. Free-host wake delays and provider outages remain possible. See [deployment and recovery guidance](DEPLOYMENT.md) and the [pilot evaluation workflow](PILOT_EVALUATION.md).
