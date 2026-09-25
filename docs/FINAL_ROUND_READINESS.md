# CargoGuard 3.3.1 — final-round readiness and evidence

> **Current release handover:** [EMPLOYEE_RELEASE.md](EMPLOYEE_RELEASE.md) records the latest 507-test build, team acceptance and company rollout prerequisites. It supersedes release-status statements in this earlier snapshot; the historical evidence and rubric mapping below remain unchanged.

Reviewed on 24 September 2026 (Asia/Kuala_Lumpur) against the four supplied organiser PDFs. This is an evidence map for the final prototype, not a promised score, an organiser ruling, or a production certification. Work is on `codex/final-round-employee-workflow`; this document does not establish a GitHub push, deployment, submission, or Microsoft tenant connection.

The product story is: **help an employee finish a shipping-document correction, while preserving exactly which source, instruction, person and revision supported the decision.** Demonstrate that complete sequence before showing additional desks or dashboards.

## Fresh first-run evidence on engine 3.3.1

The final parser/classifier/normalizer engine passed three newly generated seeds without tuning between runs. Seeds were fixed and searched in prior local validation evidence before generation. The same organiser generator and its official scorer were used; this is variation within its templates, not an independent field study or proof against every kind of overfitting.

| New seed | Exact required outputs | Exact defects caught | Required reviews caught | Category macro-F1 | Defect F1 | Observed false verified cases |
|---|---:|---:|---:|---:|---:|---:|
| 196613 | 520/520 | 60/60 | 20/20 | 1.000000 | 1.000000 | 0 |
| 262147 | 520/520 | 55/55 | 20/20 | 1.000000 | 1.000000 | 0 |
| 327673 | 520/520 | 52/52 | 20/20 | 1.000000 | 1.000000 | 0 |
| Combined | **1,560/1,560** | **167/167** | **60/60** | **1.000000** | **1.000000** | **0 observed** |

Category accuracy, field F1, review precision and the official scorer composite were also 1.0 for every seed. The composite is the supplied output scorer, **not the 100-point hackathon judging rubric**. Awaiting-document requests may have organiser status `OK`; they remain operationally unverified. False verified counts inspected the actual `verified` workflow, not every `OK` status.

The 27-file engine/evaluation dependency closure, together with processing/OCR/label-rule modules and dependency manifests, was identical before and after the 20-second experiment. Unrelated operational UI and API work was outside this freeze. The hash is `3b5e4222810db6267f0ce6dbf0dcfadb8da4690a4e0379c126d3e64d436c6e68`. The learned routing model hash remained `25b36b744cc49e09b383d01bbc2c6560fe984e4cf1670dc02b674ce5b526be2a`.

Evidence: [run summary](../work/validation/final-enhancements-331/SUMMARY.md), [machine-readable results](../work/validation/final-enhancements-331/summary.json), [source before](../work/validation/final-enhancements-331/source-before.json), [source after](../work/validation/final-enhancements-331/source-after.json), and the retained first-run harness. Each seed directory contains generated data, pipeline results, differences, predictions, official metrics and a hash-bound strict gate. `scripts/evaluate.ts` reads inbox records and source attachments; only the offline scoring step reads ground truth, after predictions are written. Label-rule approvals and human OCR transcriptions are not included in untouched automatic benchmark results.

The prior [3.3.0 first-run evidence](../work/validation/final-enhancements/SUMMARY.md) remains unchanged: 1,560/1,560 exact outputs on seeds 104729, 130363 and 155921. A later independent code review found a scenario outside those seeds: a contradictory weight inside Notes could be hidden by an earlier Total gross weight field. Engine 3.3.1 fixes that source-context defect. The final table above uses three additional untouched seeds, rather than relabelling the earlier run as a final build test.

After the safety fix, 102/102 targeted parser/normalization/label/OCR regression tests passed, including the new contradictory-total regression. An earlier separate feature selection completed 28 OCR/label-rule/batch tests. Overall acceptance counts, production build results, HTTP checks and browser results must come from the final release validation run; these smaller counts should not be added together as if they were independent tests.

## Map demonstrations to the seven scoring criteria

The final rubric assigns 70 points to technical criteria and 30 to product/impact. Its Technology Integration criterion is explicitly provisional. The rubric instructs judges to score each criterion independently and avoid awarding the same evidence twice.

