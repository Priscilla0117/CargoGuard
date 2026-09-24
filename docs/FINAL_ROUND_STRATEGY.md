# CargoGuard final-round strategy

The strongest pitch is a complete employee task: **find the right request, show the exact problem, follow up on it, check the corrected draft and retain why the task was completed**. The existing product already has parsing, comparison, review, source recovery, chat, amendments and history. The final-round extension connects those capabilities into reliable follow-up.

Status: local acceptance passed on `codex/final-round-employee-workflow`; hosted deployment remains pending and no GitHub push was made. See [FINAL_ROUND_VALIDATION.md](FINAL_ROUND_VALIDATION.md) for local release-gate, HTTP and browser evidence, and [the known synthetic rehearsal files](../examples/final-round/README.md) for the correction cycle. Dated 3.2.1 cloud evidence in [CLOUD_RELEASE.md](CLOUD_RELEASE.md) is separate. The user says the final is next week, which governs planning over the older handbook date. GitHub changes belong on a branch, not main.

## What an Averis employee needs

| Employee question | Product response | Proof that matters |
|---|---|---|
| Which request needs my attention? | Action queue, recorded owner label, shipment reference and explicit follow-up date | User-entered dates are not inferred shipping deadlines; context survives refresh |
| What exactly is wrong? | Seven SI/BL values, strict result and source locations | Original text/page/cell supports each value; unreadable evidence remains uncertain |
| What should the issuer correct? | Existing source-checked amendment draft with reference/current values | Unresolved fields are disclosed; a draft is never reported as automatically sent |
| What am I waiting for? | Persisted open/waiting/completed follow-up and reason | Handoff retains owner, date, case revision and unresolved findings |
| Does the returned draft fix the problem? | Replace the BL while retaining the selected SI, recheck and inspect revision differences | One fixed field cannot hide a new issue; both old sources remain inspectable |
| Can I finish the task? | Completion requires seven valid current-engine matches | Waiting/completed follow-ups reopen on changed revision or outdated engine; working remains working. Completion is not cargo-release approval |

Owner names are self-declared labels within one browser workspace. This is not shared staff assignment, verified identity, automatic reminders or live mailbox integration.

## Priorities tied to the final rubric

1. **Finish and harden the follow-up loop.** End-to-End Functionality is 25 points. Persist follow-up separately from document truth; bind it to the decision revision, reject stale writes and expose failures without losing the last confirmed state. Allow open/waiting while problems remain; reject completion for missing, uncertain, mismatched, duplicated or outdated checks. Follow-up cannot improve the automatic benchmark.
2. **Prove a difficult change.** Engineering Quality is 15 points. Demonstrate a revised BL that fixes an original issue while introducing another. Keep the new issue visible, preserve source history, reject stale completion and recover after a failed save. A live counterexample explains robustness better than reading a large test count.
3. **Make evidence easy to inspect.** User Experience and Differentiation is 10 points. Use the compact queue, citations, explicit pairing and correction-impact preview. Integrate follow-up into the same task. Distinguish an extraction correction from an issuer-revised document, and a policy exception from an exact match.
4. **Explain architecture through one case.** Architecture and Technology Integration are 15 points each. The learned model routes; readers/OCR/recovery provide evidence; deterministic comparison decides; transactional cloud storage retains it. Explain why routing/comparison continue without an LLM and why optional external AI has consent, budget and review gates. Small-source storage and interactive batch limits are demo trade-offs, not proof of enterprise scale.
5. **Bring employee evidence.** User Value and Impact are 10 points each. Gather operator observations, timed tasks and error outcomes with the protocol below. Present assumptions explicitly and give a specific pilot path when measurements are unavailable.

The rubric tells judges not to reward identical evidence twice. Use the journey for functionality, component/data flow for architecture, model/reader/provider behavior for integration, failure/regression evidence for robustness, operator outcomes for user value, usability observations for experience, and a measured pilot for impact. Technology Integration is marked provisional; confirm the organiser's final wording.

## Acceptance for the final-round branch

Local acceptance passed all eight release-gate steps with 380/380 tests and 157 HTTP checks; exact results and environment are in [FINAL_ROUND_VALIDATION.md](FINAL_ROUND_VALIDATION.md). The synthetic browser journey retained the SI, exposed a newly introduced port discrepancy, blocked completion, completed only after the final seven matches and recovered a stale two-tab save through **Load latest case**. Hosted acceptance remains a separate deployment step.

- Create follow-up, reload and retrieve exactly the saved owner/reference/date/state/reason. Empty dates are not overdue; dates must be valid and display their time-zone meaning.
- Two concurrent edits from the same version cannot silently overwrite each other. Failed saves preserve the last confirmed state and permit explicit retry.
- Complete only a current-engine BL comparison with seven unique required fields present, valid and matching. Reject discrepancy, uncertainty, incomplete, routed and stale-engine cases. Reject completion if the decision changes during the save.
- Revise a completed case or change its engine. UI and export require renewed follow-up rather than attaching the old completion to new evidence.
- Deny follow-up access from another workspace. Audit actor labels remain self-declared, not authenticated identity.
- Replace only the BL and verify that the selected SI's exact bytes/fingerprint are retained. Reject missing or ambiguous SI references. Keep older BL bytes and all seven previous results available in history.
- Preserve strict verdicts and automatic exports. Policy annotations and follow-up cannot convert reviewed evidence into automatic accuracy evidence.
- Inspect the actual downloaded handoff for correct email, owner, date, state, decision revision and unresolved facts. Downloading is not evidence of sending or carrier acceptance.
- Run local gate, relevant HTTP suites and browser paths against the exact branch build; report commit/environment/time. Record passes only after they occur.

