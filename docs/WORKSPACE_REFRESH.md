# Workspace design and AI capacity — 21 September 2026

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

Hosted deployment and real-provider smoke results are appended after verification.
