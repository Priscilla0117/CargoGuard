# CargoGuard — Averis shipping document verification

An evidence-first hackathon prototype that classifies operational emails, compares Shipping Instructions (SI) with draft Bills of Lading (BL), and keeps uncertain cases with a human.

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

Engine 2.0 adds conservative whole-expression numeric validation, missing-marker and duplicate-field checks, dependency-aware human corrections, recoverable/idempotent batch processing and measured request/batch latency. Original bytes are fingerprinted and never rewritten by a reviewer edit.

For a quick unseen-input demo, upload examples/demo-si.txt + examples/demo-bl.txt. Then replace them with demo-si.txt + demo-bl-revised.txt.

## Start locally

Requires Node.js >=22.13, npm and Git for source control. Python is optional and used only by the offline organiser scoring script. No AI key is needed.

Run from this project folder:

```powershell
npm run install:ci
npm run db:local
npm run dev
```

Open the Local URL printed by the server (normally http://localhost:5173). On Windows, if a PATH shim breaks npm, use `& 'C:\Program Files\nodejs\npm.cmd' run install:ci`. The direct development command is `node scripts/run-framework.mjs dev`.

The initial database is empty. Inputs load immediately; decisions appear after processing. Results survive refresh in the same browser workspace. Clearing cookies starts a different workspace; it does not delete previously stored data.

## Test and reproduce

```powershell
npm test
npm run typecheck
npm run lint
npm run evaluate
python scripts/score-evaluation.py
npm run test:api
npm run test:hardening -- http://127.0.0.1:5174
npm run build
```

Run test:api while the local app is running. It creates an isolated test workspace, not changes to the visible user's workspace. Evaluation expects the original organiser folders as siblings of cargoguard. To evaluate another permitted input bundle: `node --import tsx scripts/evaluate.ts "C:\path\to\bundle"`.

The offline score script reads ../sdoc-hackathon-docker/data_v2/ground_truth.json and imports the organiser's unmodified scorer. Application code does not read the key. Evaluation output is in work/evaluation; aggregate public metrics are regenerated in public/validation.json. Keep all answer keys and per-ID prediction artifacts outside published application inputs.

Latest verified engineering evidence:

- 520/520 organiser output objects match on the supplied development corpus.
- 46/46 discrepancy cases and 20/20 review cases identified.
- 114 regression tests, including 400 generated compound-count checks, passed.
- 70 local Worker/D1/R2 integration checks passed.
- 35 additional local hardening checks passed across 73 requests: concurrent saves/replacements, idempotent resume, scan confirmation, bounded requests, per-workspace file access and atomic upload quotas.
- TypeScript validation, full lint and production build passed. Run `npm run quality` to reproduce the static/unit/input-integrity gate; `-- --build` adds a production build.
- Both organiser folders and embedded runtime data were checked: all 520 emails and 250 document byte sequences agree.
- Three additional 520-email same-generator development sets match all expected outputs after fixes. They informed development and are not independent held-out tests.
- All six supplied scanned PDFs were OCR-read. Candidate values still contain OCR mistakes: seven-field human confirmation is mandatory.

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
| D1 workspace and audit persistence | lib/storage.ts; db/schema.ts |
| Generated SQL migration | drizzle/ |
| Original input bundle import | scripts/import-bundle.mjs; data/bundle.json |
| Offline evaluation | scripts/evaluate.ts; scripts/score-evaluation.py |
| Regression/integration tests | tests/; scripts/test-api.mjs; scripts/test-hardening-api.mjs; scripts/quality-gate.mjs |

React/Vinext runs on a Cloudflare Worker. D1 stores decisions and audit events; R2 stores uploaded original documents. The cloud role is real processing and persistence, not just front-end hosting.

## Data contract

The five categories are BL_COMPARISON, SI_REQUEST, INVOICE_QUERY, GENERAL and SPAM. The seven fields are shipper, consignee, notify_party, port_of_loading, port_of_discharge, container_count and gross_weight_kg.

The complete export is a JSON object keyed by the 520 supplied email IDs. Each value contains category, status, review_reason, has_defect and defect_fields. The organiser's NEEDS_REVIEW reasons are wrong_doc_type, missing_attachment, unreadable and missing_value. The app additionally uses uncertain_category for novel ambiguous routing; this does not occur in the tested automatic organiser export. New uploaded cases are excluded from that export.

The app deliberately separates **Awaiting documents** from **Verified**. The organiser schema marks 91 requests without attachments OK; this is preserved for compatibility, but the UI never calls them verified.

## Deployment

The registered Site is recorded in .openai/hosting.json. Do not create another registration or commit credentials. Build from the exact source revision before publishing. The build stages logical D1/R2 bindings and generated migrations under dist/.openai. Source repository access and site-audience settings are managed separately.

The development profile is portable on Windows. Production uses the emitted Worker in dist/server and static client assets in dist/client. To inspect the built Worker locally:

```powershell
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .wrangler/state --ip 127.0.0.1 --inspector-port 0 --port 5174
```

The provided local migration configuration is for local development only. The hosting platform owns the real D1/R2 resources.

A private URL is not a judge-accessible public submission. Confirm public access explicitly and test signed out. Public GitHub repository creation, team submission, recording and slides are separate actions that must be completed before the deadline.

## Safe use and limits

Use only synthetic hackathon data. This prototype is not certified for production customer documents. It has no corporate SSO/RBAC, verified reviewer identity, antivirus, formal retention policy, or live corporate inbox connection. See docs/ARCHITECTURE.md for the security boundary.

Uploads: two files per case, <=5 MB each, TXT/PDF/DOCX/XLSX, 30 uploaded cases per browser workspace with an atomic database quota. PDF text limit: 30 pages. ZIP expansion, streamed requests and extracted text are bounded. Spreadsheet formulas must have cached values. Image-only scans remain in review until replaced or explicitly transcribed by a human using optional OCR assistance.

OCR uses Tesseract.js with the English model, in a browser worker, for up to five pages and a three-minute task timeout. Its runtime/model assets are served by this app, not an external AI endpoint. The first invocation downloads several MB; model confidence is not calibrated accuracy. Corrupt PDFs cannot use scan confirmation. Source page references and SHA-256 are validated on save. A confirmed transcript survives reprocessing only while the source fingerprint matches. Replacing the documents clears the transcript. Explicit reprocess resets individual field edits; ordinary resume/engine upgrades preserve reviewed fields on identical sources.

Tesseract.js and its core use Apache-2.0; the English data package declares MIT. Local staging includes runtime license notices. See [Tesseract.js documentation](https://github.com/naptha/tesseract.js) and [language-data package](https://github.com/naptha/tessdata). Original OCR text is not treated as a command or automatically trusted shipment data.

Company names and ports are compared conservatively, not fuzzy-matched. Unfamiliar labels/layouts can require review. Nothing is automatically approved with missing field values; no carrier emails or ERP changes are made.

## Competition handover

- docs/DEMO_SCRIPT.md: five-minute walkthrough and live-demo fallback.
- docs/ARCHITECTURE.md: implementation, cloud role and production gaps.
- docs/MODEL_CARD.md: AI and honest validation claims.
- docs/REQUIREMENTS.md: rubric/requirement traceability and outstanding submission actions.

Organiser files remain unchanged. This project uses open-source libraries and AI-assisted implementation; the team must follow the event's attribution/originality rules and confirm work occurred within its allowed window. Do not claim guaranteed championship or zero future bugs.
