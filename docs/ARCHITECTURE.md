# CargoGuard architecture

This describes the CargoGuard 3.2.1 implementation now included on `main`. The latest full recorded cloud acceptance is dated **21 September 2026** in [CLOUD_RELEASE.md](CLOUD_RELEASE.md); [SUBMISSION_CHECK.md](SUBMISSION_CHECK.md) records the fresh 22 September local gate and read-only public checks. Documentation changes do not constitute a new deployment. The historical Worker/D1/R2 implementation is not the deployed architecture described here.

## What runs where

The browser displays the inbox, comparisons, evidence, uploads and reviewer forms. On request, a local browser worker proposes OCR text from scanned PDFs. It does not receive an answer key or make the authoritative comparison decision. Heavy PDF/OCR code is loaded on demand.

Version 3 defaults to standard Next.js on Node.js, independently deployed on Render Free plus persistent Turso libSQL. The server runs email classification, document parsing, normalization, comparison and API validation. Turso stores cases, immutable result revisions, policy versions, events and small original uploads. The supplied synthetic inbox is a server-side input bundle. Each browser gets a random HttpOnly workspace cookie. Local SQLite is an explicitly selected QA backend; the server refuses it on Render. Hosted API, upload and restart-persistence verification is recorded in [CLOUD_RELEASE.md](CLOUD_RELEASE.md), along with the remaining limits. The legacy Worker/D1/R2 adapter is retained as a separate optional build, not the default.

Processing flow: email + bounded attachment parsing → trained TF-IDF logistic intent router with safety abstention (an agreeing rule can corroborate, never replace its category) → for comparison requests, source-role/readability validation and seven evidence-linked fields → exact comparison plus a separate policy annotation → verified, discrepancy, review, awaiting documents or routed → atomic current result + immutable revision + audit event. Non-comparison emails are classified without shipment-field comparison.

The optional Evidence Recovery Copilot, introduced in 3.1, assists unfamiliar readable layouts. With explicit organiser/synthetic-data consent, Render sends bounded extracted lines to the fixed OpenAI Responses endpoint using an owner-supplied server-side key. The browser never receives the key. The LLM selects verbatim value fragments; the server validates citations and units. All seven fields and the role require explicit reviewer confirmation before a hash/revision-bound proposal can become a reviewed source revision. Persistent Turso reservations enforce the approved shared usage bounds, including failed attempts. Provider errors preserve the saved decision. This field-recovery workflow is separate from the case chatbot; see [AI_UPGRADE.md](AI_UPGRADE.md).

**Ask CargoGuard** is the optional floating, case-specific chatbot. The server constructs a bounded packet from the selected workspace's saved case and relevant evidence. The reviewer sees a sharing preview and explicitly consents before sending a question to OpenAI. Replies can explain findings or suggest a draft follow-up; they cannot change case decisions, send email or approve a shipment. Source-reference validation does not establish semantic truth. Chat and field recovery share persistent usage limits, while learned routing, exact comparison and manual review do not require an OpenAI request. See [CASE_ASSISTANT.md](CASE_ASSISTANT.md) for privacy, cache, revision and provider-failure boundaries.

## Intake and the scope of a comparison

Manual email intake and document replacement both use **`POST /api/upload`**; there is no separate `/api/intake` route. New email intake accepts 0-10 attachments, allowing email-only routing. Replacement accepts 2-10 files; completing a comparison still needs an identified readable SI and draft BL. The file-count check alone does not validate their roles or readability. Both paths allow TXT/PDF/DOCX/XLSX, at most **5 MiB per file / 20 MiB combined**; the multipart request is capped at 21 MiB including metadata and overhead. These are bounded demo limits, not sustained-throughput claims.

A comparison uses **one SI and one BL**, not every attachment. With extra documents, the reviewer explicitly selects an identified readable pair and records a name and reason. The server binds that selection to source fingerprints and the case revision; other files remain **retained, not verified**. Selecting a different pair recomputes and saves a new result while preserving earlier evidence. It does not establish which draft the sender intended, and a matching pair is not shipment approval. See [REVIEW_WORKSPACE_V32.md](REVIEW_WORKSPACE_V32.md).

