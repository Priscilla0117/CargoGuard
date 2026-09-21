# Database capacity incident — 21 September 2026

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

Deployment and hosted recovery are **not yet confirmed**. This record will be
updated with the exact release and hosted checks after verification. Application
timeouts improve failure containment; they cannot create capacity at the provider.

The earlier 200-check hosted acceptance remains a dated pre-incident result, not
a claim that this later outage did not occur. See [Render's health-check behavior](https://render.com/docs/health-checks).
