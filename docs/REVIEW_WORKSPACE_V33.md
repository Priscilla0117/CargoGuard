# CargoGuard 3.3 workflow guide

Implemented on `Chan-modify`. The hosted demo is not automatically updated by these changes. App login and enterprise authentication remain the teammate's workstream.

## Getting started and reading a case

The workspace uses a flat navy sidebar, white panels and teal actions. The first visit shows three steps: **Add files**, **Review differences**, and **Prepare a reply**. Choose **Try one example** to check a single supplied case, or **Upload documents** to use your files. **Check all emails** remains available for batch processing. After a case has been processed, the guide stays available under **Quick start guide**.

The four-column queue shows each category beneath its email subject. Uploaded cases display **Uploaded** instead of a UUID; the full ID remains in **Case details**. Choose **Open** beside a case. Each shipment field has labelled shipping-instruction and draft-bill-of-lading panels, with full names and addresses wrapping onto as many lines as needed. **View source** and **Correct value** are visible buttons; the latter opens the correction form directly. **Before you save** still previews all seven checks. **Save correction & recheck** keeps the current case open, while **Save correction & next case** advances through the queue. If the next case cannot load, the current case stays open with an error message.

The case header groups the outcome, subject and short result summary above a compact sender/revision row. **Priority & dates** and **Case details** expand when needed. Elevated priority, due dates and follow-up dates remain visible on the scheduling control. Underlined **Field checks**, **Sources**, **History** and **Email & replies** sections show where you are; **How to review** explains the source and correction buttons on demand.

Use **Back to field checks** when reading a source and **Back to queue** when finished with a case. **Dates & priority** and comparison-rule explanations are expandable. On mobile, the queue and comparison panels stack vertically; navigation stays visible with text labels.

Reports distinguish saved workflow outcomes from development evaluation results. Settings group the active policy, tolerance editor, impact preview and version history. Saved policy records remain available, and tolerances never erase exact differences or approve a shipment.

## Documents and corrected attachments

Choose **Upload documents** to open **Add a new document check**, then add files in separate selections. The list accumulates selections; remove an individual file before submitting if needed. Exact repeated selections are deduplicated. Intake accepts TXT, PDF, DOCX and XLSX, up to ten files, 5 MB per file and 20 MB combined. When choosing the SI and BL, the full selected filenames appear below their selectors.

In a case's **Sources** tab, use **Add documents** for an absent SI or draft. Select a document and choose **Replace this document** for a damaged or revised file. Replacing the whole packet remains available. Every change requires a reviewer and reason, checks the current case revision, rechecks the evidence and retains previous originals in **History**. The case ID stays the same. Incoming Gmail message IDs and attachment IDs identify returned files; they do not overwrite old storage objects.

Corrections belong to a specific source. Corrections to unchanged sources survive appending or replacing another document, including when several candidates temporarily prevent comparison. Choosing another pair restores corrections only for the same source name and fingerprint. Changed sources are checked afresh, and a new confirmed transcription or recovery supersedes field edits on that source. Explicitly resetting field edits still clears them. Choosing a pair verifies that pair only; unselected attachments remain outside that check.

## Daily workload and urgency

Expand **Dates & priority**, open **Daily workload calendar** and choose emails received, cases imported, due dates or follow-ups. Clicking a date filters the queue. **Received today**, **Overdue**, **Due in 3 days**, **Follow up** and priority filters give shorter working lists. Each case counts once per selected date type.

Open **Priority & dates** in a case to record normal, high or urgent priority, a due date, a follow-up date and your name. Scheduling dates use Kuala Lumpur time (UTC+8). Priority, then deadlines and arrival dates, determine queue order. These settings do not change the document verdict or its revision. Unknown receipt dates stay in the undated group; reprocessing never invents a new arrival date.

## Replies in the existing email conversation

Follow [Gmail setup](GMAIL_SETUP.md) to configure the bounded mailbox pilot. Open **Gmail inbox** and choose **Sync now** to retrieve messages; import an unlinked message as a new case or link it to a current case. Later messages in a uniquely linked thread belong to that same case. Ambiguous links require a person to choose.

