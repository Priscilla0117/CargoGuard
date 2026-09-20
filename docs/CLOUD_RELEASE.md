# CargoGuard 3 — independent public cloud release

Verified 21 September 2026, Malaysia time. Public demo: **https://cargoguard-averis.onrender.com/**. No Render, Turso or ChatGPT sign-in is required to use it.

## Deployed configuration

- Repository: `Priscilla0117/CargoGuard`, branch `cargoguard-v3-deploy`.
- Running application commit: `a59fb24c1a165eeb0616d9f7cfe96dd99c8f037b`, engine `3.0.0`.
- Existing `main` was preserved at `c069b3a4a009212be0f1f281b2ce9776136dc72e`; its separate classifier/normalization edits were not overwritten there.
- Render: `cargoguard-averis`, service `srv-dao05suk1f9s73a6qsm0`, **Free**, Singapore, Node `24.14.0`, manual deployments, health path `/api/health`.
- Turso: organisation `priscilla`, database `cargoguard`, **Free**, libSQL, Mumbai. No paid upgrade was selected on either service.
- Source and application data are separate: live decisions, histories, policies and uploaded bytes are in Turso, not Render's temporary disk. Startup migrations succeeded remotely.
- The old public v2 site and its saved work remain untouched. Browser workspaces do not transfer between the two domains.

## What actually passed on the public host

| Check | Observed result |
| --- | --- |
| Anonymous health request | HTTP 200, ready, engine 3.0.0 |
| Clean Render install and production build | Successful; correct branch, commit and Node version shown in build logs |
| Baseline API suite | 72 checks passed, including all 520 expected organiser outputs and automatic export |
| Hardening API suite | 35 checks / 73 requests passed; measured median 359 ms and p95 1,407 ms |
| Governance API suite | 23 checks passed, including concurrent policy activation, stale previews, history, source replacement and workspace isolation |
| Upload boundary suite | 10 checks passed; two 5 MiB files in one request, exact downloaded hashes, oversized-file rejection and cross-workspace denial |
| Actual Render restart | Dashboard recorded restart at 00:07 Malaysia time; seven follow-up checks confirmed unchanged case, policy, historical revision and both 5 MiB original sources |
| Browser workflow | All 520 processed: 63 verified, 46 discrepancy, 20 review, 91 awaiting documents, 300 routed; all counts remained after browser reload following restart |
| Browser scan recovery | `email_512_SI.pdf` rendered and OCR completed; suggestions stayed unconfirmed and Save was disabled; no warning/error entries in the checked browser logs |

These are low-volume synthetic acceptance checks, not a throughput or uptime guarantee. The two maximum-size TXT probes deliberately exceed the extracted-text safety limit: their correct outcome is human review, while their original bytes remain retrievable. That test does not claim automatic extraction of arbitrarily large text.

Reproducible scripts: `scripts/test-api.mjs`, `scripts/test-hardening-api.mjs`, `scripts/test-governance-api.mjs`, and `scripts/test-cloud-boundaries.mjs`. Local evidence is in ignored `work/validation/v3/cloud/`. The restart probe contains a synthetic workspace cookie and must remain private; do not commit that file. The deployed branch also passed all 126 unit tests and type-checking locally before publication.

## Important operating limits

1. Render Free sleeps after inactivity and warns of a wake-up delay of **50 seconds or more**. A natural idle-to-wake cycle was not separately measured in this release; a manual service restart was tested. Open the demo normally before judging and allow time to load. Do not use artificial keep-alive traffic to conceal the limitation.
2. The database token was created with a **30-day expiry on 20 September 2026** and stored only in Render's secret settings. Renew it before approximately **20 October 2026**, or the app will lose database access. Do not put it in source, screenshots or chat.
3. Render's free dashboard gates actual CPU/memory usage charts behind a paid plan. No production memory headroom or sustained-load certification is claimed. No upgrade was enabled to access these charts.
4. Render displayed other repositories after the user completed the GitHub connection. Only CargoGuard was used. Review the GitHub app/OAuth permission scope if it should be limited to this repository; limited scope has not been independently confirmed.
5. Repository visibility was not changed. Its anonymous GitHub API lookup returned 404 while authenticated Git access worked. Public-source access has not been verified; the organiser's public-source requirement still needs the user's visibility review before submission.
6. This remains a synthetic-data hackathon demo, not a corporate production release. It lacks verified staff identity/roles, antivirus, formal retention and backup guarantees, a durable background job queue and comprehensive global abuse protection. Never upload confidential real shipment data.

Passing the recorded tests is evidence of this release's behavior, not a promise of zero future bugs or a championship result. See [DEPLOYMENT.md](DEPLOYMENT.md) for reproduction and the remaining broader acceptance checks.
