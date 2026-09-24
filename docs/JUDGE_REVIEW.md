# Judge's review and final-pitch playbook

A mock review of `codex/final-round-employee-workflow` against the final rubric (dated 24 September 2026). It covers:

- the score a strict judge would likely give today;
- what would cost marks;
- the competitive argument to lead with.

## 1. Verdict

**CargoGuard is a genuine contender for first place.** It is not guaranteed to win.

Engineering depth is well above a typical hackathon entry: 540 automated tests, CI, 1,560/1,560 on fresh organiser seeds, a frozen 20-case authored challenge, and immutable revisions. Most finalists will show a demo and a table. CargoGuard can show evidence.

It can still lose to a weaker product with a sharper story. That is the main risk.

| # | Criterion | Max | Likely today | With the fixes below | What moves it |
|---|---|---:|---:|---:|---|
| 1 | End-to-End Functionality | 25 | 19–21 | 22–24 | Public link runs **this** branch; one fault-free, rehearsed golden path |
| 2 | Architecture & Scalability | 15 | 11–12 | 12–13 | One diagram, three trade-offs, a stated scaling path |
| 3 | Technology Integration | 15 | 9–11 | 11–13 | Show the optional LLM recovery live; explain *why* facts stay deterministic |
| 4 | Engineering Quality | 15 | 13–14 | 14 | Already excellent; show one failure recovering live |
| 5 | Solution Effectiveness | 10 | 7–8 | 8–9 | One measured before/after number |
| 6 | UX & Differentiation | 10 | 6–7 | 8 | Show 3 desks, not 10; lead with the differentiators below |
| 7 | Impact & Future Potential | 10 | 6–7 | 8 | Quantified pilot plan with success measures |
| | **Total** | 100 | **≈71–80** | **≈83–89** | |

These are one reviewer's estimates, not organiser scores.

## 2. What would cost marks (fix in this order)

1. **The public link is an older release.** The README says so. A judge who clicks it scores the old product, and "cloud meaningfully used" becomes doubtful. Deploy this exact commit to Render + Turso, then run `/api/health` and one full correction cycle on the hosted URL. Localhost is accepted, but a working public link is still stronger.
2. **Too much hedging.** The README, strategy docs and UI repeat "not proof", "no guarantee", "not claimed". A few precise boundaries build trust; dozens read as a lack of confidence. Keep **one** "Trust boundaries" slide and say everything else positively.
3. **Too many desks for five minutes.** There are ten workspaces: queue, shipments, insights, label rules, SI templates, team, Outlook, assistant, policies, batch. Demo three; mention the rest in one sentence as "the rest of the employee's day".
4. **No LLM in the default path.** Many finalists will lead with GPT/Gemini vision. Turn that into a strength (section 3, point 4). Also show the existing optional Evidence Recovery Copilot live on synthetic data if a key is available: *AI proposes, the server checks the quote is verbatim, a human confirms*.
5. **No measured impact.** See section 5. One real number from a timed trial beats any estimate.
6. **Bug found and fixed in this review.** The work-queue **Independent checks** tab silently opened the *Check* tab: `caseDestination()` mapped `"integrity"` to `"comparison"`. That made the ISO 6346 differentiator unreachable from the work queue. It is fixed in `lib/work-queue.ts`, with a regression test in `tests/work-queue.test.ts` and a browser check. Re-rehearse any demo path that opens that tab.
7. **Preliminary-judge feedback is now addressed in code (engine 3.4.0).** See [JUDGE_FEEDBACK_RESPONSE.md](JUDGE_FEEDBACK_RESPONSE.md):
   - "TBA / TBC" and similar placeholders now go to review;
   - hostile text can no longer hide a discrepancy;
   - spam attachments are never opened;
   - every mismatch is explained.

   Open the pitch with a **"You told us — we fixed it"** slide and a 10-second live demo: import a pair where both shippers say `TBA / TBC` and show that it goes to review.

## 3. Competitive advantage in five points

Everyone is building the same thing: classify → extract → compare → review button. Finalists will look alike in the first 60 seconds. Win on what happens **after** the side-by-side table.

