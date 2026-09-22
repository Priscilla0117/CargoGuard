# Requirements and judging evidence

Source basis: all five supplied PDFs, both organiser folders, and the user's organiser clarification about the released evaluation key. Documents are reference material; they do not authorize external messages, data disclosure or rule changes.

Evidence below distinguishes product capabilities, recorded testing and submission work. The latest full cloud acceptance is **3.2.1 on 21 September 2026**; [SUBMISSION_CHECK.md](SUBMISSION_CHECK.md) records the fresh 22 September local gate and read-only public checks. No new usability study or provider-answer test is claimed. The supplied final rubric still labels Technology Integration provisional pending sponsor alignment.

| Requirement / scoring area | Delivered technical evidence | Remaining competition action |
|---|---|---|
| AI is a key component | Trained TF-IDF logistic router with reproducible ablation; optional OpenAI source-quoted recovery and evidence-linked case chat; browser-local OCR; explicit human confirmation | Distinguish the learned router, real cloud LLM and deterministic comparison. Use AI_UPGRADE.md, CASE_ASSISTANT.md and dated live tests; do not claim unseen-data perfection |
| Meaningful cloud use | Live Render/Node processing with persistent Turso libSQL; hosted API and restart-persistence tests passed | Observe free-plan limits and remaining capacity/idle-wake checks in CLOUD_RELEASE.md |
| Seven required comparison fields | SI reference, all seven side-by-side, typed numeric comparison | Show representative live cases |
| Four supplied document formats | TXT, PDF text, XLSX, DOCX parsed from original bytes; all six scans OCR-tested | Scan suggestions require seven human confirmations; corrupted PDFs require replacement |
| Failure handling | Explicit uncertainty, duplicate-value conflicts, safe normalization, resume/replacement, concurrent-write checks | Demonstrate recovery; no claim of enterprise certification |
| Preliminary architecture — 15 | ARCHITECTURE.md, modular parser/classifier/API/storage | Convert key points into slides |
| Preliminary prototype — 25 | Interactive inbox, evidence, upload, corrections, export | Rehearse live workflow |
| Preliminary integration — 15 | Working independent cloud runtime and persistent database; explicit automatic/reviewed exports | Rehearse the hosted demo; no live corporate-email integration |
| Preliminary validation — 15 | Original plus four development challenge sets; 350 unit tests, 228 local HTTP checks, 12 local outage-simulation checks and 177 hosted checks in 3.2.1; exact 520-case actual cloud export independently scored; separately dated evidence in CLOUD_RELEASE.md | Explain development-vs-hold-out distinction; do not equate the automated score with judging marks |
| Problem understanding — 10 | Shipping operations workflow; no silent clearance | Validate assumptions with organiser |
| Innovation — 10 | Source evidence, fingerprint-bound scan recovery, immutable decision replay, exact verdict plus business exception, preview/CAS policy activation, live correction-impact preview with linked fields, explicit source-bound multi-attachment pairing | Demonstrate Before you save, retained excluded attachments, and that neither a policy nor an AI answer can improve the strict benchmark |
| Practicality — 10 | Low-cost deterministic checks, manual resolution, roadmap | Use measured pilot data, not fabricated ROI |
| Final E2E — 25 | Process → inspect → amend/review → replace → recheck → audit | Demonstrate without intervention from developer |
| Final architecture/integration/robustness — 15 each | Same technical foundations and test suite | Recheck the final rubric update; integration criterion was provisional |
| Final effectiveness/UX/impact — 10 each | Unified laptop Work queue, Reports and secondary Settings; three case sections, source-linked chat, checked amendments, safe next-case navigation and before/after revision evidence (LAPTOP_WORKSPACE.md) | Gather operator feedback; no invented savings or unmeasured adoption claim |
| Public repository and README | Current `main` includes the CargoGuard 3.2.1 source merged from `cargoguard-v3-deploy`; the latter identifies the historical cloud release | Verify signed-out repository access, intended default branch and final submitted commit; source access is separate from app access |
| Working public link | https://cargoguard-averis.onrender.com/; anonymous health, hosted APIs and browser workflow verified | Allow for free-tier wake-up before judging; not an uptime guarantee |
| Video, slides and team submission | RECORDING_VOICEOVER.md + RECORDING_RUNBOOK.md + REQUIREMENT_PROOF_CHECKLIST.md, with architecture/validation material | Verify actual footage, final links and team submission; an outline is not a finished recording |
| Original work during allowed window | New project in cargoguard; organiser originals unchanged | Team confirms permitted development timing and declares third-party/AI assistance as required |

Technical construction cannot guarantee first place. Judges also evaluate explanation, business insight, team presentation and compliance. Never describe the automated scorer's 100% as a guaranteed judging score.

## Written-response evidence and remaining gaps

| Topic | Available evidence | Boundary or next step |
|---|---|---|
| Problem-solution alignment | ARCHITECTURE.md explains SI-reference comparison, operational routing, source evidence and human review; REVIEW_WORKSPACE_V32.md explains explicit source choice and linked correction previews | Validate workflow assumptions with actual operators; a demonstrated feature is not an employee-outcome study |
| AI and cloud integration | AI_UPGRADE.md, CASE_ASSISTANT.md and ARCHITECTURE.md distinguish learned routing, exact rules, local OCR, optional consented OpenAI, Render processing and persistent Turso data | No autonomous cargo approval, live corporate-mail connector or enterprise identity claim |
| User feedback and testing | CLOUD_RELEASE.md records dated unit/API/persistence tests; REVIEW_WORKSPACE_V32.md records laptop workflow inspection | These are engineering acceptance checks, not recorded Averis employee feedback. An employee usability study and pilot feedback remain to be collected |
| Coding challenges | REVIEW_WORKSPACE_V32.md records ambiguity handling, dependent-field preview, source selection, payload reduction and failure handling; AI_UPGRADE.md records provider-contract failures and repairs | Explain challenge, implementation response and verified result; do not hide the earlier failures or call development reruns untouched holdouts |
| Success metrics | 520/520 supplied development outputs, 350 unit tests, 228 local HTTP checks, 12 local outage checks and 177 hosted checks in the dated 3.2.1 record | Suites and subsets overlap; do not sum them into independent cases. Employee review time, missed differences, false alarms and handover usefulness need an approved pilot; no measured ROI/adoption claim |
| Scalability plans | ARCHITECTURE.md describes bounded batches and the proposed move to managed file storage, queued workers and enterprise access/data controls | Plans are not deployed features. Evaluate unseen documents and measure load, recovery, storage growth and cost before a larger rollout |

The video, deck, README and public repository must tell the same current story. Older v2 packaging and historical release sections are not current architecture or current test totals. Maintain required attribution and verify all submitted links while signed out.
