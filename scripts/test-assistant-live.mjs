import assert from "node:assert/strict";
import fs from "node:fs/promises";

// Not CI: only run with explicit owner approval. At most TWO new provider calls.
// Uses public organiser cases in a fresh QA workspace; never reads an API key.
const origin = process.argv[2];
assert.equal(process.argv[3], "--consent-organiser-two-calls");
assert.ok(!process.argv[4] || process.argv[4] === "--missing-evidence-only");
assert.equal(origin, "https://cargoguard-averis.onrender.com");
const first = await fetch(origin + "/api/inbox", {
  signal: AbortSignal.timeout(90000),
});
assert.equal(first.status, 200);
const cookie = first.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie);
async function call(path, body) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(90000),
  });
  const data = await response.json();
  assert.equal(response.status, 200, data.error ?? "Request failed");
  return data;
}
const observations = [];
const samples = [
  [
    "email_004",
    "Explain the current differences and what to do next. Do not approve the shipment.",
  ],
  [
    "email_506",
    "What evidence is missing, and what should I request before comparison? Do not invent values.",
  ],
];
const selected =
  process.argv[4] === "--missing-evidence-only" ? samples.slice(1) : samples;
for (const [id, question] of selected) {
  await call("/api/cases", { action: "process", ids: [id] });
  const before = await call(`/api/cases?id=${id}`);
  const config = await call("/api/assistant");
  assert.ok(config.enabled);
  const input = {
    id,
    question,
    version: before.result.version,
    parentId: null,
  };
  const preview = await call("/api/assistant", { ...input, action: "preview" });
  assert.equal(
    preview.availability.allowed,
    true,
    preview.availability.reason ?? "No capacity",
  );
  const request = {
    ...input,
    action: "ask",
    requestHash: preview.requestHash,
    externalProcessingConfirmed: true,
  };
  const answer = await call("/api/assistant", request);
  assert.equal(answer.cached, false);
  assert.equal(answer.reply.turns.length, 1);
  assert.equal(config.model, "gpt-5.4-mini");
  assert.match(answer.reply.model, /^gpt-5\.4-mini(?:-\d{4}-\d{2}-\d{2})?$/);
  const budgetAfter = await call("/api/assistant");
  assert.equal(
    budgetAfter.budget.workspaceRemaining,
    config.budget.workspaceRemaining - 1,
  );
  // A cache hit is not another provider call.
  const cachedPreview = await call("/api/assistant", {
    ...input,
    action: "preview",
  });
  assert.equal(cachedPreview.availability.cached, true);
  assert.equal(cachedPreview.availability.reservedTokens, 0);
  const cached = await call("/api/assistant", request);
  assert.equal(cached.cached, true);
  assert.equal(cached.reply.id, answer.reply.id);
  assert.equal(
    (await call("/api/assistant")).budget.workspaceRemaining,
    budgetAfter.budget.workspaceRemaining,
  );
  assert.deepEqual((await call(`/api/cases?id=${id}`)).result, before.result);
  observations.push({
    id,
    originalStatus: before.result.status,
    reservedTokens: preview.availability.reservedTokens,
    reply: answer.reply,
    facts: answer.facts,
    cachedReplay: true,
    caseUnchanged: true,
  });
}
const report = {
  passed: true,
  generated_at: new Date().toISOString(),
  origin,
  provider_calls: selected.length,
  scope:
    "Consented organiser-data smoke cases, not broad model accuracy or safety certification.",
  observations,
};
await fs.mkdir("work/validation/ai-v31", { recursive: true });
await fs.writeFile(
  "work/validation/ai-v31/assistant-live-refresh.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      ...report,
      observations: observations.map(
        ({
          id,
          originalStatus,
          reservedTokens,
          cachedReplay,
          caseUnchanged,
          reply,
        }) => ({
          id,
          originalStatus,
          reservedTokens,
          cachedReplay,
          caseUnchanged,
          latency_ms: reply.latency_ms,
          answer: reply.turns[0].answer,
        }),
      ),
    },
    null,
    2,
  ),
);
