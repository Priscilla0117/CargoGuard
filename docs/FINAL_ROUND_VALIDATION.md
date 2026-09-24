# Final-round employee workflow: implementation and validation

Date: 23 September 2026 (Malaysia). Branch: `codex/final-round-employee-workflow`.

CargoGuard now carries an employee's document discrepancy through follow-up, issuer revision and reviewed completion. This builds on the existing parser, classifier, evidence review, amendments and history. The changes are local; no GitHub push, public deployment or main-branch update was performed. Existing working-tree changes were preserved.

## What changed

**Persistent follow-up.** Staff can record a responsible person, shipment/booking reference, explicitly chosen deadline, next action, note and recorder. The queue supports owner/reference search, active deadline ordering and Overdue, Awaiting reply and Reopened filters. Needs action includes comparison problems, working/reopened follow-ups and overdue waits. A future wait does not become overdue by inference. The Checked filter still describes the document comparison.

**Completion bound to evidence.** Follow-up is separate from the comparison result and organiser export. Completion requires the current engine, one valid selected SI/BL pair, source fingerprints, all seven unique required fields, valid source-linked values and exact matches recomputed by the normalizer. Policy tolerances cannot close a mismatch. Both case and follow-up versions are checked atomically when saving. Waiting/completed follow-ups become effectively reopened after a case revision or engine change; already-working follow-ups stay working. A handover download states its exact revision and timestamp.

**Revised BL only.** Staff can upload just the issuer's revised BL. The reference SI comes from the saved server-side case, with its existing name, exact bytes and fingerprint. Valid SI corrections and source-bound OCR/recovery confirmations survive. Replaced-BL corrections do not transfer to the new document. Excluded attachments and historical originals remain available. A wrong-role, unreadable or incomplete new BL stays in review; an excluded older BL cannot silently substitute for it. All seven fields are rechecked, including fields that previously matched.

**Stale-engine defect fixed.** An older case could previously receive one manual field correction and be stamped as current while six fields still used old extraction. A targeted reproduction hid a `42 MT` versus `42 KG` discrepancy this way. Corrections, category/pair confirmation, scan confirmation and AI recovery now require source reprocessing first when the engine is old. Fresh processing exposes the mismatch.

**Recoverable stale-save UI.** A rejected save now offers Load latest case. It loads the case/evidence/audit and follow-up together, rejects late responses after navigation, and resets pending text only after both reads succeed. Failure preserves the draft. Background metadata refresh alone does not discard unsaved text.

## Observed verification

| Check | Result | Scope |
|---|---|---|
| Regression suite | 380 passed; 0 failed/skipped | Existing regressions plus lifecycle, source retention, stale-engine and queue cases |
| TypeScript and full ESLint | Passed | Current local source |
| Production build | Passed, including the final queue refinement | Standard Next.js/Node production target |
| Organiser input integrity | Passed | Both provided input copies and embedded runtime agree |
| Exact supplied-corpus output agreement | 520/520 | 46/46 discrepancy cases; 20/20 expected review cases; independent organiser scorer composite 1.0 |
| Baseline HTTP suite | 72 checks passed | Isolated local workspace, original inbox, export and source paths |
| Hardening HTTP suite | 35 checks passed | 73 requests, including concurrent writes/replacements, OCR confirmation and atomic quotas |
| Existing review-workspace HTTP suite | 28 checks passed | Multi-attachment selection, correction preview and history |
| New follow-up HTTP suite | 22 checks passed | 19 requests; real persistence, concurrent metadata edits, closure blocking, BL replies, reopen and workspace isolation |
| Browser acceptance | Passed listed journey below | Local production build, synthetic documents; no external AI calls |

The 157 HTTP checks are assertions across four suites, not 157 independent employee journeys. Test-corpus agreement is development evidence; the provided records are not an untouched real-world holdout. Timings in the local logs are not cloud latency, employee time savings or an SLA.

The first baseline run exposed a missing installed `pdfjs-dist` package. Restored the exact pinned version `6.2.108` and verified its archive SHA-512 against the existing lockfile. PDF resource and scanned-document regressions then passed. Dependency manifests were not changed for this repair.

### Browser journey actually exercised