The correction-impact preview recalculates all seven checks using the same function as the save path, including linked consignee/notify-party effects. Previewing writes nothing and makes no AI call. A save validates the value and expected case revision again; the original document bytes are not edited.

## Why this fits Averis

The work starts with an operational inbox, not a chatbot. Staff see which shipments need attention, the exact SI and BL values, and the page/line/cell supporting each value. The SI is always the reference. Staff can correct an extraction, upload a revised document pair and prepare a draft amendment request. Nothing is sent to a carrier automatically.

AI handles noisy email intent and assists unfamiliar-layout interpretation. Deterministic comparison keeps shipment facts predictable and inspectable. Failure becomes a review task, not a silent success. A deterministic Resolution checklist and downloadable revision-pinned evidence packet help staff act on discrepancies without sending messages automatically.

## API contract

| Endpoint | Purpose | Safeguards |
|---|---|---|
| GET /api/inbox | 520 organiser records plus this workspace's uploads | Session-scoped database query |
| POST /api/cases | Process up to 10 IDs, select a source pair, correct a field, confirm category, or confirm a scan transcript | Bounded schema/body, origin check, optimistic version; source fingerprints for pair selection; seven confirmations, page references and source hash for scans |
| GET /api/cases?id=… | Current result, audit and latest 100 revision summaries; optional revision=… retrieves an exact historical snapshot | Session-scoped, read-only historical inspection |
| GET /api/cases?export=1 | Untouched current-engine automatic baseline for the 520 supplied IDs; mode=reviewed returns labelled operational evidence instead | No reviewed/legacy/replaced-source result can become automatic accuracy evidence |
| POST /api/upload | Import an email with 0-10 attachments, or replace case sources with 2-10 attachments | 5 MiB/file, 20 MiB combined, 21 MiB multipart body; four allowed extensions, random immutable source keys; replacement requires current revision, reviewer and reason |
| GET /api/document | Retrieve a current or revision-specific source | Case/revision membership and workspace check; no arbitrary file path |
| GET/POST /api/policies | History, preview and activate bounded weight-exception policies | Expiring server-side preview token, workspace isolation, policy/case-state CAS and reason |
| GET/POST /api/recovery | Read recovery configuration, request a source-quoted field proposal, or confirm that proposal | Consent before provider use; bounded source text; persistent shared usage limits; seven confirmations and hash/revision binding before saving |
| GET/POST /api/assistant | Read availability, preview a selected-case question, or request an advisory reply | Workspace-scoped context, preview/consent, revision checks, shared usage bounds; no case-decision mutation or automatic sending |
| GET /api/health | Schema/storage readiness and engine version | No credentials or detailed database errors exposed |
| GET /api/live | Process-only probe for Render restarts | Explicitly does not check storage; startup must still verify migrations, and release acceptance requires readiness plus workspace tests |

## Storage and concurrency

Cases have composite key (workspace, email_id). Updates require the expected version. One database transaction writes the current result, complete revision and audit event only if the version update succeeds. If any statement fails, all three roll back. SQLite triggers refuse updates/deletes to revisions and policy versions. This is application/database immutability, not protection against an administrator altering the schema. Migration imports only the actually retained legacy state and marks its provenance unverified; earlier states are not reconstructed or invented.

Stale saves and conflicting replacements are rejected. File replacement uses new random names, retaining historical source bytes. Cleanup happens only before persistence or after a confirmed rejected write. An unknown commit response is not permission to delete bytes, including bytes referenced only by history. Retention/cleanup remains future work. The 30-uploaded-case quota is checked atomically per browser workspace. The Node backend adds a **256 MiB shared attachment-byte cap**, including retained historical sources, across the demo database; this does not cap all database metadata or provider spending. Small binary documents are stored in libSQL for this bounded demo; large enterprise document volumes should move to managed object storage.

Policy v0 means exact required comparison. Versioned kg/% tolerances annotate weight differences; when both are enabled the tighter limit wins. No fields can be disabled. Strict mismatch/uncertainty always remains authoritative. Previews expire after 10 minutes. Activation checks both the prior policy version and the sum of monotonically increasing case versions atomically, so a changed case invalidates its preview. Rollback appends a new version. Each browser batch captures one policy version; existing case snapshots are unchanged by activation. Manual corrections and scan confirmation retain their case's policy.

