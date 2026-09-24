# CargoGuard 3.4.1 deployment and recovery

This release runs as a standard Next.js Node server with a persistent SQLite/libSQL database. The source branch is `codex/final-round-employee-workflow`. A branch push does not deploy it: Render automatic deployment is disabled. The [24 September hosted record](CLOUD_RELEASE_341.md) covers the accepted 3.4.1 deployment in demo mode; the [older cloud report](CLOUD_RELEASE.md) remains historical. Verify the intended engine version and actual HTTPS workflow before calling any later deployment accepted.

## Reproduce the release

Use a supported Node version (`>=22.13.0`; Render is pinned to 24.14.0) and the committed lockfile. Start from a clean checkout of the release branch:

```text
npm ci --include=dev --include=optional --no-audit --no-fund
npm run typecheck
npm run lint
npm test
npm run build
node scripts/test-team-runtime.mjs
```

Build stages the local OCR worker, WASM and English language assets. It needs no database, AI provider or Microsoft credentials. Keep development dependencies installed on the deployment: startup migrations use `tsx`. A static export cannot run the authenticated APIs, migrations or server parsers.

The team acceptance script creates a separate local database under ignored `work/validation/`, generates temporary credentials internally, starts the **production build** on loopback, and verifies bootstrap, real login, permissions, empty employee inbox, document import/download, reviewed export, audit identity, cross-origin protection and membership revocation. It restarts the server with the bootstrap secret removed and checks session, document bytes, revisions, follow-ups and shipment persistence. The redacted result is `work/validation/team-runtime.json`. It never connects to the configured cloud database or sends mail. A passing local run does not prove cloud availability or Microsoft connectivity.

The GitHub workflow runs a clean install and release checks on the feature branch/PR; it does not deploy or require secrets. The separate organiser accuracy gate remains `npm run quality -- --build`, with the independent inputs described in [DEFENSIBILITY.md](DEFENSIBILITY.md). The local team smoke does not substitute for that scoring evidence.

## Local operation

Copy `.env.example` to `.env.local`, then set an explicit file path such as `CARGO_LOCAL_DB=work/local.db`. Parent directories are created by migrations. Relative paths and environment files resolve from the checkout, even when the startup script is invoked from elsewhere. Host-injected environment variables take precedence over `.env.local`, then `.env`.

For the isolated synthetic demonstration, use `CARGO_AUTH_MODE=demo`. It offers separate cookie workspaces with self-declared actors; it is unsuitable for company documents. For a local team acceptance workspace, use the settings below with `CARGO_PUBLIC_ORIGIN=http://127.0.0.1:3000`. HTTP is allowed only on loopback. Run `npm start` after building; startup applies migrations and validates the full schema before serving. `npm run db:migrate` runs the same preflight and migration checks separately.

Local database files survive process restarts on that machine. Their durability still depends on the disk and backups. On an ephemeral host, use the remote database; never point production at an unmounted temporary directory. A local SQLite file is intended for one Node instance, not a shared writable network file across replicas.

## Shared employee deployment

Provision a **libSQL-compatible** database and a database-scoped read/write token. The current adapter uses `@libsql/client`; an incompatible database engine is not an interchangeable substitute. Store the following in the host's secret/environment settings, never source control or a `NEXT_PUBLIC_` variable:

| Setting | Required behavior |
| --- | --- |
| `TURSO_DATABASE_URL` | Persistent `libsql://` or `https://` endpoint, without credentials in the URL. |
| `TURSO_AUTH_TOKEN` | Database-scoped token with permission to apply transactional migrations. |
| `CARGO_AUTH_MODE=team` | Require authenticated accounts and enforce operator/reviewer/admin roles. |
| `CARGO_INCLUDE_SAMPLE_DATA=false` | Start with imported employee records only. This is also the team default. |
| `CARGO_PUBLIC_ORIGIN=https://your-exact-host` | Trusted public origin. On Render, `RENDER_EXTERNAL_URL` is the default when this setting is absent. Set it explicitly for a custom domain. |
| `CARGO_BOOTSTRAP_SECRET` | At least 32 cryptographically random characters for first setup. Remove after creating the first administrator. Never paste it into chat or commit it. |
| `CARGO_MAX_WORKSPACE_UPLOADS` | Optional integer 1–10000; defaults to 1000 in team mode, 30 in demo mode. This is a record-count limit, not a retention mechanism. |

A new team refuses startup without a bootstrap secret. An initialized team restarts without it. Open the HTTPS app, create the initial administrator using the setup secret, sign in, create named employee accounts, then remove the setup secret from the host and restart. Maintain at least two active administrators and distribute initial credentials through the company's approved channel. Password changes revoke existing sessions. See [TEAM_ACCESS.md](TEAM_ACCESS.md) for account lifecycle, rate limits and recovery limitations.

