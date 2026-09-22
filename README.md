# CargoGuard
## Shipping document verification for Averis

**Team MozartAI:** Ng Ern Chi and Chan Kar Jun

**Hackathon:** Averis x Monash Hackathon 2026

**Application:** CargoGuard 3.2.1

CargoGuard helps shipping operations staff find document-checking requests, extract shipment details, compare a draft Bill of Lading (BL) against its Shipping Instruction (SI), and follow up with evidence. Unreadable, missing or uncertain information goes to a person for review. A matching document pair is not permission to release a shipment.

- **Public prototype:** [Open CargoGuard](https://cargoguard-averis.onrender.com/)
- **Source:** [Priscilla0117/CargoGuard, main branch](https://github.com/Priscilla0117/CargoGuard/tree/main)
- **Submission documentation:** this README, [architecture](docs/ARCHITECTURE.md) and [requirements/evidence map](docs/REQUIREMENTS.md)
- **Recording materials:** [natural voiceover](docs/RECORDING_VOICEOVER.md) and [click-by-click guide](docs/RECORDING_RUNBOOK.md)
- **Readiness and outstanding submission items:** [submission check](docs/SUBMISSION_CHECK.md)

Judges do not need a ChatGPT account, an OpenAI account or their own API key. The optional assistant uses the owner's server-side key, consent and shared limits. Free hosting can take around a minute to wake; provider capacity and AI availability are not guaranteed. Use only organiser or synthetic documents.

**Latest verification — 22 September 2026:** production build, 350 unit tests and 228 local HTTP checks passed; the independently scored HTTP export matched all 520 supplied development outputs. Public liveness, readiness and page requests returned HTTP 200. See [scope and outstanding submission items](docs/SUBMISSION_CHECK.md); these checks are not an uptime or unseen-accuracy guarantee.

## Try the working prototype

1. Open the public link. Choose **Run inbox** if results have not yet been processed.
2. Find **email_313**. On **Check**, inspect all seven fields. Its documents disagree on container count (five versus four) and gross weight (500 kg).
3. Open a source reference to inspect the evidence. **email_512** demonstrates scan review; **email_507** demonstrates a missing draft. These are incomplete cases, not successful verifications.
4. Open floating **Ask CargoGuard**, select the case and review the outgoing data before consenting. Check its answer against the cited sources. If the provider or allowance is unavailable, the core comparison and manual review still work.
5. For the labelled synthetic multi-file demo, import the four files in [tests/fixtures/intake](tests/fixtures/intake). Explicitly select the SI and draft to compare. Other attachments remain retained but not verified.
6. Preview a field change before saving. Only save a value confirmed against its source, with a reviewer name and reason. **History** retains earlier decisions and original files. Nothing automatically sends a carrier email or approves cargo.

Follow the [recording guide](docs/RECORDING_RUNBOOK.md) for the exact source-selection, temporary preview and saved-confirmation sequence. Supplied and synthetic examples are development demonstrations, not unseen accuracy tests.

## Written responses

### 1. Problem-solution alignment

Averis shipping operations staff receive a mixed inbox: document-checking requests, shipping instructions, invoice queries, general messages and spam. For checking requests, they must compare two documents that may use different headings and layouts, identify the precise differences and decide what to request next.

CargoGuard determines the email category before shipment-field extraction and comparison. Attachments may already be parsed for text and routing context, but only comparison requests continue to field extraction and checking. The SI is the reference for seven fields: **shipper, consignee, notify party, port of loading, port of discharge, container count and gross weight in kilograms**. The report identifies the email, displays the two values and their sources, and distinguishes mismatches from missing or unreadable evidence. A person can inspect, confirm or correct information and obtain an updated report.

Useful additions address handover and review: explicit source-pair selection, a linked-field correction preview, retained decision history, a checked amendment draft and evidence-linked case chat. Other email categories are classified only; the prototype does not fulfil invoice requests or generate shipping instructions.

### 2. AI and cloud infrastructure integration

The main email router is a trained **TF-IDF multinomial logistic regression model** with word, word-pair and character features. It runs on the server without an API key. Training uses independently authored synthetic examples, not the organiser answer key. Safety checks can abstain when intent is unclear.

On the 520 supplied development emails, the current router made 513 direct learned decisions and seven learned decisions corroborated by an agreeing rule. A rule cannot replace the learned category. These counts describe routing paths, not a separate benchmark score. See the [model evidence and limitations](docs/AI_UPGRADE.md).

**Render** runs the Next.js/Node.js server and document pipeline. **Turso/libSQL** persists case results, original small uploads, revisions and review events. **OpenAI** supports optional source-quoted field recovery and case-specific explanations through server-side calls after explicit consent. Recovery requires source validation and human confirmation; chat cannot change saved decisions. **Tesseract.js** offers browser-local English OCR suggestions for scans.

Deterministic rules perform the final comparison. This keeps the core workflow usable when OpenAI is unavailable. Cloud services perform real processing and persistence, not just static-page hosting.

### 3. User feedback and testing

We used automated unit/integration tests, organiser-supplied inputs, targeted synthetic challenges and browser walkthroughs. The recorded laptop checks cover multi-file intake, source selection, linked-field previews, saves, history, direct chat and layout at 1366 x 768 and 1280 x 720.

Development feedback led to changes: ambiguous company blocks now require review; a reproduced phishing-report routing error received a targeted fix; preview and save share the same calculation; stale saves are rejected; smaller queue responses and bounded read retries improve failure handling. These changes have regression coverage.

**We have not conducted an Averis employee usability study.** Developer/browser testing is not employee feedback, and no customer testimonial, adoption figure or time-saving percentage is claimed. A supervised pilot would observe staff completing real tasks with approved non-confidential documents, measure review time and missed differences, and record their feedback. See [test scope](docs/REVIEW_WORKSPACE_V32.md#validation-and-limits).

### 4. Coding challenges / challenges faced

| Challenge | Implemented response | Evidence and boundary |
| --- | --- | --- |
| Several attachments could be the intended SI/BL pair | Explicit reviewer selection, file fingerprints, saved reason and visible exclusions | Intake/review tests; the reviewer still decides which draft is intended |
| One edit affects another field, such as “same as consignee” | Shared preview/save calculation and version-checked transactions | Dependent-field, preview/save-equivalence and stale-write tests |
| Database unavailability caused poor recovery behaviour | Separate process liveness from storage readiness; controlled failures and no automatic write replay | 12 recorded local fault checks; this does not remove provider outages |
| Large saved results made queue reads expensive | Fetch compact summaries and load full source evidence on demand | 706,990 versus 1,747,055 serialized bytes on supplied saved outputs: 59.5% smaller, not a claimed latency reduction |
| LLM recovery could select an incorrect or malformed value | Bounded output contract, verbatim source checks, unit validation and mandatory human confirmation | Dated real-provider development trials; quoting a source does not guarantee semantic correctness |

Implementation and incident details: [review workspace](docs/REVIEW_WORKSPACE_V32.md), [AI recovery](docs/AI_UPGRADE.md), [database incident](docs/DATABASE_INCIDENT_20260921.md).

### 5. Success metrics

The following are the **recorded 21 September 2026 release 3.2.1 results**, not a claim that all tests ran again today:

| Check | Recorded result |
| --- | --- |
| Actual cloud export, independently checked with the organiser scorer | 520/520 exact expected outputs on the supplied development corpus |
| Supplied edge cases | 46/46 defect cases and 20/20 review cases matched expected outputs |
| Unit tests | 350 passed; zero skipped |
| Local production HTTP checks | 228 passed |
| Local controlled storage-outage checks | 12 passed |
| Hosted checks | 170 HTTP acceptance checks plus seven retained-data checks = 177 |
| Original input integrity | 520 emails and 250 document byte sequences matched both organiser copies |

[Exact dated release evidence](docs/CLOUD_RELEASE.md) separates local, hosted, provider and historical runs. [Submission check](docs/SUBMISSION_CHECK.md) records the latest recheck without relabelling old results as new.

Four additional same-generator sets informed development. Including the original, 2,600 outputs matched, but they share templates and are **not independent real-world holdouts**. The separate 60-message routing challenge still exposes limitations, documented in [AI_UPGRADE.md](docs/AI_UPGRADE.md). OCR and LLM proposals can be wrong.

We have not measured production ROI. Proposed pilot measures are median review time, missed discrepancies/false clearances, unnecessary review referrals, correction rounds and staff task completion. Organiser scoring is a development aid, not a judging score or a guarantee of unseen accuracy.

### 6. Scalability plans / future roadmap

| Phase | Proposed work | Acceptance evidence before expanding |
| --- | --- | --- |
| Supervised non-confidential pilot | Observe staff tasks; evaluate new document layouts and operator feedback | Review-time baseline, missed/false differences and documented task feedback |
| Controlled confidential use | Corporate SSO/RBAC, verified reviewer identity, malware checks, approved data-retention/deletion and provider data handling | Security/access tests, retention approval and operational ownership |
| Larger workloads | Durable job queues, retry/idempotency controls, managed object storage and monitored database capacity | Load tests with p95 latency, memory, backlog, recovery and cost measurements |
| Enterprise integration | Permissioned Outlook/SAP/carrier adapters and operational monitoring | Integration tests, auditability and business approval before any external action |

These are planned capabilities, not features already delivered. The current free-tier demo uses bounded batches and small-file database storage; it is not an always-on enterprise service.

## Technical architecture

| Component | Technology and responsibility |
| --- | --- |
| Browser | React/Next.js interface, Work queue, Reports, source inspection, field preview and consent |
| Local scan assistance | Tesseract.js English OCR in a browser worker; proposed values require human confirmation |
| Application server | Next.js/Node.js on Render; classification, TXT/PDF/DOCX/XLSX parsing, normalization, exact comparison and validated APIs |
| Persistent database | Turso/libSQL with Drizzle SQL migrations; workspace-scoped cases, original uploads, saved revisions and audit events |
| Optional external AI | OpenAI API with server-only credentials, explicit consent, bounded context and persistent usage reservations |
| Availability checks | `/api/live` checks the process; `/api/health` checks database/schema readiness. A healthy process alone does not prove a working database |

The [architecture document](docs/ARCHITECTURE.md) explains data flow, API contracts, transactions, dependencies and security boundaries. The legacy Worker adapter is historical/optional and is not the default Render deployment.

## Implementation details

- **Classification:** five categories: `BL_COMPARISON`, `SI_REQUEST`, `INVOICE_QUERY`, `GENERAL`, `SPAM`.
- **Extraction:** preserve raw text and page, line or cell evidence. Normalize supported labels and numeric formats without guessing missing values.
- **Comparison:** use the SI as reference and check all seven fields. When all match, report “No mismatch detected.”
- **Human review:** distinguish incomplete/unreadable evidence from a discrepancy; require source inspection and a reason for confirmation. Original documents are not overwritten.
- **Source selection:** compare one identified SI/BL pair; retain and explicitly exclude other attachments.
- **Concurrency/history:** expected-version checks and atomic result/revision/event saves reject stale writes. History is protected against ordinary updates, not a database administrator changing the schema.
- **Reports:** keep untouched automatic baseline exports separate from human-reviewed evidence. Policy exceptions annotate, but never hide, the strict mismatch or improve the automatic benchmark.

Source map: [classifier](lib/classifier.ts), [parsers](lib/parsers.ts), [comparison](lib/compare.ts), [normalization](lib/normalization.ts), [corrections](lib/corrections.ts), [API routes](app/api), [storage](lib/storage.ts), [schema](db/schema.ts), [tests](tests).

## Run from a clean clone

Requires **Node.js >=22.13**, npm and Git. Node 24 is used for the deployment. No OpenAI key or original organiser folder is needed for the core application.

### Windows PowerShell

```powershell
git clone https://github.com/Priscilla0117/CargoGuard.git
cd CargoGuard
npm ci
$env:CARGO_LOCAL_DB='work/local.db'
New-Item -ItemType Directory -Force work
npm run db:migrate
node scripts/stage-ocr.mjs
npm run dev
```

### macOS / Linux

```sh
git clone https://github.com/Priscilla0117/CargoGuard.git
cd CargoGuard
npm ci
export CARGO_LOCAL_DB=work/local.db
mkdir -p work
npm run db:migrate
node scripts/stage-ocr.mjs
npm run dev
```

Open **http://localhost:3000**. Keep the environment variable in the terminal that runs the server. The initial database has no processed decisions; choose **Run inbox**. SQLite is for local development/QA only. Production on Render requires persistent Turso settings.

To test the production build, stop the development server, keep `CARGO_LOCAL_DB` set, then run:

```text
npm run build
npm start
```

## Reproduce the checks

### Self-contained checks, without the organiser folders

```text
npm run typecheck
npm run lint
npm test
node --import tsx scripts/evaluate-embedded.ts
npm run build
```

The embedded evaluator computes outputs for the included original inputs in `work/evaluation/`. It does **not** read an answer key or independently score accuracy. Some supplied PDFs are intentionally damaged; review outcomes and parser warnings for those samples are expected.

### Full organiser evaluation

Use the unchanged organiser bundle and Docker data supplied to participants. The organiser clarification permits offline use of the released evaluation key; the application does not use it for inference.

For non-default folder locations, set these in PowerShell (replace the example paths):

```powershell
$env:CARGO_ORGANISER_BUNDLE='C:\path\to\sdoc-hackathon-bundle'
$env:CARGO_ORGANISER_DOCKER_DATA='C:\path\to\sdoc-hackathon-docker\data_v2'
$env:CARGO_PYTHON='python'
npm run quality -- --build
```

Without overrides, the gate expects the organiser folders beside this repository. Python is required for the official offline scorer. The gate discovers all test files, checks both input copies, generates predictions, invokes the unmodified organiser scorer and performs the production build. Detailed results remain under ignored `work/validation/`.

After that gate, start the local production server and run:

```text
npm run test:api -- http://127.0.0.1:3000
npm run test:hardening -- http://127.0.0.1:3000
npm run test:governance -- http://127.0.0.1:3000
node scripts/test-release-api.mjs http://127.0.0.1:3000
node --import tsx scripts/test-revision-api.ts http://127.0.0.1:3000
node scripts/test-assistant-api.mjs http://127.0.0.1:3000
node --import tsx scripts/test-review-workspace-api.ts http://127.0.0.1:3000
```

These suites create synthetic QA workspaces and write test data. Use a dedicated local database. Do not point them at a shared production service without permission. Assistant preflight tests are not real-provider answer-quality tests. The core API suite expects the baseline generated by the full organiser gate.

## Cloud deployment and AI configuration

Follow [DEPLOYMENT.md](docs/DEPLOYMENT.md) and `render.yaml`. The default deployment uses Render plus Turso, not local disk persistence.

Set `TURSO_DATABASE_URL` and a database-scoped `TURSO_AUTH_TOKEN` only in Render's secret environment settings. Never set `CARGO_LOCAL_DB` there. Optional cloud assistance additionally uses `CARGO_AI_PROVIDER`, `CARGO_AI_MODEL` and `CARGO_AI_API_KEY`; follow [.env.example](.env.example) and [AI_UPGRADE.md](docs/AI_UPGRADE.md). Do not prefix secrets with `NEXT_PUBLIC_` or commit actual environment files.

Core classification and comparison require no LLM key. When enabled, the assistant/recovery can send the specifically previewed question, case context and source excerpts to OpenAI after consent. Browser OCR does not send scan contents to OpenAI. Shared attempt/token limits and provider availability can stop AI requests; a restart does not reset persistent allowances.

## Safety and operating limits

- Manual email intake accepts up to **10 attachments**; replacement accepts **2–10**. Each is at most **5 MiB**, with **20 MiB combined**. The comparison uses exactly one selected SI and one BL.
- Supported inputs: TXT, text PDF, DOCX and XLSX. Each workspace allows **30 uploaded cases**. The Node demo caps stored upload bytes at **256 MiB across the database**, including retained historical sources; this is not a per-workspace allowance or a complete database-size cap.
- Text PDFs are bounded to 30 pages. Browser OCR handles up to five pages with a three-minute timeout and English suggestions. Confirm all seven fields against the source before saving.
- Reviewer names are self-declared. Browser-workspace isolation is not corporate authentication. Clearing cookies starts another workspace; it does not delete earlier saved data.
- Missing evidence never authorizes clearance. The UI keeps attachment-free requests visibly unverified even where the organiser export convention assigns `OK`.
- No live corporate inbox connection, automatic email sending, shipment approval, formal retention policy or production compliance certification is claimed.
- Free-service cold starts and quotas remain constraints. Verify readiness and a real case before presenting; do not describe old test results as continuous uptime.

## Submission and attribution

The [submission check](docs/SUBMISSION_CHECK.md) separates completed technical checks from outstanding links, video verification and team declarations. The rules require a public source repository with setup instructions, a working public prototype, accessible slides/documentation, a project description and a demo video of at most five minutes. This README covers architecture, implementation, challenges and roadmap; recording notes are not a finished video.

Original organiser inputs are embedded for the authorised hackathon demo. Answer keys and per-ID prediction artifacts are excluded from application inputs and Git. No broad redistribution licence is assigned to organiser data. Keep library and OCR notices intact.

Development, testing and documentation used **OpenAI Codex assistance**, alongside the open-source dependencies recorded in `package.json` and the lockfile. Preserve the included vendor/OCR licence notices. The team remains responsible for reviewing the implementation and declaring any reused material. It must confirm eligibility, registration, originality and work within the allowed event window. This repository cannot certify those declarations, production readiness, zero future bugs or a judging outcome.
