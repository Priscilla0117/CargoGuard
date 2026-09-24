# Review of the proposed workflow expansion

Date: 23 September 2026. Review only, before implementation. No application behavior, connector permissions or message dispatch was changed for this assessment.

The strongest additions deepen a single employee task: identify missing evidence, associate the right shipment, obtain the revised draft, explain remaining problems and retain the approved decision. This extends the current final-round follow-up rather than creating many unrelated screens. It is useful to distinguish a document comparison, independent document checks, an approved instruction change and an operational action. These have different evidence and authority requirements.

## Priorities

| Proposal | Recommendation | Important condition |
|---|---|---|
| Missing-document request draft | First group of improvements | Show exactly what is missing; review recipient/content; record sent only after confirmed dispatch |
| Later-reply association and comparison | First group, after reliable linking | Conflicting references, absent SI and ambiguous attachments remain reviewable |
| One shipment workspace | Foundational addition | Preserve individual messages/cases and allow multiple relationships; do not merge on subject alone |
| Email amendment interpretation | Useful controlled extension | Proposal and authorized approval before becoming an effective instruction; original SI result remains visible |
| Container identifier/check digit | Strong independent check | Presence, format and evidence first; valid checksum is not proof of existence or correct shipment |
| Container-list/count consistency | Strong independent check | Deduplicate repeated identifiers; distinguish a complete list from a partial/unreadable list |
| Weight and port plausibility | Useful advisory layer | Actual equipment/units/allocation and route context; no universal invented limit |
| Historical shipment deviation | Later targeted feature | Confirm customer identity/comparable cohort; difference from history is not automatically an error |
| Sanctions name screening | Roadmap or explicitly limited demonstration | Compliance-owned scope, list freshness and human investigation; never claim compliance clearance |
| Draft SI reuse | Later | Approved template/customer master; no silent carry-over of volatile shipment values |
| Invoice query task | Best first extension beyond BL checking | Supported identifiers and real billing owner/state; acknowledgement is not payment or liability approval |
| General-email digest | Later | Source links, coverage and unresolved actions; do not hide urgent requests in a summary |
| Report suspicious email to IT | Small optional addition | Configured destination, preserved provenance and staff-reviewed report |
| Batch document-check completion | Later, tightly gated | Current evidence and per-case authorization/version checks, not classifier confidence |
| Deadline countdown/alerts | High value after confirmed deadlines | Correct cutoff type/timezone/source; persistent, deduplicated notifications that recheck current state |
| Assignment and shift handover | Foundational employee feature | Verified team membership, claim/reassign, absence coverage and authenticated audit actors |
| Operational analytics | High value with accurate data | Denominators, unique-case counting, first-pass history and confirmed attribution; no causal overclaim |
| Cross-inbox questions | High value after structured shipment data | Validated filters, permission-scoped results, citations and an explicit as-of time |
| Outlook add-in | Useful adoption extension, conditional | Verify actual clients/shared mailbox and tenant deployment; start with a thin selected-email task pane |

## 1. Missing documents and shipment context

The supplied 520-record dataset contains 220 BL_COMPARISON emails. **94/220 (42.73%) have no attachments**: 91 request documents and three report dropped attachments. Two further cases have one attachment. These counts agree in the retained original evaluation results. The suggested 45% is a rough estimate, not the exact measured proportion.

Awaiting documents is already implemented (`lib/compare.ts:391`). Existing guidance explains missing evidence, but the amendment-draft helper blocks incomplete cases and only drafts supported mismatches (`lib/case-guide.ts:134`); a dedicated missing-document request draft would add real value.

Recommended sequence:

1. Identify the missing SI/BL or unreadable file, with supporting case context.
2. Prepare a request using confirmed shipment references. Review the destination and content.
3. Record dispatch only when the connector confirms it, or clearly label a staff-recorded external action. A draft is not a sent message.
4. Retain next-chase time and suppress duplicate reminders.
5. Suggest an association for an incoming reply, retain its provenance, then compare only after a valid reference SI and selected BL exist.

