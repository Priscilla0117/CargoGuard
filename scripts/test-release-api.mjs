import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";

// Explicit host only; never inherit credentials from a previous hosting provider.
const target = new URL(process.argv[2] ?? "http://127.0.0.1:3000");
assert.ok(
  ["http:", "https:"].includes(target.protocol) &&
    !target.username &&
    !target.password &&
    target.pathname === "/" &&
    !target.search &&
    !target.hash,
  "Supply an HTTP(S) origin without credentials, query parameters or a path.",
);
const origin = target.origin;
const started = performance.now();
const checks = [];
const requests = [];
const reportPath = "work/validation/v3/release-api.json";
let activeCheck = "initialization";
let engine;

async function check(name, verify) {
  activeCheck = name;
  await verify();
  checks.push({ name, passed: true });
}

async function request(path, options = {}) {
  assert.ok(
    requests.length < 34,
    "The smoke suite must stay below 35 requests.",
  );
  const {
    body,
    cookie,
    foreignOrigin,
    contentType,
    mixedMultipart = false,
  } = options;
  const multipart = body instanceof FormData;
  const json = body !== undefined && !multipart && typeof body !== "string";
  const headers = new Headers({ Origin: foreignOrigin ?? origin });
  if (cookie) headers.set("Cookie", cookie);
  if (contentType || json)
    headers.set("Content-Type", contentType ?? "application/json");
  const outgoing = new Request(origin + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: json ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(90000),
    redirect: "error",
  });
  if (mixedMultipart)
    outgoing.headers.set(
      "Content-Type",
      outgoing.headers
        .get("Content-Type")
        .replace("multipart/form-data", "Multipart/Form-Data"),
    );
  const log = {
    route: new URL(outgoing.url).pathname,
    method: outgoing.method,
  };
  requests.push(log);
  const before = performance.now();
  try {
    const response = await fetch(outgoing);
    const bytes = new Uint8Array(await response.arrayBuffer());
    log.status = response.status;
    log.duration_ms = Math.round(performance.now() - before);
    const text = new TextDecoder().decode(bytes);
    let data = null;
    if (response.headers.get("content-type")?.includes("application/json")) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Server returned invalid JSON.");
      }
    }
    return {
      status: response.status,
      headers: response.headers,
      data,
      text,
      bytes,
    };
  } catch {
    log.duration_ms = Math.round(performance.now() - before);
    throw new Error(
      "Request failed, timed out, redirected or returned invalid JSON.",
    );
  }
}

function errorResponse(response, status, message) {
  assert.equal(response.status, status);
  assert.equal(typeof response.data?.error, "string");
  assert.match(response.data.error, message);
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
}

async function session() {
  const response = await request("/api/inbox");
  assert.equal(response.status, 200);
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("cargo_workspace="))
    ?.split(";")[0];
  assert.ok(
    /^cargo_workspace=[a-f0-9-]{36}$/.test(cookie ?? ""),
    "A valid workspace cookie must be issued.",
  );
  return cookie;
}

function document(role, unit, weight) {
  return [
    role === "SI" ? "SHIPPING INSTRUCTION" : "DRAFT BILL OF LADING",
    "Shipper: RELEASE TEST EXPORT LTD",
    "Consignee: RELEASE TEST IMPORT LTD",
    "Notify Party: SAME AS CONSIGNEE",
    "Port of Loading: SINGAPORE",
    "Port of Discharge: PORT KLANG",
    "Container Count: 2 x 40HC",
    `Gross Weight (${unit}): ${weight}`,
  ].join("\n");
}

function form(blWeight = "42000") {
  const data = new FormData();
  data.set("subject", "Synthetic release check: compare SI and draft BL");
  data.set(
    "body",
    "Please compare the shipping instruction and draft bill of lading across all seven required fields.",
  );
  data.append(
    "files",
    new File([document("SI", "MT", "42")], "release-si.txt"),
  );
  data.append(
    "files",
    new File([document("BL", "KG", blWeight)], "release-bl.txt"),
  );
  return data;
}

