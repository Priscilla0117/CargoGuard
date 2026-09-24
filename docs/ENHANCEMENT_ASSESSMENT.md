# Employee-focused enhancement assessment

Assessment date: 23 September 2026. Current branch: `codex/final-round-employee-workflow`.

The five suggestions are useful directions, but several are already partly implemented and several need narrower safety boundaries. The strongest product proposition is: **employees can identify the next action, inspect its evidence, coordinate responsibility, check the returned draft and retain why the task was completed**. Priority should follow demonstrated employee effort and failure risks, rather than feature count.

This assessment does not implement the proposed OCR, learning, deadline, identity or threading extensions. It records code inspection, targeted checks and an implementation order. Existing final-round workflow acceptance is in [FINAL_ROUND_VALIDATION.md](FINAL_ROUND_VALIDATION.md).

## Recommendation by proposal

| Proposal | Existing capability | Recommended refinement | Priority |
|---|---|---|---|
| OCR with review | Browser-local English OCR, seven prefilled unconfirmed values, source pages, mean OCR confidence, explicit human confirmation | Field-specific source crops and recognition confidence; bounded OCR preparation; actionable failure recovery | High employee value |
| Learn corrections | Per-case corrections with history; fixed label aliases, including Load Port | Proposed template-scoped aliases, impact preview, authorized activation, versioning and rollback | After identity and evaluation controls |
| Three new seeds | Historical multi-seed development reports; current normalizer regressions | Frozen first-run fresh-seed results plus an independent blind set using different layouts/authors | High evidence value |
| Urgency and revised threads | Entered deadlines, overdue sorting, owner/reference search; BL-only revisions and What changed? | Evidence-backed document deadlines, unknown-deadline queue, conservative reply association | High employee value |
| Security | Workspace isolation, source restrictions, atomic audit/revision history, bounded read-only AI | Verified login, server authorization, shared ownership, privacy-safe diagnostics, adversarial tests | Required before an employee pilot |

## 1. OCR: reduce confirmation effort without inventing certainty

`components/scan-assist.tsx` already runs local OCR when the reviewer requests it, proposes seven values, shows original page images and requires explicit confirmation. `lib/transcription.ts` binds confirmation to the source hash and page references. Scans remain in review until confirmation. Empty/corrupt input errors are visible; corrupt PDFs cannot enter the scan-confirmation route.

The current confidence display is a mean of page-level recognition scores. It is not field accuracy, a calibrated probability of correctness, or confidence that SI and BL agree. Do not present a page average as a per-field score.

Recommended next implementation:

- Place the supporting image crop/highlight beside each value. Retain the original page and exact source identity.
- Derive field recognition confidence from the OCR words actually used, retaining the method. Keep missing/conflicting values explicitly unknown and all OCR fields unconfirmed.
- Put uncertain fields first and allow efficient keyboard navigation. Do not pre-check confirmation boxes.
- Prepare OCR through a bounded, cancellable queue with progress. The current browser worker depends on an open session; it is not a durable unattended server job.
- Use Retry for transient downloads, worker failures and timeouts. For empty/corrupt bytes, show Replace document/request readable copy. Retrying the same unreadable bytes is not recovery.

Acceptance: source/value correspondence, incorrect but high-confidence digits, rotations, multiple pages, canceled work, worker failure, invalid PDFs, changed source hashes and interrupted saves. Existing English/five-page/5 MB limits must remain visible unless deliberately expanded and tested.

## 2. Learning: retain a reusable interpretation, never a shipment-specific answer

`lib/compare.ts` already recognizes `Load Port`, `Port of Loading` and `POL`. Demonstrating this example as newly learned would be misleading. `lib/corrections.ts` stores corrections for a specific case; there is no reusable learned-rule registry.

Distinguish two actions:

- Correct this document: the extracted gross weight should be 42,500 kg.
- Propose a reusable mapping: this confirmed issuer/template uses an unfamiliar label for gross weight.

Never learn a general substitution such as `43,000 -> 42,500`, broad company identity equivalence or port equivalence from one case. It can hide a real discrepancy in another shipment. A reusable alias should identify a field; extraction, normalization and all seven comparisons must still run.

Recommended flow: candidate with source evidence and scope -> conflict detection -> impact preview on retained cases -> authorized approval -> immutable rule version -> observed applications -> rollback by a new version. Scope should include the workspace and confirmed template/issuer context; sender text alone is not verified identity. Ambiguous aliases abstain. Existing completed decisions are not rewritten silently.

