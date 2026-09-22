# Review workspace — product guide

CargoGuard 3.2.1 organizes document checking around **Work queue**, **Reports** and secondary **Settings**. A case has three sections: **Check**, **Sources** and **History**.

[Architecture](ARCHITECTURE.md) · [Case assistant](CASE_ASSISTANT.md) · [Setup and tests](DEVELOPMENT.md)

## From inbox to a supported decision

| Step | Reviewer action | Product boundary |
| --- | --- | --- |
| Route | Run the sample inbox or import an email | Five email categories; only comparison requests continue to shipment checking |
| Inspect | Read the seven SI/BL values and source evidence in Check | SI is the reference; uncertain values are not matches |
| Select sources | Choose an identified readable SI and BL when several attachments exist | Only that pair is verified; all other files remain retained, not verified |
| Resolve | Inspect sources, confirm an extraction, replace files or request missing evidence | Saved corrections do not edit original documents |
| Recheck | Review the recomputed result and any remaining uncertainty | Matching fields do not authorize shipment release |
| Trace | Inspect earlier snapshots and original files in History | Reviewer names are self-declared, not corporate identities |

Queue filters group cases by next action. With the supplied data, **15 need evidence recovery and 96 need documents**; the latter includes five missing-attachment review cases plus 91 awaiting-document requests. These operational queues do not change the underlying **20 review / 91 awaiting** result counts.

Reports include discrepancy-pattern counts and an event trail. Counts are observations, not inferred root causes, supplier ratings or measured savings. **Help & exports** offers a shift brief and separately labelled automatic/reviewed exports. Correction drafts require source review and acknowledgement; nothing is emailed automatically.

## Intake and source selection

**Import email** accepts sender, subject, message and 0–10 TXT/PDF/DOCX/XLSX attachments. Document replacement accepts 2–10 files. Both use `POST /api/upload`, with **5 MiB per file / 20 MiB combined** limits.

Email-only intake can route a message but cannot verify absent documents. Extra attachments keep a comparison under review until the reviewer selects a valid pair in **Sources**. A name and reason are required. The server binds the selection to file SHA-256 fingerprints and the current revision.

Files with unknown roles or unreadable content need the appropriate recovery/replacement process before selection. Selecting a pair does not establish the sender's intended draft. A different pair recalculates from source while keeping prior corrections and bytes in history. Replacement clears the old selection; source-identical reprocessing preserves it.

## Preview a correction before saving

Under **Details / correct value → Correct value**, **Before you save** recalculates all seven checks as the value is edited. It shows resolved findings, new issues, remaining uncertainty and linked effects—for example, a notify party expressed as **SAME AS CONSIGNEE**.

Previewing saves nothing and makes no AI request. Preview and server save share the same calculation. Invalid values disable Save and are rejected again by the server. Saving checks the expected revision and atomically records the result, complete revision and event; a stale save is rejected.

A changed SI value is a change to the reference, not evidence that the BL issuer corrected anything. **Save correction & next case** advances only after a successful save; it never approves the next case.

## Reproducible four-file example

This small fictional example exercises source selection, linked-field preview and history. It is not organiser evaluation data and does not contact an AI provider.

Files: [si.txt](../tests/fixtures/intake/si.txt), [earlier-bl.txt](../tests/fixtures/intake/earlier-bl.txt), [latest-bl.txt](../tests/fixtures/intake/latest-bl.txt), [invoice.txt](../tests/fixtures/intake/invoice.txt).

### Import and compare

1. Open **Work queue → Import email**.
2. Use sender `demo@example.test`, subject `Synthetic test: review the latest draft BL`, and message: `Please compare the attached shipping instruction with the latest draft bill of lading. The earlier draft and invoice are included for context.`
3. Attach the four unchanged files and choose **Import & check email**.
4. Under **Sources → Select SI and draft BL**, select `si.txt` and `earlier-bl.txt`. Enter your actual reviewer name and a reason such as `Synthetic test: inspect the supplied earlier draft.` Choose **Confirm pair & compare**.
5. Expect **MISMATCH** in **consignee and notify party**: SI uses BETA IMPORTS LTD; the earlier BL uses GAMMA IMPORTS LTD and inherits that value for notify party.
6. Under **Change comparison pair**, select `si.txt` and `latest-bl.txt`, record the reason and confirm. Expect all seven fields to match for the **selected pair**. The earlier draft and invoice remain retained, not verified.

Both drafts were imported together; selecting another one is not receipt of a new sender email.

### Check a linked edit safely

1. Inspect `latest-bl.txt`: its consignee is **BETA IMPORTS LTD**, and notify party is **SAME AS CONSIGNEE**.
2. In **Check**, show all fields. In the right-hand draft BL consignee column, choose **Details / correct value → Correct value**.
3. Temporarily enter `GAMMA IMPORTS LTD`. Expect **two new problems** in the preview, including the linked notify-party change. **Do not save that hypothetical value.**
4. Restore the actual source value `BETA IMPORTS LTD`. Confirm that the preview returns to matching.
5. Enter your reviewer name and a truthful reason, for example: `Confirmed BETA IMPORTS LTD against the latest BL source; the temporary what-if was not saved.` Choose **Save correction & recompute**.
6. Verify the save confirmation and new revision. The seven-field result should remain matching. This confirms an already-correct extraction; it does not repair a real parser error or change the original file.
7. Open **History**, inspect the saved review entry, then expand **Inspect full earlier snapshot and original files** to check the earlier evidence.

Because the saved value remains BETA, before/after field comparison can correctly show **zero value changes**. The new review record is distinct from the earlier source-pair change. If a save fails or its outcome is unclear, inspect current state before repeating it.

## History and review safeguards

History compares the current result with an earlier saved snapshot. Source links are pinned to each revision. It distinguishes new issues, newly matching fields, unresolved fields and checks no longer available. A mismatch becoming unknown or being routed elsewhere is not shown as a fix.

SI, category, engine, policy and source-pair changes receive notices. Historical inspection is read-only; it does not restore or delete a result. Database triggers reject ordinary revision updates/deletes, but this is not certified tamper-proof storage against an administrator.

## Validation and limits

The recorded 21 September 3.2.1 gate passed **350 unit tests**, **228 local HTTP assertions**, **12 local outage checks** and **177 hosted acceptance/persistence assertions**. Laptop workflows were inspected at 1366×768 and 1280×720. The separate [22 September report](SUBMISSION_CHECK.md) records the fresh local recheck; [cloud evidence](CLOUD_RELEASE.md) separates dated hosted and provider tests.

The synthetic pairing and linked-edit paths have regression coverage, including stale writes, preview/save equivalence, cancellation, file fingerprints and revision history. These are engineering checks, not an Averis employee usability study or comprehensive accessibility certification.

The [model card](MODEL_CARD.md) records routing errors, development-set limitations and OCR/LLM fallibility. Browser workspaces are not corporate authentication. Only organiser/synthetic data belongs in the public prototype. A supervised pilot with approved new documents, staff feedback and measured review outcomes is still required before production use.
