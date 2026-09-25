# Laptop-first work queue and revision comparison — 21 September 2026

## Scope and workflow

Implements the approved simplification: two main pages (Work queue and Reports),
secondary Settings, and three case sections (Check, Sources, History). No provider
calls, quota changes, paid service, credential changes, schema migrations,
automatic emails or shipment approvals. Engine remains 3.1.0; the release commit
identifies this UI/workflow version.

- Work queue replaces separate Operations, Inbox and Review navigation. Compact
  filters, search, category and two additional queues preserve every category.
  Old-engine results belong to recheck, not the checked queue.
- Reports combines performance and latest-100-event audit search. Patterns and
  development-only validation remain available. Settings contains versioned
  policies and an expandable AI-allowance panel.
- All seven fields remain in Check. Sources and uncertainty warnings stay visible;
  normalization/edit controls and technical routing details expand on demand.
  Original email is in Sources; readable-document AI recovery expands explicitly.
- Request correction opens the existing source-checked amendment first. Other
  contextual actions open case guidance. Floating chat opens directly and case
  selection stays within chat. Consent and budget checks are unchanged.
- Next case follows the captured filtered queue without wrapping or approving.
  Save correction & next case advances only after a successful server save.
  Closing the inspector preserves queue search, filters and pagination.
- Shift brief and automatic/reviewed exports remain under Help & exports.

Queue counts describe next actions, not raw workflow labels: the supplied 20
NEEDS_REVIEW cases include five missing-attachment cases. Accordingly, 15 belong
to Recover evidence and 96 to Missing documents (91 awaiting + those five).
All 520 remain accounted for; no benchmark outcome was changed.

## What changed? safeguards

History defaults to the nearest earlier available snapshot. Select any earlier
revision from the latest 100 saved revisions. The pure comparator examines all
seven fields; source links are pinned to each snapshot's exact version.

- Now matches: a previously mismatched/uncertain field has a valid recorded match.
  This does not claim the issuer corrected a file or authorize release.
- New issue: a previously matching field now has mismatch or uncertainty.
- Still unresolved: includes mismatch becoming uncertain; not a fix.
- Not compared now: absent comparison, including routing away; not a fix.
- Newly available checks and changed matching values are identified separately.
- SI-value, category, engine and policy changes trigger notices. Changing the SI
  to match the BL is not proof the BL was corrected.
- Cross-case, reversed/invalid versions and duplicate/unknown fields fail closed.
  Missing source links are not invented. Extraction edits do not edit original files.
- Inspection is read-only: no restoring snapshots, clearing issues, provider
  allowance consumption or extra decision revisions.

## Local verification

- Complete eight-step quality gate: 314 tests in 21 files; typecheck, lint,
  770-input integrity, organiser evaluation, independent scorer, OCR staging and
  production build passed.
- 200 HTTP checks: 72 core + 35 hardening + 23 governance + 30 release + 25
  assistant preflight + 15 new revision-flow checks. No provider requests.
- Automatic supplied-corpus output remains 520/520 exact; 46/46 defect cases,
  20/20 review cases, zero false OK. Prediction SHA-256:
  `b0fac824010298e6bfa3b231c0490452916e50f47bc2df76df249321d659333c`.
- Existing saved outputs across 2,600 development cases passed 25,058 operations
  assertions and 7,198 assistant source-excerpt checks. These are transformation
  regressions, not new held-out model-accuracy results.
- At 1366 × 768 the queue table begins near y=319 and six full rows fit before
  scrolling. Previously Operations' queue began near y=962 and Inbox's table near
  y=726. At 1280 × 720, five full rows fit. No page-wide horizontal overflow was
  observed at either tested laptop size.
- Browser journeys: Run inbox; filtered case opening; all seven fields; correction
  save/advance; historical comparison; source tools; direct case chat; audit
  search; settings. Synthetic replacement showed one field now matching, one new
  port issue and one remaining unknown-weight blocker; the case stayed NEEDS_REVIEW.

Reproduce persisted revision checks against an explicit origin:

```powershell
node --import tsx scripts/test-revision-api.ts http://127.0.0.1:3053
```

Only synthetic cases in fresh isolated workspaces are created. Reports stay under
ignored work/validation; workspace cookies are never printed or published.

## Release status and limits

The interface below remains current, but its initial runtime was superseded by
the [database outage recovery release](DATABASE_INCIDENT_20260921.md) at 17:49 MYT.
The original acceptance below predates the later provider capacity failure.

Live at **https://cargoguard-averis.onrender.com/**. Runtime commit
`e716487660f281cdc1f0ccaa5cc237be936c8f05`, branch `cargoguard-v3-deploy`, Render
deployment `dep-daofajad0e5s7381trog`. Deployment started at **17:13:49 Malaysia
time on 21 September 2026** and Render reported **Deploy succeeded / Live** after
**2m51s**. Later documentation-only commits do not change this runtime.

- All **200 hosted HTTP checks** passed again, completed by **17:18:54 MYT**:
  72 core, 35 hardening, 23 governance, 30 release, 25 assistant preflight and
  15 revision-flow checks. These tests create synthetic isolated workspaces;
  the existing visible user's cases were not edited. Provider calls: **zero**.
- The actual hosted automatic export was independently scored at **17:18:36
  MYT**: **520/520 exact**, all 46 defect cases and 20 review cases, zero false OK,
  official supplied-corpus composite 1.0. The prediction hash equals the local
  hash above. This is supplied development data, not unseen accuracy.
- Seven post-redeployment persistence checks passed at **17:17:03 MYT**:
  unchanged saved case and policy, available historical revision, exact hashes
  of both retained 5 MiB source files, and denial of both to another workspace.
  The private persistence bookmark remains ignored and must not be published.
- Hosted browser acceptance confirmed the compact queue, historical v1/v2 to v3
  comparison (including engine-change notices), all seven fields on expansion,
  revision-pinned source links, direct case chat, Reports, audit trail and Settings.
  No warning/error entries appeared in the inspected browser log. No new AI
  answer was requested; this release does not re-test provider answer quality.
- Hosted hardening requests measured median **263 ms**, p95 **485 ms**, across
  73 requests while other suites ran. This is low-volume synthetic evidence,
  not a cold-start, load-capacity or latency guarantee.

Reports remain in the deployment checkout's ignored `work/validation/`, including
`laptop-hosted-accuracy.json`. The original project mirror receives the source and
documentation changes without replacing unrelated local edits. Its installed
dependencies/build output are not the tested deployment; use `npm ci` and rebuild
if running that copy.

Laptop-first, not a new mobile optimization effort. No employee usability study,
accessibility certification, sustained-load test or new LLM-quality test. Shared
AI caps, provider failures, free-tier wake-up, database-token expiry, self-declared
reviewers and lack of corporate SSO remain limitations. No finite test suite
guarantees zero bugs or first place.
