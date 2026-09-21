import { test } from "node:test";
import assert from "node:assert/strict";
import { GET, dynamic } from "../app/api/live/route";
import { PIPELINE_VERSION } from "../lib/types";

test("process liveness does not claim database readiness or cache a healthy result", async () => {
  const response = await GET();
  assert.equal(dynamic, "force-dynamic");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), {
    status: "alive",
    engine: PIPELINE_VERSION,
    database_checked: false,
    readiness_endpoint: "/api/health",
  });
});
