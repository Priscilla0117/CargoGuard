# Judge's review and final-pitch playbook

A presentation playbook for `codex/final-round-employee-workflow`. Use the [3.4.1 audit](JUDGE_FEEDBACK_AUDIT.md) for current measurements and open deployment work. It covers:

- the evidence to demonstrate against the rubric;
- what would cost marks;
- the competitive argument to lead with.

## 1. Verdict

CargoGuard can demonstrate source-linked decisions, repeatable tests, independent document checks and a complete amendment cycle. Those are concrete reasons to choose this approach. We have not evaluated every finalist, and cannot predict a score or first place.

| Criterion | Max | Evidence to demonstrate |
|---|---:|---|
| End-to-End Functionality | 25 | This exact branch completing intake, review, corrected revision and sign-off |
| Architecture & Scalability | 15 | Clear data flow, bounded processing, source/version integrity and the explicit queue roadmap |
| Technology Integration | 15 | Learned routing, local OCR, deterministic checks and optional source-quoted AI; live tenant limits stated |
| Engineering Quality | 15 | Current CI, reproduced judge defects, real HTTP checks and recovery after a failure |
| Solution Effectiveness | 10 | Staff task completion and observed pilot handling time when collected |
| UX & Differentiation | 10 | Evidence-first review, unknown-value restraint, port-reference contradictions and revision-safe completion |
| Impact & Future Potential | 10 | Frozen pilot inputs/labels, measurable safety/workload outcomes and an owned adoption plan |

## 2. What would cost marks (fix in this order)

1. **The public link is an older release.** The README says so. A judge who clicks it scores the old product, and "cloud meaningfully used" becomes doubtful. Deploy this exact commit to Render + Turso, then run `/api/health` and one full correction cycle on the hosted URL. Localhost is accepted, but a working public link is still stronger.
2. **Too much hedging.** The README, strategy docs and UI repeat "not proof", "no guarantee", "not claimed". A few precise boundaries build trust; dozens read as a lack of confidence. Keep **one** "Trust boundaries" slide and say everything else positively.
3. **Too many desks for five minutes.** There are ten workspaces: queue, shipments, insights, label rules, SI templates, team, Outlook, assistant, policies, batch. Demo three; mention the rest in one sentence as "the rest of the employee's day".
4. **Explain the AI boundary.** Show why deterministic comparison supports reproducible shipment decisions (section 3, point 4). Show the existing optional Evidence Recovery Copilot live on synthetic data if a key is available: *AI proposes, the server checks the quote is verbatim, a human confirms*.
5. **No measured impact.** See section 5. One real number from a timed trial beats any estimate.
6. **Bug found and fixed in this review.** The work-queue **Independent checks** tab silently opened the *Check* tab: `caseDestination()` mapped `"integrity"` to `"comparison"`. That made the ISO 6346 differentiator unreachable from the work queue. It is fixed in `lib/work-queue.ts`, with a regression test in `tests/work-queue.test.ts` and a browser check. Re-rehearse any demo path that opens that tab.
7. **Demonstrate the preliminary feedback fixes (engine 3.4.1).** See [JUDGE_FEEDBACK_AUDIT.md](JUDGE_FEEDBACK_AUDIT.md) for resolved defects and remaining production work:
   - the judge's unknown-value examples and tested neighbouring variants go to review;
   - known discrepancies remain visible in hostile-text regressions;
   - the intake gate skips spam attachments, including when SPAM is confirmed;
   - mismatch notes explain patterns without claiming a confirmed cause.

   Open the pitch with a **"You told us — we fixed it"** slide and a 10-second live demo: import a pair where both shippers say `TBA / TBC` and show that it goes to review.

## 3. Competitive advantage in five points

Classification, extraction and comparison address the shared brief. Demonstrate the additional employee value **after** the side-by-side table; avoid guessing which features other finalists have built.

1. **"The SI is the reference — but who checks the reference?"** Comparison can only prove the BL copied the SI. CargoGuard also checks each document against **public registers**:
   - ISO 6346 container check digits;
   - since this review, **UN/LOCODE port codes** ([PORT_REFERENCE.md](PORT_REFERENCE.md)).

   On the organiser inbox, it finds all 16 self-contradictory port values. Example: `TUTICORIN, INDIA (KEMBA)`, where KEMBA is Mombasa, Kenya. It raises **0** issues on verified cases and identifies the conflicting name/code for the issuer to resolve; the register cannot determine the intended shipment destination. It also flags the SI's `JOAQB` as absent from the bundled UN/LOCODE snapshot.
