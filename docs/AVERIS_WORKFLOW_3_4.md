# Employee workflow hardening — 3.4.0

Based on the `cowork` branch at `4a93d2c5997cd42449e5b47abb118b86dd1d6ec8`. This release focuses on trustworthy document correction, request tracking and recovery from interrupted mailbox operations. It preserves the received files and does not issue or approve bills of lading.

## The employee journey

1. Import email and select the current SI and draft BL. Clearly irrelevant attachments can be retained without parsing; confirming a deferred message as a document check reads its stored originals.
2. Inspect differences using the source links. For a supported BL mismatch, **Review correction** shows the current BL value beside the proposed value already filled from the selected SI. **Review prefilled correction request** opens a draft containing the known differences; staff reviews the request without retyping the values. The proposal itself does not change a case or send email.
3. **Correct a reading error** is a separate action. A different reading is automatically filled only when supported by that document's own field evidence; this can restore a mistaken manual reading without copying the other document. Source text, an original-file link and a direct route to document reading help remain available. Unsupported readings remain **Needs review**, even when they equal the SI. Confirm a difficult scan through transcription/recovery, or obtain a revised document. Original bytes and earlier revisions remain unchanged.
4. If the document is actually wrong, prepare a correction request. Review the recipients and wording before sending through a configured mailbox. A saved draft, copied message or downloaded email does not prove that a request was sent.
5. A confirmed mailbox submission can record **Waiting for reply** automatically and preserve the existing owner and deadline. An employee can also record a request made outside CargoGuard through an explicit confirmation. Historical waits without a recorded request become actionable for staff to check.
6. Receive the revised BL, recheck all seven fields, and inspect revision differences. Reading corrections survive only for the same source identity. The newest related draft controls whether earlier discrepancies have been resolved. A matching document check remains separate from shipment completion and release authority.

## Automation and safeguards

- Combined unknown values such as `TBA / TBC` and `TO BE ADVISED (TBA)` cannot produce a match. Wrapped container counts and PDF weight layouts have regression coverage.
- Source-pair selection, replacement, reprocessing and scan confirmation preserve source-bound correction history. Selecting the same files cannot erase an unresolved correction.
- An unrelated invoice does not block an otherwise unambiguous SI/BL comparison. Ambiguous pairs, stale evidence and linked shipment blockers remain actionable.
- Conversation grouping by subject alone cannot close or resume work. Receiving a BL does not automatically fulfill an SI request.
- Mailbox intake keeps a durable cursor and import identity, recovers abandoned import reservations and avoids recreating a case after a retry. Provider received time is distinct from the sender's message date.
- Each send or mailbox draft has a durable operation identity tied to the reviewed case revision. Duplicate requests return the saved receipt. Uncertain delivery blocks another send until checked or explicitly resolved; status checks never resend. Partial SMTP acceptance identifies affected recipients and does not automatically mark the request as waiting.
- Matching-field emails explicitly report the selected document comparison. They do not instruct a carrier to finalise a BL or release cargo. Optional AI wording must retain this scope.
- Import polling and reminders run while the browser is open. This release does not claim unattended background processing or automatic follow-up emails.

## Verification

Run the reproducible checks from the repository root:

```sh
npm run quality -- --build
node scripts/test-team-runtime.mjs
node --import tsx scripts/test-averis-workflow-api.ts http://127.0.0.1:5192
node --import tsx scripts/test-review-workspace-api.ts http://127.0.0.1:5192
node --import tsx scripts/test-revision-api.ts http://127.0.0.1:5192
```

The last three commands require an isolated local demo server; they create synthetic workspaces and documents. The team-runtime script starts its own isolated production server and checks permissions, persistence and restart behavior. Local validation reports are written under `work/validation/` and are excluded from Git.

Validated locally on 25 September 2026:

| Check | Result |
| --- | --- |
| Type checks and lint | Passed |
| Automated regression suite | 648 passed, 0 failed or skipped |
| Production build and local OCR assets | Passed |
| Original organiser corpus and independent scoring script | 520/520 exact output agreement; 46/46 defect cases and 20/20 required reviews; 0 observed false clearances on this corpus |
| Organiser input integrity | 520 emails and 250 documents unchanged |
| Isolated production team and restart acceptance | 49 checks passed |
| Employee correction/request/replacement HTTP journey | 24 checks passed |
| Explicit document-selection HTTP journey | 28 checks passed |
| Revision history and source isolation HTTP journey | 15 checks passed |
| Browser review | Inbox, compact comparison, prefilled correction proposal, source excerpt, unsupported-edit preview, reply and follow-up screens inspected |

Organiser scoring and authored regression fixtures are development evidence, not independently labelled unseen production accuracy. Provider tests use simulated services; the checks above do not establish live-mailbox compatibility, production capacity or zero defects.

## Before an Averis pilot

Apply the included database migration through normal startup. Existing source files and case history remain intact. Recheck old-engine comparisons before completing them; staff should inspect legacy waits that have no request record.

Test approved Gmail/Google Workspace credentials against real draft, threading, partial-failure and corrected-attachment scenarios. No live mailbox was used in this development environment. Validate the employee workflow, document authority, retention, backups and workload on an approved supervised pilot. Existing authentication remains separate from this change. Larger deployments still require queued background intake and storage capacity planning, as documented in the README.
