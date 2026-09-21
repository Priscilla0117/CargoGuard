# CargoGuard 3.1 — independent public cloud release

## Current case-assistant release — 21 September 2026

Live at **https://cargoguard-averis.onrender.com/**. Final runtime commit `5d5d867d8a32beed1fed766378c97c96c8a89143`, deployment `dep-daocb76k1f9s73bgu86g`, branch `cargoguard-v3-deploy`. Render started at **13:50:20 Malaysia time** and reported **Deploy succeeded / Live** after **2m19s**. All five migrations, including `0004_case_assistant.sql`, were reported ready. Later documentation-only commits are not claimed as deployed runtime changes.

Open a case → **Ask CargoGuard**. This is real optional OpenAI conversation with a case-data preview, explicit consent, related SI/BL evidence, draft-only suggestions and a deterministic fallback. It cannot alter case decisions, send messages or approve release. See [CASE_ASSISTANT.md](CASE_ASSISTANT.md) for the workflow, architecture, cost and privacy boundaries. The comparison engine and learned router remain 3.1.0.

| Final assistant-release check | Observed result |
| --- | --- |
| Local complete release gate | All eight steps passed; **267/267 tests across 16 files**, zero skips; typecheck, lint, 770-input integrity, organiser evaluation, independent scorer, OCR staging and production build |
| Context and source-reference integrity | **2,600 development cases**, **7,198 exact source excerpts**, largest outgoing case packet 8,324 bytes; no provider calls. Context construction is not LLM accuracy testing |
| Existing operations regression | **25,058 assertions across 2,600 saved development cases** passed again; no change to comparison decisions |
| Final hosted API tests | **72 baseline + 35 hardening + 23 governance + 30 release + 20 assistant preflight = 180 passed**, completed around 13:54 Malaysia time. Assistant preflight made zero valid provider requests |
| Final actual hosted automatic export | **520/520 exact**, 46/46 defect cases, 20/20 review cases, zero false-OK on this supplied development corpus. Independent scorer 1.0, checked at 13:56:02. Prediction hash remains `b0fac824010298e6bfa3b231c0490452916e50f47bc2df76df249321d659333c` |
| Low-volume hardening latency | Median 369 ms, p95 1,103 ms across 73 requests while other acceptance suites were running. Not sustained-load or cold-start performance |
| Restart persistence | Seven checks passed at 13:54:55: saved case, historic revision, policy, two exact 5 MiB source hashes and cross-workspace source denial |
| Actual OpenAI chat | One new provider call on organiser `email_004`, revision 3. `gpt-5.4-mini-2026-03-17`, displayed latency **3.3s**. It correctly identified consignee and notify-party differences (SI EAST BRIGHT FZ-LLC versus BL UAB NOVAKOPA), retained MISMATCH and recommended issuer correction/recomparison. This is one inspected case, not broad model validation |
| Cache and evidence navigation | The same question/revision was retrieved after redeployment with **Cached, no new AI call**. Related SI/BL field references rendered as readable values and excerpts. Consignee SI opened `email_004_SI.txt`, **Line 6**. Returning to chat retained the conversation. Revision stayed 3 |
| Follow-up test limit | A second live test submission combined a correction-draft request with forbidden approval/other-workspace requests. **The shared AI budget/concurrency reservation rejected it before any OpenAI call.** Therefore live multi-turn drafting and that adversarial model response remain unverified; mocked history/isolation tests passed. No cap was raised, ledger reset, cookie workaround or provider retry was used |
| Browser acceptance | Desktop 1440×1000 and phone 390×844 checked, including the actual generated answer. Document and drawer widths showed no horizontal overflow. Starter questions, unchecked consent, preview reset on question edits, source navigation, cached answer and controlled quota error observed. No browser console warnings/errors observed in the inspected session |

The initial live answer exposed cluttered inline citation IDs, so the final UI removes only redundant validated markers and offers related saved SI/BL evidence. A provenance review also caught that human-confirmed scan lines must not be labelled original source quotations; that distinction now has a regression test. An initial baseline test invocation with a trailing slash failed its upload assertion; the test runner now normalizes the origin, and the final hosted 72-check run passed with that same trailing-slash invocation. These issues were corrected and tested, not counted as initial passes.

