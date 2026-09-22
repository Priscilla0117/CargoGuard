# CargoGuard requirement-to-proof checklist

Updated 21 September 2026 for the latest 566-word natural narration script and 4:50 plan. Runtime remains a target until the actual recording is measured.

The organiser PDFs are supplied separately; they are not redistributed here. For the fresh 22 September code/main verification, see [submission check](SUBMISSION_CHECK.md). The filming status below remains separate.

## What “covered” means

Each requirement below has a planned evidence location and an acceptance check. **A plan is not proof that the final video passed.** Tick an item only after checking the actual recording or named supporting artifact.

The supplied rules require a video of at most five minutes. The rubrics accept evidence demonstrated, submitted or clearly explained; they do not demand a separate video walkthrough of every advanced feature. Main-video priorities are the core workflow and a clear employee benefit. Full advanced recovery/failure tests need supporting evidence rather than a misleading two-second clip.

The story-led revision keeps the same eleven proof scenes, with new timing and stronger employee-value explanations. Coverage below refers to scene numbers. Neither the prose revision nor a planned scene is new runtime evidence.

Current verification status:

- All five organiser PDFs were reviewed in the preceding requirements audit. Use-case pages 1–2 were rechecked for this revision.
- Current UI/code paths were checked for classification execution, extraction, reprocessing, field confirmation, history, OCR and exports.
- Prior preparation inspected live #313, #512 and the AI consent preview.
- This revision ran a local calculation check using the four actual synthetic fixtures. It passed: learned category BL_COMPARISON; earlier pair MISMATCH in consignee/notify; latest pair OK with all seven fields matching; non-mutating preview affects two fields; restoring BETA and confirming it preserves OK and sets reviewed provenance.
- That local check made **zero external calls**. It did **not** test a current cloud database save, browser flow, OCR run or OpenAI answer.
- Final filmed proof, successful live rehearsal, exported duration, public links and submission completion remain to be checked.

## A. Mandatory video contents

Source: Rules and Regulations, page 6.

| Requirement | Planned location | Acceptance check |
| --- | --- | --- |
| Quick team/project introduction | Scene 1 | Registered team name and CargoGuard clearly spoken/shown |
| Problem: affected user and why it matters | Scene 1 | Shipping staff, mixed requests, right attachments, missed-difference/rework risk explained |
| Key technologies and integration | Scenes 2, 6, 9 | Learned router, parsing/comparison role, Render, Turso and optional OpenAI explained through the workflow |
| Working prototype | Scenes 2–8 | Genuine UI interactions and outcomes, not mock-ups or substituted screenshots |
| Impact: metrics, results or user feedback | Scenes 10–11 | Dated development results and realistic proposed measures; no invented employee savings |
| Maximum five minutes | Final export | Measure actual media duration; target 4:45–4:50 |
| Accessible video | Submission link | YouTube unlisted/public, or Drive Anyone with link → Viewer; verify signed out |

A narrated promise does not satisfy “working prototype” if the corresponding result is missing or failed in the footage.

## B. Core problem requirements

Source: Shipping Document Verification Use Case, pages 1–2.

| Core requirement | Main-video proof | Pass condition |
| --- | --- | --- |
| Classify five message types | Scene 2 shows five categories, original #313 request, actual Reprocess sources and model/category output | One real automatic execution visible; five-type support documented; no manual category override presented as AI |
| Only comparison requests continue to checking | Scene 2 narration | Explicitly says other categories need classification, not automated fulfilment |
| Read SI and BL attachments | Scene 3 | Both document identities and source contents visible |
| Extract corresponding shipment fields | Scene 3 | Original source value/heading shown beside the resulting structured field |
| Recognize varied labels | Scene 3 | SI “Load Port” and BL “POL” map to the same Port of loading field; wording verified from #313 sources |
| SI is the reference | Scenes 3–4 | Clearly spoken or labelled; no suggestion that the BL can silently override it |
| Compare all seven fields | Scenes 3–4 and 7 | All seven rows readable at least once; raw source and normalized comparison distinguished |
| Show exact mismatches side by side | Scene 4 | #313: containers 5 vs 4, gross weight 118,270 vs 117,770 kg; other five match |
| Clear report tied to email | Scenes 4 and 7 | Case ID/subject, overall outcome, individual fields and SI/BL values visible |
| Report when all fields match | Scene 7 | Saved latest-pair summary says “No mismatch detected. All seven shipment fields match the Shipping Instruction.” |
| Escalate rather than guess | Scene 5 | #512 scan and #507 missing BL show reason/context and need for human action |
| Human review and updated output | Scene 8 | Original value checked, actual confirmation saved with reviewer/reason, new revision/review record and recomputed report visible |

