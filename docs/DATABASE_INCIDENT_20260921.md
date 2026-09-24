# Database capacity incident — 21 September 2026

## Later restart-loop finding — 19:25 MYT, 3.2 deployment

Render initially marked `eeafff2` live at 19:24:27. Public health returned 200
with engine 3.2.0, but the first acceptance session failed with a gateway 502
before its mutation tests began. Render Events subsequently reported an HTTP
health-check 503, followed by exit-status-1 startup failures. Earlier 18:05 and
18:20 events show the same dependency-triggered restart pattern on the previous
release. This is not evidence of successful hosted acceptance.

The Turso dashboard still showed reads/writes enabled and about 108.69 MB stored.
A single read-only `SELECT 1` diagnostic returned 1; its console displayed five
seconds. This shows that one query succeeded, not that every cloud request was
healthy. The new logs do not establish whether the underlying cause was the
earlier capacity condition, latency, or another transient provider fault.

Version 3.2.1 adds `/api/live`, an uncached process-only endpoint that explicitly
reports `database_checked: false`. Render's process probe uses it; the separate
`/api/health` endpoint remains a bounded database-readiness check and returns 503
on failure. This prevents a later external database outage from restarting an
otherwise responsive application and hiding its controlled failure interface.
It does not make database-dependent operations available while storage is down.
Normal startup still verifies migrations before starting the HTTP server; no
schema check or persistent-storage requirement is skipped.

This choice responds to Render's documented restart semantics:
[health-check failure handling](https://render.com/docs/health-checks).
Release acceptance requires both real storage readiness and workspace read/write
tests, not just the liveness response or the Render "Live" label. A local
production-build simulation with invalid synthetic database settings passed 12
checks: the shell/liveness remained available while all eight readiness probes
and the inbox correctly returned 503. Hosted release results are recorded in
CLOUD_RELEASE.md. The earlier dated recovery record below is preserved.

## Observed failure

At **17:27 MYT**, Render recorded an instance failure because the configured HTTP
health check exceeded its five-second deadline. A subsequent public health request
returned HTTP 502. The failed instance restarted but its previously fast migration
checks took minutes. A manual recovery restart was recorded at **17:35 MYT**.

At **17:36:15** and **17:36:53 MYT**, the new instance logged the database driver's
`SQLITE_UNKNOWN` error: **Server database capacity temporarily exceeded, please try
again later**. This is direct evidence of the database provider rejecting requests;
it is not evidence that a particular UI button, AI request or bad document caused
the outage. The provider's underlying capacity condition is outside the app's
control. A database marked Active in its dashboard is not proof queries succeed.

Turso showed reads and writes enabled, about 108.63 MB stored, 196,466 rows read and
80,558 rows written when inspected. No data, credentials, plan, access settings or
database region was changed. The database console subsequently displayed all five
applied migration records; that read alone is not full application recovery.

## Reliability changes

- Database HTTP requests have a 15-second network deadline covering both response
  headers and body, with caller cancellation preserved. No automatic SQL replay:
  a timed-out write may already have committed.
- Health checks use an independent connection with a two-second network deadline,
  a three-second overall probe deadline, single-flight deduplication and a short
  one-second result cache. A failed or timed-out database check still returns 503,
  never a fabricated healthy result. The Render health-check path is unchanged.
- Normal restarts use two read queries to verify applied migrations, instead of
  opening write transactions for every already-applied migration. New migrations
  still recheck inside a transaction and commit atomically with their tracking row.
- Startup has a 60-second migration-process ceiling and exits on failure. It never
  silently uses temporary local storage or starts with skipped migrations.
- Non-JSON 502/503/504 responses receive an actionable message. Users are asked to
  check saved progress before repeating a mutation; saves and AI calls are not
  automatically repeated.

## Verification and release state

The local eight-step gate passed: **329 tests in 22 files**, typecheck, lint,
770-input integrity, supplied-corpus evaluation, independent scorer, OCR assets
and production build. All **200 local HTTP checks** passed at **17:44 MYT**.
The supplied 520-case output is unchanged. Fifteen new regressions cover real
stalled HTTP headers/body, cancellation, no replay, overlapping/hung health checks,
capacity rejection, recovery, restart behavior and migration rollback.

The initial migration tests incorrectly used an anonymous in-memory SQLite database,
which is not shared across libSQL's interactive transaction connections. They were
corrected to isolated ignored QA files before the final passing run. No live data
was involved. No valid AI-provider request was made in these tests.

## Verified recovery

Runtime commit **`9ae3b8bb0c9a068da8fc81e76eac8343304e7c9f`**, existing deployment
branch `cargoguard-v3-deploy`, Render deployment **`dep-daofq9mk1f9s73btquig`**.
Started **17:47:18 MYT**; Render confirmed **Deploy succeeded / Live** after
**2m40s**. The new process began at 17:49:41, reported all five migrations ready
at 17:49:45 and started Next.js at 17:49:48. No schema migration was added.

- Public `/api/health` returned **200**, `ready`, engine 3.1.0 in **262 ms**.
- **15 hosted revision-flow checks** passed at **17:50:40 MYT**: synthetic upload,
  document replacement, persistence, immutable history, exact original/replacement
  source retrieval, routing changes and workspace isolation.
- **25 hosted assistant preflight checks** passed at **17:50:46 MYT**, with zero
  provider calls. This is not a new AI-answer-quality evaluation.
- **Seven retained-data checks** passed at **17:50:59 MYT**: unchanged saved case
  and policy, available historical revision, exact hashes for both retained 5 MiB
  files and denial to another workspace. No existing user data was edited.
- The existing browser workspace reloaded **all 520 saved cases**, with the same
  action counts and case 004's revision 3/seven fields. Historical comparison also
  loaded. No warnings/errors appeared in the inspected browser log after recovery.
- **Nine additional local production-build fault checks** passed against an
  intentionally invalid synthetic database: eight simultaneous health requests
  returned 503 and inbox loading returned controlled JSON 503, all within 447 ms
  in that run. No valid credentials or live database were used for this fault test.

This release has **47 hosted acceptance/persistence checks**, in addition to the
200 local HTTP checks and nine local fault checks. The full 200-check
hosted suite was intentionally not rerun immediately after a provider capacity
incident. Hosted tests were small, isolated and made no paid AI requests.

Application timeouts improve failure containment; they cannot create capacity at
the provider. The database became accessible during recovery; the observations do
not prove the application patch alone resolved Turso's underlying capacity condition.
Free-tier wake-up and provider outages remain possible. No sustained-load, uptime
or zero-bug guarantee is claimed. Later documentation commits are not new runtimes.

The earlier 200-check hosted acceptance remains a dated pre-incident result, not
a claim that this later outage did not occur. See [Render's health-check behavior](https://render.com/docs/health-checks).