Explicit reprocess reads current source bytes and resets individual extraction corrections, retaining confirmed categories and fingerprint-matched scan transcripts. Resume/engine upgrades also preserve field corrections when every source hash is unchanged. The interface distinguishes these operations. Two browser batch workers send at most ten emails each; each server batch parses at most two cases concurrently. Database results are loaded and saved in batches. Idempotent skipSaved retries reuse current-engine results, so concurrent resume does not create duplicate events. Pause finishes in-flight batches; reload can resume saved progress. This is a bounded interactive workflow, not a durable background queue.

## Parser design

- TXT: strict UTF-8, with source line numbers.
- DOCX: read Word XML without executing macros; preserve paragraph and line-break boundaries.
- XLSX: read workbook relationships, shared/inline strings and values from non-formula cells. Formula and error cells are rejected, even when a formula has a cached result; no formula is evaluated. Cell references accompany extracted values.
- PDF: read text items with page and vertical-position evidence. Explicit total-weight fragments on the same baseline can be recombined; nearby item weights are not substituted.
- Image-only PDFs: NEEDS_REVIEW, with optional browser-local English OCR suggestions. The original image and proposed values remain visible; users must confirm the role, every field and source page, reviewer name and reason. The server validates the unchanged SHA-256 and existing page count before comparing. Corrupt PDFs require replacement and cannot be approved through this route.

Archive expansion, file size, page count and extracted-text limits bound processing. Whole container expressions are consumed; supported compound counts are summed. Missing markers and conflicting repeated labels remain uncertain. Numbers are never accepted merely because their prefix parses. SAME AS CONSIGNEE is recomputed after human edits. Missing attachment requests remain visibly unverified, even when the organiser output convention uses OK. Source excerpts are highlighted from field evidence, and normalized values are visible beside raw values.

## Security boundaries and production gaps

This is a hackathon prototype using synthetic data. A random session cookie is a capability, not enterprise identity. Reviewer names are self-declared and visibly labelled as such. Public demo visitors receive separate workspaces; this is not staff authentication. Parameterized queries scope cases, revisions, policy tokens and sources to the workspace. The origin check uses the configured public origin on a reverse-proxied host and does not trust arbitrary forwarded-origin headers.

Implemented: HttpOnly/SameSite cookie, Secure in production, no-store responses, parameterized SQL, stale-write detection, ZIP expansion limits, file-type limits, escaped React text, SHA-256 file fingerprints and no automatic email sending. Routing, exact comparison and local OCR do not transmit data to OpenAI. Optional recovery and case chat **do transmit the consented, bounded text packet** through the server; the API key stays server-side. These controls do not establish zero provider retention, hallucination immunity or enterprise data-policy approval.

Not implemented: corporate SSO/RBAC, independently verified reviewer identity, tenant administration, malware scanning, formal retention/deletion schedules, legal-compliance certification, WORM/tamper-proof audit storage, background queues, rate limiting across sessions, or live Outlook/SAP/carrier connectors. OCR is English-only and human-confirmed, not an unattended clearance engine. Do not use real customer documents until production controls and a security review exist.

Cloud is meaningful: processing, uploaded documents, decisions and audit events all live in cloud services after deployment; hosting is not merely a static front end.

## Scaling plan and trade-offs

The demo favours a small, inspectable deployment: one Node application, bounded interactive batches and transactional libSQL persistence. Keeping small originals with saved results simplifies this prototype, but database bytes, free-host sleep and interactive processing are real limits. The 21 September release reduced the measured supplied-corpus queue payload by 59.5%; that is not a throughput or latency guarantee.

Before a larger rollout, the proposed sequence is: (1) approve staff identity/roles, data handling, retention and security controls; (2) run a supervised evaluation on approved new material; (3) move large originals to managed object storage with versioned access, and introduce a durable job queue and bounded workers; (4) measure concurrent load, recovery, storage growth and cost before choosing capacity. Live mailbox/ERP connectors require separate approval and are future work. No production load certification, employee time-saving result or rollout commitment is claimed.