| Criterion | Points | Concrete evidence to demonstrate | Limits / additional evidence needed |
|---|---:|---|---|
| End-to-End Functionality | 25 | Inbox classification → source-backed seven-field comparison → missing-document or discrepancy task → revised BL with unchanged SI → renewed comparison → authenticated completion and revision history. Show a failed/stale action recovering visibly. | The complete configured production path still needs the final deployed smoke test. A local prototype or mocked provider test is not evidence of a live tenant integration. |
| Architecture & Scalability | 15 | Separate extraction/normalization, workflow records, authentication, database adapters and provider integration. Explain workspace scoping, source fingerprints, immutable revisions, compare-and-swap writes, bounded processing and provider dispatch states. | Current limits intentionally bound a pilot. Explain a migration to queued processing, database backups and monitored workers; do not claim enterprise throughput without load tests. |
| Technology Integration | 15 | Learned intent router, PDF/Word/spreadsheet extraction, local Tesseract OCR with real word coordinates, persistent SQL workflow records, and the configured Microsoft OAuth/Graph/Outlook path where available. | Show the cloud architecture and actual deployed persistence. If Microsoft is unconfigured, demonstrate the implemented adapter and its tests while naming tenant consent and host acceptance as remaining work. |
| Engineering Quality & Robustness | 15 | Fresh seed evidence above; adversarial normalization checks; corrupt-source review; stale source/rule rejection; audit-transaction rollback; roles checked at APIs; OCR cancellation/retry; safe provider retry behavior. | Final gate logs and browser evidence are required. No finite suite demonstrates zero bugs. Database triggers protect app behavior, not hostile database-administrator access. |
| Solution Effectiveness & User Value | 10 | Show one shipment workspace, confirmed cutoffs, authenticated ownership/handover, missing-document draft and an amendment record that preserves original SI truth. | Measure employee time, rework and unresolved queue age. No actual Averis time-saving percentage or adoption claim has been measured. |
| User Experience & Differentiation | 10 | OCR field crops, uncertainty-first confirmation, a BL correction that introduces a different error, source-linked amendments, cautious template learning, and a checksum that catches two agreeing but invalid documents. | Rehearse keyboard, narrow-screen, failure and stale-data recovery paths. Keep the main demo focused; additional screens must not obscure the employee's next action. |
| Impact & Future Potential | 10 | Manager views with denominators and case citations, question-to-visible-filter search, a clearly scoped shared-team pilot, and guarded Outlook adoption. | Root-cause attribution, legal compliance and unattended operation cannot be inferred from aggregate mismatch counts. Present an explicit pilot measurement plan. |

## Delivered extension boundaries

| Area | What the implementation supports | What must not be claimed |
|---|---|---|
| OCR review | Browser-local English OCR; seven unconfirmed suggestions; actual supporting-word mean/lowest recognition scores; source-page crops; low/missing evidence cues; source SHA256 and all-field human confirmation. | Scores are recognition signals, not calibrated shipment correctness probabilities. A low-quality supplied scan produced weak and missing fields, which is a successful reason to keep review mandatory. No OCR score alone clears a case. |
| Readability / parser reliability | Empty, corrupt and ambiguous inputs remain review cases. Explicit harmless Remarks/Notes now stop weight extraction; weight-bearing notes remain ambiguous. OCR weight-label units are retained. | Retrying corrupt bytes repairs nothing. Replace the original when content is invalid. A note containing an alternative weight cannot be ignored to improve scores. |
| Governed label learning | Exact source heading → proposed mapping → current impact preview → reviewer approval → source-bound reuse. Exact role/format/heading-set scope; immutable history; disable rollback; real approved-rule and assisted-case counters. | Shipment values or equivalence tolerances are never learned. A matching heading set is not proof of issuer identity. Built-in aliases such as Load Port are not newly learned. Existing case decisions do not mutate when a rule changes. |
| Shared-team workflow | Named local/pilot accounts, operator/reviewer/admin API permissions, shared workspace, authenticated actor records, membership-backed shipment ownership and handover. | Default anonymous demo mode is not authenticated corporate access. SSO/MFA and enterprise provisioning are later deployment work. |
| Shipment and instruction workspace | Explicit case association, references with source evidence, confirmed deadline types, original SI comparison and separately approved amendment comparison, task/history records. | The newest email is not automatically authoritative. Conflicting identifiers must not silently merge shipments. Approval of an email instruction is not equivalent to an issuer issuing a revised SI. |
| Independent integrity checks | ISO 6346 identifier/check-digit validation; completeness-aware count checks; source-backed equipment-mass checks; same-port advisory. | These findings stay separate from organiser seven-field output. The generator can contain invalid random identifiers and partial tables. Missing limits or a partial list means not checked, not passed. |
| Batch document-check completion | Up to 25 current source-backed matches, seven-value inspection, explicit scope confirmation, per-case CAS/audit and partial-result reporting. Reviewed/OCR/rule/replaced-source cases require individual completion. | Batch sign-off is human handling, not “zero-touch automation.” It does not release cargo or establish sanctions/equipment clearance; unavailable independent checks remain disclosed. |
| Other desks | Missing-document chaser drafts; billing-reference/charge quotations and acknowledgement drafts; SI worksheets and approved template support; suspicious-message report drafts; handover and general-message digest. | A draft is not a sent message, paid invoice, prepared final SI, security incident confirmed by IT, or business resolution. Volatile values must not be copied from old shipments. |
| Insights | Bounded inbox questions translated into visible filters, current case citations, discrepancy distributions and historical-consignee advisories. | A carrier association is not proof of causation. Historical deviations are prompts to inspect current evidence, not automatic corrections. Unsupported questions are not guessed. |
| Deadline notifications | Source/revision-bound due-soon and overdue notifications, deduplication and acknowledgement; departure estimates remain distinct from document cutoffs. | In-app notifications do not prove delivery of Teams/email alerts. Background monitoring and external channels require configured, verified infrastructure. |
| Microsoft integration | OAuth/Graph adapter, selected-message import, Outlook task-pane surface, saved-task draft creation and a separately configured send capability with revision/content checks. | No live tenant connection, mailbox import, draft creation or external send is established merely by implementation or mocked HTTP tests. A task pane does not provide unattended mailbox monitoring. |
| Sanctions screening | Keep as a compliance-owned roadmap item. | No name-only demo can honestly establish shipment clearance or complete sanctions compliance. |

