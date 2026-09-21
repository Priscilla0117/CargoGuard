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

## Unchanged boundaries

No API contract, model, prompt, comparison engine, database migration, AI budget,
secret or hosting-plan change. These are UI/workflow and local-guidance changes.
The real LLM remains case-scoped and fallible. This release does not establish
new model-quality results, unseen-data accuracy, production uptime or a judging
outcome. Expanded paid evaluation remains pending its separately proposed cap.

Public-cloud acceptance will be recorded after deployment is confirmed.
