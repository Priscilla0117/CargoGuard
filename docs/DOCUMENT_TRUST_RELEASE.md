# Document trust and continuous mailbox intake — 3.5.0

This release addresses the mixed-PDF amendment failure and reduces the reported formatting false alarms. It remains a supervised document assistant. Passing the supplied development examples is not evidence of operational accuracy on unseen shipments.

## PDF checks and recovery

PDF extraction now records coverage for each page. Pages without readable text, pages containing images, visual annotations/forms, or shapes painted after text require visual inspection. Readable values remain available as a **partial comparison**; they cannot produce verification or case completion until the unresolved content is reviewed. Existing AI recovery, individual reading corrections and document selection cannot bypass this requirement.

The regression fixture contains 42,000 KG in page-one text and a scanned page-two amendment to 43,000 KG. It starts in Needs review. Confirming the amendment produces a gross-weight mismatch, retains the original PDF and readable text, and records the reviewer, reason, source fingerprint and page references in history.

The document action opens the affected source. Reviewers can use browser-local English OCR or inspect rendered original pages manually. Readable values are prefilled; OCR suggestions and every authoritative field still require confirmation. Every flagged page must be opened and acknowledged. Known invoices cannot be relabelled as SI or BL through scan confirmation.

This is deliberately conservative: logos, table borders and harmless annotations may also require review. It does not establish that every conceivable PDF rendering technique is interpreted correctly. Manual/OCR review supports five pages and 5 MB; larger or unsupported files have a replacement route. Arbitrary conflicting values require clarification, not a guess. Original documents are never silently rewritten.

The processing version is now **3.5.0**. Recheck saved cases before completion; older scan confirmations without page coverage are not reused as clearance.

## Formatting and dependent fields

Validated Savannah/USSAV and Houston/USHOU forms are recognized, including the tested country/code variants. Container expressions such as `2 x 40HC containers` are accepted. Contradictory known port/code combinations, quantities and units remain reviewable. Existing consignee/“same as consignee” explanations retain each field result while describing the dependency.

## Background mailbox intake

Apply migrations through `0014_mail_worker.sql`. `npm start` applies these and can supervise both the website and the intake worker. Enable team mode and `CARGO_MAIL_WORKER_ENABLED=true`, connect a mailbox and enable its Automatic import setting. Deploy on an always-on Node host; a stopped laptop or sleeping host cannot poll.

The worker uses existing durable cursors, import identities and fenced leases. It checks active membership and the current mailbox authority again before saving. Oldest attempts are considered first, with bounded batches and continuation past invalid accounts. Mailbox settings distinguish last successful synchronization, latest attempt/error and worker status. Disabling Automatic import, disconnecting or revoking access stops further intake.

This worker only imports. It cannot draft or send messages; existing employee-reviewed send and uncertain-delivery reconciliation remain separate. See [Gmail setup](GMAIL_SETUP.md) for configuration and provider limitations. This is bounded persistent polling, not a distributed processing queue.

## Validation and remaining acceptance

Local regression tests cover mixed/image-only PDFs, textual amendments, images on otherwise readable pages, annotations, covering shapes, source-bound confirmation, forbidden role changes, normalization and worker restart/deduplication/access changes. HTTP acceptance covers upload, rejected incomplete confirmations, blocked completion, authoritative amendment confirmation, immutable source download and historical revisions. The actual Node supervisor is tested for startup, heartbeat, natural worker exit, closed listening port and no orphan children.

On 25 September 2026, typecheck, lint, all **721 tests**, input-integrity checks and the production build passed. The supplied development corpus retained **520/520 exact output agreement**. Local HTTP checks passed: API 74, governance 26, hardening 36, operational workflow 24 and document trust 8. Browser walkthroughs confirmed page-two opening, prefilled values, mandatory confirmations, the saved 43,000 KG mismatch and its page-two source link. Browser-local OCR also surfaced the conflicting 42,000/43,000 KG values without accepting either automatically. These are development and synthetic acceptance results, not an independent field trial.

Reproduce the automated checks from the repository root:

```text
node scripts/quality-gate.mjs --build
node scripts/test-mail-supervisor.mjs
node --import tsx scripts/test-document-trust-api.ts http://127.0.0.1:5200
node --import tsx scripts/test-averis-workflow-api.ts http://127.0.0.1:5200
node scripts/test-api.mjs http://127.0.0.1:5200
node scripts/test-hardening-api.mjs http://127.0.0.1:5200
node scripts/test-governance-api.mjs http://127.0.0.1:5200
```

The HTTP scripts require a separately started, isolated local demo server with a fresh local database, synthetic samples enabled, and external AI/mail sending disabled. The quality gate needs the organizer bundles and a Python runtime (`CARGO_PYTHON` can select it).

**Still required before an operational pilot:**

- Real Gmail acceptance on the intended test installation: new/duplicate messages, missing attachments, revised BL replies, interrupted connections, browser closure and service restarts. Local provider mocks and supervisor checks do not validate Google OAuth, live conversation threading, quotas or delivery.
- An independently labelled, anonymized set of 30–50 unseen cases frozen before evaluation, plus measured operator handling times. Use the [pilot evaluation procedure](PILOT_EVALUATION.md). The tooling verifies hashes and computes metrics; it cannot certify human labels, consent, independence or time measurements.
- Report observed missed discrepancies, false alarms, abstention workload and paired handling times, including failures. No production accuracy or workload saving is claimed by this release.
