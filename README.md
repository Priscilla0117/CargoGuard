# CargoGuard

Shipping-document verification and follow-up for operations teams. CargoGuard classifies incoming email, compares Shipping Instructions (SI) with draft Bills of Lading (BL), and gives employees a source-backed route from a discrepancy to a corrected document. Decisions, originals, revisions, assignments and handovers are stored in a database.

**Final-round branch:** `codex/final-round-employee-workflow`. Engine **3.3.1**. This repository contains the executable Next.js application, SQL migrations, local OCR assets, regression tests and deployment configuration. No paid AI API is needed for classification, comparison or OCR.

The existing URL, https://cargoguard-averis.onrender.com/, is an **older release**, not proof that this branch has been deployed. Its dated record is in [CLOUD_RELEASE.md](docs/CLOUD_RELEASE.md). Deploy the exact feature-branch commit and run acceptance checks against that host before sharing it as the final release.

## Employee workflows

| Workspace | Working capabilities |
| --- | --- |
| Work queue | Email and document import; five-category routing; seven-field comparison; source inspection; corrections; OCR review; replacement BL; revision differences; batch completion of eligible matches |
| Shipments | Explicit document association; current comparison; ownership; confirmed cutoffs; approved email instructions; revised-SI reconciliation; missing-document and billing drafts; tasks; handovers; history |
| Insights | Source-linked questions and filters; discrepancy distributions; historical party deviations; quoted general-email digest; visible denominators |
| Label rules | Propose unfamiliar headings, preview impact, approve scoped reuse, inspect history and disable rules |
| SI templates | Approved stable party fields, source-bound reuse and rollback; shipment-specific values remain blank |
| Team access | Named accounts, operator/reviewer/admin permissions, shared workspace, revocable sessions and audited administration |
| Outlook | OAuth/Graph adapter, selected-message import, reviewed drafts and guarded dispatch; requires Microsoft registration and live acceptance |

Email content is untrusted evidence, never an instruction to the application. The original SI comparison remains visible when an employee approves a later instruction. Missing, damaged, ambiguous or scanned documents cannot become automatic matches. OCR suggestions include source crops and recognition scores; all seven fields require human confirmation.

Independent ISO 6346 and source-backed consistency checks can expose errors even when both documents agree. A separate [UN/LOCODE port-code check](docs/PORT_REFERENCE.md) compares each stated port code with the public UNECE register (release 2024-2). On the organiser inbox it flags all 16 port values whose code contradicts the stated country, such as `TUTICORIN, INDIA (KEMBA)`, and raises no issue on any verified case. Missing evidence stays **Not checked**. Document-check completion never authorizes cargo release or establishes compliance clearance.

The **Amendment resolution** desk follows a reviewed instruction into a source-backed revised SI, then shows every remaining BL difference. It includes an editable request draft and downloadable decision brief; recording a change never bypasses the full document check. See the [synthetic rehearsal](examples/amendment-resolution/README.md), [authored 20-case operations challenge](docs/OPERATIONS_CHALLENGE.md) and [competitive value proposition](docs/CREATIVE_VALUE_PROPOSITION.md).

## Run from a clean checkout

Requires **Node.js 22.13 or newer** and npm. Python is only needed for separate organiser scoring. Run from the repository root:

```sh
npm ci
```

Copy `.env.example` to `.env.local` and configure local development:

```dotenv
CARGO_LOCAL_DB=work/local.db
CARGO_AUTH_MODE=demo
CARGO_INCLUDE_SAMPLE_DATA=true
```

```sh
npm run db:migrate
npm run dev
```

Open http://localhost:3000. Demo mode has isolated browser workspaces and organiser samples, with reviewer names clearly labelled as self-reported. Run the inbox to process samples or import permitted test files. On Windows, use `npm.cmd` if a PowerShell shim prevents npm from running.

For a production server using the configured environment:

```sh
npm run build
npm start
```

Build stages the local OCR worker, English model and licence notices. Startup checks configuration and applies versioned migrations before serving requests. `/api/live` checks the process; `/api/health` checks database readiness.

## Configure an employee team

Deploy behind HTTPS with an approved persistent Turso/libSQL database. Put configuration and credentials in the host's environment settings, never Git:

```dotenv
CARGO_AUTH_MODE=team
CARGO_PUBLIC_ORIGIN=https://your-approved-host.example
CARGO_INCLUDE_SAMPLE_DATA=false
CARGO_MAX_WORKSPACE_UPLOADS=1000
```