## A convincing five-minute demonstration

1. **0:00–0:35 — Employee problem.** Explain the time spent finding requests, chasing missing sources and reconciling revisions. State SI authority and the seven fields.
2. **0:35–1:50 — Finish a correction.** Use the known rehearsal: initial weight error → revised BL fixes weight but changes discharge port → final BL passes. Show the unchanged SI, previous revision diff and responsible employee.
3. **1:50–2:40 — Hard evidence.** Show a scan with actual crops and uneven recognition scores. Leave an uncertain field unconfirmed so the save remains blocked. Briefly demonstrate that an invalid container check digit is detected even when documents agree.
4. **2:40–3:25 — Governed action.** Show a confirmed document cutoff, next-action task, source-bound amendment or label-rule approval, and one restricted operator action. Keep drafts and approved instructions clearly distinct from source truth.
5. **3:25–4:15 — Engineering proof.** Present the three frozen first-run results plus one concurrent-edit or corrupt-file recovery. Explain why no false verified case was observed in those datasets and why that is a scoped claim.
6. **4:15–5:00 — Adoption and impact.** Show current-source manager drill-down or the configured Outlook entry point, then propose a measured employee pilot. End with the next human action and its evidence, not a large feature inventory.

Use synthetic/organiser material and identify rehearsed cases as rehearsed. Keep a recording and local fallback, but make the public deployed link functional for judges. The rules' video limit is five minutes; rehearse below that limit rather than relying on the tolerance.

## Rule and submission checks that code alone cannot settle

| Supplied document requirement | Evidence / required action |
|---|---|
| AI must be a meaningful component. | Explain the independently trained TF-IDF/linear intent model and OCR, with source-backed deterministic comparison. Do not call every rule an AI model. Optional LLM use is not necessary to claim the existing learned classifier. |
| Cloud infrastructure must be meaningfully used. | The application includes cloud/server deployment and persistent storage adapters. Confirm and record the final feature-branch build deployed with working persistence; local tests alone do not complete this requirement. |
| Final submission must extend the preliminary entry and include a working prototype. | CargoGuard retains its original inbox/comparison core and adds the operational capabilities above. Preserve a clear before/after record and final version identity. |
| Original work, permitted dependencies, no plagiarism/tampering. | Keep model provenance, licence notices, source history and dependency attribution. Generated ground truth remains an offline evaluation artifact, never an application input or submitted prediction shortcut. Team authorship and any final AI-assistance declaration must be represented accurately. |
| Work must occur within the official event duration. | The provided infopack lists final pitch day as **26 September 2026**; the user reported “next week.” Check the latest finalist communication for the actual final deadline and development window. Do not present the preliminary submission deadline as the final cutoff. |
| Mandatory project description, repository, working public demo, deck/documentation and video links. | Verify access from a fresh signed-out browser. Keep development on the feature branch; do not publish secrets, personal data, or answer keys. This engineering run does not itself submit those links. |
| Organisers may update rules; judging decisions are final. | Reconcile any newer finalist instruction with these supplied PDFs before submission. This document cannot certify eligibility, team membership, submission timing or final marks. |

## Employee pilot measurement

Use a small blinded set from different authors and layouts, keeping related templates together when splitting evaluation data. Have an experienced reviewer establish adjudicated ground truth independently. Compare manual and assisted workflows in alternating order so practice effects do not all favour the second method.

Record active handling minutes per case, false verified cases, unnecessary reviews, amendments per shipment, first-pass document errors, unresolved cutoff breaches, and handover completeness. Report counts and denominators. Measure speed on both clean and difficult cases; do not exclude failures or OCR reviews to improve the headline. Only then estimate time/cost savings and agree the pilot's release criteria with Averis employees.

## Sources

- [Final judging rubric](<../../Averis x Monash Hackathon 2026 - Final Judging Rubric.pdf>) — scoring weights, evidence-based marking and provisional integration criterion.
- [Shipping document verification use case](<../../Shipping Document Verification Use Case.pdf>) — SI authority, five categories, seven fields, review/retry expectations and the limits of the optional scorer.
- [Rules and regulations](<../../Averis x Monash Hackathon Rules and Regulations.pdf>) — AI/cloud, originality, event duration, submission artifacts and five-minute video requirement.
- [Participant infopack](<../../Averis Hackathon Participant Infopack.pdf>) — supplied event timeline and advanced problem context.
