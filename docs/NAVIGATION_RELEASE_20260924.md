# Navigation correction and shared workspace — 24 September 2026

**Status: deployed and accepted on 24 September 2026.** Commit `69f2519e329efa4cc994f2e33c52bc8c65eabfeb` from `codex/final-round-employee-workflow` is live on Render. Engine version remains **3.4.1** because the document-processing engine and database schema are unchanged. Main and older shared Git history remain unchanged.

## Confirmed problem and correction

On the live 3.4.1 application at commit `22d1ccf`, opening Outlook and then returning to Work queue caused a client-side `TypeError` involving `history.pushState`. Office.js had replaced the browser history methods with `null`. Microsoft documents this behavior and recommends retaining/restoring the methods when a framework depends on them. See [Microsoft's Office.js-specific web API guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/develop/referencing-the-javascript-api-for-office-library-from-its-cdn).

The Office runtime loader now preserves the current router-aware history methods and restores disabled methods when the script loads or fails. Restoration remains active if the user leaves Outlook before the download finishes. It does not wait for Office host readiness, which may remain pending in an ordinary browser, and it does not replace newer router wrappers that are already valid.

## Workspace changes

- One persistent sidebar provides **eight destinations** on every workspace page: Work queue, Shipments, Insights, Outlook, Label rules, SI templates, Reports and Settings. Mobile navigation uses the same destinations.
- Workbench views and selected cases are represented in the URL, so Reports/Settings and case navigation respond to browser Back and Forward.
- Shipment loading, selection and async updates are guarded against stale replies. Rules and Outlook failures are handled visibly instead of escaping as unhandled async failures.
- Team access is shared across routes and revalidated on pathname changes and visible-window focus. Concurrent checks are coalesced; query-only view/case changes do not trigger authentication polling. Transient failures retain the last confirmed identity, while a successful unauthenticated response returns the user to sign-in.
- Identity changes remount workspace content so cached state from a previous user is not reused. The shared shell includes keyboard focus behavior, responsive layouts and print exclusions for navigation and team administration.

These changes do not establish live Microsoft mailbox connectivity, enterprise SSO or independently measured employee usability.

## Local validation recorded so far

| Check | Recorded result |
| --- | --- |
| Regression tests | **636 passed** |
| Static and build checks | Typecheck, lint and production build passed |
| Local production HTTP release suite | **30 assertions passed / 31 counted requests** |
| Desktop navigation | Seven destination round trips, returning to Work queue; no observed navigation errors or horizontal overflow |
| Mobile navigation at **390 × 844** | Seven destination round trips; no observed navigation errors or horizontal overflow |
| Workbench browser history | Reports and Settings Back/Forward navigation checked |
| Case browser history | Sample case 001 → 002 → Back, then close, checked |
| Import dialog | Open and close checked |
| Shipment workflow | Create shipment, reselect and change detail tabs checked |

The final production build, including the short-height sidebar adjustment, passed. [GitHub CI for the deployed commit](https://github.com/Priscilla0117/CargoGuard/actions/runs/35991728016) completed successfully. These are bounded synthetic checks, not proof that every browser or workflow is defect-free.

## Hosted acceptance

- Render deployment: `dep-daqgbqm7bikc738e24m0`; service `srv-dao05suk1f9s73a6qsm0`.
- Live at **19:16:36 MYT / 11:16:36 UTC on 24 September 2026**, from the exact commit above.
- Live `/api/health`: `{"status":"ready","engine":"3.4.1"}`.
- Release API suite: **30/30 assertions**, 31 counted requests; no paid AI calls.
- Retained-data recheck after deployment: **7/7 checks**, 8 requests, recorded at **11:17:19 UTC**. Saved case, policy, historical revision, two exact 5 MiB originals and cross-workspace isolation were preserved. The pre-deployment recheck also passed at 11:14:19 UTC.
- A fresh browser opened directly on Outlook, loaded the real Office runtime and returned to Work queue successfully. All seven destination round trips were then checked on desktop and at **390 × 844**, including cached Outlook revisits. Queue controls became available after the normal data refresh; no navigation errors or horizontal page overflow were observed.
- Reports/Settings Back and Forward, import-dialog opening and closing, and a direct pointer hit on its close control were checked on the live site. The short-height desktop sidebar retained all navigation and identity without an internal scrollbar.

An already-open browser tab may retain the previous JavaScript. Refresh that tab to load this release. No Microsoft tenant was configured or authenticated during these checks; actual Outlook mailbox operations still require tenant acceptance testing.

## Deployment and rollback

The previous deployment `dep-daqfq97f3r2c73b74f3g` at commit `22d1ccfd7acd2adfca8214597e6e5f4f2518159d` is the rollback target. It contains the known Office navigation defect, so use rollback only for a more serious regression. Its [earlier hosted acceptance](CLOUD_RELEASE_341.md) does not cover this correction.

There are **no database migrations or comparison-engine changes** in this navigation release. Reverting the executable does not require reverting or deleting stored cases, originals, reviews or shipment records. An application rollback is not a database backup or recovery test; confirm the target artifact is still available before using [Render's rollback procedure](https://render.com/docs/rollbacks).

Automatic deployment remains off. All source changes stay on the final-round branch. `main` remains at `949f98537f4b963362b480120af41fc843207571`.
