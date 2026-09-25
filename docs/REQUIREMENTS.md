# Final-round requirements and judging evidence

Source basis: the supplied final judging rubric, shipping use case, rules and participant handbook; earlier project material is background. These documents supply evaluation requirements, not permission to send messages, disclose data or change accounts. The user's current instruction is to develop for the final next week and keep any GitHub work on a branch rather than main. That governs planning where the older handbook date differs.

## Final rubric: 100 points

The rubric gives **70 technical points and 30 product/impact points**. End-to-End Functionality is the largest single criterion. Technology Integration is marked provisional, pending sponsor alignment; verify the final organiser wording before the pitch. Assign each piece of evidence a primary criterion instead of counting it repeatedly.

| Criterion | Points | Evidence to demonstrate | Remaining proof |
|---|---:|---|---|
| End-to-End Functionality | 25 | Inbox → classify → extract → compare → inspect evidence → request correction → replace draft → recheck → retain history. Final-round branch adds revision-bound follow-up and handoff; local browser journey passed changed-evidence, blocked-completion and stale-save recovery paths | See FINAL_ROUND_VALIDATION.md; repeat against the hosted build after deployment, which remains pending |
| Architecture & Scalability | 15 | Separate browser OCR, server parsing/model/comparison, APIs and transactional persistent storage; immutable decision snapshots and optimistic concurrency | Explain bounded batches, small-file storage and why object storage, durable jobs and corporate access are later changes; low-volume tests are not capacity evidence |
| Technology Integration | 15 | Learned email router, format readers, browser OCR, optional source-quoted cloud recovery, deterministic decisions and persistent cloud data interact meaningfully | Show each technology's contribution; distinguish cloud LLM from deterministic guidance and local OCR |
| Engineering Quality & Robustness | 15 | Source hashes, stale-write rejection, input bounds, historical sources, explicit review, outage handling and independent export verification; final-round local gate/API/browser acceptance passed | Use dated FINAL_ROUND_VALIDATION.md and distinguish local results from unchanged hosted deployment |
| Solution Effectiveness & User Value | 10 | Exact SI/BL evidence plus the next action; follow-up captures a self-declared owner, reference and due date | Source-checked operator tasks and feedback; confirm workflow assumptions with an Averis operator when available |
| User Experience & Differentiation | 10 | Compact queue, source evidence, correction-impact preview, explicit pairing, before/after revisions and revision-aware follow-up | Demonstrate that changed evidence cannot remain silently completed; test the presentation laptop |
| Impact & Future Potential | 10 | Proposed pilot measures active handling time, false clearances, review workload, amendment cycles and adoption | Gather observations before claiming savings; explain a staged pilot with identity, mailbox integration and approved data controls |

## Use-case and submission requirements

| Requirement | Current evidence or scope | Final action |
|---|---|---|
| AI as a key component | Learned TF-IDF logistic router, optional source-grounded LLM recovery/chat and pretrained local OCR | Use current MODEL_CARD.md; show learned contribution and its limits |
| Meaningful cloud infrastructure | Recorded Render/Node processing and persistent Turso/libSQL source bytes, cases, policies and history | Verify the exact released build and judge access; retain cold-start, quota and availability limits |
| Five email categories | BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL and SPAM | Show misleading-subject handling and uncertainty escalation; other categories need classification only |
| Seven comparison fields, SI reference | Shipper, consignee, notify party, loading/discharge ports, container count and gross weight in kg | Preserve every strict match/mismatch/uncertain result when a business policy adds an annotation |
| Advanced documents and failures | TXT/PDF/DOCX/XLSX readers; scan assistance; missing, conflicting and unreadable evidence remain reviewable | Demonstrate source evidence, human correction and retry/replacement without claiming unattended OCR clearance |
| Clear per-email result | Evidence-linked values and reasons; complete matching comparisons report no mismatch; incomplete requests never appear verified | Preserve organiser-format export separately from human-reviewed operational results |
| Working final prototype extending preliminary entry | Evidence-aware 3.2.1 baseline; final-round follow-up and BL-only replacement passed local acceptance on codex/final-round-employee-workflow | Hosted rollout remains pending; this branch has not been pushed to GitHub |
| Public GitHub source and clear README | Existing repository with setup, source and tests; work stays on a separate branch | Verify signed-out access to the submitted branch; no visibility change is implied |
| Public functional prototype | Recorded demo at https://cargoguard-averis.onrender.com/ | Check anonymously after deployment; allow for free-tier wake-up |
| Demo video, slides/documentation and submission | Existing demonstration/architecture material; new FINAL_ROUND_STRATEGY.md | Prepare and submit the actual artifacts. Rules specify a maximum five-minute video; confirm live-pitch timing separately |
| Original work and allowed window | Team project, unchanged organiser originals, open-source dependencies and disclosed AI assistance | Follow organiser updates and attribution requirements; the assistant cannot certify competition compliance for the team |

## Evidence boundary

The 21 September 2026 release record reports exact supplied-corpus output and separately scoped local/hosted checks. See [CLOUD_RELEASE.md](CLOUD_RELEASE.md) rather than mixing totals from older releases. None is a real-world holdout, employee savings measurement, uptime guarantee or new-branch test result.

[FINAL_ROUND_VALIDATION.md](FINAL_ROUND_VALIDATION.md) records the newer local branch acceptance: all eight release-gate steps with 380/380 tests, 157 HTTP checks, exact supplied-corpus output and the browser correction/follow-up journey. Hosted deployment is unchanged. [The known synthetic rehearsal files](../examples/final-round/README.md) reproduce the employee flow without claiming unseen-data accuracy.

Final-round follow-up is workspace-scoped. Owner names are self-declared; there is no corporate identity, cross-workspace assignment, automatic dispatch or cargo-release approval. Operational completion remains separate from comparison truth.

See [FINAL_ROUND_STRATEGY.md](FINAL_ROUND_STRATEGY.md) for the employee roadmap, demonstration and measurement protocol.
