# Cloud and provider verification

This report records **dated observations**, not continuous availability or a guarantee of unseen accuracy. The application runtime is CargoGuard **3.2.1**, deployed on **21 September 2026**. The separate [22 September verification report](SUBMISSION_CHECK.md) records the later local rerun, clean installation and read-only public checks.

[Public prototype](https://cargoguard-averis.onrender.com/) · [Deployment instructions](DEPLOYMENT.md) · [Model card](MODEL_CARD.md)

## Release identity

- Runtime commit: `15ccb25d737bc233bc15912631a55f954b3f5e50`.
- Render reported the service live at **19:37:58 MYT, 21 September 2026**, after a 2m25s deployment.
- All five existing database migrations were ready. Render runs Next.js/Node; Turso stores cases, review history, policies and small original uploads.
- The runtime source is included on `main`. Later documentation commits are not new application deployments.
- Anonymous visitors can use the prototype without a Render, Turso or OpenAI account. Optional AI uses server-side credentials and explicit consent.

## 3.2.1 acceptance results — 21 September

| Check | Recorded result and scope |
| --- | --- |
| Full local release gate | Eight steps passed: typecheck, lint, **350 unit tests / zero skips**, original-input integrity, supplied evaluation, independent scoring, OCR assets and production build |
| Original-input integrity | All **520 emails and 250 document byte sequences** matched both organiser copies |
| Local production HTTP | **228 assertions**: 72 core, 35 hardening, 23 governance, 30 release, 15 revision, 25 assistant preflight and 28 intake/review |
| Local storage-outage simulation | **12 checks** with deliberately invalid synthetic database settings: shell/liveness available; eight readiness calls and inbox returned controlled 503 |
| Hosted HTTP | **170 assertions**, completed by **19:41:49 MYT**: 72 core, 30 release, 15 revision, 25 assistant preflight and 28 intake/review |
| Retained cloud data | **Seven checks**, at **19:40:55 MYT**: unchanged saved case/policy, historical revision, two retained 5 MiB source hashes and cross-workspace source denial |
| Independently scored actual cloud export | **520/520 exact outputs**, all **46 defect cases** and **20 review cases**, zero false-OK decisions on the supplied development corpus; official composite 1.0 |
| Additional development sets | Four same-generator sets also matched, for **2,600 outputs including the original**; not independent real-world holdouts |

The final hosted total is **177 = 170 HTTP + seven retained-data assertions**. The 35 hardening and 23 governance checks ran locally for this release; they are not relabelled as current hosted checks. Counts overlap in purpose and are not independent business scenarios. No valid provider request was made by this release's HTTP suites.

Actual cloud-export SHA-256: `b0fac824010298e6bfa3b231c0490452916e50f47bc2df76df249321d659333c`. Supplied-data agreement is not a judging score, live-LLM benchmark or unseen-document accuracy.

### Browser and persistence observations

Local laptop walkthroughs at **1366×768 and 1280×720** covered four-file intake, explicit source pairing/exclusions, linked-field preview, invalid-value rejection, preview/save equivalence, cancellation, history and direct floating chat.

The final public walkthrough at **1280×720** retained the 520-case outcome counts after reprocessing to 3.2.1. A labelled synthetic four-file case moved from review to a human-reviewed matching **selected pair**, with excluded documents still visible. Previewing a different consignee showed two new issues including the linked notify party; cancelling preserved the revision. History retained earlier evidence, and floating chat opened directly. No horizontal overflow or console warnings/errors appeared in that inspected session.

Earlier, on **21 September at 00:07 MYT**, an actual service restart was followed by seven retained-data checks. Maximum-size upload checks retrieved two exact 5 MiB source files and rejected cross-workspace access. Those maximum-size TXT fixtures exceeded extraction limits and correctly required review; this was storage-boundary evidence, not successful extraction of arbitrary large documents.

These are bounded acceptance observations, not accessibility certification, employee usability research, load testing or an uptime guarantee.

## Live-provider evidence

These tests were recorded on **21 September** during earlier AI/workflow releases. The 3.2.1 acceptance above did **not** repeat them. Mock and preflight tests cannot substitute for live answer-quality evaluation.

### Source-quoted field recovery

| Observation | Result |
| --- | --- |
| Two unfamiliar-layout synthetic development documents | Final rerun recovered **14/14 expected fields**, with **75 workflow assertions** passing |
| Provider / contract | `gpt-5.4-mini-2026-03-17`; `evidence-selectors-v3` |
| Recorded provider latency | 2,482 ms for the sectioned SI; 2,449 ms for the transposed BL |
| Recorded token use on those two final calls | 3,077 actual tokens combined |
| Review safeguards | No saved changes before confirmation; all seven confirmations, source/revision binding, stale/cross-workspace rejection and cache reuse checked; six actual discrepancies remained |
| Additional organiser document | One UI-only proposal showed seven correct fields; confirmations stayed unchecked and Save disabled; no case change |

**Earlier failures matter:** prompt v1 included labels and omitted party addresses; validators blocked confirmation. Prompt v2 improved the values but a full gross-unit heading was rejected by an overly narrow validator. The contract was corrected and retested. Final success is therefore development feedback, **not an untouched holdout**.

Six provider requests were used, including unsuccessful proposals. Only **three distinct documents** received live proposals; eight other recovery fixtures were not live-tested. Rare layouts and adversarial instructions lack comprehensive provider evaluation. Quoting a real source does not guarantee the right field or complete value.

### Case conversation

- An inspected answer for **`email_004`**, revision 3, identified consignee/notify-party differences, kept the case's MISMATCH status and advised issuer correction/recomparison. Recorded latency was about **3.3 seconds**. Source navigation and a subsequent cached answer were checked without changing the case.
- A follow-up combining drafting with prohibited approval/other-workspace requests was **rejected by the shared reservation limit before OpenAI was called**. It is not evidence of a model refusal; live multi-turn/adversarial drafting remained unverified.
- During a later two-request smoke run, another `email_004` answer returned HTTP 200, but the harness stopped because the provider returned a dated model name rather than its alias. Its full semantic/cache assertions were **not completed**. The harness was corrected without repeating that request.
- The remaining **`email_506` missing-evidence test passed**: it explained missing attachments and 0/7 comparison coverage, requested SI plus draft BL, cited current-case facts, made no approval claim and left the saved case unchanged. Latency was **2,888 ms**. Cached preview/replay used no additional call.

These few examples do not establish broad model reliability. Source-reference validation, mocks and a successful deterministic comparison benchmark do not prove semantic truth or prompt-injection immunity. See [assistant scope and current shared limits](CASE_ASSISTANT.md).

## Reliability incident and response

On **21 September at 17:27 MYT**, Render observed a health timeout, followed by public 502 responses. Later logs explicitly reported **“Server database capacity temporarily exceeded”** from Turso. This establishes a provider rejection, not a particular UI action as the cause. A single successful diagnostic query did not establish full recovery.

The initial 3.2.0 deployment later appeared live but failed its first hosted inbox request with 502 and entered a dependency-related restart loop. It is **not counted as successful acceptance**. The underlying later database fault was not conclusively isolated to capacity versus latency or another transient issue.

Implemented controls:

- Bounded database requests and controlled errors; no automatic replay of writes that may already have committed.
- Process-only **`/api/live`** for Render restarts; **`/api/health`** still checks actual storage and returns 503 on failure.
- Startup still verifies migrations with a 60-second ceiling. No silent local-storage fallback or skipped schema checks.
- One bounded retry for a transient read-only inbox request; stale/older responses cannot overwrite newer state.

Separating liveness prevents a later storage outage from itself causing a process restart. It does **not** make database-dependent operations succeed during an outage or resolve the provider's underlying capacity. Free-host cold starts and database outages remain possible.

## Security assessment and remaining limits

The **dated 21 September dependency assessment** found zero production-package advisories, but **four moderate and two low development-tool findings**, with no high/critical findings. These included deprecated/legacy development-server toolchains; they must not be exposed. This is a historical audit, not a current vulnerability-free guarantee.

The installed `unpdf` 1.8.1 embedded PDF.js **6.1.200**, separately from the pinned PDF resources. The [Mozilla scripting advisory](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j) required enabled viewer scripting. CargoGuard's inspected code extracts/renders documents without importing PDFViewer/ScriptingManager or executing PDF JavaScript actions. That code-path assessment is not a penetration test or an embedded-engine upgrade. Adding viewer scripting requires a patched engine and renewed review.

Other boundaries:

- Free hosting sleeps and can delay requests. A natural idle-to-wake cycle and production memory headroom were not separately certified.
- The deployment database token was issued with a 30-day expiry on 20 September; renewal is required before approximately **20 October 2026**.
- Source selection does not prove sender intent. Excluded files remain retained, not verified.
- Reviewer names are self-declared; browser cookies are not enterprise identity. Database revision triggers do not prevent a database administrator altering the schema.
- No enterprise SSO/RBAC, malware scanning, formal retention/deletion, guaranteed backups, durable job queue or corporate-mail/ERP connector is claimed.
- Only organiser/synthetic data belongs in this public prototype. There is no measured employee time saving or production ROI.

Use [the development guide](DEVELOPMENT.md) to reproduce local checks and [deployment acceptance](DEPLOYMENT.md) for authorised cloud tests. No finite test suite guarantees zero future bugs.