Prefer **Approved rules added this week**, **Cases assisted by approved rules** and reviewed error outcomes to an unqualified learning counter. Keep candidate counts separate. Personal shipment values do not belong in the reusable alias store.

Acceptance: another shipment benefits from the alias, changed weight still fails comparison, conflicting labels stay uncertain, another workspace cannot activate it, and rollback reproduces the earlier interpretation.

## 3. Evaluation: distinguish reproducibility from generalization

The historical model card records four additional same-generator datasets after development fixes. They are development evidence, not three fresh runs on this branch. Some historical per-seed raw gate files are absent locally even though aggregate summaries remain. Do not merge these records into new first-run claims.

The organiser generator supports `--seed`, `--n` and `--out`; 500 requested messages plus 20 edge cases yields 520. A fresh experiment must freeze source, model and generator hashes, use unused seeds and separate output directories, retain failures and avoid tuning between runs. Never overwrite the supplied input bundle or let the application read answer keys.

Three new first runs completed on the frozen engine 3.2.1, with no application/model/generator tuning. The before/after 237-file source manifest was identical. Full inputs, predictions, hashes, scorer results and differences are retained in the [fresh evaluation evidence](../work/validation/enhancement-assessment/SUMMARY.md).

| Seed | Exact outputs | Exact defects caught | Required review cases caught | False verified |
|---|---:|---:|---:|---:|
| 314159 | 520/520 | 62/62 | 20/20 | 0 |
| 271828 | 520/520 | 66/66 | 20/20 | 0 |
| 161803 | 520/520 | 57/57 | 20/20 | 0 |
| Combined | 1,560/1,560 | 185/185 | 60/60 | 0 |

Category macro-F1, defect precision/recall/F1 and review precision/recall were 1.0 for each seed. This automatic benchmark leaves scans in review; it does not measure OCR transcription accuracy. The source-manifest scope is recorded with this experiment and differs from the earlier 233-file release manifest.

