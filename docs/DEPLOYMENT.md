# CargoGuard — deployment

CargoGuard 3.2.1 uses **Next.js/Node on Render with persistent Turso/libSQL storage**. The default deployment is not the historical Worker/D1/R2 adapter.

Public prototype: [CargoGuard](https://cargoguard-averis.onrender.com/). Dated acceptance results and known limitations: [cloud validation](CLOUD_RELEASE.md) and [verification report](SUBMISSION_CHECK.md).

## Reproduce the hosted service

1. Use the source at the repository root and select the intended commit/branch. The current `main` includes the released application. A source update alone does not establish a successful deployment.
2. Create a **libSQL-compatible** Turso database. Use a database-scoped read/write token with migration permission. Put the URL and token in the host's secret environment settings, never in Git.
3. Create a Render Node web service using [render.yaml](../render.yaml):
   - Runtime: Node **24.14.0** in the supplied blueprint.
   - Build: `npm ci --include=dev --no-audit --no-fund && npm run build`.
   - Start: `npm start`.
   - Process-health path: `/api/live`.
   - Select the intended plan and region; monitor current provider/account quotas.
4. Configure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`. **Do not set `CARGO_LOCAL_DB` on Render**: live data must survive process replacement.
5. Render's trusted `RENDER_EXTERNAL_URL` supports the origin check. For a custom domain, set `CARGO_PUBLIC_ORIGIN=https://your-exact-domain`.
6. Startup applies versioned transactional SQL migrations before serving. Both `/api/live` and `/api/health` must return HTTP 200, and actual workspace reads/saves must pass.

Use [the local setup guide](DEVELOPMENT.md) for SQLite development and test commands. Turso's native engine and libSQL are distinct; this adapter targets libSQL.

## Optional OpenAI assistance

Classification, exact comparison and manual review do not require an LLM key. To enable evidence recovery and case chat, set these server-only variables:

```text
CARGO_AI_PROVIDER=openai
CARGO_AI_MODEL=gpt-5.4-mini
CARGO_AI_API_KEY=<restricted project key>
```

Never use a `NEXT_PUBLIC_` prefix or commit real environment files. See [.env.example](../.env.example), [the model card](MODEL_CARD.md) and [case-assistant safeguards](CASE_ASSISTANT.md).

Judges need no personal provider key. Requests require a sharing preview/consent and consume shared persistent allowances. Current application bounds are 50 attempts globally per UTC day, 10 per workspace/day, 100 lifetime, 500,000 reserved token units/day and 1,000,000 lifetime. Other input/concurrency/provider bounds can stop requests sooner. Failed attempts count; process restarts and new cookies do not reset global usage.

Removing `CARGO_AI_PROVIDER` disables new external requests without removing saved evidence. Provider failure must not create a comparison verdict or silently save a proposal. Use only organiser/synthetic text in this public prototype.

## Acceptance checks

Run `npm run quality -- --build` first with the organiser-path overrides in [DEVELOPMENT.md](DEVELOPMENT.md#full-organiser-evaluation). It generates the baseline required by the core API suite. Run mutation tests only against an explicitly approved test workspace/service.

```text
node scripts/test-api.mjs https://YOUR-ASSIGNED-HOST
node scripts/test-hardening-api.mjs https://YOUR-ASSIGNED-HOST
node scripts/test-governance-api.mjs https://YOUR-ASSIGNED-HOST
node scripts/test-release-api.mjs https://YOUR-ASSIGNED-HOST
node --import tsx scripts/test-revision-api.ts https://YOUR-ASSIGNED-HOST
node scripts/test-assistant-api.mjs https://YOUR-ASSIGNED-HOST
node --import tsx scripts/test-review-workspace-api.ts https://YOUR-ASSIGNED-HOST
```

This is a reproduction checklist, not a claim that every suite ran against every historical release. The dated cloud report identifies the hosted subset; assistant preflight does not test real model-answer quality.

Check original downloads, supported upload boundaries, source-pair exclusions, correction previews, stale-write rejection, historical snapshots and isolation between browser workspaces. Verify retained cases, policies and original source hashes after restart and idle wake-up. Independently score an untouched automatic export; agreement with local predictions alone is not independent accuracy evidence.

## Failure and capacity boundaries

- `/api/live` checks the process only. `/api/health` checks database/schema readiness and returns a controlled 503 during storage failure. Process liveness is not proof of working storage.
- Database writes fail closed and are not automatically replayed. A response with an unknown commit outcome requires inspection, not a blind retry.
- Free hosting can sleep and has resource quotas; temporary local disks are not persistent storage. This deployment has no uptime or sustained-throughput certification.
- Intake accepts 0–10 files; replacement 2–10. Bounds are 5 MiB/file, 20 MiB combined and a 21 MiB multipart request. One selected SI/BL pair is compared; other files remain unverified.
- The demo's shared 256 MiB attachment-byte cap is not a complete database-size or account-spending cap.
- Corporate SSO/RBAC, malware screening, formal retention, queued processing and managed large-file storage are production prerequisites, not delivered features.
