# Independent cloud deployment — CargoGuard 3

Recorded release status: **CargoGuard 3.2.1 was live at https://cargoguard-averis.onrender.com/ on 21 September 2026, 19:37:58 MYT**, runtime `15ccb25d737bc233bc15912631a55f954b3f5e50`. That release passed **350 unit tests, 228 local HTTP checks, 12 local storage-outage checks and 177 hosted acceptance/persistence checks** (170 HTTP + 7 retained-data checks), with a 520/520 exact cloud export on the supplied development corpus. See [CLOUD_RELEASE.md](CLOUD_RELEASE.md) for the dated evidence and its limits. These are not new checks performed by this documentation update, independent production accuracy or an uptime guarantee.

The current `main` source includes the 3.2.1 deployment code merged from `cargoguard-v3-deploy`. The recorded cloud release above used that deployment branch; merging or editing documentation does not itself deploy a new runtime. The old v2 site remains untouched. The steps below describe reproduction, not permission to create duplicate resources or change the existing service.

For the separate **22 September** local quality/build/API rerun and read-only public-service snapshot, see [SUBMISSION_CHECK.md](SUBMISSION_CHECK.md). The hosted totals above retain their original release date.

## Recommended free demo setup

Render Free runs the standard Next.js app. Turso Free (a **libSQL-compatible database**, using `@libsql/client`) keeps decisions, audit history, policies and uploaded source bytes. No ChatGPT account or Sites integration is needed to open the deployed app. This setup is a recommendation for the current upload/persistence design, not a claim that one provider is universally best.