2. **A correction cycle, not a one-shot compare.** The corrected BL fixes the weight but introduces a new port error. CargoGuard re-checks all seven fields against the unchanged SI, keeps every revision, and refuses completion while anything is open.
3. **Source evidence and revision checks.** Extracted values retain available page/line/cell locations and a SHA-256 of the source. Decisions bind to a revision; the server rejects stale approvals after a new draft. Demonstrate this retained history and rejection path.
4. **Deterministic where facts matter, AI where language is fuzzy.** A learned intent router handles email classification, and local OCR handles scans. The core compares extracted evidence without generating replacement shipment facts. Local extraction can still be wrong, so uncertain evidence requires review. The core runs on a laptop without per-page API charges or an external document-processing service. Optional cloud AI and hosted deployment have separate data-flow and approval considerations.

5. **It helps staff investigate a mismatch.** Each difference is labelled either:
   - a possible clerical pattern (swapped digits, tonnes vs kg, a port code kept but the name changed, parties swapped), which staff verify before requesting a correction; or
   - a *different value*, which needs confirmation from the shipper.

   The original organiser-inbox assessment identified 39 possible clerical patterns and 47 other differences across 86 mismatched fields. These are triage suggestions, not independently adjudicated causes.

**Closing line:** *"CargoGuard shows the difference, links it to the source, helps staff request the correction, and checks the whole revised draft again before completion."*

## 4. Five-minute demo (rehearse under 4:45)

| Time | Show | Say |
|---|---|---|
| 0:00–0:30 | Work queue after **Run inbox**: 520 emails routed into queues | "One inbox, five kinds of mail. Staff start from *what needs action*, not from reading everything." |
| 0:30–1:30 | Case #013 → Check tab (port of discharge mismatch) → **Independent checks** → Port code reference | "The BL says Tuticorin, India, but its code refers to Mombasa, Kenya. We show the contradiction and ask the issuer to confirm the intended destination." |
| 1:30–2:45 | `examples/final-round` correction cycle: weight fixed, new port error, final BL passes; revision diff; completion blocked, then allowed | "Real corrections are loops. A fix can break something else. We re-check everything, every time." |
| 2:45–3:30 | Scanned PDF → OCR crops with recognition scores → uncertain field blocks confirmation | "OCR pre-fills the evidence. The reviewer confirms it against the source image before the case can be cleared." |
| 3:30–4:15 | Evidence slide: current-version fresh-seed results, authored challenge, CI and pilot protocol | "Fresh seeds test robustness within the organiser generator. Our separate authored challenge tests harder operational cases. Independent staff validation is the next measurement." |
| 4:15–4:45 | Pilot plan + close | Closing line above |

Keep a screen recording of this exact path as a fallback.

## 5. Get one real impact number before pitch day (about 1 hour)

1. Pick 10 comparison cases: 4 clean, 4 with discrepancies, 2 needing review. Include scans.
2. Two teammates check them **manually** (open both files, fill a 7-field sheet). A different two use **CargoGuard**. Counterbalance distinct case subsets to reduce learning effects; do not claim this eliminates bias or represents Averis staff.
3. Record minutes per case, missed discrepancies and false alarms.
4. Report the median time per case, errors caught and errors missed, with n = 10 and the method stated.

A small honest measurement beats "could save X%". Present it as *indicative*, then show the pilot measures for Averis staff:

- active handling minutes per case;
- false-verified count (target 0);
- first-pass amendment rate;
- cutoff breaches;
- queue age.

## 6. Questions judges will likely ask

| Question | Answer |
|---|---|
| Why no LLM for extraction? | Facts must be reproducible and cited. We use AI for intent and messy layouts, where it helps, and deterministic comparison where a hallucination would cost money. An optional LLM copilot exists, but it must quote the source verbatim and a human confirms it. |
| Did you overfit the organiser data? | We report three fresh seeds generated *after* freezing the engine, plus a 20-case challenge written independently of the generator. We also say plainly that both share limits. |
| What if the SI itself is wrong? | That's why the independent checks exist: ISO 6346 and UN/LOCODE catch errors present in both documents. |
| How does it scale? | Stateless Next.js servers on libSQL/Turso, with bounded batches and compare-and-swap writes. The next step is a queue plus object storage for documents; the limits are explicit in the code. |
| How does it reach users? | Outlook add-in and Graph import are implemented, pending tenant approval. The standalone web app works today. |
| Why UN/LOCODE and not a paid port database? | It's the UN standard behind the codes on these documents, and it's public domain. The snapshot version is recorded, so results are reproducible. |

## 7. Verified in this review

Run on this branch on 24 September 2026. Figures below are historical results from the first review (engine 3.3.1); current engine 3.4.1 verification is recorded in [JUDGE_FEEDBACK_AUDIT.md](JUDGE_FEEDBACK_AUDIT.md):

- `npm run typecheck` ✔
- `npm run lint` ✔
- `npm test`: **540/540** ✔
- `npm run build` ✔
- `node scripts/test-team-runtime.mjs`: 49 checks ✔
- operations challenge: 20/20, same dataset checksum ✔
- `scripts/evaluate-port-reference.ts` on the 520-email inbox: 0 issues on verified cases ✔
- browser check of the Independent checks tab at 1440 px and 390 px: no console errors, no horizontal overflow ✔
