# Chat-first Ask CargoGuard — 21 September 2026

## Employee journey

The floating launcher opens a conversation, not a compulsory case directory.
Employees can type immediately, use one of two workspace shortcuts, or attach
a shipment. A known case ID in a question opens that case's chat and carries the
question. Case selection never calls the verification-detail navigation handler.
Unprocessed and older-engine cases offer **Prepare case & continue chat** inside
the same panel; `skipSaved: true` preserves supported prior human corrections.
Only an explicit Evidence Navigator / Resolution action leaves the assistant.

The conversation scrolls independently while the question composer stays visible.
The case ID, current revision and result remain visible above the conversation.
Privacy and allowance details are expandable; the OpenAI sharing preview and
unchecked consent remain mandatory before each real request. Enter prepares a
question (Shift+Enter adds a line); it never bypasses sharing consent.

Workspace guidance is deliberately local and labelled **no AI request**. It
supports product help and saved-workspace counts, not an unrestricted general
LLM. Unrecognized questions ask for case context instead of inventing evidence.
Unknown or multiple case IDs are clarified, and no cross-workspace lookup is
made. An unavailable workspace is not described as having zero cases.

Case questions/replies remain separated by case and revision (up to five in tab
memory). Workspace chat retains up to ten local turns while the panel is closed.
A browser reload clears tab memory. Preview and consent are not retained when
the panel closes or a case changes. Workspace chat state belongs to this floating
assistant instance; reopening from a separate case-details shortcut can start a
new workspace chat instance. No browser persistent storage was added.

## Regression evidence

- Nine new tests cover known IDs, upload IDs, repeated IDs, multiple/unknown IDs,
  unavailable workspaces, count accuracy, precedence, bounded help and abstention.
- Local UI: direct question `email_004` → prepare documents → case chat, with the
  exact question retained and MISMATCH unchanged. No details-page redirect.
- Local older-engine regression: only an isolated local test database was marked
  with a legacy version. Selection stayed in chat, refresh produced revision 2,
  and the unsent question survived. No public case was changed for this fixture.
- Case switch: email_001 started with an empty question, verified OK, and could
  not preview an explicit email_004 question (409 before any AI dispatch).
  Switching back restored only email_004's question.
- Workspace Enter submission, help response and unsent draft survived closing
  and reopening. The initial workspace error was also exercised and handled.
- Desktop and mobile browser inspections; mobile 390×844 had panel bounds
  x0/y0/390×844, no horizontal overflow and a visible dock at y639–844 in the
  checked case-chat state. The final styling simplifies the home screen to two
  prompts and uses dark-green primary buttons for stronger contrast.
- Local production HTTP acceptance: 182 checks (72 core, 35 hardening,
  23 governance, 30 release, 22 assistant preflight). No valid provider ask.
- Final eight-step quality gate passed on navigation-fix commit `99ba6e8`:
  typecheck, lint, **281 tests / 18 files**, bundle integrity, organiser evaluation,
  independent scoring, OCR staging and production build. All 520 supplied cases
  still matched the organiser truth; not a held-out accuracy claim.
- Final production UI: desktop 1280×720, mobile 390×844 and compact 320×568.
  At 320×568 the composer occupied y347–568 with a 162px scrolling conversation;
  no horizontal overflow. Escape returned focus to the launcher. Reopening
  retained the case question and removed its sharing preview. No warning/error
  entries appeared in the inspected production browser session.
- A final close-handler correction resets the attachment picker and source view,
  so dismissing a picker cannot make the next launcher click start on the list.

## Unchanged boundaries

No API contract, model, prompt, comparison engine, database migration, AI budget,
secret or hosting-plan change. These are UI/workflow and local-guidance changes.
The real LLM remains case-scoped and fallible. This release does not establish
new model-quality results, unseen-data accuracy, production uptime or a judging
outcome. Expanded paid evaluation remains pending its separately proposed cap.

## Public-cloud acceptance

Final runtime `99ba6e85d5053ae593a2604d4c3362bcf87a0779`, Render deployment
`dep-daodsq942hec739fh4p0`. Started 21 September 2026 at 15:36:09 MYT and
succeeded in 2m13s on the existing Free service. The initial chat-first build
`4960517` had deployed successfully in 2m22s before the final close-handler fix.
No secrets, plans, health-check settings or database records were reset.

- All **182 hosted HTTP checks passed** around 15:39 MYT. Hardening acceptance
  covered 73 requests with median 375ms and p95 1,050ms in this run; this is not
  sustained-load or uptime certification.
- Fresh hosted automatic export independently rescored: **520/520 exact**,
  46/46 defect cases, 20/20 review cases, zero false-OK decisions, composite 1.0.
  SHA-256 `b0fac824010298e6bfa3b231c0490452916e50f47bc2df76df249321d659333c`.
  Scope remains supplied development data, not unseen cases or LLM quality.
- Public floating launcher opened the message box immediately. Workspace guide
  reported 46 discrepancy / 20 review / 91 awaiting-document cases from the
  user's already processed workspace. A typed email_004 question opened its
  chat without navigating to details; the existing revision 3 was retained.
- Public sharing preview worked with OpenAI configured. Send remained disabled
  without consent; **no real AI request was made in this turn**. Changing to the
  picker, closing and reopening returned to the conversation, not the list.
- No warning/error entries were observed in the inspected public browser session.

The updated public page is https://cargoguard-averis.onrender.com/. Reload an
already-open page to load the new UI. Free-host cold starts remain possible.
