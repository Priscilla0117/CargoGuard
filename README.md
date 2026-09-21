# CargoGuard — Averis shipping document verification

An evidence-first hackathon prototype that classifies operational emails, compares Shipping Instructions (SI) with draft Bills of Lading (BL), and keeps uncertain cases with a human.

Public cloud demo: **https://cargoguard-averis.onrender.com/**. See [the verified cloud release and operating limits](docs/CLOUD_RELEASE.md). Free hosting can take 50 seconds or more to wake after inactivity.

Version 3.1 is deployed with a stronger learned router, optional source-linked OpenAI evidence recovery and an operational evidence handoff. Judges use the public link without an API key; bounded requests use the owner's server-side key. Read [the AI upgrade and honest evaluation boundaries](docs/AI_UPGRADE.md), [dated live acceptance evidence](docs/CLOUD_RELEASE.md), and [the two-file unfamiliar-layout demonstration](examples/evidence-recovery/README.md).

## What you can do

1. Open the app and click **Run inbox** to process all 520 organiser emails.
2. Open a discrepancy to compare all seven fields and inspect the original evidence.
3. Use **New verification** with your own synthetic TXT, PDF, DOCX or XLSX pair.
4. Use **Correct value** only after inspecting the source. A reviewer name and reason are required.
5. Use **Replace documents** to resolve missing, damaged or revised files in the same case.
6. Download an amendment draft (nothing is sent), print the case, or export the organiser submission once all 520 are processed.
7. See measured validation in Performance and recorded actions in Audit trail.
8. Use **Confirm category** for uncertain or incorrect email routing. The reviewer decision is version-checked and audited.
9. For an image-only PDF, open **Documents → Read scan with local OCR**. Inspect the displayed original, correct every suggested value, select the document role and confirm all seven fields before saving. This is assisted transcription, not unattended scan approval.
10. For unfamiliar readable layouts, use **Documents → Evidence Recovery Copilot** after explicit synthetic-data consent. Verify every source quotation before confirming the role and all seven fields. AI proposals alone never change the saved decision.
11. Open **Resolution** for a deterministic next-action checklist and downloadable evidence handoff; nothing is sent automatically.

Engine 3.0 adds immutable full decision snapshots, separate automatic/reviewed exports, versioned business-tolerance previews, better current-message routing, conservative optional-port-code equivalence, and a standard Next.js deployment independent of ChatGPT Sites. It retains the v2 safety checks, OCR assistance, uploads and source fingerprints. See [the upgrade evidence and remaining release gate](docs/V3_TECHNICAL_UPGRADE.md) and [the independent deployment guide](docs/DEPLOYMENT.md).

For a quick unseen-input demo, upload examples/demo-si.txt + examples/demo-bl.txt. Then replace them with demo-si.txt + demo-bl-revised.txt.

## Start locally

Requires Node.js >=22.13, npm and Git for source control. Python is optional and used only by the offline organiser scoring script. No AI key is needed.

Run from this project folder:

```powershell
npm ci
$env:CARGO_LOCAL_DB='work/local.db'
New-Item -ItemType Directory -Force work
npm run db:migrate
npm run dev
```

Open http://localhost:3000. On Windows, if a PATH shim breaks npm, use `& 'C:\Program Files\nodejs\npm.cmd'`. Local SQLite is for QA only. Render startup refuses a local database and requires persistent Turso credentials.

The initial database is empty. Inputs load immediately; decisions appear after processing. Results survive refresh in the same browser workspace. Clearing cookies starts a different workspace; it does not delete previously stored data.

## Test and reproduce

```powershell
npm test
npm run typecheck
npm run lint
npm run evaluate
python scripts/score-evaluation.py
npm run test:api
npm run test:hardening -- http://127.0.0.1:3000
npm run test:governance -- http://127.0.0.1:3000
npm run build
```

Run test:api while the local app is running. It creates an isolated test workspace, not changes to the visible user's workspace. Evaluation expects the original organiser folders as siblings of cargoguard. To evaluate another permitted input bundle: `node --import tsx scripts/evaluate.ts "C:\path\to\bundle"`.

