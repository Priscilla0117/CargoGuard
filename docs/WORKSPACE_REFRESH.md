# Workspace design and AI capacity — 21 September 2026

The later [laptop-first refresh](LAPTOP_WORKSPACE.md) replaces the six-tab layout
described below with a unified queue, Reports and secondary Settings. Its release
keeps the AI limits and safeguards documented here unchanged.

## Why requests were blocked

The deployed status reported 7 attempts, 13 shared daily request slots remaining,
but only 12,384 daily reserved token units remaining. A normal grounded question
can require more. The previous UI highlighted request counts without showing
whether this exact question could fit the token bound.

The owner explicitly requested a higher AI limit. This release raises daily
capacity while preserving the previously approved lifetime exposure:

| Guard | Previous | Current |
|---|---:|---:|
| Workspace requests / UTC day | 3 | 10 |
| Shared requests / UTC day | 20 | 50 |
| Shared reserved token units / UTC day | 100,000 | 500,000 |
| Shared lifetime requests | 100 | 100 |
| Shared lifetime reserved token units | 1,000,000 | 1,000,000 |
| Concurrent requests | 2 | 2 |

These are maximums, not guaranteed request entitlements. Whichever guard binds
first stops new provider requests. Token reservation conservatively includes
UTF-8 payload bytes, overhead and maximum output; it is not actual billed usage.
No attempt records are deleted or refunded. Daily limits reset at midnight UTC
(08:00 Malaysia); lifetime limits do not. No paid plan, credit purchase or top-up.
Other apps using the owner's key are outside this application's controls.

Free chat previews now calculate the same reservation as the send path and return
an availability result. The consent screen explains capacity before a provider
request, disables Send when it cannot fit, and offers Evidence Navigator. A valid
workspace-scoped cached answer remains usable without a new reservation. Server
atomic checks still apply at send time because other visitors can consume capacity.

## Operator experience

- All six tabs share higher-contrast text, calmer teal navigation, rounded panels,
  soft surface colours and consistent spacing. Colour complements textual labels.
- Operations queues have distinct action colours. AI availability shows remaining
  request slots, reserved capacity, daily reset and lifetime limitations; refresh
  performs no provider call or case-data transmission.
- Inbox and Review retain source-first comparison, with colour-coded outcome cards.
- Policy uses a dedicated editor panel; its guide reinforces preview before activation.
- Performance separates operational rates from development-corpus evaluation.
- Audit events have individual cards. Demo reviewer names are still self-declared.
- Compact workflow guides explain each tab's purpose. Irrelevant metric cards were
  removed from Policy and Audit to reduce clutter.
- Mobile AI launcher sits above bottom navigation; it no longer covers Audit.
  Main navigation returns to the top and exposes the current page accessibly.

No new operational permission is introduced. Chat cannot send emails, approve
shipments, release cargo or change case decisions. The extraction and comparison
engine, prompt, model, consent boundary, source isolation and ledger are unchanged.

## Requirements rechecked

All five supplied PDFs were reread, along with both organiser distributions'
READMEs. Their contents are reference evidence, not permission to disclose data.
The organiser's clarification permits the released ground truth for evaluation;
the runtime still does not consume it.

| Source | Design / engineering consequence |
|---|---|
| Shipping Document Verification Use Case, pp. 1–4 | Keep mixed-inbox routing, SI as reference, all seven fields, exact source evidence, visible uncertainty and human correction |
| Preliminary Judging Rubric, pp. 1–3 | Working core is 25/100; preserve reproducible validation and real integrations, not cosmetic AI |
| Final Judging Rubric, pp. 1–3 | Clear UX and meaningful differentiation support 10/100; robustness and end-to-end workflow must remain demonstrable. Integration criterion remains provisional in the supplied draft |
| Rules and Regulations, pp. 1–7 | Meaningful AI + cloud, functional public prototype, original team work and mandatory submission artifacts remain obligations |
| Participant Infopack, pp. 1–6 | Preliminary submission deadline stated as 22 September 2026, 12:00; team must check organiser updates |