## A focused five-minute demonstration

**0:00–0:25 — Start with the employee.** “Averis staff need to know what to correct, what they are waiting for, and whether the returned draft actually resolves the issue.” Explain that this checks shipping documents; a human remains responsible for operational decisions.

**0:25–1:10 — Find the request.** Process or open the inbox. Explain five categories and seven fields. Import the rehearsal SI and initial BL, which differ in gross weight (42,500 kg versus 43,000 kg), and show the source citation. Avoid spending the pitch scrolling through 520 records.

**1:10–2:00 — Turn the discrepancy into work.** Record a self-declared owner, reference and explicit follow-up date. Inspect the amendment draft, then mark waiting. Download the handoff and show its saved revision and unresolved fields. Nothing has been dispatched.

**2:00–3:05 — Test the returned draft.** Replace only the BL with a clearly synthetic revision that fixes one error but introduces another. Show the retained SI and History → What changed? Demonstrate that completion is blocked. If previously completed evidence changes, show the reopened follow-up.

**3:05–3:45 — Finish the task.** Supply the correctly revised BL, recheck all seven fields and complete follow-up. Show the preserved mismatch and originals in history. Call this completion of a document-check task, not cargo release. A judge can change a value in a copy for an additional live test; rehearsed examples are not an untouched holdout.

**3:45–4:25 — Explain AI and reliability.** Show learned routing and optional consent-gated recovery on a prepared unfamiliar layout if provider availability permits. Explain source validation, human confirmation and deterministic comparison. If the provider is unavailable, show its real error/manual path; never substitute recorded output as live.

**4:25–5:00 — Evidence and pilot.** Separate dated development accuracy, final-build engineering results and observed operator timings. State sample/limitations. Propose approved documents, corporate access, read-only mailbox intake and measurement of workload and false clearances. Rules specify a five-minute submitted video; confirm actual live-pitch time separately.

## Measure impact without invented savings

Use approved synthetic or anonymized cases covering clean matches, discrepancies, missing documents, revised drafts and difficult layouts. Have an operator perform comparable manual and assisted tasks; counterbalance order to reduce learning effects. Keep source-checked expected decisions hidden until task completion. Team-member timings are a usability rehearsal, not Averis employee validation.

Record task ID, condition, format, start/end, active review minutes, waiting time, final correctness, escalations, amendment cycles and a short usability comment. Pause active timing during breaks/external waiting. Case age is not employee effort. Report sample counts, median/spread and completion/error rates together; faster work that misses a discrepancy is not success.

Define measures before collection:

- **False clearance:** a source-checked discrepancy or required unknown appears as a complete match. Report count/denominator; zero observed cases does not prove zero underlying risk.
- **Discrepancy recall/precision:** detected true discrepancies / all true discrepancies, and true discrepancies / all flagged discrepancies. Separate case-level and field-level results.
- **Review burden:** reviewed cases / eligible comparison requests, by missing evidence, layout, scan and routing uncertainty.
- **Active handling time:** observed human review/correction time per completed task. Report elapsed follow-up time separately.
- **Operational outcome:** amendment cycles, overdue follow-ups based on entered dates, abandoned tasks and operator-rated clarity of the next action.

Calculate a savings scenario only after measuring a time difference: `(manual minutes − assisted minutes) × observed comparable volume`. Label volume extrapolations and wage assumptions. Pattern counts, synthetic scores and test assertions are not money saved.

## Roadmap beyond the prototype

**Next validation:** Freeze cases from independent templates/authors; preserve first-run results separately from fixes. Expand live-model evaluation for wrong-but-real quotations, missing addresses, conflicting units and embedded instructions. Check accessibility and usability on the presentation laptop. Rehearse provider/database failure.

**Approved internal pilot:** Add corporate SSO/roles, genuine shared ownership, approved read-only mailbox intake with attachment/thread provenance, approved storage, malware checks, retention/deletion and backup/restore. Agree who can change an SI reference and complete review. These are future integrations and governance work.

If Averis uses Microsoft Outlook, a future adapter can combine [Microsoft Graph message change notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview), which require the relevant Mail.Read permission, with [per-folder message delta checkpoints](https://learn.microsoft.com/en-us/graph/delta-query-messages). This is a proposed implementation path conditional on the actual mailbox platform and tenant approval, not a current connection.

**Scale after demand is measured:** Move binaries to suitable object storage, add durable idempotent jobs, evaluate load/tenancy boundaries, monitor service/quality metrics and test recovery. Consider multilingual inputs and additional shipping documents after the seven-field workflow is dependable.

The defensible differentiator is evidence retained through the correction cycle, explicit human responsibility and no silent clearance. Do not claim uniqueness among all participants, zero bugs, perfect unseen accuracy or a guaranteed championship.