let failure;
try {
  await check("health reports ready", async () => {
    const response = await request("/api/health");
    assert.equal(response.status, 200);
    assert.equal(response.data?.status, "ready");
    assert.equal(typeof response.data?.engine, "string");
    engine = response.data.engine;
  });
  let cookie, other;
  await check("fresh synthetic workspaces are distinct", async () => {
    cookie = await session();
    other = await session();
    assert.ok(cookie !== other, "Fresh workspaces must have distinct cookies.");
  });

  for (const path of ["/api/cases", "/api/upload"]) {
    await check(
      `${path} rejects foreign origin before parsing a malformed body`,
      async () => {
        errorResponse(
          await request(path, {
            cookie,
            body: "not valid JSON or multipart",
            contentType: "text/plain",
            foreignOrigin: "https://untrusted.invalid",
          }),
          403,
          /Cross-origin/,
        );
      },
    );
    await check(
      `${path} rejects missing workspace before body parsing`,
      async () => {
        errorResponse(
          await request(path, {
            body: "not valid JSON or multipart",
            contentType: "text/plain",
          }),
          400,
          /Workspace session expired/,
        );
      },
    );
  }
  await check("upload rejects unsupported content type", async () => {
    errorResponse(
      await request("/api/upload", { cookie, body: {} }),
      415,
      /multipart/,
    );
  });
  await check("authenticated malformed JSON is a client error", async () => {
    errorResponse(
      await request("/api/cases", {
        cookie,
        body: "{",
        contentType: "application/json",
      }),
      400,
      /valid UTF-8 JSON/,
    );
  });

  for (const field of ["id", "version", "actor", "reason", "subject", "body"]) {
    await check(`duplicate multipart ${field} is rejected`, async () => {
      const data = form();
      if (!["subject", "body"].includes(field)) data.append(field, "");
      data.append(field, "conflicting second value");
      errorResponse(
        await request("/api/upload", { cookie, body: data }),
        400,
        /Only one .* field is allowed/,
      );
    });
  }
  for (const revision of ["9007199254740992", "9".repeat(400)]) {
    for (const path of ["/api/cases", "/api/document"]) {
      await check(
        `${path} rejects ${revision.length > 20 ? "overflowed" : "unsafe integer"} revision`,
        async () => {
          const response = await request(
            `${path}?id=invalid&revision=${revision}`,
            { cookie },
          );
          assert.equal(response.status, 400);
          assert.match(
            response.data?.error ?? response.text,
            /Invalid revision/,
          );
        },
      );
    }
  }
  await check("42 MT label versus 42 KG label is a real mismatch", async () => {
    const response = await request("/api/upload", { cookie, body: form("42") });
    assert.equal(response.status, 200);
    const result = response.data?.result;
    assert.equal(result?.status, "MISMATCH");
    assert.deepEqual(result.defect_fields, ["gross_weight_kg"]);
    const weight = result.comparison.find(
      (row) => row.field === "gross_weight_kg",
    );
    assert.equal(weight?.si.normalized, 42000);
    assert.equal(weight?.bl.normalized, 42);
  });
  let matched;
  await check(
    "42 MT equals 42000 KG; case-insensitive multipart succeeds",
    async () => {
      const response = await request("/api/upload", {
        cookie,
        body: form(),
        mixedMultipart: true,
      });
      assert.equal(response.status, 200);
      matched = response.data?.result;
      assert.equal(matched?.status, "OK");
      assert.equal(matched.workflow, "verified");
      assert.equal(matched.comparison.length, 7);
      assert.ok(matched.comparison.every((row) => row.result === "match"));
      assert.ok(Number.isSafeInteger(matched.version) && matched.version > 0);
    },
  );
  await check("unknown companion document requires review", async () => {
    const data = form();
    data.delete("files");
    data.append(
      "files",
      new File([document("SI", "MT", "42")], "release-si.txt"),
    );
    data.append(
      "files",
      new File(
        ["Unidentified attachment. Daily office schedule only."],
        "unidentified.txt",
      ),
    );
    const response = await request("/api/upload", { cookie, body: data });
    assert.equal(response.status, 200);
    assert.equal(response.data?.result?.status, "NEEDS_REVIEW");
    assert.notEqual(response.data.result.workflow, "verified");
  });
  await check(
    "third extra attachment is retained and requires explicit pair selection",
    async () => {
      const data = form();
      data.append(
        "files",
        new File(["Unidentified extra evidence"], "extra.txt"),
      );
      const response = await request("/api/upload", { cookie, body: data });
      assert.equal(response.status, 200);
      assert.equal(response.data.result.documents.length, 3);
      assert.equal(response.data.result.status, "NEEDS_REVIEW");
      assert.equal(response.data.result.comparison.length, 0);
    },
  );

  const id = matched.email.email_id;
  let initial;
  await check("saved automatic revision is available", async () => {
    const response = await request(`/api/cases?id=${encodeURIComponent(id)}`, {
      cookie,
    });
    assert.equal(response.status, 200);
    initial = response.data;
    assert.equal(initial.result.version, matched.version);
    assert.equal(initial.revisions[0]?.origin, "automatic");
  });
  const review = {
    action: "review",
    id,
    version: matched.version,
    field: "gross_weight_kg",
    side: "bl",
    actor: "Synthetic release tester",
    reason:
      "Automated synthetic regression only; not a real shipping approval.",
  };
  await check("ambiguous review value is rejected as HTTP 422", async () => {
    errorResponse(
      await request("/api/cases", {
        cookie,
        body: { ...review, value: "unknown" },
      }),
      422,
      /complete, unambiguous field value/,
    );
  });
  let corrected;
  await check(
    "valid human correction commits a new reviewed revision",
    async () => {
      const response = await request("/api/cases", {
        cookie,
        body: { ...review, value: "43000 KG" },
      });
      assert.equal(response.status, 200);
      corrected = response.data.result;
      assert.equal(corrected.version, matched.version + 1);
      assert.equal(corrected.reviewed, true);
      assert.equal(corrected.status, "MISMATCH");
      assert.deepEqual(corrected.defect_fields, ["gross_weight_kg"]);
    },
  );
  await check("stale review is HTTP 409, not a silent overwrite", async () => {
    errorResponse(
      await request("/api/cases", {
        cookie,
        body: { ...review, value: "42000 KG" },
      }),
      409,
      /Case changed/,
    );
  });
  await check(
    "invalid and stale reviews add no event or revision",
    async () => {
      const response = await request(
        `/api/cases?id=${encodeURIComponent(id)}`,
        { cookie },
      );
      assert.equal(response.status, 200);
      assert.equal(response.data.result.version, corrected.version);
      assert.equal(response.data.result.status, "MISMATCH");
      assert.equal(response.data.audit.length, initial.audit.length + 1);
      assert.equal(
        response.data.revisions.length,
        initial.revisions.length + 1,
      );
      assert.equal(response.data.revisions[0]?.origin, "reviewed");
    },
  );
  const source = matched.documents[0];
  const sourcePath = `/api/document?id=${encodeURIComponent(id)}&name=${encodeURIComponent(source.name)}&revision=${matched.version}`;
  await check(
    "original automatic revision source bytes remain unchanged",
    async () => {
      const response = await request(sourcePath, { cookie });
      assert.equal(response.status, 200);
      assert.equal(
        createHash("sha256").update(response.bytes).digest("hex"),
        source.sha256,
      );
    },
  );
  await check("another workspace cannot load the synthetic case", async () => {
    errorResponse(
      await request(`/api/cases?id=${encodeURIComponent(id)}`, {
        cookie: other,
      }),
      404,
      /not been processed/,
    );
  });
  await check(
    "another workspace cannot load revision source bytes",
    async () => {
      assert.equal((await request(sourcePath, { cookie: other })).status, 404);
    },
  );
} catch (error) {
  failure = {
    check: activeCheck,
    message: error instanceof Error ? error.message : "Unknown failure",
  };
  process.exitCode = 1;
}

const report = {
  format: "cargoguard-release-api-smoke-v1",
  generated_at: new Date().toISOString(),
  base_url: origin,
  engine,
  passed: !failure,
  checks_passed: checks.length,
  request_count: requests.length,
  elapsed_ms: Math.round(performance.now() - started),
  checks,
  requests,
  ...(failure ? { failure } : {}),
  limits: [
    "Synthetic smoke checks only; not production load or security certification.",
    "Multi-attachment intake retains companions and requires explicit valid SI/BL pair selection; it does not silently verify every attachment.",
    "Source bodies, workspace cookies and authentication tokens are not included in this report.",
  ],
};
await fs.mkdir("work/validation/v3", { recursive: true });
await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify(
    {
      passed: report.passed,
      checks_passed: checks.length,
      request_count: requests.length,
      elapsed_ms: report.elapsed_ms,
      report: reportPath,
      ...(failure ? { failure } : {}),
    },
    null,
    2,
  ),
);
