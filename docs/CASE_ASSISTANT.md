# Ask CargoGuard — evidence-linked case conversation

This is a real optional OpenAI LLM feature, separate from the fixed Evidence Navigator. It helps a shipping reviewer understand findings, identify blockers, prepare a draft correction request or hand over the case. It is an advisory aid, not a decision-maker.

## Judge / employee journey

1. Select the floating **Ask CargoGuard** button from any workspace screen. Search by case ID, subject or sender, for example organiser `email_004`. No external AI request is made by searching or selecting.
2. Select the case. If it has not been processed, explicitly choose **Verify this case · no AI request** inside the panel. The saved exact result, workflow and revision remain visible. Existing case details also provide an **Ask CargoGuard** shortcut to this same panel.
3. Select a suggested question or type your own. **Preview data to share** makes no provider call.
4. Inspect the exact outgoing case packet. Confirm authorization using the initially unchecked checkbox, then select **Send to AI**.
5. Inspect each answer's evidence references and use **Open source evidence** to inspect the parsed lines and original document link inside the panel. Transcriptions are explicitly labelled. AI wording can be wrong even when its citation IDs are valid.
6. Ask a follow-up, with a fresh preview and consent. Each conversation is limited to three turns. Drafts are visibly draft-only; nothing is sent or saved as a case decision.

Judges need no API account or key. The server uses the owner's configured OpenAI key. If AI is unavailable, **Resolution → Evidence Navigator** and all manual/verification features remain usable.

The panel starts with deterministic workspace counts and guidance, not an invented AI summary. **Change case** searches only the inbox supplied to this browser workspace. A question naming another standard `email_…` or uploaded-case UUID is rejected by the server before contacting OpenAI; this is an identifier guard, not semantic detection of every possible indirect reference. Cross-case synthesis is intentionally unsupported.

Up to five case/revision conversations and unsent questions remain in React memory while this tab stays loaded, including when visiting Resolution. No browser localStorage is used. Closing/reopening or switching cases clears the preview and consent; answers and questions remain separated by case/revision. Reloading the whole page clears this tab memory. Each reopen fetches current case data; a new revision starts fresh. The server still checks freshness, history binding and expiry before an AI request.

## Technical boundaries

- Server builds the context from the current workspace's saved case, never a client-supplied case object. It includes saved route/result/readiness, required next steps, field comparison values and selected matching source lines.
- Original excerpts are included only when their location matches the saved field reference. Human-confirmed scan transcriptions are never labelled original quotations, and the scanned image is not sent to AI. Other values are explicitly labelled saved extractions, not verified original quotations. Email headers/body, case IDs, document filenames/hashes and unrelated cases are excluded from the provider packet automatically. Values, excerpts or the question can still contain sensitive data: review the preview.
- Preview hash binds workspace, case, revision, selected evidence, question, parent reply, model and prompt contract. Altering these requires a fresh preview. Parent history comes from the server's workspace-scoped immutable cache, not arbitrary client messages.
- Server checks source IDs, schema, size and completion status. This validates references, **not semantic truth or prompt-injection immunity**. Human review is mandatory.
- No tools, browsing, email sending, database mutation capabilities or model-chosen endpoints. The API route never calls the case-write or audit-decision functions. Plain React text rendering; model text is not interpreted as HTML or executable links.
- Same-origin/session checks, strict input schema, bounded streams, 25-second provider timeout and no automatic retries. A changed case revision during generation causes the answer to be discarded; the attempted request still counts.
- Current contract: `case-advisor-v1`, model allowlist `gpt-5.4-mini`, Responses API, strict JSON schema, `store:false`, up to 1,600 output tokens. No provider key enters the browser.
- New migration `0004_case_assistant.sql` adds only the advisory reply cache. Engine remains 3.1.0 because the comparison pipeline is unchanged.

## Cost and retention

Chat and evidence recovery use **the same persistent `recovery_attempts` ledger**: 3 calls/workspace/UTC day, 20 globally/UTC day, 100 globally over the database lifetime, 100,000 conservative reserved tokens/day, 1,000,000 reserved tokens over the database lifetime, two concurrent calls, one pending call per workspace. Cookie changes and deployment restarts do not reset global limits. Failed calls consume allowance. The additional lifetime token guard only tightens the existing limits. Increasing the paid-test/demo allowance is pending the owner's separate bounded spending confirmation; no increase or ledger reset is included in this release.

The interface reads the actual configured limits from the API instead of hardcoded copy. Quota rejection distinguishes lifetime, workspace/day, global/day, and concurrent-request causes; daily reset timestamps are UTC. Displayed remaining counts are a snapshot, not a reservation: the atomic SQL guard runs again before every provider request. Token limits can be exhausted before request-count limits. No billing balance, API key or other workspace's case content is exposed.

Questions are at most 800 characters. The combined case/history/question packet is limited to 24,000 UTF-8 bytes; oversized requests are rejected, not silently truncated. Provider responses are bounded to 40,000 bytes. Identical accepted question/parent/revision requests reuse the cache without another provider call. Conservative byte-based token reservations are a cost guard, not billed token counts or a tokenizer estimate.

The browser view can be cleared with **Start a new conversation**. This is not a deletion claim. Cached chat is workspace-scoped and accessible for 30 minutes; expired rows are removed on a subsequent chat cache write. `store:false` is not a guarantee of zero provider retention. Do not use this public hackathon prototype for confidential customer documents without a proper enterprise privacy/security review.

## Reproducible evidence and limitations

Initial case-tab release on 21 September 2026 (before the floating-panel upgrade; see GLOBAL_ASSISTANT_RELEASE.md for newer evidence):

- Eight-step quality gate passed, including **267 tests across 16 files**, typecheck, lint, original-input integrity, independent organiser scoring, OCR staging and production build.
- Seventeen new assistant tests cover the provider contract, source privacy, scan-transcription provenance, readable/navigable citation rendering, rejection of invalid references, no-key/error behavior, shared quota, cache privacy/expiry, same-origin/session/consent, preview binding, follow-ups and in-flight revision changes. Provider responses are mocked: these tests do not establish LLM answer quality.
- `scripts/test-assistant-corpus.ts` checked context preparation for **2,600 development cases**, including **7,198 exact source excerpts**. Largest packet: **8,324 bytes**. No provider calls. These generator sets are not production or unseen-data evidence.
- Local HTTP regression: 72 checks passed. Desktop 1440×1000 and mobile 390×844 inspected; no document/drawer horizontal overflow. Disabled AI, starter questions, preview reset on edits and unchecked consent behavior checked. No browser console warnings/errors observed in this test session.

Live-provider acceptance must be recorded separately in CLOUD_RELEASE.md. Two live examples cannot establish broad model reliability. This feature improves the operator workflow; it cannot guarantee a championship, zero bugs, shipping correctness or measured employee time savings.
