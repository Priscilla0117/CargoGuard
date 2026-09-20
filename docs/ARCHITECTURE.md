# CargoGuard architecture

## What runs where

The browser displays the inbox, comparisons, evidence, uploads and reviewer forms. On request, a local browser worker proposes OCR text from scanned PDFs. It does not receive an answer key or make the authoritative comparison decision. Heavy PDF/OCR code is loaded on demand.

Cloudflare Workers runs the email classifier, document parsers, normalization, comparison and API validation. D1 stores versioned case results and append-only application audit events. R2 stores uploaded original documents. The supplied synthetic inbox is a server-side input bundle. Each browser gets a random HttpOnly workspace cookie.

Processing flow: email → learned intent classifier + explicit intent rules → document type and readability checks → seven evidence-linked fields → typed comparison → verified, discrepancy, review, awaiting documents or routed → D1 result + audit event.

## Why this fits Averis

The work starts with an operational inbox, not a chatbot. Staff see which shipments need attention, the exact SI and BL values, and the page/line/cell supporting each value. The SI is always the reference. Staff can correct an extraction, upload a revised document pair and prepare a draft amendment request. Nothing is sent to a carrier automatically.

AI handles noisy email intent. Deterministic comparison keeps shipment facts predictable and inspectable. Failure becomes a review task, not a silent success.

## API contract

| Endpoint | Purpose | Safeguards |
|---|---|---|
| GET /api/inbox | 520 organiser records plus this workspace's uploads | Session-scoped D1 query |
| POST /api/cases | Process up to 10 IDs, correct a field, confirm category, or confirm a scan transcript | Bounded schema/body, origin check, optimistic version; seven confirmations, page references and source hash for scans |
| GET /api/cases?id=… | Result and latest 100 case audit events | Session-scoped |
| GET /api/cases?export=1 | Organiser JSON for exactly the 520 supplied IDs | Rejects incomplete exports; uploaded cases excluded |
| POST /api/upload | Create a case or replace both documents in one case | Maximum two files, 5 MB/file, four allowed extensions, random R2 keys |
| GET /api/document | Retrieve a current source attachment | Case membership and workspace check; no arbitrary file path |

## Storage and concurrency

Cases have composite key (workspace, email_id). Updates require the expected version. One D1 transaction updates each result and writes its audit event only if the version update succeeded. Stale reviewer saves and conflicting replacements are rejected. File replacement uses new random names rather than overwriting originals. New R2 objects are cleaned up only when they are known not to be referenced by a committed case. If database status is unknown, retaining possible orphans is safer than deleting committed evidence; an operational retention/cleanup service remains future work. The 30-upload quota is checked atomically during insertion as well as before expensive parsing.

Explicit reprocess reads current source bytes and resets individual extraction corrections, retaining confirmed categories and fingerprint-matched scan transcripts. Resume/engine upgrades also preserve field corrections when every source hash is unchanged. The interface distinguishes these operations. Two browser batch workers send at most ten emails each; each server batch parses at most two cases concurrently. Database results are loaded and saved in batches. Idempotent skipSaved retries reuse current-engine results, so concurrent resume does not create duplicate events. Pause finishes in-flight batches; reload can resume saved progress. This is a bounded interactive workflow, not a durable background queue.

## Parser design

- TXT: strict UTF-8, with source line numbers.
- DOCX: read Word XML without executing macros; preserve paragraph and line-break boundaries.
- XLSX: read workbook relationships, shared/inline strings and cached cell values. Never evaluate formulas. Cell references accompany extracted values.
- PDF: read text items with page and vertical-position evidence. Explicit total-weight fragments on the same baseline can be recombined; nearby item weights are not substituted.
- Image-only PDFs: NEEDS_REVIEW, with optional browser-local English OCR suggestions. The original image and proposed values remain visible; users must confirm the role, every field and source page, reviewer name and reason. The server validates the unchanged SHA-256 and existing page count before comparing. Corrupt PDFs require replacement and cannot be approved through this route.

Archive expansion, file size, page count and extracted-text limits bound processing. Whole container expressions are consumed; supported compound counts are summed. Missing markers and conflicting repeated labels remain uncertain. Numbers are never accepted merely because their prefix parses. SAME AS CONSIGNEE is recomputed after human edits. Missing attachment requests remain visibly unverified, even when the organiser output convention uses OK. Source excerpts are highlighted from field evidence, and normalized values are visible beside raw values.

## Security boundaries and production gaps

This is a hackathon prototype using synthetic data. A random session cookie is a capability, not enterprise identity. Reviewer names are self-declared. The deployment's site-access layer can restrict who visits; D1 workspace isolation is additionally enforced by the app.

Implemented: HttpOnly/SameSite cookie, Secure in production, no-store responses, parameterized SQL, stale-write detection, ZIP expansion limits, file-type limits, escaped React text, SHA-256 file fingerprints, no automatic email sending, and no external AI transmission.

Not implemented: corporate SSO/RBAC, independently verified reviewer identity, tenant administration, malware scanning, formal retention/deletion schedules, legal-compliance certification, WORM/tamper-proof audit storage, background queues, rate limiting across sessions, or live Outlook/SAP/carrier connectors. OCR is English-only and human-confirmed, not an unattended clearance engine. Do not use real customer documents until production controls and a security review exist.

Cloud is meaningful: processing, uploaded documents, decisions and audit events all live in cloud services after deployment; hosting is not merely a static front end.
