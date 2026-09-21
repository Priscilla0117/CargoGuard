import assert from "node:assert/strict";
import fs from "node:fs/promises";

// Run the production HTTP server with deliberately unreachable synthetic DB
// settings. Bypass startup migrations ONLY for this local outage simulation.
// Never invoke against the real deployment or with real credentials.
const target = new URL(process.argv[2] ?? "http://127.0.0.1:3056");
assert.equal(target.protocol, "http:");
assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
assert.ok(
  !target.username && !target.password && !target.search && !target.hash,
);
const origin = target.origin;
const checks = [];
async function get(path) {
  return fetch(origin + path, { signal: AbortSignal.timeout(10000) });
}
const started = performance.now();
const page = await get("/");
assert.equal(page.status, 200);
assert.match(await page.text(), /CargoGuard/);
checks.push(
  "The application shell remains available during the synthetic storage outage",
);
const live = await get("/api/live");
assert.equal(live.status, 200);
const alive = await live.json();
assert.equal(alive.status, "alive");
assert.equal(alive.database_checked, false);
assert.equal(alive.readiness_endpoint, "/api/health");
assert.equal(live.headers.get("cache-control"), "no-store");
checks.push(
  "Process liveness is uncached and explicitly does not claim database readiness",
);
for (const response of await Promise.all(
  Array.from({ length: 8 }, () => get("/api/health")),
)) {
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: "unavailable" });
  checks.push("Storage readiness remains unavailable during the fault");
}
const inbox = await get("/api/inbox");
assert.equal(inbox.status, 503);
const body = await inbox.json();
assert.match(body.error, /Unable to load workspace/);
assert.equal(body.cases, undefined);
checks.push(
  "Inbox returns controlled failure, never fabricated empty or successful results",
);
const after = await get("/api/live");
assert.equal(after.status, 200);
assert.equal((await after.json()).status, "alive");
checks.push("The app stays alive after failed database reads");
const report = {
  origin,
  generated_at: new Date().toISOString(),
  passed: true,
  checks,
  duration_ms: Math.round(performance.now() - started),
  scope:
    "Local production-build simulation with invalid synthetic DB settings, not a live-provider outage test. No startup migrations skipped in normal deployment.",
};
await fs.mkdir("work/validation/v32", { recursive: true });
await fs.writeFile(
  "work/validation/v32/readiness-fault-api.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