- [Render Free](https://render.com/docs/free): sleeps after 15 minutes without traffic; wake-up takes about a minute. Its local disk is temporary. Do not store live data there. Free compute is not a production SLA; account bandwidth/build quotas also apply.
- [Turso pricing](https://turso.tech/pricing): choose the Free plan, do not enable paid overages, and monitor account quotas. The app caps shared attachment bytes at 256 MiB, including retained historical originals, but that is not a complete account-spending or database-size cap.
- [Vercel Hobby](https://vercel.com/docs/plans/hobby) is for personal/non-commercial use. Its [Functions payload limit](https://vercel.com/docs/functions/limitations) was documented as 4.5 MB in the provider review below. This app accepts up to 5 MiB per file and 20 MiB combined attachments, with a 21 MiB multipart request bound. That contract needs a redesigned direct/chunked upload path before deployment behind that limit. This version has not been accepted on Vercel; do not advertise its maximum uploads there as verified.
- [Cloudflare Workers Free](https://developers.cloudflare.com/workers/platform/limits/) has 10 ms CPU per HTTP request. It is not the recommended free server-side PDF parser host. R2 requires subscription setup and bills usage above allowances.

Checked against provider documentation on 20 September 2026. Check the account dashboard for the actual current allowances before publishing. No free provider can guarantee uninterrupted judging-day service.

## Account and deployment steps

1. You create/sign in to Render and Turso and accept their account terms yourself. Do not send passwords or tokens in chat. No paid trial, card-backed upgrade or paid overage is needed by this plan; stop if a provider asks for an unwanted upgrade.
2. In Turso, create a libSQL-compatible database on Free. Choose an appropriate nearby available region. Copy its connection URL and a database-scoped read/write token into Render's **secret environment settings**, not into source control. The token must support migrations; restrict it to this demo database and rotate it after the event.
3. Put this project at the root of the repository used by Render. For the existing project, `main` contains the current source; verify the intended commit and service branch before any deployment. A repo publish is a separate action. Do not upload real environment files, `.git`, `.wrangler`, `.openai`, local databases, `work/`, organiser answer keys or old prediction files. `.env.example` is a placeholder template, not a place for secrets. Preserve source licenses and attribution; do not apply the archived v2 Site instructions in GITHUB_UPLOAD.md to this deployment.
4. Create a Render Blueprint from `render.yaml`, or create a Node web service with exactly these settings: Free plan, Singapore region if available, Node 24.14.0, build `npm ci --include=dev --no-audit --no-fund && npm run build`, start `npm start`, process-health endpoint `/api/live`. Keep `/api/health` for database-readiness checks; it returns 503 during a storage outage. Render restarts failing instances, so using an external database check for its process probe can amplify a database outage into a restart loop.
5. Set server secrets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. Never use `NEXT_PUBLIC_` for them. Do **not** set `CARGO_LOCAL_DB` on Render. Render's trusted `RENDER_EXTERNAL_URL` supports the origin check; for a custom domain set `CARGO_PUBLIC_ORIGIN=https://your-exact-domain`.
6. Deploy. Startup applies versioned, transactional SQL migrations and starts Next.js. It fails closed if a persistent cloud database is not configured or the schema cannot be checked. `/api/live` must return HTTP 200 with `alive`; this does not establish storage availability. Before accepting a release, `/api/health` must also return HTTP 200 with `ready` and the intended engine version (`3.2.1` for this source), and actual workspace reads/saves must pass. If storage fails later, the running interface can show a controlled failure without a dependency-triggered process restart; writes remain fail-closed and are never automatically replayed.
7. Optional OpenAI support uses server-only `CARGO_AI_PROVIDER=openai`, `CARGO_AI_MODEL` and `CARGO_AI_API_KEY`, configured by the account owner in Render's secret settings. Use the supported model and approved shared limits documented in [AI_UPGRADE.md](AI_UPGRADE.md); never place the key in browser code or Git. The owner-funded service requires preview/consent for organiser/synthetic text. Judges need no personal API key. Chat and recovery remain optional; provider failure must not create a comparison verdict or silently save a proposal.
8. Test the actual assigned HTTPS URL; do not invent or announce a URL before deployment succeeds. Judge access must not depend on your Render/Turso login.

Turso's newer native engine and libSQL are distinct. The current adapter and migrations were locally tested against libSQL. Verify remote support, transaction semantics, triggers and 5-MB binary round-trips before declaring the hosted deployment ready; do not silently substitute another engine.

## Hosted acceptance gate — mandatory

Run these against the real URL, with permission to create synthetic QA workspaces:

```text
node scripts/test-api.mjs https://YOUR-ASSIGNED-HOST
node scripts/test-hardening-api.mjs https://YOUR-ASSIGNED-HOST
node scripts/test-governance-api.mjs https://YOUR-ASSIGNED-HOST
node scripts/test-release-api.mjs https://YOUR-ASSIGNED-HOST
node --import tsx scripts/test-revision-api.ts https://YOUR-ASSIGNED-HOST
node --import tsx scripts/test-review-workspace-api.ts https://YOUR-ASSIGNED-HOST
```

This is a reproduction checklist, not a claim that every listed suite was run against the same historical hosted release. In the final 3.2.1 record, the 35 hardening and 23 governance checks ran locally; use CLOUD_RELEASE.md for the exact hosted subset. Optional live-provider tests consume the owner's API balance and require separate approved allowance; do not treat mocked or preflight tests as LLM answer-quality evidence.

The baseline suite requires local `work/validation/v3/original/submission.json`, produced by the full quality gate below. It is not deployed as app input. With default organiser locations, `npm run evaluate` can also produce it; that standalone evaluator does not read the quality gate's organiser-path environment overrides, so prefer the gate when using custom paths.

Run `npm run quality -- --build` first: it now discovers all test files, checks organiser input integrity, produces predictions and independently validates them with the supplied official scorer. Set the explicit organiser paths described in [DEFENSIBILITY.md](DEFENSIBILITY.md) when needed. Independently score the retained `work/validation/http-submission.json` after hosted tests; agreement with locally produced predictions alone is not proof of organiser accuracy.

Also verify: all 520 browser cases finish; PDF/DOCX/XLSX/TXT are handled; OCR assets and PDF pages render; original sources download; previews, corrections and stale writes behave correctly; automatic exports remain unchanged after human edits; and two signed-out browser workspaces cannot read each other's uploads/history. Manual email import accepts 0-10 attachments; replacement accepts 2-10. Both use `/api/upload`, at most 5 MiB/file and 20 MiB combined. The count check is not a role/readability check: a valid comparison still requires an identified readable SI and draft BL. Extra attachments require an explicit comparison pair and remain labelled retained, not verified. Test supported boundary combinations and quota failures with synthetic data on the remote service, not only localhost; do not extrapolate one two-file test into acceptance of every ten-file combination.

Create an uploaded case and a policy, note its revision, restart/redeploy the Render app, then verify the same browser still sees the exact case, original bytes, history and policy. Repeat after an idle cold start. Database/network failure must show an error, not fake success. Record hosted p95 timings and memory; local timings are not cloud capacity evidence.

For a new or changed deployment, complete acceptance before announcing it as ready. The existing public link has the historical acceptance record above; this checklist does not establish its availability today. Retiring the old site or migrating its saved user work requires a separately verified plan. Cookie workspaces do not transfer across domains automatically.

## Honest operation

Use organiser/synthetic data only. This demo lacks corporate SSO, authenticated roles, antivirus, formal retention, global abuse prevention, guaranteed backups and a durable background queue. Reviewer names are self-declared. Database triggers protect revisions from ordinary update/delete operations, but a database administrator can alter the schema; this is not certified tamper-proof storage.

Open the real demo shortly before judging to allow normal cold-start and OCR loading. Do not use artificial keep-alive traffic to disguise a free-plan limitation. Export reviewed evidence as a local demo fallback, while clearly distinguishing it from a live run.

A neutral hosting URL is appropriate. It does not change how the product was built. Retain required licenses and answer questions about AI-assisted development truthfully.