1. **"The SI is the reference — but who checks the reference?"** Comparison can only prove the BL copied the SI. CargoGuard also checks each document against **public registers**:
   - ISO 6346 container check digits;
   - since this review, **UN/LOCODE port codes** ([PORT_REFERENCE.md](PORT_REFERENCE.md)).

   On the organiser inbox, it finds all 16 self-contradictory port values. Example: `TUTICORIN, INDIA (KEMBA)`, where KEMBA is Mombasa, Kenya. It raises **0** issues on verified cases, and it tells the employee *which half* of the port to correct. It also shows that the dataset's own SI uses `JOAQB`, a code UN/LOCODE does not contain.
2. **A correction cycle, not a one-shot compare.** The corrected BL fixes the weight but introduces a new port error. CargoGuard re-checks all seven fields against the unchanged SI, keeps every revision, and refuses completion while anything is open.
3. **Every value is traceable to evidence.** Each extracted value links to page/line/cell and a SHA-256 of the source. Decisions bind to a revision, so a stale "approved" can never carry over to a new draft. That is audit-grade, not demo-grade.
4. **Deterministic where facts matter, AI where language is fuzzy.** A learned intent router handles messy email, and local OCR handles scans. Shipment facts are never *generated*, so a model cannot invent a weight. The core runs on a laptop with no per-page API cost, and customer documents never leave the company. Averis handles confidential customer paperwork, so that is a procurement advantage, not a limitation.

5. **It explains every mismatch, not just shows it.** Each difference is labelled either:
   - a *likely clerical slip* (swapped digits, tonnes vs kg, a port code kept but the name changed, parties swapped), where staff just ask for a correction; or
   - a *different value*, where staff confirm with the shipper first.

   On the organiser inbox that is 39 clerical slips and 47 different values, out of 86 mismatches. This is the triage an experienced clerk does in their head, done for every junior employee.

**Closing line:** *"Other tools tell you the two documents differ. CargoGuard tells you which one is wrong, what to ask the issuer for, and proves it when the corrected draft comes back."*

## 4. Five-minute demo (rehearse under 4:45)

| Time | Show | Say |
|---|---|---|
| 0:00–0:30 | Work queue after **Run inbox**: 520 emails routed into queues | "One inbox, five kinds of mail. Staff start from *what needs action*, not from reading everything." |
| 0:30–1:30 | Case #013 → Check tab (port of discharge mismatch) → **Independent checks** → Port code reference | "The BL says Tuticorin, India, but its own code is Mombasa, Kenya. So the BL changed the name and kept the SI's code. We ask the issuer for exactly that." |
| 1:30–2:45 | `examples/final-round` correction cycle: weight fixed, new port error, final BL passes; revision diff; completion blocked, then allowed | "Real corrections are loops. A fix can break something else. We re-check everything, every time." |
| 2:45–3:30 | Scanned PDF → OCR crops with recognition scores → uncertain field blocks save | "When the system is unsure, it says so with the source image. It never guesses." |
| 3:30–4:15 | Evidence slide: 1,560/1,560 on fresh seeds, 20/20 authored challenge, 540 tests, **measured time trial** | "Accuracy is measured on data we never tuned on, plus our own harder cases." |
| 4:15–4:45 | Pilot plan + close | Closing line above |

Keep a screen recording of this exact path as a fallback.

## 5. Get one real impact number before pitch day (about 1 hour)

1. Pick 10 comparison cases: 4 clean, 4 with discrepancies, 2 needing review. Include scans.
2. Two teammates check them **manually** (open both files, fill a 7-field sheet). A different two use **CargoGuard**. Swap halves to cancel out learning effects.
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

Run on this branch on 24 September 2026. Figures below are from the first review (engine 3.3.1); the current engine 3.4.0 verification, now with more tests, is recorded in [JUDGE_FEEDBACK_RESPONSE.md](JUDGE_FEEDBACK_RESPONSE.md#verification):

- `npm run typecheck` ✔
- `npm run lint` ✔
- `npm test`: **540/540** ✔
- `npm run build` ✔
- `node scripts/test-team-runtime.mjs`: 49 checks ✔
- operations challenge: 20/20, same dataset checksum ✔
- `scripts/evaluate-port-reference.ts` on the 520-email inbox: 0 issues on verified cases ✔
- browser check of the Independent checks tab at 1440 px and 390 px: no console errors, no horizontal overflow ✔