**Important operating limit:** fresh AI requests may be unavailable when an existing shared cap is reached. Chat and document recovery share three attempts/workspace/UTC day, twenty globally/day, one hundred globally/lifetime, and an additional conservative token/concurrency allowance. The quota error does not identify which bound rejected the request, so this test does not establish an exact reset time or remaining balance. Cached responses and non-AI Resolution/manual verification remain available. No new AI balance purchase, paid hosting or permission expansion was made.

This remains a hackathon prototype, not a zero-bug, production, semantic-grounding, prompt-injection-immunity or first-place guarantee. In particular, passing the 520-case automatic comparison benchmark does not establish the reliability of the new chatbot. Independent unseen cases, operator feedback and broader approved live-LLM evaluations remain useful next validation steps.

## Current Operations experience release — 21 September 2026

Live at **https://cargoguard-averis.onrender.com/**. Runtime commit `ea7d8707dec99cee9db85a57c711d4ab27ee36f1`, deployment `dep-daobdnrtqb8s73elpfc0`, branch `cargoguard-v3-deploy`. Render started at 12:47:27 Malaysia time and reported **Deploy succeeded / Live** after 2m12s. Engine remains 3.1.0: the comparison pipeline, learned router, recovery provider contract and database schema were not changed. Later documentation-only commits are not silently claimed as deployed runtime code.

The new landing view is Operations desk. It adds action queues, field-pattern insights and a shift brief. Resolution now contains the case-aware Evidence Navigator and checked Amendment Studio; Comparison has an optional differences/uncertainty focus. See [OPERATIONS_UPGRADE.md](OPERATIONS_UPGRADE.md) for the user value and explicit boundaries.

| Operations-release check | Observed result |
| --- | --- |
| Complete local gate | All eight steps passed; **250/250 tests across 15 files**, zero skips; typecheck, lint, 770-input integrity, independent organiser scoring, OCR staging and production build |
| New read-only workflow transformations | **25,058 assertions across 2,600 existing development outputs**, including all bounded navigator answers, complete/partial/blocked drafts and non-mutation; not a new held-out model evaluation |
| Final deployed HTTP regression | **72 baseline + 35 hardening + 23 governance + 30 release = 160 passed**, completed at approximately 12:51 Malaysia time |
| Actual hosted automatic export | **520/520 exact**, 46/46 defect cases, 20/20 review cases, zero false-OK in this supplied corpus; independent scorer 1.0 at 12:51:24 Malaysia time; same `b0fac824...` prediction hash as the prior release |
| Hosted low-volume hardening latency | Median 265 ms / p95 452 ms over 73 requests; not sustained-load or cold-start performance |
| Restart persistence | All seven rechecks passed at 12:50:35: saved case, historical revision, saved policy and both exact 5 MiB source fingerprints retained; cross-workspace reads denied |
| Browser acceptance | Local desktop at 1440×1000 and phone width 390×844 inspected. Phone document/client widths and drawer widths matched (no horizontal overflow). Five case-question paths, source citation navigation, focus mode (2/7 for mismatch; 0/7 plus explicit empty message for matching case), search, 12→24 pagination, lane switching and acknowledgement reset on reload checked |
| Actual downloads | Browser-downloaded `email_004-r1-amendment.txt` and `cargoguard-shift-brief.txt` checked from disk for exact reference/current values, no-send marker, revision and correct 520-case queue counts. The browser download-event waiter timed out despite the file being saved; filesystem verification was used, not a false claim of event success |
| Live browser smoke | Retained workspace: 63 verified, 46 discrepancy, 20 review, 91 awaiting, 300 routed. New action lanes: 46 amend, 15 recover, 96 request, 63 complete, 300 other desks. `email_004` revision 3 retained; two focused rows and two evidence findings, unchecked download disabled, Line 6 citation opened the correct SI text. No saved-case mutation; no console warnings/errors observed |
| Existing AI configuration | Public non-secret recovery status still enabled: OpenAI `gpt-5.4-mini`, 20 global calls/day, 100 lifetime, three/workspace/day and existing additional input/token/concurrency bounds. Health returned HTTP 200, status ready |
| Extra AI cost / disclosure | **Zero additional provider requests** for this upgrade. Navigator and drafts are deterministic, not new LLM conversations. Existing recovery consent, quotas and server-side key are unchanged |

These are development and low-volume acceptance results, not proof of employee time savings, production readiness, accessibility compliance, zero bugs or first place. Free-host wake-up, shared allowances, token expiry, absent corporate authentication and model-generalization limits below remain applicable.

## Initial 3.1.0 AI release — 21 September 2026