### The seven fields

1. Shipper
2. Consignee
3. Notify party
4. Port of loading
5. Port of discharge
6. Container count (UI label: Containers)
7. Gross weight in kilograms (UI label: Gross weight (kg))

Do not hide all matching fields for the whole video. “Seven fields” spoken without showing the fields is weaker evidence.

### Important distinctions

- A category filter is not model execution.
- A spinner is not a successful extraction.
- An extracted text panel is not the original PDF image.
- Chat assistance is not the problem statement’s human-escalation requirement.
- The synthetic latest-draft selection is a source-pair change, not document editing.
- Scene 8 confirms a value that was already correctly extracted. Do not pretend it fixes a real parser error.
- Restoring BETA before saving is essential. Never save the intentionally wrong GAMMA value just to produce a dramatic history.
- A green comparison means the selected document values match, not permission to release cargo.

## C. Advanced-stage evidence

The use case explicitly encourages advanced work. These claims need evidence beyond the basic four steps. Main-video coverage is deliberately distinguished from full proof.

| Advanced area | In the main film | Supporting proof required if claiming full capability |
| --- | --- | --- |
| PDF layout/table extraction | #313 sources and structured results | Original PDF ↔ extracted result; retain document/page references |
| Word and mixed formats | Not fully walked through | Backup #097: SI.xlsx + BL.docx, source labels/cells and actual comparison; product also supports TXT |
| Image-only scan recovery | Review state/control shown, not full recovery | Complete #512 OCR + all-field confirmation workflow below |
| Varied labels/formatting | Load Port/POL shown | Other formatting/normalization tests in release evidence; do not claim every unseen layout |
| Missing attachments | #507 review reason shown | Confirm missing BL is not reported as a match; #508 offers a zero-attachment backup |
| Human confirmation/correction | Source-checked confirmation saved in scene 8 | Saved revision and provenance; a real extraction correction needs genuine source evidence |
| Visible processing failure | Not injected into public app | Clearly labelled local failure evidence and recorded release tests |
| Retry and replacement | Controls explained; #313 reprocess actually runs | Genuine retry/replacement path below; a button alone is not recovery proof |
| Reliability/security/performance | Selected recorded test evidence | Submitted dated test reports and limitations; no zero-failure/production-security claim |

### Backup 1: Mixed Word/Excel extraction

1. In a recording workspace, search `email_097`.
2. Open **Sources** and show `email_097_SI.xlsx` and `email_097_BL.docx`.
3. Open a source reference/cell and show the extracted comparison field.
4. On **Check**, inspect the actual container and gross-weight findings described in the release demo guide.
5. Do not narrate unverified literal numbers. Confirm them against these originals before filming.

Suggested explanation: “This example uses an Excel instruction and a Word draft. The extracted values still feed the same seven-field comparison.”

### Backup 2: Full scan recovery

1. Use a fresh, unconfirmed `email_512`. It has both scanned SI and BL.
2. **Sources → email_512_SI.pdf → Read scan with local OCR**.
3. Wait for actual OCR output. First use can download the model; label any shortened wait.
4. Select **Confirm document role → Shipping Instruction (reference)**.
5. For each of seven fields, compare **Confirmed source value** and **Source page** against the original page. Correct actual OCR mistakes only using the visible original.
6. Tick each **I checked this field against the original page** only after that check. Enter real **Reviewer name** and **Reason / source confirmation**.
7. **Save all seven confirmed fields & recompute**.
8. Repeat for the BL using **Draft Bill of Lading**. Confirming just the SI may leave the case correctly under review.
9. Show the actual final comparison and saved history after both documents are confirmed. Do not assume the final result must be matching.
10. If the scan is unreadable even to a person, request replacement. Do not invent field values.