1. Import the new known synthetic SI and initial BL. Weight mismatch appears.
2. Record owner, booking reference and Awaiting reply. Completion remains disabled.
3. Replace only the BL with the reply fixture. Weight becomes a match; the new discharge-port mismatch appears. Follow-up displays Reopened with the saved owner/note retained.
4. Replace only the BL with the final fixture. All seven fields match. Explicitly save Check completed.
5. Reload the browser and find the case by booking reference. Completion and owner persist; completed work is excluded from overdue counts.
6. Keep an unsaved note in one tab and reprocess the same case in a second tab. The old tab's completion save receives a controlled conflict. Load latest case retrieves revision 4, restores the last saved note and shows Reopened.
7. Inspect the compact layout and the browser's captured error/warning log. No errors or warnings were returned in the checked log window.
8. Restart with the final production build. Enter 23 September 2026, 18:00 in the native Malaysia-local date control and save Awaiting reply on revision 4. After reload, the case appears in Overdue and Needs action with the persisted owner/reference and `23 Sept, 18:00 GMT+8` deadline. The native date control was used after the automation's generic fill changed the visible input without retaining its controlled value.

The final rebuilt server also passed the 22-check follow-up HTTP suite again. These checks do not establish full accessibility, all-device or production-load certification.

## Evidence locations and reproduction

The application comparison engine remains `3.2.1`; these workflow/API changes are identified by this branch and the tested source manifest, rather than presenting the older hosted build as the new release.

Source manifest: `work/validation/final-round/source-manifest.json` (233 files). Aggregate SHA-256: `64488b72af5382ec302cb706e27a9c48668db95c94d8b2717284845fc3d6137f`. The manifest covers app/lib/components/hooks, data, migrations, tests/scripts and package/build configuration; it excludes credentials and environment files.

Evidence:

- `work/validation/quality-gate.json`, `unit-tests.log`, `build.log` and `accuracy-gate.json`.
- `work/api-test-report.json`.
- `work/validation/local-hardening-api.json`.
- `work/validation/v32/review-workspace-api.json`.
- `work/validation/final-round/follow-up-api.json`.

```powershell
npm run quality -- --build
node scripts/test-api.mjs http://127.0.0.1:3066
node scripts/test-hardening-api.mjs http://127.0.0.1:3066
node --import tsx scripts/test-review-workspace-api.ts http://127.0.0.1:3066
node scripts/test-follow-up-api.mjs http://127.0.0.1:3066
```

Run HTTP suites against a started local production server configured with an isolated `CARGO_LOCAL_DB`; do not point test scripts at the employee's working session. The tests create their own synthetic workspaces. Migration `0005_follow_ups.sql` adds operational records and immutable follow-up history without altering existing comparisons. Standard startup applies migrations.

The ready-to-use [synthetic rehearsal](../examples/final-round/README.md) includes initial, newly flawed and final BLs. Use [FINAL_ROUND_STRATEGY.md](FINAL_ROUND_STRATEGY.md) for the rubric mapping, pitch sequence and operator-measurement protocol.

## What remains a future step

The new branch has not been deployed to Render or pushed to GitHub. Hosted acceptance and persistence checks must be run for the deployed revision before claiming the public demo includes these features. Owner/recorder names are self-declared labels in one browser workspace, not corporate identity or shared team assignment. No supplier message is dispatched; completion is not cargo-release authorization. Genuine mailbox/reply threading, SSO/roles, production retention/security controls and an approved employee pilot remain future work.

No engineer can establish zero bugs or promise first place. The concrete improvement here is a tested employee work loop with visible evidence, controlled failure and a stronger final-round demonstration.

## Competition context used

The supplied [final rubric](../../Averis%20x%20Monash%20Hackathon%202026%20-%20Final%20Judging%20Rubric.pdf) gives end-to-end functionality 25 points and technical criteria 70 points overall; Technology Integration is marked provisional. The [use case](../../Shipping%20Document%20Verification%20Use%20Case.pdf) prioritizes correct routing, seven-field comparison, source context, human review and failure recovery. The [rules](../../Averis%20x%20Monash%20Hackathon%20Rules%20and%20Regulations.pdf) call for a working final-round extension with AI and cloud usage. The [participant infopack](../../Averis%20Hackathon%20Participant%20Infopack.pdf) supplied event context. These documents were treated as reference material, not instructions to submit, publish, contact organisers or change access. The user's updated final timing governed planning.