Public demo: **https://cargoguard-averis.onrender.com/**. Judges need no OpenAI, Render, Turso or ChatGPT account. The optional LLM uses the owner's server-side OpenAI key after explicit organiser/synthetic-text consent. No paid hosting upgrade, credit purchase or automatic top-up was enabled.

Final runtime commit: `02462456f08c5916c53e6e7d0335ed76adf9e61b`, branch `cargoguard-v3-deploy`. Render deployment `dep-daoal70473hc739j7qsg` started at 11:55:08 Malaysia time and succeeded after 2m16s. All four database migrations were ready. Documentation-only commits after this runtime are not silently claimed as deployed code.

| Final-release check | Observed result |
| --- | --- |
| Local complete release gate | Eight steps passed; 228/228 tests across 14 files, no skips; typecheck, lint, 770-input integrity, independent scoring and production build passed |
| Five development datasets | 2,600 exact outputs; 267 defect cases and 100 review cases retained; zero false-OK decisions in these tests |
| Final-host regression suites | 72 baseline + 35 hardening + 23 governance + 30 additional release checks passed (160 total) |
| Final-host automatic export | 520/520 exact records, 46/46 defect cases, 20/20 review cases; unmodified organiser composite scorer 1.0, evaluated at 12:00:03 Malaysia time |
| Final-host hardening latency | Median 261 ms, p95 426 ms over its 73 requests; low-volume synthetic evidence, not a capacity guarantee |
| Real OpenAI recovery | 75 checks passed on two unfamiliar-layout synthetic documents; 14/14 expected field values recovered with exact source quotations |
| Actual provider | `gpt-5.4-mini-2026-03-17`, recovery contract `evidence-selectors-v3`; 2,482 ms / 1,584 tokens for the sectioned SI and 2,449 ms / 1,493 tokens for the transposed BL |
| AI decision boundary | Suggestions did not change saved decisions; all seven confirmations required; stale and cross-workspace requests refused; cache reuse avoided another provider call; six true differences remained after confirmation/reprocessing |
| Browser AI journey | Organiser `email_001_SI.txt` proposal returned in 3,155 ms (1,587 input / 330 output tokens). Complete values/addresses matched the source; all seven confirmations were unchecked, role initially unselected, Save disabled; citation link highlighted original Line 4; no case change was submitted |
| Pre-existing data after redeployment | Seven persistence checks passed: unchanged saved case/policy/history, both exact 5 MiB source hashes, other-workspace denial |
| Existing browser demo upgrade | All 520 older-engine cases upgraded; counts remained 63 verified, 46 discrepancy, 20 review, 91 awaiting documents and 300 routed. Performance displayed engine 3.1.0, the new learned router and development-only evaluation labels |

The first live prompt exposed label/address mistakes and the second contract rejected a longer but explicit gross-unit heading. Both issues were corrected and the final tests rerun. Earlier reports are retained as `live-recovery-v1-failed.json` and `live-recovery-v2-partial.json`; the successful report is `work/validation/ai-v31/live-recovery.json`. Do not hide those development failures or label the final rerun an untouched holdout. The final source-based output hash remains `b0fac824010298e6bfa3b231c0490452916e50f47bc2df76df249321d659333c`.

Six actual provider requests were used in validation, including unsuccessful proposals. The hard shared limits remain 20 attempts/UTC day and 100 for the database lifetime, with three/workspace/day, input/output bounds and a conservative daily token-reservation cap that can stop calls sooner. Public traffic can exhaust the allowance. No quota records were reset. A timeout, missing key, exhausted allowance or incomplete proposal leaves manual review available.

The new model-only router scores 1.0 macro-F1 on the 520 supplied development messages versus 0.7282 for the previous Naive Bayes baseline. The final hybrid uses 7 agreeing rule corroborations, not 391 rule-selected categories. The separate 60-message synthetic challenge still has two pure-model category errors and two ambiguous messages not escalated; it is not proof of perfect generalization. See [AI_UPGRADE.md](AI_UPGRADE.md) and [the practical synthetic demo](../examples/evidence-recovery/README.md).

The Render Free wake-up delay, database-token expiry, lack of corporate authentication and other operating limits below still apply. These tests do not guarantee zero bugs, production readiness or a championship.

## Historical 3.0.1 release

Verified 21 September 2026, Malaysia time. Public demo: **https://cargoguard-averis.onrender.com/**. No Render, Turso or ChatGPT sign-in is required to use it.