A real recovery demonstration includes the original, suggestions, human checks, save and recomputed outcome. A “Read scan” button screenshot does not prove this flow succeeded.

### Backup 3: Processing failures and retries

Do not deliberately break the public database or alter production credentials for footage.

Existing recorded release evidence includes **12 local production-build storage-outage checks** with controlled 503 responses and preserved process liveness. Keep “local controlled test” visible if using those records.

For a safely scoped local/test demonstration:

- Show the genuine failure message and preserved prior state.
- Restore the known test condition, then use **Reprocess sources**.
- Show the resulting current revision and outcome.
- Never manufacture an error overlay or imply a normal rerun proves recovery from an outage.

**Refresh workspace** fetches data; **Reprocess sources** reruns classification/parsing/comparison. Keep those distinct.

For an actual unreadable/damaged source replacement:

1. **Replace documents**.
2. Supply a readable, authorised replacement SI and BL; enter **Reviewer name** and **Reason for replacement**.
3. **Replace documents & recheck**.
4. Inspect the new result and retained historical source context.

Do not pretend an unrelated fixture is the genuine replacement for an organiser shipment.

### Backup 4: Usable report/export

The main video shows the per-case report. For export proof:

- **Request correction → Full resolution checklist & evidence handoff → Download evidence handoff** provides evidence/report context.
- The printer icon is **Print report**. Show a saved PDF only if the browser print/save actually completed.
- **Work queue → Help & exports → Export reviewed evidence** is reviewed operational evidence, not an untouched accuracy benchmark.
- Do not use **Export automatic baseline** in a partially processed/reviewed workspace and expect success; it requires all 520 current untouched automatic results.
- **Reports → Performance → Download validation report** is recorded aggregate validation, not a fresh evaluation run.

Keep backup clips separate from the five-minute submission video, in accessible supporting documentation/demo material. Whether judges inspect additional materials is their decision; do not make a critical core claim depend solely on an optional clip.

## D. Both marking rubrics

Both allocate 70 technical / 30 product points. Criteria are related but not identical between preliminary and final rounds. The same evidence is not automatically rewarded twice.

| Preliminary / final area | Points | Evidence to provide |
| --- | --- | --- |
| Working Core Prototype / End-to-End Functionality |25| Real classify/extract/compare/review/report flow; saved recheck; working integrations |
| System Design & Architecture / Architecture & Scalability |15| Scene 9 plus detailed diagram, data flow, component choices, trade-offs and explicitly future scaling path |
| Technology Integration |15| Learned routing, parsers, persistent storage and genuine consented AI answer; explain why each contributes |
| Technical Feasibility & Validation / Engineering Quality & Robustness |15| Dated tests, uncertainty, review provenance, failure handling, isolation/version checks and limitations |
| Problem Statement Understanding / Solution Effectiveness & User Value |10| Correct affected user, SI reference, clear next action and practical workflow |
| Innovation & Solution Approach / User Experience & Differentiation |10| Meaningful document selection, linked preview and evidence navigation shown simply; no unsupported “only team” claim |
| Practical Value & Potential / Impact & Future Potential |10| Approved-pilot proposal, measures of review time/missed differences, adoption prerequisites and honest roadmap |

Final rubric page 2 calls Technology Integration provisional pending sponsor alignment. Check for an updated organiser version. No script or dataset score guarantees rubric marks or a win.

### Stronger architecture evidence

Current: Render-hosted Next.js/Node; Turso/libSQL persistence of small files/cases/revisions; local trained email model; parsers/normalization/comparison; optional server-side OpenAI.

Reasons: keep exact comparison separate from AI advice; keep credentials server-side; preserve review/source history across application restarts.