Mandatory video, documentation/slides, repository and team submission are not
completed by a UI release. No competition outcome or zero-defect guarantee is made.

## Verification

- Full eight-stage gate passed: TypeScript, lint, **289 tests / 19 files**, original
  bundle integrity, original-data evaluation, independent organiser scorer, OCR
  assets and production build.
- Original automatic output: **520/520 exact**, all 46 defect cases and all 20
  review cases matched; zero false-OK decisions on this supplied development set.
  Output hash: `b0fac824010298e6bfa3b231c0490452916e50f47bc2df76df249321d659333c`.
  This is not a claim of unseen-data accuracy or an LLM benchmark.
- Local production HTTP suites: **185 checks** (72 core, 35 hardening, 23
  governance, 30 release, 25 assistant preflight). Preflight uses no provider calls.
- Browser: all six tabs visually checked at 1440px desktop; all six checked at
  390px and 320px with no page-level horizontal overflow. The 390px navigation
  test confirmed the launcher clears the bottom bar and every tab selects the
  expected view. At 320×568, chat composer remained visible, the case stayed in
  chat, a free capacity preview worked, and unconfigured AI could not be sent.
- Policy impact preview inspected 520 cases without activation. Local browser
  warning/error log was empty in the inspected session.

## Hosted acceptance

Runtime commit `3d3a37946558a94d3311d1e5cac4f8166488cade` was deployed to the
existing free Render service. Deployment `dep-daoefeid0e5s73fulc20` started at
16:15:54 MYT and succeeded in 2m15s on 21 September 2026. No new database migration.

- All **185 hosted HTTP checks passed**, finishing approximately 16:20 MYT.
  Hardening suite median 263ms / p95 452ms over 73 requests; this is low-volume
  acceptance evidence, not a load-test or uptime promise.
- A fresh hosted automatic export independently matched **520/520** reference
  records, 46/46 defect cases, 20/20 review cases, zero false OK, composite 1.0.
  Its output hash matches the local value recorded above.
- Seven existing persistence/isolation checks passed after deployment: saved case,
  historical revision and policy unchanged; both exact 5 MiB sources retained and
  inaccessible to a different workspace.
- The quota response showed the new limits, with all seven earlier attempts still
  counted. No usage was reset. Two new provider requests were made in this turn.
- The first real chat request (`email_004`) returned HTTP 200 and one validated
  answer, but the new smoke harness stopped on an overly strict model-name
  assertion: OpenAI returned `gpt-5.4-mini-2026-03-17`, not the alias. That first
  answer's full semantic/cache assertions were **not completed**. The harness was
  corrected to accept the configured alias or a dated snapshot of the same model.
  The first request was not repeated.
- The remaining single live test (`email_506`) passed completely: the answer
  explained missing attachments and 0/7 comparison coverage, requested SI + draft
  BL, cited current-case facts, made no approval claim and left the saved case
  unchanged. A free cached preview and cached replay consumed no additional
  request. Provider latency was 2,888ms. This is a smoke test, not broad LLM accuracy.
- Public UI: direct chat opening, revision-3 case loading, 15,079-unit capacity
  preview, Send disabled without consent, and unobstructed mobile Audit navigation
  were verified. No further provider call was made through the UI.
- At 16:22 MYT, the shared ledger had **41 daily / 91 lifetime requests** and
  **389,474 daily / 889,474 lifetime reserved token units** remaining. This is a
  timestamped observation; other visitors can consume the allowance.

The optional `scripts/test-assistant-live.mjs` requires an explicit consent flag,
has no automatic retry and is excluded from CI. It accepts `--missing-evidence-only`
to run just that one case. Never run it again without sufficient owner-authorized
test allowance. Detailed responses are saved under ignored `work/validation/ai-v31/`.

Reload https://cargoguard-averis.onrender.com/ to load the new interface. Free-host
idle wake-up, provider failures, exhausted quotas and untested documents remain
possible limitations. No finite test suite establishes a zero-bug guarantee.