The offline score script reads ../sdoc-hackathon-docker/data_v2/ground_truth.json and imports the organiser's unmodified scorer. Application code does not read the key. Evaluation output is in work/validation/v3/original; aggregate public metrics are regenerated in public/validation.json. Keep all answer keys and per-ID prediction artifacts outside published application inputs.

Latest verified engineering evidence:

- 520/520 organiser output objects match on the supplied development corpus.
- 46/46 discrepancy cases and 20/20 review cases identified.
- 197 regression tests across all eleven discovered test files, including 400 generated compound-count checks and isolated PDF resource loading, passed. The earlier 126-test gate omitted an inherited file; see the defensibility record.
- 72 original-inbox and baseline-export HTTP checks passed on the independent Node build.
- 35 additional local hardening checks passed across 73 requests: concurrent saves/replacements, idempotent resume, scan confirmation, bounded requests, per-workspace file access and atomic upload quotas.
- TypeScript validation, full lint and production build passed. Run `npm run quality` to reproduce the static/unit/input-integrity gate; `-- --build` adds a production build.
- Both organiser folders and embedded runtime data were checked: all 520 emails and 250 document byte sequences agree.
- Four additional 520-email same-generator development sets match all expected outputs after fixes: 2,600/2,600 total exact decisions. They informed development and are not independent held-out tests.
- The original 12 targeted HarborCheck-comparison probes now all pass. This diagnostic set is not a general accuracy benchmark.
- 23 additional governance HTTP checks passed, covering policy activation races, stale previews, immutable history, historical source access and labelled exports.
- The prior OCR evaluation read all six supplied scanned PDFs; a scanned-document browser workflow was also checked on the v3 production build. Candidate values still contain OCR mistakes: seven-field human confirmation is mandatory.

These are development-corpus and engineering results, not an untouched hold-out test or a guarantee of real-world accuracy. See docs/MODEL_CARD.md for methodology and limitations.

## Stack and source map

| Area | Source |
|---|---|
| Main React workbench | components/workbench.tsx |
| Hybrid learned email classifier | lib/classifier.ts |
| TXT/PDF/DOCX/XLSX readers | lib/parsers.ts |
| Evidence extraction, normalization, comparison | lib/compare.ts; lib/normalization.ts |
| Scan suggestions and source-confirmed transcription | components/scan-assist.tsx; lib/ocr.ts; lib/transcription.ts |
| API routes | app/api/ |
| Transactional workspace and audit persistence | lib/storage.ts; lib/runtime-node.ts; db/schema.ts |
| Versioned SQL migrations, including integrity triggers | drizzle/ |
| Original input bundle import | scripts/import-bundle.mjs; data/bundle.json |
| Offline evaluation | scripts/evaluate.ts; scripts/score-evaluation.py |
| Regression/integration tests | tests/; scripts/test-api.mjs; scripts/test-hardening-api.mjs; scripts/quality-gate.mjs |

The default is standard Next.js/Node.js, deployed on Render Free with a persistent Turso libSQL database. Decisions, revisions, policy versions and small uploaded originals live in the external database, not Render's temporary disk. Browser OCR remains local. The legacy Worker adapter is retained separately; it is not required by the default build.

## Data contract

The five categories are BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL and SPAM. The seven fields are shipper, consignee, notify_party, port_of_loading, port_of_discharge, container_count and gross_weight_kg.

The **automatic baseline** export is a JSON object keyed by the 520 supplied email IDs, using the earliest provably automatic revision from the current engine. Each value contains category, status, review_reason, has_defect and defect_fields. Human-influenced, replaced-source and undocumented legacy snapshots are excluded. If an older workspace has no untouched baseline, run the inbox in a fresh private-browser workspace; do not erase reviews. The **reviewed evidence** export is separately labelled and includes current result, source and policy information; it must not be reported as automatic accuracy. The organiser's NEEDS_REVIEW reasons are wrong_doc_type, missing_attachment, unreadable and missing_value. The app additionally supports uncertain_category for novel ambiguous routing. New uploads are excluded from the organiser baseline.