Proposed larger rollout: queued processing and managed file storage, with corporate authentication/roles, approved retention/security controls and unseen-document evaluation before confidential use. Do not present those proposed controls as already implemented.

### Validation labels

- 520/520: exact expected outputs on supplied development data, not unseen production accuracy or final judging score.
- 350 unit tests: recorded local release gate.
- 177 hosted checks: 170 HTTP + 7 retained-data checks.
- 12 storage-outage checks: separate local controlled tests.
- Actual provider-answer testing: limited; the main chat must be fact-checked independently.
- The local synthetic calculation check for this script is not an additional hosted suite and does not change the historical release totals.

## E. Non-video submission and eligibility checklist

Source: Rules and Regulations pages 1–2 and 6–7; infopack directs submission details to those rules.

- [ ] Team name/member registration and eligibility are correct; team size 2–5 and other participation conditions checked by the team.
- [ ] Work complies with the official hackathon period and originality rules; required source/licence acknowledgements are present.
- [ ] AI is a meaningful component and cloud use is meaningful.
- [ ] Project description submitted.
- [ ] Public GitHub repository includes source and clear setup README.
- [ ] Public deployed prototype works without the owner’s account and stays accessible during judging.
- [ ] Public deck/documentation covers technical architecture, implementation details, challenges and future roadmap.
- [ ] Public/unlisted video or appropriately shared Drive link works signed out.
- [ ] Actual video is under five minutes.
- [ ] Submission completed before the applicable deadline. The supplied files state 22 September 2026, 12:00 p.m.; check current organiser announcements for changes.
- [ ] For a final-round entry, it extends/improves the preliminary entry.
- [ ] Confirm latest organiser announcements, including provisional integration criteria.

Writing a video script does not complete these items. This recording plan does not submit an entry, change permissions, purchase services or verify team eligibility. See [SUBMISSION_CHECK.md](SUBMISSION_CHECK.md) for the separate current code/public-access audit; final filmed proof still requires sign-off.

## F. Final evidence sign-off

Record actual timestamps or artifact links, not planned times:

- [ ] Automatic classification execution and result: ______
- [ ] Original attachment to seven extracted fields: ______
- [ ] Normalized headings/values without a false mismatch: ______
- [ ] Exact two-field mismatch and five matching fields: ______
- [ ] Unreadable/missing-source reason and human action: ______
- [ ] Genuine correct chatbot answer plus opened supporting reference: ______
- [ ] Correction draft clearly unsent: ______
- [ ] Saved latest-source comparison and no-mismatch report: ______
- [ ] Previewed linked effect, exact source restored, human confirmation saved: ______
- [ ] New review revision and earlier history retained: ______
- [ ] Architecture roles and future/current distinction: ______
- [ ] Dated validation numbers and limitations readable: ______
- [ ] Full advanced claims supported by actual backup artifacts: ______
- [ ] Final duration and signed-out playback/link checks: ______

If any critical item fails, revise the claim or fix/rehearse the flow before submitting. Do not hide the failure with a success voiceover.

## Source ledger

- Shipping Document Verification Use Case (organiser-supplied PDF), pages 1–4.
- Rules and Regulations (organiser-supplied PDF), pages 1–2 and 6–7.
- Preliminary Judging Rubric (organiser-supplied PDF), pages 1–3.
- Final Judging Rubric (organiser-supplied PDF), pages 1–3.
- Participant Infopack (organiser-supplied PDF), pages 4–5.
- [Current release evidence](<CLOUD_RELEASE.md>), current 3.2.1 section only.
- Current deployment components and `lib/corrections.ts`, `lib/processing.ts`, `lib/compare.ts`, `app/api/cases/route.ts`, plus actual intake fixtures.
- Original organiser #313 source PDFs; #097 mixed-format and #507 missing-BL paths were identified in the supplied data/code audit.

The user-relayed organiser clarification permits use of the released Docker reference answers for self-evaluation. That does not make those answers an unseen test set or appropriate runtime inference input.
