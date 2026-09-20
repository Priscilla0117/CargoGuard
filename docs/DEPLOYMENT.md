# Independent cloud deployment — CargoGuard 3

Status as of 21 September 2026: **live at https://cargoguard-averis.onrender.com/**. The Render build, 130 hosted API checks, upload boundary tests, browser OCR and restart-persistence checks passed. See [CLOUD_RELEASE.md](CLOUD_RELEASE.md) for exact evidence and outstanding idle-wake/capacity limitations. The old v2 site remains untouched. The steps below describe how to reproduce the deployment; do not create duplicate resources for the existing service.

## Recommended free demo setup

Render Free runs the standard Next.js app. Turso Free (a **libSQL-compatible database**, using `@libsql/client`) keeps decisions, audit history, policies and uploaded source bytes. No ChatGPT account or Sites integration is needed to open the deployed app. This setup is a recommendation for the current upload/persistence design, not a claim that one provider is universally best.

- [Render Free](https://render.com/docs/free): sleeps after 15 minutes without traffic; wake-up takes about a minute. Its local disk is temporary. Do not store live data there. Free compute is not a production SLA; account bandwidth/build quotas also apply.
- [Turso pricing](https://turso.tech/pricing): choose the Free plan, do not enable paid overages, and monitor account quotas. The app caps uploaded bytes at 256 MB but that is not a complete account-spending or database-size cap.
- [Vercel Hobby](https://vercel.com/docs/plans/hobby) is for personal/non-commercial use. Its [Functions payload limit](https://vercel.com/docs/functions/limitations) is 4.5 MB. Our existing two-by-5-MB upload contract needs a redesigned direct/chunked upload path before Vercel can support it unchanged. Do not deploy this version to Vercel and advertise 5-MB paired uploads as verified.
- [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/limits/) has 10 ms CPU per HTTP request. It is not the recommended free server-side PDF parser host. R2 requires subscription setup and bills usage above allowances.

Checked against provider documentation on 20 September 2026. Check the account dashboard for the actual current allowances before publishing. No free provider can guarantee uninterrupted judging-day service.

## Account and deployment steps

1. You create/sign in to Render and Turso and accept their account terms yourself. Do not send passwords or tokens in chat. No paid trial, card-backed upgrade or paid overage is needed by this plan; stop if a provider asks for an unwanted upgrade.
2. In Turso, create a libSQL-compatible database on Free. Choose an appropriate nearby available region. Copy its connection URL and a database-scoped read/write token into Render's **secret environment settings**, not into source control. The token must support migrations; restrict it to this demo database and rotate it after the event.
3. Put this project at the root of the repository used by Render. A repo publish is a separate action; review its contents first. Do not upload `.env*`, `.git`, `.wrangler`, `.openai`, local databases, `work/`, organiser answer keys or old prediction files. Preserve the source licenses and attribution.
4. Create a Render Blueprint from `render.yaml`, or create a Node web service with exactly these settings: Free plan, Singapore region if available, Node 24.14.0, build `npm ci --include=dev --no-audit --no-fund && npm run build`, start `npm start`, health endpoint `/api/health`.
5. Set server secrets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Never use `NEXT_PUBLIC_` for them. Do **not** set `CARGO_LOCAL_DB` on Render. Render's trusted `RENDER_EXTERNAL_URL` supports the origin check; for a custom domain set `CARGO_PUBLIC_ORIGIN=https://your-exact-domain`.
6. Deploy. Startup applies versioned, transactional SQL migrations and starts Next.js. It fails closed if a persistent cloud database is not configured. `/api/health` must return HTTP 200 with engine `3.0.0`.
7. Test the actual assigned HTTPS URL; do not invent or announce a URL before deployment succeeds. Judge access must not depend on your Render/Turso login.

Turso's newer native engine and libSQL are distinct. The current adapter and migrations were locally tested against libSQL. Verify remote support, transaction semantics, triggers and 5-MB binary round-trips before declaring the hosted deployment ready; do not silently substitute another engine.

## Hosted acceptance gate — mandatory

Run these against the real URL, with permission to create synthetic QA workspaces:

```text
node scripts/test-api.mjs https://YOUR-ASSIGNED-HOST
node scripts/test-hardening-api.mjs https://YOUR-ASSIGNED-HOST
node scripts/test-governance-api.mjs https://YOUR-ASSIGNED-HOST
```

The baseline suite requires local `work/validation/v3/original/submission.json`, produced by `npm run evaluate`. It is not deployed as app input.

Also verify: all 520 browser cases finish; PDF/DOCX/XLSX/TXT are handled; OCR assets and PDF pages render; original sources download; previews, corrections and stale writes behave correctly; automatic exports remain unchanged after human edits; and two signed-out browser workspaces cannot read each other's uploads/history. Test maximum-size uploads and quota failures on the remote service, not only localhost.

Create an uploaded case and a policy, note its revision, restart/redeploy the Render app, then verify the same browser still sees the exact case, original bytes, history and policy. Repeat after an idle cold start. Database/network failure must show an error, not fake success. Record hosted p95 timings and memory; local timings are not cloud capacity evidence.

Only then share the independent URL. Keep the old site until the new one passes; retiring it or migrating its saved user work requires a separately verified plan. Cookie workspaces do not transfer across domains automatically.

## Honest operation

Use organiser/synthetic data only. This demo lacks corporate SSO, authenticated roles, antivirus, formal retention, global abuse prevention, guaranteed backups and a durable background queue. Reviewer names are self-declared. Database triggers protect revisions from ordinary update/delete operations, but a database administrator can alter the schema; this is not certified tamper-proof storage.

Open the real demo shortly before judging to allow normal cold-start and OCR loading. Do not use artificial keep-alive traffic to disguise a free-plan limitation. Export reviewed evidence as a local demo fallback, while clearly distinguishing it from a live run.

A neutral hosting URL is appropriate. It does not change how the product was built. Retain required licenses and answer questions about AI-assisted development truthfully.
