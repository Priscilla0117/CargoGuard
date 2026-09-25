<p align="center">
  <img src="public/favicon.svg" width="64" height="64" alt="CargoGuard shield" />
</p>

<h1 align="center">CargoGuard</h1>

<p align="center"><strong>Shipping documents. Clear evidence. Accountable decisions.</strong></p>
<p align="center">An AI-assisted workspace for shipping-document verification and follow-up.<br />Built for the Averis × Monash Hackathon.</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#try-the-workflow">Try the workflow</a> ·
  <a href="docs/DOCUMENT_TRUST_RELEASE.md">Release notes</a> ·
  <a href="#documentation">Documentation</a>
</p>

**Version 3.5.0** · Branch: `codex/document-trust-and-mail-worker`

CargoGuard helps shipping teams take an incoming email through document checking, correction and handover. It compares **Shipping Instructions (SI)** with **draft Bills of Lading (BL)**, shows the evidence behind each result and keeps track of what changed when a revised document arrives.

Core email classification, document comparison and local OCR work **without a paid AI API**.

## What employees can do

| Task                           | How CargoGuard helps                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| **Find the next action**       | Classifies emails into five categories, groups related conversations and highlights urgent work.                                |
| **Check SI against BL**        | Compares seven key fields side by side, highlights differences and links results to their sources.                              |
| **Review difficult documents** | Flags incomplete PDF coverage and supports manual page inspection or browser-local OCR.                                         |
| **Resolve discrepancies**      | Prepares editable reply drafts, records follow-ups and rechecks replacement documents for remaining or newly introduced errors. |
| **Hand over with context**     | Retains original files, revisions, ownership and decision history so the next employee can see what remains unresolved.         |
| **Search the workspace**       | Ask CargoGuard helps find saved emails; reports show document-check results and work needing attention.                         |

The seven comparison fields are **shipper, consignee, notify party, port of loading, port of discharge, container count and gross weight**. Independent container-number and consistency checks can also flag issues when the two documents agree.

## What's new in 3.5.0

### Review the whole document

Readable text alone is not enough to clear a PDF. CargoGuard checks each page for unreadable content, images, annotations, forms and covering shapes. Extracted values remain visible as a **partial comparison**, while unresolved pages block verification and completion.

> **Example:** Page one says **42,000 KG**, but a scanned amendment on page two changes it to **43,000 KG**. CargoGuard requests review. Confirming the amendment exposes the weight mismatch and records the reviewer, reason and supporting page while retaining the original PDF.

Every flagged page must be opened and acknowledged, and all seven authoritative fields must be confirmed. These checks are conservative: harmless logos or table borders can also require review. See the [synthetic PDF fixtures](tests/fixtures/pdf-coverage/README.md).

### Keep incoming work moving

A configurable background worker imports email for connected team accounts even after the browser closes. Saved progress and duplicate protection support interrupted checks and restarts. Mailbox settings show the last successful sync, recent errors and worker status. **The worker only imports; sending a reply remains an employee action.**

### Recognise more equivalent formats

The comparison recognises additional tested port-name/code variants and container expressions such as `2 x 40HC containers`. Contradictory values still require attention.

**Upgrading?** Recheck saved cases before completion. Older scan confirmations without page-coverage evidence cannot clear the new review requirements. [Read the full 3.5.0 release notes](docs/DOCUMENT_TRUST_RELEASE.md).

## Try the workflow

**Import → Compare → Review → Reply → Recheck**

1. Open **Import email → Load 28 practice emails**, or import your own permitted synthetic `.eml`, TXT, PDF, DOCX or XLSX files.
2. Open a case and inspect the SI vs BL comparison and original evidence.
3. Confirm uncertain readings or request clarification for conflicting information.
4. Review a reply draft, record the follow-up and import the revised BL.
5. Recheck all seven fields before completing the document check and handing over the case.

The practice mailbox is an authored demonstration dataset. For a repeatable correction journey, use the [final-round rehearsal](examples/final-round/README.md): a replacement BL fixes the weight but introduces a port error, which requires another correction.