Policy laboratory supports bounded kilogram and SI-relative percentage tolerances. If both are enabled, both must be satisfied. Preview and justification are mandatory; activation is version-checked against both policy and case state. Policies annotate exceptions but NEVER hide a strict mismatch, skip any of the seven fields, or approve a shipment. Reprocessing uses a captured policy; manual corrections retain their result's policy snapshot. Rollback means recording earlier settings as a new version.

The app deliberately separates **Awaiting documents** from **Verified**. The organiser schema marks 91 requests without attachments OK; this is preserved for compatibility, but the UI never calls them verified.

## Deployment

The independent public deployment is **live**. Follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) to reproduce it and [docs/CLOUD_RELEASE.md](docs/CLOUD_RELEASE.md) for its exact commit, hosted test evidence, restart verification and limitations. Both provider plans were verified Free. Installation itself does not create accounts or provision resources.

To verify the default production build locally with the same QA database:

```powershell
npm run build
npm start
```

Render Free sleeps after 15 idle minutes and can take about a minute to wake. Turso credentials remain server-only. Leave paid overages disabled, check quotas before judging, and open the actual demo shortly before the presentation. This is not an always-on production SLA. The old hosted v2 deployment and its data have not been changed or deleted.

A private URL is not a judge-accessible public submission. Confirm public access explicitly and test signed out. Public GitHub repository creation, team submission, recording and slides are separate actions that must be completed before the deadline.

## Safe use and limits

Use only synthetic hackathon data. This prototype is not certified for production customer documents. It has no corporate SSO/RBAC, verified reviewer identity, antivirus, formal retention policy, or live corporate inbox connection. See docs/ARCHITECTURE.md for the security boundary.

Uploads: two files per case, <=5 MB each, TXT/PDF/DOCX/XLSX, 30 uploaded cases per browser workspace with an atomic database quota. The Node demo also caps total uploaded bytes at 256 MB, including retained historical sources. PDF text limit: 30 pages. ZIP expansion, streamed requests and extracted text are bounded. Spreadsheet formulas must have cached values. Image-only scans remain in review until replaced or explicitly transcribed by a human using optional OCR assistance.

OCR uses Tesseract.js with the English model, in a browser worker, for up to five pages and a three-minute task timeout. Its runtime/model assets are served by this app, not an external AI endpoint. The first invocation downloads several MB; model confidence is not calibrated accuracy. Corrupt PDFs cannot use scan confirmation. Source page references and SHA-256 are validated on save. A confirmed transcript survives reprocessing only while the source fingerprint matches. Replacing the documents clears the transcript. Explicit reprocess resets individual field edits; ordinary resume/engine upgrades preserve reviewed fields on identical sources.

Tesseract.js and its core use Apache-2.0; the English data package declares MIT. Local staging includes runtime license notices. See [Tesseract.js documentation](https://github.com/naptha/tesseract.js) and [language-data package](https://github.com/naptha/tessdata). Original OCR text is not treated as a command or automatically trusted shipment data.

Company names and ports are compared conservatively, not fuzzy-matched. Unfamiliar labels/layouts can require review. Nothing is automatically approved with missing field values; no carrier emails or ERP changes are made.

## Competition handover

- docs/DEMO_SCRIPT.md: five-minute walkthrough and live-demo fallback.
- docs/ARCHITECTURE.md: implementation, cloud role and production gaps.
- docs/MODEL_CARD.md: AI and honest validation claims.
- docs/REQUIREMENTS.md: rubric/requirement traceability and outstanding submission actions.

Organiser files remain unchanged. This project uses open-source libraries and AI-assisted implementation; the team must follow the event's attribution/originality rules and confirm work occurred within its allowed window. Do not claim guaranteed championship or zero future bugs.