In **Email & replies**, inspect the returned attachment and choose the source to replace or add it as another attachment. Review and submit the new document revision. Correspondence alone does not mark a discrepancy resolved.

The existing **Ask CargoGuard** assistant can prepare a reply when optional AI is configured and the reviewer consents to the disclosed request. The deterministic correction draft also works without AI. Put the reviewed text in the reply editor, check recipients and save the draft. Confirm sending separately. Gmail thread identity, original subject and reply headers keep it in the existing conversation. A changed case revision makes an earlier saved reply stale. A timeout is treated as uncertain and reconciled before another send is considered.

The optional Gmail sync worker has durable cursors, bounded batches and a database lease. Provision it separately if continuous intake is needed. It is not a scalable document-processing queue, and a sleeping web host cannot monitor continuously. A durable job queue with retries, dead-letter handling and capacity testing remains production-roadmap work.

## Judge feedback and evaluation

Compound unknown-party expressions cannot produce a verified match merely because both documents contain the same placeholder. Regression tests include `TBA / TBC`, `TO BE ADVISED (TBA)` and real company names containing those letters. Hostile-text tests surround a known shipment discrepancy. Confidently unrelated email attachments are deferred until a reviewer reroutes the case for verification; unknown classification still inspects evidence conservatively.

The [unseen pilot protocol](UNSEEN_PILOT.md) supplies immutable manifests, independent labels, an evaluation runner and paired staff-timing input. Its templates contain no invented labels or outcomes. Collect and independently label a genuinely unseen sample, freeze it before evaluation, and run a supervised pilot before making operational accuracy or time-saving claims.

## Validation

Validation uses local synthetic workspaces and mocked Gmail responses. No real messages were sent and no live Google OAuth/delivery test was performed. Gmail requires the owner's configured Cloud OAuth client and mailbox; app authentication must integrate the documented ownership check before widening access.

For the current whole-site redesign, all **420 unit/regression tests**, **TypeScript**, **ESLint** and the **optimized production build** passed. Browser checks covered the queue, getting-started guide, upload dialog, long source values, sources, revision history, correction draft, reports, settings and disabled Gmail messaging. Phone-width checks covered queue stacking, labelled navigation, reports, settings, history and the assistant, with no horizontal page overflow observed. The production preview loaded its saved workspace without browser warnings or errors. Connected Gmail and live AI states were not exercised in this visual walkthrough.

Earlier local workflow validation, recorded on 24 September 2026 before the whole-site redesign:

| Check                           | Result                                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit/regression suite           | 420 passed, zero failed/skipped; includes 22 mocked Gmail checks                                                                                                   |
| Existing HTTP suites            | 228 passed across core, hardening, governance, release, revision history, review workspace and assistant preflight                                                 |
| New workflow HTTP suite         | 18 passed: individual replacement, history, version conflicts, unknown parties, scheduling isolation, deferred routing and disabled Gmail                          |
| Correction persistence journey  | Passed append → unresolved pair → persisted read → pair selection, summary privacy, historical evidence and explicit reset                                         |
| Supplied development set        | 520/520 exact outputs with the independent official scorer; 46/46 defect cases and 20/20 review cases                                                              |
| Source integrity                | All 520 email records and 250 original document copies unchanged                                                                                                   |
| Earlier build checks            | TypeScript, ESLint and optimized production build passed for the earlier workflow version; core and new workflow HTTP checks passed against that production server |
| Earlier browser walkthrough     | File accumulation, replacement/append history, deadlines and calendar filters passed; the earlier production page loaded                                           |
| Earlier readability walkthrough | Desktop and 390 px source-value wrapping, visible actions, correction focus/cancel, preview and saved discrepancy checks passed for the earlier interface          |

This evidence does not establish unseen operational accuracy, employee time savings, live Gmail delivery, hosted persistence or scale. The 520-case results describe development data already supplied to the project.