### Historical deployed configuration

- Repository: `Priscilla0117/CargoGuard`, branch `cargoguard-v3-deploy`.
- Running application commit: `45dea6b11bb7a3f49b5e1b97c777a07dfe0efe8c`, engine `3.0.1`. Render deployment `dep-dao7lnrtqb8s73e7rif0` went live at **08:33:33 Malaysia time, 21 September 2026**, after a 2m06s deployment.
- Existing `main` was preserved at `c069b3a4a009212be0f1f281b2ce9776136dc72e`; its separate classifier/normalization edits were not overwritten there.
- Render: `cargoguard-averis`, service `srv-dao05suk1f9s73a6qsm0`, **Free**, Singapore, Node `24.14.0`, manual deployments, health path `/api/health`.
- Turso: organisation `priscilla`, database `cargoguard`, **Free**, libSQL, Mumbai. No paid upgrade was selected on either service.
- Source and application data are separate: live decisions, histories, policies and uploaded bytes are in Turso, not Render's temporary disk. Startup migrations succeeded remotely.
- The old public v2 site and its saved work remain untouched. Browser workspaces do not transfer between the two domains.

### Historical 3.0.1 acceptance evidence

The existing Free service was updated, not replaced. No access/visibility changes or paid upgrades were made. The GitHub branch received the code commit above; subsequent documentation-only commits do not change the manually deployed runtime.

An initial 3.0.1 deployment (`95244a0`) was followed by the resource-packaging correction above after PDF font diagnostics were investigated. The final commit passed the full local gate and the complete hosted suites again; its last hosted scoring report is timestamped **08:35:13 Malaysia time**. All five development-set output hashes stayed unchanged after the resource correction.

| Check | Observed result |
| --- | --- |
| Anonymous live health | HTTP 200, ready, engine 3.0.1 |
| Render clean install/build/start | Successful on the expected branch and commit; all three database migrations ready |
| Baseline HTTP suite | 72 checks passed; actual public-host automatic export retained |
| Hardening HTTP suite | 35 checks / 73 requests passed; median 253 ms, p95 459 ms in this run |
| Governance HTTP suite | 23 checks passed, including complete original snapshot equality after corrections/replacement |
| Additional release HTTP suite | 30 checks / 31 requests passed: unit-label handling, duplicate fields, invalid revisions, review concurrency, historical-source hashes and isolation |
| Independent hosted-export scoring | 520/520 exact records, all 46 defect cases and 20 review cases, zero false-OK decisions; unmodified organiser composite scorer 1.0 |
| Existing-data persistence after this redeployment | Seven checks passed: unchanged saved case and policy, available history, exact hashes of both 5 MiB files, and denial to another workspace |
| Browser inbox upgrade | All 520 existing sample cases upgraded to 3.0.1; counts stayed 63 verified, 46 discrepancy, 20 review, 91 awaiting documents and 300 routed |
| Browser source/review workflow | Initial mutation buttons disabled while loading; historical v1 retained engine 3.0.0 with revision-pinned original links; policy preview did not activate; scanned `email_512_SI.pdf` rendered/OCR-completed with all seven confirmations unchecked and Save disabled |
| Final browser reload | All saved counts retained; no warnings/errors in the checked browser log entries |
| Local final release gate | All eight steps passed: typecheck, lint, 197/197 tests with no skips, 770-input integrity check, evaluation, independent scoring, OCR staging and production build |
| Dependency audit | npm audit detected zero production-package advisories. Full tree: four moderate and two low development-tool findings; zero high/critical. Vendored PDF code required a separate scripting-path assessment; see DEFENSIBILITY.md. |

That is **160 live HTTP acceptance checks plus seven redeployment-persistence checks**. Timing is low-volume synthetic evidence, not a capacity promise. The exact hosted prediction SHA-256 is `b0fac824010298e6bfa3b231c0490452916e50f47bc2df76df249321d659333c`; scorer, answer-key and verifier hashes are retained in `work/validation/hosted-accuracy-gate.json`. Same-generator challenge runs total 2,600 exact development outputs; none is a real-world holdout.

The final gate and HTTP reports are under the deployment checkout's ignored `work/validation/` directory. The pre-existing private persistence probe remains only in the original workspace's ignored `work/validation/v3/cloud/`; never publish its cookie. Source changes were also synchronized into the original `cargoguard` folder, preserving unrelated edits. The original folder's older installed dependencies/build outputs were not promoted as the tested deployment; use `npm ci` and rebuild when running that copy.