Also set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` and a cryptographically random `CARGO_BOOTSTRAP_SECRET` of at least 32 characters in the secret store. Register the first administrator on the sign-in page using that secret, then remove the bootstrap secret. Administrators create employees and assign roles.

**A new employee workspace starts empty.** Import records through the normal workflow. Organiser sample processing, unsaved sample downloads and benchmark export are disabled unless explicitly enabled. Turning samples off does not delete existing records or history. Imported-case capacity is enforced transactionally: 30 by default in demo mode and 1,000 in team mode, configurable from 1 to 10,000. This does not increase the separate 256 MiB source-storage ceiling.

Follow [deployment instructions](docs/DEPLOYMENT.md), [team setup](docs/TEAM_ACCESS.md) and the [employee release record](docs/EMPLOYEE_RELEASE.md). The Render blueprint supplies team-mode settings; applying it does not itself create an administrator or validate company access.

## Verify changes

```sh
npm run typecheck
npm run lint
npm test
npm run build
node scripts/test-team-runtime.mjs
```

The team acceptance script uses an isolated local database and temporary test identities. It checks real HTTP permissions, workflow persistence and restart recovery without external providers. The [GitHub workflow](.github/workflows/verify.yml) installs locked dependencies, checks types, lints, tests, builds and runs team acceptance on feature-branch pushes and pull requests. See [GitHub's Node.js CI documentation](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs).

For organiser scoring, keep the supplied `sdoc-hackathon-bundle` and `sdoc-hackathon-docker` folders **beside** this repository. They are not required to run the application. Set `CARGO_ORGANISER_BUNDLE`, `CARGO_ORGANISER_DOCKER_DATA` and `CARGO_PYTHON` if their locations differ, then run:

```sh
npm run quality -- --build
```

Three fresh first-run seeds produced **1,560/1,560 exact outputs**, catching all **167 defects** and **60 required reviews**, with zero observed false verified cases. The engine closure was unchanged between runs. These datasets share the organiser generator: results establish within-generator consistency, not real-world accuracy, absence of bugs or a judging score. Human-assisted results are excluded from the untouched automatic benchmark. See [validation details](docs/FINAL_ENHANCEMENTS_VALIDATION.md) and [model card](docs/MODEL_CARD.md).

## Microsoft connection

The application works without Microsoft. Connecting Outlook requires an approved tenant registration, delegated permissions, redirect URI and encrypted token storage. Follow [MICROSOFT_SETUP.md](docs/MICROSOFT_SETUP.md). Sending and Outlook framing default to disabled. No tenant is available for live acceptance; mocked tests do not establish live mailbox compatibility.

Chasers, acknowledgements, IT reports and handovers remain saved drafts unless explicitly dispatched through a configured channel. In-app reminders refresh while the workspace is open. Teams delivery, unattended mailbox/background monitoring and sanctions screening are not delivered features.

## Deployment boundaries

- Team access is application authentication, not corporate SSO/MFA. Company security/data approval, employee acceptance, backups/restores, retention and hosting capacity are deployment prerequisites.
- Imports accept up to 10 TXT/PDF/DOCX/XLSX files, 5 MiB each and 20 MiB combined. Source history is retained and consumes storage.
- PDF text extraction is bounded to 30 pages; English browser OCR supports five pages. Recognition confidence is not a calibrated correctness probability. Formulas require inspected, recalculated values-only evidence.
- The SQL-backed source store is bounded to 256 MiB across the deployment. Plan monitored capacity and object storage/queued processing before a larger rollout.
- Optional external AI requires configuration and explicit per-request consent. The existing consent path is limited to synthetic/organiser content; company-confidential data must stay out until an approved processing arrangement exists.
- Free-host cold starts and quotas are not a company uptime guarantee. A successful GitHub push does not establish deployment or company acceptance.

## Source map and handover

| Area | Location |
| --- | --- |
| Employee UI | `components/workbench.tsx`, `app/shipments`, `app/insights`, `app/rules`, `app/templates`, `app/outlook` |
| Routing and comparison | `lib/classifier.ts`, `lib/routing*`, `lib/parsers.ts`, `lib/normalization.ts`, `lib/compare.ts` |
| Workflow and identity | `lib/storage.ts`, `lib/shipment-storage.ts`, `lib/auth.ts`, `lib/team-storage.ts` |
| Migrations and storage | `drizzle/`, `db/schema.ts`, `lib/runtime-node.ts` |
| Regression/HTTP acceptance | `tests/`, `scripts/test-*.mjs`, `scripts/test-*.ts` |

See [architecture](docs/ARCHITECTURE.md), [judge review and pitch playbook](docs/JUDGE_REVIEW.md), [rubric mapping](docs/FINAL_ROUND_READINESS.md), [requirements](docs/REQUIREMENTS.md) and [synthetic correction-cycle files](examples/final-round/README.md). Historical documents remain dated records, not evidence for a newer deployed build.

Organiser files remain unchanged; answer keys are used only for offline scoring, never inference. This project uses open-source libraries and AI-assisted implementation. Tesseract.js/core use Apache-2.0; the English model package declares MIT; staged assets retain notices. The team must accurately disclose authorship and follow the permitted development window and submission rules. No championship or zero-defect guarantee is made.