The supplied `render.yaml` defines a Node service, team mode, samples disabled, the exact build/start commands and `autoDeployTrigger: off`. Use the requested feature branch. It retains the existing service name; do not create a duplicate resource for an already configured service. A new Blueprint prompts for the database token and bootstrap secret. **For an existing Blueprint, Render does not apply newly added `sync: false` secrets automatically**: add them in the dashboard before deploying. Set the exact public origin when using a custom domain. Official reference: [Render Blueprint specification](https://render.com/docs/blueprint-spec).

Render's local filesystem is ephemeral and the runtime rejects local-database configuration there. The supplied free compute plan is for demonstration/pilot validation; choose the company's approved hosting, capacity and availability arrangement before operational reliance. This repository does not enroll a service, accept a paid plan or deploy on your behalf. Review current [Render free-service limitations](https://render.com/docs/free) and account/database quotas directly before an event.

## Health and hosted acceptance

Use `/api/live` for the host's process health check. It reports `alive` without touching the database, avoiding dependency-driven restart loops during a storage outage. `/api/health` is the separate database readiness check: it returns `ready` only after a bounded query verifies all runtime tables. Partial schemas or unavailable storage return 503. Healthy probes alone do not establish successful business operations.

Before accepting a new HTTPS deployment:

1. Back up the existing database using the provider's supported procedure and verify a restore to an isolated database. Retain the previous release identifier. Review migrations before applying them; they are transactional per file, and startup never resets stored data.
2. Confirm `/api/live` and `/api/health` return the intended engine, **3.4.1**. For a team deployment, sign-out must block inbox, document, shipment and export APIs. Inspect the real HTTPS session cookie for `Secure`, `HttpOnly` and `SameSite=Strict`.
3. With synthetic data and named test accounts, import a document pair, resolve an exception as reviewer, save a shipment/follow-up, download original bytes, inspect revisions and export reviewed evidence. An operator must not approve reviews or edit membership; cross-origin writes must fail.
4. Restart/redeploy the service, then verify the same accounts see the exact saved versions, source bytes, audit history and notes. Verify after the host's idle wake too, if applicable. Revoke a test account and confirm its existing session is rejected.
5. Verify PDF/DOCX/XLSX/TXT parsing, browser OCR assets, bounded uploads, quota errors and user-visible failures on the actual host. Measure cloud latency and memory with expected users; local test timings are not cloud capacity evidence.

Anonymous organiser API suites (`test-api`, `test-hardening`, `test-governance`, `test-release-api`) are for a **separate demo-mode synthetic deployment**. Do not weaken a team service to make those suites pass. Never run QA that writes synthetic records against a live employee database without a defined test workspace and authorization.

## Limits and incident handling

- Uploaded files are limited to 5 MB each, 20 MB per email and 10 attachments. Stored attachment bytes have a **deployment-wide 256 MB cap**, shared by all workspaces. This is not a complete database-size or spending cap; revisions, metadata and account limits also consume capacity. Reaching a cap fails explicitly and retains existing evidence. Plan storage, retention and orphan cleanup before broader use; do not delete evidence to make a demo look successful.
- Writes fail closed when the database is unavailable. A network failure after a write may mean the write committed. Refresh current records before retrying; do not automatically replay business mutations. Database tokens, email bodies and attachment contents must not appear in diagnostic logs.
- Migration preflight reports configuration failures without dumping driver errors or secrets. If it fails, correct the environment or restore database availability before restarting. Do not remove migration-history rows or reset the database as a troubleshooting shortcut. All-table readiness detects missing feature tables after a partial upgrade.
- Revisions and security audit use database protections against ordinary edits. A database administrator can change the schema; this is not immutable external audit storage. Establish backup/restore ownership, key rotation, retention and incident response with company IT.
- Named accounts and roles are implemented. Corporate SSO/MFA, identity-provider lifecycle integration, malware scanning, penetration testing and company security/privacy approval remain prerequisites for a company rollout. The local passwords are a pilot access mechanism, not a claim of enterprise identity integration.
- Microsoft connection, selected-mail import, Outlook task pane and reviewer-triggered draft/alert adapters require an Entra tenant, registered application, approved scopes, callback URL and encryption key. None has been provisioned or live-tested for this user. See [MICROSOFT_SETUP.md](MICROSOFT_SETUP.md). Disabled configuration fails closed; no unattended delivery is claimed.

Keep the earlier service and saved work until the new release passes its own acceptance. Domains and cookies do not migrate work automatically. Keep licensing and AI-assisted-development attribution truthful when presenting the system.
