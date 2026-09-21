# CargoGuard 3.2 — evidence-aware review workspace

Status: release candidate; hosted acceptance is recorded separately in CLOUD_RELEASE.md. Changes are independently implemented; HarborCheck was a workflow/comparison reference, not copied source. This is a stronger hackathon prototype, not a championship, zero-bug or production-readiness guarantee.

## What staff can do

### Import an email, not just a document pair

Use **Import email** to enter sender, subject and message and attach up to **10 TXT/PDF/DOCX/XLSX files**, **5 MiB each / 20 MiB combined**. Email-only messages can be routed too. This is manual intake, not Gmail or Outlook synchronisation. No mailbox permissions were added.

With extra attachments, the case stays under review. In **Sources**, explicitly select a readable identified SI and BL. The server binds the choice to source SHA-256 fingerprints and the current case revision. A reviewer name and reason are required. Other attachments remain downloadable and are clearly labelled **retained, not verified**. Unknown roles and damaged sources cannot bypass recovery simply by selecting them. Changing the pair recalculates from the sources; previous corrections and source bytes remain in history. Replacement drops the prior selection. Source-identical reprocessing preserves it.

This is useful when an operations email includes an invoice, an older BL and the latest BL. Staff can show exactly which documents supported their decision. It does not prove which revision a sender intended; the reviewer must check that.

### See a correction's consequences before saving

Under **Details / correct value → Correct value**, the **Before you save** panel recalculates all seven checks while the employee edits. It shows resolved findings, newly introduced problems, remaining uncertainty and linked-field changes. For example, changing a consignee can also change a notify party expressed as “same as consignee”.

The preview and server save share one calculation function. The preview makes **no storage write and no AI request**. Invalid/ambiguous values disable saving and are rejected again by the server. A version check prevents stale overwrites. Changing extracted data does not modify original files or authorize shipment release. SI edits are explicitly identified as changes to the reference.

### Less searching and less clutter

Two main pages remain: Work queue and Reports; Settings stays secondary. Compact colour-coded queue cards show counts and filter the next action. Colours also have labels/icons. Multi-file intake shows file names and limits. On laptops, the correction form and its impact preview sit side by side. History warns when the selected pair changes even if its field values are identical.

## Fixes and reliability boundaries

- Unexplained multiple corporate names in a party block now trigger review rather than becoming a false match when repeated in both documents. Wrapped company names, address continuations, repeated identical names and explicit agency wording have regression tests. This conservative gate does not recognize every possible international company-name construction.
- The learned router was retrained with independently authored security-incident examples. A report *about* a phishing message no longer automatically becomes the phishing message in the reproduced failing scenario. Actual credential demands still classify as spam. No organiser answer-key data was added to training.
- Inbox SQL removes document text, comparison evidence and email bodies **before** transferring results from the remote database. Full evidence remains available through the case-detail API. On the 520 supplied saved outputs, serialized queue summaries are 706,990 bytes versus 1,747,055 bytes for full results: **59.5% smaller**. This is a payload measurement, not a guaranteed latency reduction.
- Inbox, audit and policy reads run concurrently. One bounded retry is allowed for a transient **read-only inbox** failure; writes are never automatically replayed. Cancelled/older refreshes cannot replace newer case results or error/loading state. The UI labels last successful sync and retained older results after a failed refresh; it does not claim continuous healthy cloud status.
- Version 3.2.1 separates the process-only `/api/live` probe from `/api/health`, which still returns 503 when storage cannot be reached. Render uses the process probe so a later database outage does not itself trigger a restart loop. Normal startup still requires successful migration checks; there is no temporary local-storage fallback and failed writes are not replayed. Twelve local production-build fault checks verified this distinction with deliberately invalid synthetic database settings.
- The previous Turso capacity incident and Render free-tier cold starts remain provider constraints. This change reduces avoidable transfer and improves failure handling; it does not establish unlimited capacity or uninterrupted service.

## Validation and limits

The 3.2.1 local release gate passed all eight steps: typecheck, lint, **350 unit tests / zero skips**, 770-file organiser-input integrity, supplied-corpus evaluation, independent organiser scorer, OCR asset staging and production build. **228 local HTTP checks** passed on the 3.2 feature build (72 core, 35 hardening, 23 governance, 30 release, 25 assistant preflight, 15 revision and 28 new intake/review checks). The subsequent process-health patch has twelve additional local production-build fault checks. No valid external AI request was made. Use `public/validation.json`, `work/validation/quality-gate.json`, and CLOUD_RELEASE.md for timestamps and separately dated hosted acceptance.

The test suite includes 20 new unit checks for the repaired ambiguities, preview/save equivalence, dependent fields, pair fingerprints, source changes, history, isolation, compact summaries and bounded retries. The final browser walkthrough checked **1366×768 and 1280×720** layouts: four-file intake, pair selection with explicit exclusions, preview-only linked-field changes, rejected ambiguous values, save matching the preview, unchanged revision after cancelling, history, retained work after restart, and direct floating chat. The two-column dialog fits within the measured laptop viewport, without horizontal overflow. No warning/error appeared in the inspected final browser console. These observations are not a comprehensive accessibility audit or employee usability study.

All five same-generator development sets (2,600 emails total) match the expected outputs under the revised engine. These are **not independent production holdouts**. The separate 60-message routing challenge still has two incorrect raw category predictions among 50 clear messages; both go to review under the current safety wrapper. Nine of ten intentionally ambiguous messages go to review. This is not perfect model understanding.

The model is reproducibly trained from 910 generated training rows, with 181/182 grouped-by-body validation rows correct. Those rows are combinations of independently authored examples, not 1,092 real-world emails. Current model SHA-256: `25b36b744cc49e09b383d01bbc2c6560fe984e4cf1670dc02b674ce5b526be2a`. Retraining to a separate file reproduced the hash. The model has 9,244 features and occupies 776,816 bytes. Scores remain uncalibrated.

Existing optional cloud chat and source-quoted recovery remain available with consent and shared limits; this release did not spend additional OpenAI balance or change those limits. Grounding/source checks do not make an LLM hallucination-proof. Reviewer identities remain self-declared and the demo uses browser-workspace isolation, not enterprise SSO/RBAC. Only organiser/synthetic data belongs in this public prototype.

## Reproduce and demonstrate

```text
npm run quality -- --build
node --import tsx scripts/test-review-workspace-api.ts http://127.0.0.1:3055
node scripts/test-release-api.mjs http://127.0.0.1:3055
node --import tsx scripts/test-revision-api.ts http://127.0.0.1:3055
```

Use the four clearly synthetic files in `tests/fixtures/intake/`. Import all four. Select the SI and earlier BL to show the consignee/notify differences. Select the latest BL to show a matching **selected pair**, with two excluded attachments still visible. Preview a consignee change to show its notify-party consequence; cancel it to prove the preview saves nothing. Open History to inspect who selected each pair, original files and the revision differences.

This demonstrates employee value and auditability. It is more defensible than claiming a feature is unique among every team, claiming 100% accuracy on unseen shipments, or presenting a preview as an issuer-corrected document.
