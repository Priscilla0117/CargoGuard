# CargoGuard technical hardening — engine 2.0.0

Date: 20 September 2026. Scope: technical product only; no GitHub publication, pitch deck or video. The existing Site remains owner-private. Organiser source files were not changed.

## What changed

- Fixed the audited false-clearance defects: compound/contradictory container expressions, matching placeholders, misleading email subjects, and SAME AS CONSIGNEE after human edits.
- Added strict whole-value numeric parsing, missing-marker detection, conflicting-label escalation and explicit uncertain-category review. Every comparison uses the same normalization in extraction and reviewer edits.
- Added browser-local OCR assistance for image-only PDFs. It displays the original page and suggestions, requires all seven field confirmations plus document role/reviewer/reason, and validates source SHA-256, revision and page count on save. It never clears a shipment on OCR confidence alone. Corrupt files still require replacement.
- Added resumable/idempotent processing, two bounded browser batch workers, bounded server parsing, batch database operations, atomic upload quotas and version-checked concurrent replacements/reviews.
- Fixed request recovery after a rejected oversized body in the local Worker runtime. Added friendly timeout/connection errors without automatically replaying non-idempotent writes.
- Made evidence easier to inspect: normalized values, uncertainty explanations, highlighted source excerpts, explicit category confirmation, readable audit summaries and detailed evidence on demand.
- Replaced misleading parser-only timing with measured end-to-end request and batch timings.
- Updated production dependencies to address the two reported advisories. `npm audit --omit=dev` reported zero vulnerabilities at this check; that is not a security certification.

## Verified evidence

| Check | Result |
|---|---|
| Both organiser folders versus embedded runtime | 520 email records and 250 document byte sequences agree |
| Original supplied output objects | 520/520 exact matches; 46/46 defect cases; 20/20 review cases |
| Original plus three generated development sets | 2,080/2,080 output objects; 209/209 exact defect catches; 80/80 review cases; zero observed false clearances |
| Regression suite | 114 tests pass, including 400 generated container-sum checks |
| Baseline local Worker/D1/R2 integration | 70 checks pass, including processing/exporting all 520 records |
| Additional local hardening integration | 35 checks pass across 73 requests; simultaneous edits/replacements, recovery, scan confirmation and upload-quota races |
| Hosted Worker/D1/R2 integration | 105 checks pass: 70 baseline checks plus the same 35 hardening checks |
| TypeScript / lint / build | Passed; full final release gate is retained in work/validation |
| Original scanned PDFs | All six rendered and OCR-read; manual confirmation remains mandatory |
| Local browser batch | 519 pending emails processed in 2.9 seconds in one measured run; hardware/network dependent |
| Browser scan recovery | Original SI and BL visually checked, OCR errors corrected, both transcripts saved, seven-field verified result shown with audit provenance |
| Browser pause / refresh / resume | Local engine upgrade paused after 60/521 cases, retained progress after refresh, resumed only the 461 remaining cases and completed |

The generated challenge sets informed fixes. They are **development sets from the same generator**, not an independent real-world or novel-template holdout. Never describe these results as guaranteed unseen accuracy or a championship judging score.

OCR diagnostic: 36/42 fields produced syntactically usable suggestions at 180 DPI. This is candidate completeness, **not accuracy**; names and numbers still contain reading mistakes. Browser rendering produced different suggestions, as expected. Human checking is the safety boundary.

Routing ablation on the supplied development set: Naive Bayes alone 73.27% classification accuracy (macro-F1 0.7282); hybrid 100% (1.000). The hybrid uses explicit rules for 370/520 decisions and model-only routing for 150/520. The model and the rules must be explained honestly.

## Hosted release verification

Deployed successfully at 06:15:06 UTC on 20 September 2026 (14:15 Malaysia). The site remains **owner-private**; no public-access change was made.

- Product: https://cargoguard-averis-workbench.ngernchi.chatgpt.site
- Saved Site version: **2**; engine **2.0.0**.
- Exact source revision: `95e54c28f80a14bb1c158983be05566b51b9f9aa`.
- Version ID: `appgprj_6aaf485afa2c81918fc8e404ecfcdf4d~appgver_924b337b738c8191932992b4500e8d9a`.
- Deployment ID: `appgdep_6aaf79c3a5bc8191ab6ab391273eb40c`.
- Normalized uploaded archive SHA-256: `b9044e38a87c8c1ae09c74e728fe47cc3ae85fa4c5868f76841892dca4292fe3`.

The hosted baseline suite passed all 70 checks, including full processing/export equality for the 520 supplied emails, at 06:24 UTC. The hosted hardening suite passed all 35 checks across 73 requests, including actual R2 source bytes, workspace isolation, concurrent reviews/replacements, scan confirmation and atomic upload quotas. Reports are `cargoguard/work/validation/hosted-baseline-api.json` and `hosted-hardening-api.json`.

In the owner's browser workspace, all 520 existing results were genuinely reprocessed from the old engine to engine 2 in **20.9 seconds**, including network requests and persistence. The resulting totals remained 63 verified, 46 discrepancies, 20 review cases, 91 awaiting documents and 300 routed. The browser's 54 successful request samples showed a 764 ms median and 1,342 ms p95. This is one measured browser run, not a service-level guarantee or a cold-start benchmark. The separate serialized hosted hardening test harness took 223 seconds (3,170 ms median / 4,888 ms p95 per request); these are different workloads and must not be conflated.

Hosted OCR was exercised on the original `email_513_SI.pdf`: same-site model loading and page rendering succeeded, all seven suggestions appeared, and saving remained disabled without human confirmations. The case stayed in review at revision 2; unverified suggestions were not saved to the owner's case. No browser errors or warnings were returned in the checked hosted log window. Original scan SI/BL correction and final save were exercised separately in the local browser, while hosted API tests exercised server-side confirmation and audit safeguards.

The source and build were saved to the existing private Site infrastructure, **not GitHub**. The working source tree was clean at handover. Temporary Git/hosted-test credentials were not stored in project files or reports.

## How to reproduce

Run inside `cargoguard`, using Node >=22.13:

```powershell
npm run quality -- --build
npm run evaluate
python scripts/score-evaluation.py
node scripts/check-bundle.mjs
node --import tsx scripts/ablation.ts
```

Start the built Worker as described in README, then:

```powershell
node scripts/test-api.mjs http://127.0.0.1:5174
node scripts/test-hardening-api.mjs http://127.0.0.1:5174
```

The test scripts create isolated synthetic workspaces. They do not modify the visible user's decisions. Destructive/reviewer browser QA uses a separate local workspace; hosted browser QA upgraded the existing engine results and read an OCR suggestion without saving a human decision. Offline evidence is under `cargoguard/work/validation/`; organiser scoring is under `cargoguard/work/evaluation/`. Full source and architecture/model/requirement notes are in the project README and docs folder. The earlier readiness audit is retained as a historical record of defects now covered by regressions.

## Boundaries that remain

No honest engineer can promise zero future bugs or first place. This is a substantially strengthened hackathon product, not enterprise-production certification. Before real customer use: corporate identity/RBAC, verified reviewers, malware scanning, operational retention/cleanup, cross-session rate limiting, load/failure testing and an approved real-document pilot are still needed. English OCR supports at most five pages, and ambiguous or unsupported values remain review tasks.

Judge access, GitHub, slides, video and team submission remain separate from this technical-only scope. No live carrier emails, corporate inbox, ERP changes or fabricated business-impact claims were added.
