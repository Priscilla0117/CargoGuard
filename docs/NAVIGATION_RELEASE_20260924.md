# Navigation correction and shared workspace — 24 September 2026

**Status: deployment and hosted acceptance pending.** The correction is prepared on `codex/final-round-employee-workflow`; its deployment commit will be recorded after publication. Engine version remains **3.4.1** because the document-processing engine and database schema are unchanged. Main and older shared Git history remain unchanged.

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

The final production build, including the short-height sidebar adjustment, passed. Hosted checks must be recorded separately after deploying the exact final commit. These are bounded synthetic checks, not proof that every browser or workflow is defect-free.

## Deployment and rollback

The current hosted application is the previous accepted deployment `dep-daqfq97f3r2c73b74f3g` at commit `22d1ccfd7acd2adfca8214597e6e5f4f2518159d`. Retain this as the rollback target for the navigation release. Its [earlier hosted acceptance](CLOUD_RELEASE_341.md) does not cover this correction.

There are **no database migrations or comparison-engine changes** in this navigation release. Reverting the executable does not require reverting or deleting stored cases, originals, reviews or shipment records. An application rollback is not a database backup or recovery test; confirm the target artifact is still available before using [Render's rollback procedure](https://render.com/docs/rollbacks).

Record the final commit, Render deployment identity, completion time, live health result and hosted navigation/workflow checks here before changing the status to deployed and accepted. Leave automatic deployment off and keep all source changes on the final-round branch.
