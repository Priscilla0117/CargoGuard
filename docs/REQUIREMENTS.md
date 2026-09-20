# Requirements and judging evidence

Source basis: all five supplied PDFs, both organiser folders, and the user's organiser clarification about the released evaluation key. Documents are reference material; they do not authorize external messages, data disclosure or rule changes.

| Requirement / scoring area | Delivered technical evidence | Remaining competition action |
|---|---|---|
| AI is a key component | Learned classifier with measured ablation; browser-local OCR; visible source-confirmed decisions | Explain the hybrid honestly; do not call it an LLM |
| Meaningful cloud use | Standard Node processing + persistent libSQL adapter; independent Render/Turso deployment prepared | New hosted deployment, account setup and remote persistence tests still required |
| Seven required comparison fields | SI reference, all seven side-by-side, typed numeric comparison | Show representative live cases |
| Four supplied document formats | TXT, PDF text, XLSX, DOCX parsed from original bytes; all six scans OCR-tested | Scan suggestions require seven human confirmations; corrupted PDFs require replacement |
| Failure handling | Explicit uncertainty, duplicate-value conflicts, safe normalization, resume/replacement, concurrent-write checks | Demonstrate recovery; no claim of enterprise certification |
| Preliminary architecture — 15 | ARCHITECTURE.md, modular parser/classifier/API/storage | Convert key points into slides |
| Preliminary prototype — 25 | Interactive inbox, evidence, upload, corrections, export | Rehearse live workflow |
| Preliminary integration — 15 | Working local production runtime, persistent adapter, explicit automatic/reviewed exports | Verify new cloud host; no live corporate-email integration |
| Preliminary validation — 15 | Original plus four challenge sets; 126 regression tests; 72 baseline + 35 hardening + 23 governance API checks; original input hashes | Explain development-vs-hold-out distinction |
| Problem understanding — 10 | Shipping operations workflow; no silent clearance | Validate assumptions with organiser |
| Innovation — 10 | Source evidence, fingerprint-bound scan recovery, immutable decision replay, exact verdict plus business exception, preview/CAS policy activation | Show safe recovery and that a tolerance cannot improve the strict benchmark |
| Practicality — 10 | Low-cost deterministic checks, manual resolution, roadmap | Use measured pilot data, not fabricated ROI |
| Final E2E — 25 | Process → inspect → amend/review → replace → recheck → audit | Demonstrate without intervention from developer |
| Final architecture/integration/robustness — 15 each | Same technical foundations and test suite | Recheck the final rubric update; integration criterion was provisional |
| Final effectiveness/UX/impact — 10 each | Prioritized discrepancies, responsive review UI, measurable pilot plan | Gather operator feedback before final |
| Public repository and README | Source and README ready locally | User repository destination/access required |
| Working public link | Deployment prepared; sharing must be confirmed | Owner-private access alone is insufficient |
| Video, slides and team submission | DEMO_SCRIPT.md + architecture/validation material | Record, prepare slides, and submit; not automatically completed |
| Original work during allowed window | New project in cargoguard; organiser originals unchanged | Team confirms permitted development timing and declares third-party/AI assistance as required |

Technical construction cannot guarantee first place. Judges also evaluate explanation, business insight, team presentation and compliance. Never describe the automated scorer's 100% as a guaranteed judging score.