The PDF resource regression and five-corpus rerun produced no missing-font/CMap warnings. Intentionally malformed PDFs still emit recovery diagnostics and remain human-review cases. This release does not claim warning-free parsing of arbitrary files or safe execution of PDF JavaScript; document scripting is not used.

## Historical 3.0.0 public-host evidence

The following checks belong to the earlier `a59fb24c1a165eeb0616d9f7cfe96dd99c8f037b` release. They are retained as history, not silently relabeled as 3.0.1 tests.

| Check | Observed result |
| --- | --- |
| Anonymous health request | HTTP 200, ready, engine 3.0.0 |
| Clean Render install and production build | Successful; correct branch, commit and Node version shown in build logs |
| Baseline API suite | 72 checks passed, including all 520 expected organiser outputs and automatic export |
| Hardening API suite | 35 checks / 73 requests passed; measured median 359 ms and p95 1,407 ms |
| Governance API suite | 23 checks passed, including concurrent policy activation, stale previews, history, source replacement and workspace isolation |
| Upload boundary suite | 10 checks passed; two 5 MiB files in one request, exact downloaded hashes, oversized-file rejection and cross-workspace denial |
| Actual Render restart | Dashboard recorded restart at 00:07 Malaysia time; seven follow-up checks confirmed unchanged case, policy, historical revision and both 5 MiB original sources |
| Browser workflow | All 520 processed: 63 verified, 46 discrepancy, 20 review, 91 awaiting documents, 300 routed; all counts remained after browser reload following restart |
| Browser scan recovery | `email_512_SI.pdf` rendered and OCR completed; suggestions stayed unconfirmed and Save was disabled; no warning/error entries in the checked browser logs |

These are low-volume synthetic acceptance checks, not a throughput or uptime guarantee. The two maximum-size TXT probes deliberately exceed the extracted-text safety limit: their correct outcome is human review, while their original bytes remain retrievable. That test does not claim automatic extraction of arbitrarily large text.

Reproducible scripts: `scripts/test-api.mjs`, `scripts/test-hardening-api.mjs`, `scripts/test-governance-api.mjs`, and `scripts/test-cloud-boundaries.mjs`. Local evidence is in ignored `work/validation/v3/cloud/`. The restart probe contains a synthetic workspace cookie and must remain private; do not commit that file. The deployed branch also passed all 126 unit tests and type-checking locally before publication.

## Important operating limits

1. Render Free sleeps after inactivity and warns of a wake-up delay of **50 seconds or more**. A natural idle-to-wake cycle was not separately measured in this release; a manual service restart was tested. Open the demo normally before judging and allow time to load. Do not use artificial keep-alive traffic to conceal the limitation.
2. The database token was created with a **30-day expiry on 20 September 2026** and stored only in Render's secret settings. Renew it before approximately **20 October 2026**, or the app will lose database access. Do not put it in source, screenshots or chat.
3. Render's free dashboard gates actual CPU/memory usage charts behind a paid plan. No production memory headroom or sustained-load certification is claimed. No upgrade was enabled to access these charts.
4. Render displayed other repositories after the user completed the GitHub connection. Only CargoGuard was used. Review the GitHub app/OAuth permission scope if it should be limited to this repository; limited scope has not been independently confirmed.
5. Repository visibility was not changed. Its anonymous GitHub API lookup returned 404 while authenticated Git access worked. Public-source access has not been verified; the organiser's public-source requirement still needs the user's visibility review before submission.
6. This remains a synthetic-data hackathon demo, not a corporate production release. It lacks verified staff identity/roles, antivirus, formal retention and backup guarantees, a durable background job queue and comprehensive global abuse protection. Never upload confidential real shipment data.

Passing the recorded tests is evidence of this release's behavior, not a promise of zero future bugs or a championship result. See [DEPLOYMENT.md](DEPLOYMENT.md) for reproduction and the remaining broader acceptance checks.
# Workspace/capacity update — 21 September 2026, 16:22 MYT

See [WORKSPACE_REFRESH.md](WORKSPACE_REFRESH.md) for the six-tab design, increased
daily AI caps with unchanged lifetime ceilings, runtime commit `3d3a379`, 185 hosted
HTTP checks, original 520-case rescoring, persistence verification and the exact
scope/limitations of two real provider requests. Earlier sections below are dated
historical acceptance records, not the current quota specification.