The same-generator limitation applies even to perfect scores: seeds change sampled inputs while sharing generation logic, templates and entity pools. Stronger generalization evidence comes from a blind set with different authors/layouts and grouping related templates/threads so they do not leak across splits. This follows the distinction between ordinary random splits and evaluation on unseen groups in [scikit-learn's evaluation guidance](https://scikit-learn.org/stable/modules/cross_validation.html).

The existing normalizer coverage is substantial. A focused rerun of pipeline, hardening, adversarial-comparison, generalization and evaluation-gate suites passed **146/146** tests in this assessment. Coverage includes generated container sums, tonne/kg conversion, malformed numbers, missing values, notify-party dependencies, ambiguous ports and conflicting units. Expand tests for observed gaps and new features rather than duplicating these assertions.

Report per-seed category metrics, defect detection, exact defect fields, review recall and false verified cases with denominators. Distinguish organiser `status=OK` from employee `workflow=verified`: missing-document requests may use OK in the organiser contract without being safe to complete. Report review burden and false clearances together so sending everything to review cannot masquerade as success.

## 4. Urgency: deadline evidence and safe case association

The queue already sorts active follow-ups using staff-entered `due_at`, and BL-only replacement creates revisions under the same case. History already identifies fixed, new and unresolved issues, plus changed references. Current emails lack received timestamps, Message-ID, reply headers and provider conversation IDs, so this is manual revision grouping, not automatic mail threading.

**ETD is a departure estimate, not a BL approval deadline.** Keep BL confirmation, SI submission, VGM, gate-in, internal follow-up and ETD separately typed. Carrier documentation distinguishes document deadlines from other cutoffs and advisory dashboard dates from final booking-confirmation deadlines. [Maersk deadline guidance](https://www.maersk.com/support/faqs/shipping-instructions-deadline), [cutoff guidance](https://www.maersk.com/fr-fr/support/faqs/how-can-i-find-out-the-vessel-cut-off-time).

Extract a candidate with its exact quote, source/page, source hash, type, timezone and confirmation state. Explicitly resolve `03/04`, date-only values, missing timezone/year, conflicting dates and quoted older messages. Do not convert “tomorrow” without a reliable message timestamp or invent an Averis SLA. A confirmed document deadline can feed the current queue; show why the case is urgent. Keep an unknown-deadline queue so missing dates are visible.

For replies, use provider message identity/reply provenance together with verified shipment references. A shared subject or conversation can contain multiple shipments. Conflicts require a suggested link and human confirmation. Duplicate delivery must be idempotent; arrival order must not silently select an older attachment as authoritative. Preserve originals and the selected SI hash.

The supplied 520 email subjects/bodies contain no ETD/cutoff/estimated-departure/deadline keywords in the targeted check. Their accuracy score cannot validate this extension; add a separate labelled date/thread set.

## 5. Security: protect the workflow independently of classification

The current random workspace cookie isolates browser workspaces. It is not employee authentication or verified identity. Owner/reviewer labels are self-declared. The unused `app/chatgpt-auth.ts` helper does not create route authorization in the running application. Existing case/revision/audit writes are atomic, and immutable revision triggers protect against ordinary updates; they are not administrator-proof audit storage.

A useful identity extension includes a shared team workspace with authenticated membership, server-enforced operator/reviewer/admin permissions, claim/reassign behavior and an audit actor derived from the session. The server must reject unauthorized direct API calls; hiding a button is insufficient. Deny by default and check permissions on every relevant request, including source downloads, exports, rule activation and history. [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html).

Treat all incoming text as data. A SPAM label is not an authorization or AI-security boundary. A legitimate document request can carry embedded instructions; a security-training email can quote the same phrase harmlessly. Keep business category separate from any suspicious-content indicator, and retain a safe review route. Layer bounded context, schema/source validation, least privilege and human confirmation. Prompt warnings alone are insufficient. [OWASP prompt-injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

Application error handlers inspected here log an operation label plus error type, and provider diagnostics are bounded. Add a centrally allowlisted diagnostic logger and tests that raw email bodies, credentials, session tokens and personal values do not reach it. Preserve necessary original evidence in access-controlled case/audit records rather than destroying comparison evidence through blanket redaction. Logs still need sanitization, access restrictions and retention controls. [OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html).

### Actual local security probes

Evidence: `work/validation/enhancement-assessment/security-probes.json`. Four synthetic routing probes produced SPAM for explicit credential phishing with an injected instruction, BL_COMPARISON for a document request with an injection, GENERAL for a security-training quotation, and BL_COMPARISON for its clean document-request control.

A deterministic pipeline probe retained the real weight discrepancy when the injected instruction was in the email. Appending either the instruction or a harmless `Remarks: Delivery pending.` line to the BL made the weight uncertain and routed the case to review. The original strict “mismatch stays mismatch” assertion failed and is retained in the report; no probe became verified. This reveals a field-boundary sensitivity worth fixing and regression-testing to reduce unnecessary review. It is not evidence that the parser followed a command.

These are small local probes. No external AI model was called, and no claim of complete prompt-injection resistance follows. A future adversarial suite should test instructions in emails, source lines and OCR, correct business classifications with malicious content, secrets/external URLs, access denial and sanitized diagnostics.

## Recommended implementation order and better additions

1. **Fix observed review friction and strengthen evidence.** Address the trailing-remarks boundary, make OCR confirmation efficient, retain first-run evaluation evidence and add a genuinely independent blind challenge.
2. **Make collaboration real.** Authenticated shared ownership, My work/Unassigned views, claim/reassign and absence handover are more useful than names in isolated browser workspaces. They also make rule approval and audit actors meaningful.
3. **Add source-backed deadlines and careful reply linkage.** Answer “what needs my action today, why, and which document supports that?” without merging different shipments or guessing cutoffs.
4. **Add governed template memory.** Approve reusable label interpretations with impact preview and rollback after identity/evaluation controls exist.
5. **Measure employee benefit.** Record comparable manual/assisted active handling time, correction cycles, unnecessary review, overdue work and wrong-case linkage. Use observed counts/denominators; do not turn test counts into time or money saved.

The final-round demonstration should show one complete difficult task: scan -> supported extraction -> discrepancy -> responsible owner/deadline -> revised BL fixing one field but introducing another -> blocked completion -> final verified revision -> retained audit/history. Add one unauthorized-write attempt and one injection example whose content cannot clear the discrepancy. Explain which parts are real, synthetic, manually confirmed and still proposed.

This supports end-to-end functionality, engineering quality, employee value and UX more coherently than adding disconnected features. No feature list or finite test suite can establish zero bugs or guarantee a competition result.