[Hosted demo](https://cargoguard-averis.onrender.com/) — its deployed version may differ from this branch. The local quick start below runs the checked-out source; historical hosting records do not establish that 3.5.0 is deployed.

## Quick start

Requires **Node.js 22.13 or newer** and **npm**. A mailbox connection and external AI credentials are optional.

**1. Get this branch and install dependencies.**

```sh
git clone --single-branch --branch codex/document-trust-and-mail-worker https://github.com/Priscilla0117/CargoGuard.git
cd CargoGuard
npm ci
```

**2. Copy `.env.example` to `.env.local` and set these values.**

```dotenv
CARGO_LOCAL_DB=work/local.db
CARGO_AUTH_MODE=demo
CARGO_INCLUDE_SAMPLE_DATA=true
```

**3. Create the local database and start the app.**

```sh
npm run db:migrate
npm run dev
```

Open [localhost:3000](http://localhost:3000). Demo mode provides isolated browser workspaces and synthetic samples. On Windows, use `npm.cmd` if PowerShell blocks the `npm` shim.

To run the production build with your configured environment:

```sh
npm run build
npm start
```

Startup applies database migrations before serving requests. `/api/live` reports process health; `/api/health` checks database readiness.

## Team and mailbox setup

Named accounts provide operator, reviewer and administrator roles. Team workspaces start empty by default. Follow the [deployment guide](docs/DEPLOYMENT.md) and [team setup guide](docs/TEAM_ACCESS.md) for HTTPS, persistent storage and account creation.

<details>
<summary><strong>Enable background email intake</strong></summary>

After configuring the team deployment, set:

```dotenv
CARGO_AUTH_MODE=team
CARGO_MAIL_WORKER_ENABLED=true
```

Configure `CARGO_MAIL_TOKEN_KEY` and your selected mailbox connection using the [Gmail setup guide](docs/GMAIL_SETUP.md). Connect through Google sign-in or a supported IMAP/SMTP account, then enable **Automatic import** in **Setup → Email accounts**.

Run `npm start` on an **always-on Node host**. It applies migrations through `0014_mail_worker.sql` and supervises both the website and the intake worker. Signing out does not disconnect an authorised mailbox. Turning Automatic import off, disconnecting the account or revoking team access stops further intake.

In demo mode, or without the worker enabled, automatic checks require the Inbox to stay open. A sleeping or stopped host cannot poll. The supplied Render configuration uses a free plan; continuous intake needs a hosting arrangement that remains running.

Replies can be saved as drafts or explicitly sent after review and confirmation. Set `CARGO_MAIL_ALLOW_SEND=false` for drafts-only operation. Real mailbox authentication, threading and delivery still require acceptance testing on the intended installation. The separate [Outlook adapter](docs/MICROSOFT_SETUP.md) requires Microsoft tenant configuration and live acceptance.

</details>

## How it works

**Next.js + React + TypeScript** provide the workspace. A learned **TF-IDF email classifier** routes incoming work; document parsers and deterministic rules compare shipment values. **Tesseract.js** supplies local English OCR. **SQLite/libSQL with Drizzle** stores cases, sources and review history.

Optional external AI assists with recovery, questions and reply wording when configured. Core checks remain available without it, and uncertain document evidence still requires review. See [architecture](docs/ARCHITECTURE.md) and [configuration](.env.example) for details.

## Validation

The [3.5.0 release record](docs/DOCUMENT_TRUST_RELEASE.md) reports the following results from **25 September 2026**:

| Check                                                     | Recorded result                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Automated regression suite                                | **721 tests passed**                                                                                 |
| Supplied development corpus                               | **520/520 exact output agreement**                                                                   |
| Type checking, lint, input integrity and production build | **Passed**                                                                                           |
| Local HTTP acceptance                                     | API **74**, governance **26**, hardening **36**, workflow **24**, document trust **8** checks passed |

These are development and synthetic acceptance results. Live mailbox acceptance and an independently labelled employee pilot remain outstanding. The earlier [1,560-output evaluation](docs/FINAL_ENHANCEMENTS_VALIDATION.md) is a historical result from a different release.

<details>
<summary><strong>Run the checks</strong></summary>

After installing dependencies, run:

```sh
npm run typecheck
npm run lint
npm test
npm run build
node scripts/test-team-runtime.mjs
node scripts/test-mail-supervisor.mjs
```

The [GitHub workflow](.github/workflows/verify.yml) runs application checks, a production build and authenticated team/restart acceptance. It does not deploy the application.

For organiser scoring, place `sdoc-hackathon-bundle` and `sdoc-hackathon-docker` beside the repository, install Python, then run:

```sh
npm run quality -- --build
```

If needed, set `CARGO_ORGANISER_BUNDLE`, `CARGO_ORGANISER_DOCKER_DATA` (the `data_v2` directory) and `CARGO_PYTHON`. These organiser bundles are not required to run the app. The [release notes](docs/DOCUMENT_TRUST_RELEASE.md) provide the separate local HTTP acceptance commands and their isolated test-environment requirements.

</details>

## Current scope

- **Human review stays in control.** Missing or unresolved evidence blocks completion. A completed document check does not authorise cargo release or establish compliance clearance.
- **Document limits are explicit.** Up to 10 supported attachments per email, 5 MiB each and 20 MiB combined; `.eml` files up to 20 MiB. PDF parsing supports 30 pages; manual/OCR page review supports five pages and 5 MiB. Larger or unsupported review cases need replacement documents. Retained source storage is capped at 256 MiB across the deployment.
- **Company use needs acceptance.** Hosting, data approval, backups, retention and employee validation require an agreed rollout. Application accounts do not provide corporate SSO/MFA. External AI processing requires approved configuration and appropriate data handling.

## Documentation

| Start here                   | Guide                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Current release and evidence | [Document trust 3.5.0](docs/DOCUMENT_TRUST_RELEASE.md)                                                                                                 |
| Hosting and team access      | [Deployment](docs/DEPLOYMENT.md) · [Team setup](docs/TEAM_ACCESS.md)                                                                                   |
| Connected mailboxes          | [Gmail / IMAP / SMTP](docs/GMAIL_SETUP.md) · [Microsoft / Outlook](docs/MICROSOFT_SETUP.md)                                                            |
| Technical design             | [Architecture](docs/ARCHITECTURE.md) · [Model card](docs/MODEL_CARD.md)                                                                                |
| Demonstration and evaluation | [Practice mailbox](docs/FIELD_TEST.md) · [Amendment rehearsal](examples/amendment-resolution/README.md) · [Pilot evaluation](docs/PILOT_EVALUATION.md) |

---

Built with open-source libraries and AI-assisted development. Tesseract.js/core use Apache-2.0; the English model package declares MIT. Staged OCR assets retain their licence notices. Organiser answer keys are used only for offline evaluation, never application inference.
