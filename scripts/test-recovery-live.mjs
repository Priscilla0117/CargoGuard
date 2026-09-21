import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { FIELDS } from "../lib/types.ts";
import { normalizeValue } from "../lib/normalization.ts";

// Deliberately NOT part of CI: requires explicit owner consent and spends two
// server-side provider attempts. Never reads, accepts or prints an API key.
const origin = process.argv[2];
assert.equal(process.argv[3], "--consent-synthetic-two-calls");
assert.ok(origin?.startsWith("https://"));
const fixturesBytes = await fs.readFile(
  "tests/fixtures/ai-recovery-challenge.json",
);
const fixtures = JSON.parse(fixturesBytes.toString()).fixtures;
const selected = ["recovery-03", "recovery-02"].map((id) =>
  fixtures.find((f) => f.id === id),
);
let checks = 0;
const observations = [];
const check = (condition, message) => {
  assert.ok(condition, message);
  checks++;
};
const session = async () => {
  const r = await fetch(origin + "/api/inbox");
  assert.equal(r.status, 200);
  return r.headers.get("set-cookie").split(";")[0];
};
const cookie = await session(),
  other = await session();
const call = async (path, body, ws = cookie) => {
  const r = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: ws,
      Origin: origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  return { status: r.status, data: await r.json() };
};
let passed = false;
try {
  const config = await call("/api/recovery");
  check(
    config.status === 200 &&
      config.data.enabled &&
      config.data.provider === "openai",
    "real provider configured",
  );
  const form = new FormData();
  form.set(
    "subject",
    "Compare the attached SI and draft BL — synthetic acceptance test",
  );
  form.set(
    "body",
    "Please verify the draft bill of lading against the shipping instruction. Synthetic software test, not a real shipment.",
  );
  for (const fixture of selected)
    form.append(
      "files",
      new File(
        [fixture.source.spans.map((s) => s.text).join("\n")],
        fixture.source.name,
      ),
    );
  const uploaded = await fetch(origin + "/api/upload", {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
    body: form,
  });
  const uploadedData = await uploaded.json();
  check(
    uploaded.status === 200,
    "synthetic unfamiliar-layout sources uploaded",
  );
  let result = uploadedData.result;
  check(
    result.status === "NEEDS_REVIEW",
    "deterministic baseline cannot silently clear unfamiliar layouts",
  );
  const id = result.email.email_id;
  for (const fixture of selected) {
    const sourceHash = createHash("sha256")
      .update(fixture.source.spans.map((s) => s.text).join("\n"))
      .digest("hex");
    const doc = result.documents.find((d) => d.sha256 === sourceHash);
    check(
      !!doc,
      "uploaded document located by exact source-byte hash, independent of safe filename prefix",
    );
    const request = {
      action: "suggest",
      id,
      version: result.version,
      name: doc.name,
      sha256: doc.sha256,
      externalProcessingConfirmed: true,
    };
    check(
      (
        await call("/api/recovery", {
          ...request,
          externalProcessingConfirmed: false,
        })
      ).status === 400,
      "explicit consent is mandatory",
    );
    check(
      (await call("/api/recovery", request, other)).status === 404,
      "other workspace cannot spend on or read this source",
    );
    const response = await call("/api/recovery", request);
    observations.push({
      fixture: fixture.id,
      status: response.status,
      response: response.data,
    });
    check(
      response.status === 200 && response.data.cached === false,
      `real provider response for ${fixture.id}: ${response.data.error ?? ""}`,
    );
    const proposal = response.data.proposal;
    check(
      proposal.provider === "openai" &&
        proposal.usage?.total_tokens > 0 &&
        proposal.latency_ms > 0,
      "actual provider usage and latency captured",
    );
    check(proposal.role === fixture.declared_role, "document role is correct");
    for (const field of FIELDS) {
      const suggestion = proposal.fields[field];
      check(
        suggestion && !suggestion.issue,
        `${fixture.id}/${field} has usable evidence`,
      );
      for (const citation of [
        ...suggestion.citations,
        ...(suggestion.unit_citation ? [suggestion.unit_citation] : []),
      ]) {
        check(
          doc.lines[citation.line - 1]?.text.includes(citation.quote),
          `${field} quote exists verbatim`,
        );
      }
      // Fixtures carry human-adjudicated values; they are never sent to OpenAI.
      const expected = fixture.expected.fields[field];
      const expectedInput =
        field === "gross_weight_kg"
          ? `${expected.normalized} KG`
          : expected.value;
      assert.equal(
        normalizeValue(field, suggestion.value).value,
        normalizeValue(field, expectedInput).value,
        `${fixture.id}/${field} semantic value`,
      );
      checks++;
    }
    const unchanged = await call(`/api/cases?id=${encodeURIComponent(id)}`);
    check(
      unchanged.data.result.version === result.version &&
        unchanged.data.result.status === result.status,
      "suggestion alone changes no verdict or revision",
    );
    const cached = await call("/api/recovery", request);
    check(
      cached.data.cached === true && cached.data.proposal.id === proposal.id,
      "repeat suggestion uses immutable cache, not another provider attempt",
    );
    const confirmation = {
      action: "confirm",
      id,
      version: result.version,
      name: doc.name,
      sha256: doc.sha256,
      proposalId: proposal.id,
      role: fixture.declared_role,
      confirmed: Object.fromEntries(FIELDS.map((f) => [f, true])),
      actor: "Automated synthetic QA",
      reason:
        "All seven proposed values and exact quotations checked against the independently authored synthetic fixture. Not a real shipment review.",
    };
    check(
      (
        await call("/api/recovery", {
          ...confirmation,
          confirmed: { ...confirmation.confirmed, shipper: false },
        })
      ).status === 400,
      "one unchecked field prevents save",
    );
    const confirmed = await call("/api/recovery", confirmation);
    check(
      confirmed.status === 200 && confirmed.data.result.reviewed === true,
      "confirmed source creates explicitly reviewed revision",
    );
    result = confirmed.data.result;
    check(
      (await call("/api/recovery", confirmation)).status === 409,
      "stale confirmation cannot overwrite a new revision",
    );
  }
  check(
    result.has_defect &&
      result.defect_fields.length === 6 &&
      !result.defect_fields.includes("port_of_discharge"),
    "recovered SI/BL compare as six real differences, not automatic approval",
  );
  const reprocessed = await call("/api/cases", {
    action: "process",
    ids: [id],
  });
  check(
    reprocessed.status === 200 &&
      reprocessed.data.results[0].reviewed === true &&
      reprocessed.data.results[0].defect_fields.length === 6,
    "confirmed hash-bound evidence survives reprocessing",
  );
  passed = true;
} catch (error) {
  observations.push({
    failure: error instanceof Error ? error.message : "Unknown test failure",
  });
  process.exitCode = 1;
} finally {
  const report = {
    passed,
    checks,
    origin,
    generated_at: new Date().toISOString(),
    fixture_sha256: createHash("sha256").update(fixturesBytes).digest("hex"),
    scope:
      "Two live synthetic unfamiliar-layout documents only; not a production accuracy estimate. No API key read or stored. Automated fixture confirmation is explicitly labelled as QA.",
    observations,
  };
  await fs.writeFile(
    "work/validation/ai-v31/live-recovery.json",
    JSON.stringify(report, null, 2),
  );
  console.log({
    passed,
    checks,
    observations: observations.map((o) => ({
      fixture: o.fixture,
      status: o.status,
      failure: o.failure,
      provider: o.response?.proposal?.provider,
      model: o.response?.proposal?.resolved_model,
      latency_ms: o.response?.proposal?.latency_ms,
      usage: o.response?.proposal?.usage,
      error: o.response?.error,
    })),
  });
}
