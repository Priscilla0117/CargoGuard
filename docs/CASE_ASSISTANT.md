# Ask CargoGuard — case assistance

A floating, optional OpenAI assistant helps a reviewer understand a saved case, inspect evidence and draft a follow-up. It is separate from the deterministic Evidence Navigator and does not make operational decisions.

[Architecture](ARCHITECTURE.md) · [Model limitations](MODEL_CARD.md) · [Dated provider tests](CLOUD_RELEASE.md#live-provider-evidence)

## Use the assistant

1. Open the floating **Ask CargoGuard** button. Type a question with a case ID, such as `email_004`, then choose **Continue**. Alternatively, **Attach a case** and search by ID, subject or sender. Selecting a case stays inside chat and makes no external AI request.
2. If needed, choose **Prepare case & continue chat** to calculate and save the case evidence first. This preparation does not call OpenAI.
3. Type a question or use a suggestion. **Review & send** prepares the outgoing-data preview without contacting the provider.
4. Inspect that preview, tick the initially unchecked consent box, then choose **Send to AI**.
5. Read the answer and its references. **Open source evidence** shows the associated parsed lines and original document link. Human-confirmed transcriptions are labelled separately.
6. For a follow-up, review a fresh preview and consent again. A conversation is limited to three turns.

Example question: **“What needs fixing, and which evidence supports it?”** The assistant can explain the selected case and suggest wording. Drafts are not sent, and neither a question nor an answer changes the saved comparison.

Visitors need no personal OpenAI key. Calls use server-side credentials configured by the application operator. When AI is unavailable, the case's contextual **Resolve case** or **Request correction** action still provides deterministic guidance and source-checked drafting.

### Local guidance is not an LLM

Welcome shortcuts such as **What needs attention?** use saved workspace counts and local product guidance, explicitly labelled **no AI request**. A general question without supported context requests clarification rather than inventing shipment evidence.

The assistant covers one case/revision at a time. Explicit references to a different standard case ID are rejected before provider dispatch. This identifier guard does not understand every indirect reference. Cross-case synthesis and unrelated general chat are unsupported.

## What is shared

The server builds the context from the current workspace's saved case, not an arbitrary client-provided case object. It includes selected result/readiness information, required actions, comparison values and relevant source excerpts.

- Original quotations require a matching saved source location. Human-confirmed OCR is labelled transcription; other values are labelled saved extractions.
- Email headers/body, case IDs, document filenames/hashes and unrelated cases are excluded from the provider packet automatically.
- The question, field values and selected excerpts can still contain sensitive information. Inspect the actual preview; use only organiser/synthetic data in the public prototype.
- The scanned image itself is not sent to the assistant. Browser-local OCR is a separate workflow.
- The API key never enters browser code. `store:false` is used, but this is **not** a guarantee of zero provider retention.

No model tools, browsing, email sending, automatic case writes or arbitrary network endpoints are enabled. Answers render as plain React text, not executable HTML. Valid reference IDs do not prove semantic truth or prompt-injection immunity; inspect the cited source.

## Freshness, consent and storage

A preview hash binds workspace, case, revision, evidence, question, parent reply, model and prompt contract. Changes require a new preview. Parent conversation history comes from a server-side workspace-scoped cache, not arbitrary client messages. If the revision changes during generation, the reply is discarded; that attempted call still counts.

Up to five case/revision conversations and unsent questions remain in tab memory. Local workspace guidance retains up to ten turns. Closing the panel clears preview/consent, not the in-memory conversation; switching cases separates conversations. Reloading the whole page clears tab memory. No browser localStorage is used.

Server-cached replies are workspace-scoped and accessible for 30 minutes. Expired rows are cleaned on a subsequent chat cache write. **Start a new conversation** clears the browser view; it is not a deletion guarantee. Formal retention/deletion and verified staff identities are production prerequisites.

## Shared usage and failure handling

Chat and field recovery share the same persistent attempt ledger. The recorded demo configuration is:

| Guard | Limit |
| --- | ---: |
| Per workspace / UTC day | 10 attempts |
| Across the database / UTC day | 50 attempts |
| Across the database lifetime | 100 attempts |
| Conservative reserved token units / UTC day | 500,000 |
| Conservative reserved token units / lifetime | 1,000,000 |
| Concurrent provider requests | Two globally; one pending per workspace |

The API displays the actual configured limits; these are ceilings, not guaranteed entitlements. Any guard may stop a call first. Conservative token reservations are not billed token counts. Cookie changes or redeployment do not reset shared allowance, and failed attempts consume quota. Daily limits reset at midnight UTC; lifetime limits do not.

Previews check whether the exact question/history packet fits. An atomic reservation checks again at send time because other visitors may consume capacity. Identical valid cached requests require no new provider call.

Questions are limited to 800 characters; the combined case/history/question packet to 24,000 UTF-8 bytes; provider responses to 40,000 bytes and 1,600 output tokens. Oversized packets are rejected rather than silently truncated. The provider timeout is 25 seconds with no automatic retry. Same-origin/session, schema, consent and reference checks are enforced server-side.

If the provider, key or allowance is unavailable, the app shows the failure and preserves the case. It does not substitute a fixed fixture as a live AI answer. Recheck saved state before repeating an uncertain action.

## Validation and limits

Current unit/API suites cover consent, context scope, scan provenance, valid references, cache expiry/isolation, preview binding, follow-ups, provider failures and in-flight revision changes. Assistant preflight and mocked provider tests do **not** measure real-model answer quality.

Context construction was checked across 2,600 same-generator development cases with 7,198 exact excerpts; the largest packet in that diagnostic was 8,324 bytes. This verifies context construction on those cases, not unseen data or model understanding.

The [dated cloud report](CLOUD_RELEASE.md#live-provider-evidence) records the limited real-provider answers, failed/incomplete tests and remaining gaps. No broad live multi-turn or adversarial-quality certification exists. This public prototype lacks enterprise authentication and is not approved for confidential shipments.