Automatic drafting is a modest extension. Reliable unattended intake, association, sending and retry recovery require mailbox integration, durable jobs and deduplication. They should not be described as a quick regex feature.

There is an actual conflicting-reference example: `email_003` contains `SIN525534192` in its subject and requests a draft for `SIN832764835` in its active body. Any-reference or subject-only matching could associate the wrong shipment. Preserve both observations, show why a match was suggested and require review on disagreement. Never send a chaser to an address simply because untrusted text requests it.

The current `Email` schema (`lib/types.ts:35`) lacks trusted received timestamps, message/reply headers and provider conversation IDs. Cases are keyed by workspace plus email ID (`db/schema.ts:19`), and existing revision diffs reject different email IDs (`lib/revision-diff.ts:70`). A shipment workspace is therefore a real data-model extension.

Use an internal shipment identity with auditable links to messages, references, source revisions, comparisons and billing tasks. Booking, BL and OC identifiers are typed references, not universally unique interchangeable keys. Split/consolidated shipments and messages about multiple bookings require relationships rather than forced one-to-one merging. Support duplicate detection, explicit unlink/relink, and access checks. Preserve the per-email output required by the existing benchmark.

## 2. Email amendments require a controlled change of instructions

The supplied use case explicitly makes the SI the comparison reference. It does not establish Averis's authorization policy for operational amendments. An email may request a change; its wording alone does not establish authority or chronological precedence.

Extract an amendment proposal with the exact quote, message identity, affected shipment/field and available timestamp. A verified, authorized reviewer confirms sender/context, scope and intended value. Record the approval and effective version, retain the original SI and show the history. Conflicting, quoted-old, superseded or unapproved instructions remain visible review blockers.

Display both results distinctly:

- Original SI comparison: SI says A; BL says B; strict mismatch remains recorded.
- Approved instruction comparison: authorized amendment version 2 changes A to B; compare against that approved version and cite its source.

Do not use “latest email wins,” silently edit the original SI, or allow operational amendments to inflate the automatic organiser benchmark. Where the organization's process requires an updated SI, request that authoritative document instead of inventing an alternative approval process.

## 3. Checks that can find shared errors in SI and BL

### Container identifier and check digit

This is a strong, explainable enhancement. Validate the ISO identifier structure and extracted characters before calculating the check digit. An ambiguous OCR character remains uncertain. With the user's synthetic `MSCU1234560` example, both independent arithmetic and the official BIC calculator produce expected check digit **6** (`MSCU1234566`). [BIC calculator](https://www.bic-code.org/check-digit-calculator/).

The check can detect an invalid identifier even when SI and BL repeat it. Passing the checksum does not verify the container's existence, ownership, physical condition or association with this shipment. Do not automatically correct the document's last digit: the error could be elsewhere in the identifier.

The current seven-field model does not contain structured container identifiers or list completeness. Extract and cite them first. Use a separate status such as missing/not checked, uncertain, passed or failed; absence of an ID is not a passed checksum.

**Dataset caveat:** `../sdoc-hackathon-docker/data_v2/render.py:119` generates container IDs from four random letters and seven random digits without ISO format/checksum validation. The renderer can also stop listing rows when page space runs out (`:125`). These checks must have their own valid/invalid/partial-list fixtures. Keep the seven-field comparison result separate from additional operational findings. Run the same validation rules consistently; do not special-case benchmark IDs as valid.

### Count, weight and port checks

- Compare a declared container count with distinct identifiers only when a complete list is available. Repeated headers, continuation pages and duplicated rows must not inflate counts. An incomplete list should explain the missing evidence.
- A shipment's average gross weight per container cannot establish that every container is within capacity. One unit can be overweight while the average looks reasonable. Distinguish cargo gross, tare and packed-container gross, and use actual equipment limits and per-container allocations when available. Unknown capacity stays unknown. Manufacturer/type variation matters. [Hapag-Lloyd equipment guidance](https://www.hapag-lloyd.com/en/services-information/cargo-fleet/container.html).
- Equal loading and discharge ports are an advisory consistency question. Confirm port identity and route context before declaring an error; string equality is not a complete shipment-validity rule.

