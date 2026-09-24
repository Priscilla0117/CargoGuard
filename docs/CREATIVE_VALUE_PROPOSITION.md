# Why choose CargoGuard?

CargoGuard's strongest argument is a complete, inspectable correction cycle: **find the issue, establish the intended change, obtain the authoritative evidence, check the returned document and retain why the check was completed.**

This is a proposed value proposition, not a claim that other finalists lack these capabilities. We have not evaluated their systems. OCR, extraction, dashboards, review queues and audit trails alone are weak claims of originality; established document-processing products already offer many of them.

## The memorable employee problem

An employee receives a later email changing the consignee. The returned BL implements that change, but introduces a wrong discharge port. An approved instruction is useful evidence of intent; it is not itself a replacement source document.

CargoGuard now follows that change through three visible stages:

1. **Approve the instruction.** A reviewer records the exact email quotation, intended field and value, source revision and original SI fingerprint.
2. **Confirm the SI evidence.** An employee can create an editable revised-SI request. When the issuer's replacement SI and latest BL arrive, link and select that case. A reviewer records incorporation only if the actual selected SI supports the instruction. Editing an extracted field cannot impersonate a new SI.
3. **Check the whole BL.** The desk shows the instruction, current SI and current BL together, plus every remaining strict field difference. Incorporation cannot bypass an unrelated error, uncertainty, unfinished task or independent blocking finding.

The decision brief preserves source revisions, document fingerprints, review reasons, remaining issues and whether earlier incorporation evidence is still current. Later revisions require another check. Completion means completion of a document-verification task, never authorization to release cargo.

## Design decisions that earn their place

| Decision                                                        | Additional employee value                                                                  | Demonstrable evidence                                                                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Follow an instruction through to the replacement SI             | Staff can explain what they are waiting for and what evidence will resolve it              | Revised-SI task, quotation, selected documents, reviewer incorporation and immutable history                    |
| Check every field after a correction                            | A repaired weight or consignee does not hide a new port error                              | Remaining SI–BL differences and the existing revision comparison                                                |
| Check document agreement and independent consistency separately | Two documents sharing a typo should not create false confidence                            | ISO 6346 check-digit finding on identical bad container IDs, without rewriting the seven-field benchmark result |
| Keep OCR behind source review                                   | Staff start from suggestions while uncertain evidence remains visible                      | Source crop, recognition score, confirmed values and visible retry/error paths                                  |
| Reuse approved label mappings with evidence and scope           | Repeated layouts become easier to process without silently teaching a wrong business value | Rule preview, source/template scope, approval and disable history                                               |
| Bind decisions to evidence revisions                            | Shift handovers do not carry an obsolete “complete” status forward                         | Stale-write rejection, proof invalidation and reopened checks                                                   |
| Run locally with deterministic core checks                      | The presentation and core workflow do not depend on a paid model or Microsoft tenant       | Production localhost build, local OCR assets and reproducible tests                                             |

These are advantages over a **basic single-pass comparator**, not measured claims against another named team's system.

## Data strategy

Use three distinct evidence layers and keep their denominators visible:

- **Organiser benchmark and frozen generated seeds:** core classification, seven-field comparison and review routing under the organiser distribution. Fresh seeds test variation within that generator; they do not prove generalisation to arbitrary carrier layouts.
- **Own operations challenge pack:** deliberately labelled synthetic cases independent of the organiser generator, including shared document errors and ambiguous values. See [OPERATIONS_CHALLENGE.md](OPERATIONS_CHALLENGE.md). It is a transparent diagnostic set, not external customer data, an untouched blind holdout or a statistically representative sample.
- **Workflow acceptance:** storage and HTTP tests of reviewer decisions, wrong revised sources, concurrency, permissions, persistence and completion. These test operational behavior and must not be added to the benchmark's accuracy denominator.

For a future employee pilot, obtain approved anonymised carrier documents and have an independent reviewer label them before running the system. Measure correct decisions, false clearances, escalations and active handling time together. No observed employee time or financial savings is claimed by the current synthetic evaluation.

## Suggested five-minute presentation

**Opening:** “Averis staff need to know whether the latest document is safe to sign off, what is still missing, and why an earlier decision changed.”

**Show the change:** Open a synthetic shipment with an approved consignee change. Show the quoted email alongside the old SI and the returned BL. Create the revised-SI request and identify it as an editable draft.

**Show the trap:** Select the supplied replacement SI and revised BL. Record the correctly incorporated consignee. The BL has the wrong discharge port: the remaining-differences panel still flags it and completion is rejected. This demonstrates the reason to recheck the entire document.

**Resolve it:** Select the corrected BL, inspect the new revision, reconfirm the source-bound incorporation and complete the document check after resolving its tasks. Open the decision brief and history.

**Challenge the basic approach:** Open a challenge case in which both documents share an invalid container check digit. Explain why agreement alone is insufficient, and that checksum validity does not prove container registration or physical condition.

**Close with evidence:** Show the actual benchmark/seed denominators, challenge dataset provenance and current engineering checks. Explain the pending company-specific acceptance and integration requirements. Invite a judge to change a synthetic document and observe the result.

Suggested closing line:

> “Choose CargoGuard for an evidence trail through the whole correction cycle: staff can see what changed, what remains unresolved, and exactly which documents support the final check.”

## Research and scope

[Averis's own service description](https://www.averis.com/services/shipping-documentation) includes BL finalisation, shipping-document and billing tracking, and support for customer shipping queries. Connecting the comparison to follow-up is therefore relevant to its stated work; this does not substitute for interviewing its employees.

[Maersk's verify-copy amendment guide](https://www.maersk.com/support/faqs/how-do-i-make-an-amendment-to-my-verify-copy-bill-of-lading) describes updating shipping instructions and receiving a revised verify copy. This supports the demonstrated flow.

[DCSA's SI/TD implementation guide](https://reference.dcsa.org/content/standards/guidelines/implementation-guides/implementing-bill-of-lading-si-td) also describes direct transport-document amendments. Requiring revised SI evidence is CargoGuard's conservative workflow for the SI-reference case study, not a universal carrier requirement or a claim of DCSA conformance.

[BIC's identification-number explanation](https://www.bic-code.org/identification-number/) supports container check-digit validation. It is a reference for a deterministic rule, not an imported registry or sanctions dataset.

Localhost acceptance follows the organiser message supplied by the user. The current Microsoft integration still needs tenant registration and live acceptance; no tenant is configured. Company rollout also requires approved document authority, infrastructure and user acceptance. Neither a championship, full rubric marks nor zero future defects can be guaranteed.
