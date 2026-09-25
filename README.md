<p align="center">
  <img src="public/favicon.svg" width="64" height="64" alt="CargoGuard" />
</p>

<h1 align="center">CargoGuard</h1>
<p align="center"><strong>Shipping document verification and follow-up</strong></p>

CargoGuard helps shipping teams compare **Shipping Instructions (SI)** with **draft Bills of Lading (BL)**, resolve discrepancies and track corrections. Each result links to its source, while original documents and decision history remain available for review and handover.

## Key features

- **Document comparison** — Checks shipper, consignee, notify party, loading and discharge ports, container count and gross weight, accounting for supported formatting differences.
- **Evidence review** — Inspects PDF page coverage and supports local OCR for scans. Incomplete or uncertain evidence requires human confirmation before completion.
- **Correction workflow** — Prepares editable replies, tracks follow-ups and rechecks revised documents for remaining or newly introduced discrepancies.
- **Email workspace** — Classifies incoming messages, groups conversations and supports searches across saved cases. Optional background intake works for configured team mailboxes on an always-on host; sending remains an employee action.

**Import → Compare → Review → Reply → Recheck**

## Quick start

Requires **Node.js 22.13+** and **npm**. Core classification, comparison and local OCR do not require a paid AI API or mailbox connection.

```sh
git clone https://github.com/Priscilla0117/CargoGuard.git
cd CargoGuard
npm ci
```

Copy `.env.example` to `.env.local` and set:

```dotenv
CARGO_LOCAL_DB=work/local.db
CARGO_AUTH_MODE=demo
CARGO_INCLUDE_SAMPLE_DATA=true
```

Build and start the application. The build includes local OCR assets; startup creates the database:

```sh
npm run build
npm start
```

Open [localhost:3000](http://localhost:3000). Select **Import email → Load 28 practice emails** to explore the workflow with synthetic data. On Windows, use `npm.cmd` if PowerShell blocks `npm`.

## Technology

Next.js, React and TypeScript power the interface. A learned email classifier and deterministic comparison rules process documents; Tesseract.js provides English OCR. SQLite/libSQL stores cases, source files and history.

## Validation

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

The [3.5.0 validation record](docs/DOCUMENT_TRUST_RELEASE.md) documents **721 passing tests** and **520/520 exact output matches** on the supplied development corpus, recorded on **25 September 2026**. These are development results; live mailbox acceptance and an independent employee pilot remain outstanding.

A completed document check does not authorise cargo release. Deployment requirements, document limits and operational setup are covered in the guides below.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment and team setup](docs/DEPLOYMENT.md)
- [Mailbox configuration](docs/GMAIL_SETUP.md)
- [Release notes and validation](docs/DOCUMENT_TRUST_RELEASE.md)

---

Developed with open-source libraries and AI-assisted implementation. Bundled OCR assets retain their licence notices.