Add evidence, rule version and resolution/acknowledgement to every additional finding. If a new check blocks operational completion, enforce that gate explicitly while leaving the original comparison and scoring contract truthful.

### Historical deviations

A previous consignee is not ground truth for the next shipment. Establish confirmed customer identity, comparable route/product/document roles, sample size and time window. Show the observed difference with links to source shipments, not a fabricated probability or automatic correction. Avoid training a feedback loop on prior extraction errors. Only call this a deviation from history until a reviewer confirms a document error.

The current system has no trusted cross-shipment customer master/history model. A customer-approved template or master-data check is a better first step than claiming anomaly detection from unrelated synthetic records.

### Sanctions screening

Keep this as a compliance-reviewed roadmap item or limited candidate-match demonstration. Display the exact list source/version/fetched time, matched entry and identifiers; make unavailable/stale/not-screened states visible. A name match is a lead for investigation, and no match is not a compliance certificate. OFAC explains that many name hits are false positives and that other identifiers and the organization's procedures matter. [OFAC match guidance](https://ofac.treasury.gov/faqs/5).

Name-only list matching also cannot establish ownership-based restrictions; OFAC discusses indirect and aggregated ownership in its 50 Percent Rule. [OFAC ownership guidance](https://ofac.treasury.gov/faqs/401). Averis compliance must determine applicable regimes, lists and decisions. Do not label a company sanctioned or a shipment cleared merely from a fuzzy-match score. This is not necessary to demonstrate a strong seven-field verification workflow.

## 4. Other desks: deepen the shipment task selectively

**SI_REQUEST:** prepare from an explicitly selected approved template/customer master. Cite copied fields and require confirmation. Do not silently reuse old container numbers, seals, quantities, weights, voyage or dates. Even a usually stable consignee/address needs a governed source. Draft status must be unmistakable.

**INVOICE_QUERY:** this is the most coherent next desk because it can share shipment references and ownership. Extract supported invoice/BL references and charge labels with evidence, create a billing task and draft a neutral acknowledgement. No claim about amount owed, liability, payment approval or resolution should be inferred. The current “routed” category summary is classification only; it is not an actual billing-system integration.

**GENERAL:** a digest is useful after message timestamps and reliable action extraction exist. Retain source links and inclusion counts; keep unresolved/urgent requests visible outside the digest. It is a later convenience feature.

**SPAM/IT:** prepare a report with the suspicious reason, original message provenance and inert links for staff review. Sending needs a configured IT destination and an actual connector outcome. Classification alone does not prove maliciousness. This is useful but less central than closing missing-document and revision loops.

## 5. Exceptions, deadlines and shared responsibility

Batch completion must use current source evidence and the strict completion gate, not email classifier confidence. Exclude unresolved categories, missing evidence, unconfirmed OCR, stale revisions and unresolved blocking findings. Recheck each case at commit, enforce permission and record individual outcomes/actor. A mixed batch must show precisely which cases succeeded or failed. Label the action document-check completion, not cargo release.

“Percent handled without anyone opening it” is ambiguous: batch sign-off is still human work, and a logged page open is not proof of substantive review. Prefer eligible cases requiring no manual extraction/correction, active review minutes, false verified outcomes and outstanding reviews, with explicit denominators. Do not include spam/general messages to inflate automation rates.

Countdowns need the confirmed action cutoff, source and timezone; ETD is not interchangeable with that deadline. Background alerts need a durable scheduler and idempotency keys, cooldown/acknowledgement, owner/escalation rules and a final state check immediately before dispatch. Completion, revision or changed deadline must suppress stale alerts. Current browser time display alone cannot provide delivery guarantees.

Start assignment with authenticated shared membership, transparent customer/desk rules, claim/reassign and manual override. Balance later using availability and task complexity as well as workload. Concurrent claims must not silently assign two owners. Current typed owner labels are not corporate identity. The existing handover can then become meaningful shift coverage.

## 6. Management insight and inbox questions

Current code already counts discrepancy fields (`components/workload-insights.tsx`). Extend it with case drill-down, date ranges, first-pass versus corrected outcomes, overdue unresolved work and amendment cycles. Use trusted carrier/customer attribution and count unique shipments or explicitly identified revisions; do not count every revised draft as a separate defective shipment.

The proposed sentence “Carrier X caused 38% of consignee errors” overstates what comparison data can show. Separate confirmed source-document errors from OCR/extraction errors and distinguish association from cause. For example, show reviewed errors / eligible reviewed drafts for each carrier, with counts and case links. A high-volume carrier can dominate counts while having a lower error rate. The current synthetic inputs also lack timestamps and entity metadata needed for genuine weekly historical trends.

Cross-inbox questions are useful after structured shipment data exists. Begin with supported filters; optionally translate natural language to a validated query such as destination port, open discrepancy, owner and deadline. Show the interpretation, as-of time and cited cases. Counts should be computed from authorized records, not invented by a model. Do not execute model-authored arbitrary SQL. For “Jakarta,” show whether the filter uses the confirmed SI destination, BL destination or an approved port alias; ambiguity is material.

The current assistant answers one selected case or a small fixed workspace summary (`lib/assistant-home.ts`). General cross-inbox factual search is a new capability.

## 7. Outlook: a useful access point, conditional on the real environment

If Averis uses supported Microsoft 365 clients, a thin task pane can show the selected email's proposed shipment link, missing documents, evidence/differences and reviewed draft. Keep processing and authorization in the existing backend so web and Outlook show the same case. Microsoft supports pinnable task panes, with documented client requirements. [Task-pane guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/pinnable-taskpane).

Verify shared-mailbox/client compatibility and tenant deployment before promising rollout. [Shared-mailbox guidance](https://learn.microsoft.com/en-us/office/dev/add-ins/outlook/delegate-access). A foreground add-in is not itself an always-running intake/reminder service; background synchronization and delivery need a separate backend integration. Mail read/write and send capabilities are separate permissions. [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference).

Do not invest in a simulated Outlook screen and call it integration. A small working selected-message flow with traceable results is the useful acceptance target. The full mailbox connector and tenant setup remain conditional on the approved environment.

## Proposed implementation sequence

1. Preserve the earlier reliability priorities: parser review-friction fixes, OCR evidence UX, authenticated shared ownership and independent evaluation.
2. Build the shipment association foundation, missing-document request draft and manual/assisted reply association; reuse existing BL replacement, diff and follow-up.
3. Add separate container/check-digit/list-consistency findings and explicit operational resolution gates.
4. Add approved instruction amendments, confirmed cutoffs and reliable reminders.
5. Add evidence-backed operational analytics and structured cross-inbox search.
6. Add a thin Outlook pane and billing task when the real integration environment is confirmed.
7. Consider historical deviations, SI template preparation, digest and governed batch completion as measured extensions. Keep sanctions screening under a separate compliance-owned roadmap.

For the final, demonstrate one difficult journey end to end: missing BL -> request draft -> reply association with conflict protection -> SI/BL agreement but invalid container ID -> authorized correction/amendment -> revised BL introducing a new error -> blocked completion -> final supported completion -> measurable history. Clearly label synthetic examples and actual integration boundaries. This directly supports the rubric's 25-point end-to-end criterion and 15-point engineering-quality criterion without assuming feature count determines the result.

This review is informed by the supplied shipping use case and final rubric as reference material, current source code and recorded dataset outputs, plus the linked primary sources. It does not certify Averis's actual processes, regulatory obligations, production readiness or a competition outcome.
