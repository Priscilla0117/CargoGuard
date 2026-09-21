import { test } from "node:test";
import assert from "node:assert/strict";
import { POST as mutateCases, GET as readCase } from "../app/api/cases/route";
import { POST as upload } from "../app/api/upload/route";
import { GET as readDocument } from "../app/api/document/route";
import { readForm, revisionNumber } from "../lib/http";

const workspace = "4b6897b0-cb12-4c69-b918-e5fa6cbbd8bb";

for (const [name, handler] of [
  ["case mutation", mutateCases],
  ["document upload", upload],
] as const) {
  test(`${name} rejects another origin before consuming its body`, async () => {
    const request = new Request("https://cargo.test/api", {
      method: "POST",
      headers: {
        origin: "https://untrusted.test",
        cookie: `cargo_workspace=${workspace}`,
        "content-type": "text/plain",
      },
      body: "malformed and untrusted request",
    });
    const response = await handler(request);
    assert.equal(response.status, 403);
    assert.equal(request.bodyUsed, false);
    const payload = (await response.json()) as { error: string };
    assert.match(payload.error, /Cross-origin/);
  });

  test(`${name} rejects a missing workspace before consuming its body`, async () => {
    const request = new Request("https://cargo.test/api", {
      method: "POST",
      body: "malformed and untrusted request",
    });
    const response = await handler(request);
    assert.equal(response.status, 400);
    assert.equal(request.bodyUsed, false);
    const payload = (await response.json()) as { error: string };
    assert.match(payload.error, /Workspace session expired/);
  });
}

test("unsupported multipart content type is rejected without reading the body", async () => {
  const request = new Request("https://cargo.test/api/upload", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  await assert.rejects(readForm(request), { status: 415 });
  assert.equal(request.bodyUsed, false);
});

test("multipart media types remain case insensitive", async () => {
  const data = new FormData();
  data.append("files", new File(["source bytes"], "shipment.txt"));
  const request = new Request("https://cargo.test/api/upload", {
    method: "POST",
    body: data,
  });
  request.headers.set(
    "content-type",
    request.headers
      .get("content-type")!
      .replace("multipart/form-data", "Multipart/Form-Data"),
  );
  assert.equal(
    ((await readForm(request)).get("files") as File).name,
    "shipment.txt",
  );
});

test("valid history selectors retain exact integer identity", () => {
  assert.equal(revisionNumber(null), undefined);
  assert.equal(revisionNumber("1"), 1);
  assert.equal(
    revisionNumber(String(Number.MAX_SAFE_INTEGER)),
    Number.MAX_SAFE_INTEGER,
  );
});

for (const field of ["id", "version", "actor", "reason", "subject", "body"]) {
  test(`duplicate upload ${field} fields are rejected instead of choosing different values`, async () => {
    const data = new FormData();
    data.append("subject", "Compare attached shipping documents");
    data.append("body", "Compare the SI and draft BL.");
    if (field !== "subject" && field !== "body") data.append(field, "");
    data.append(field, "conflicting second value");
    const response = await upload(
      new Request("https://cargo.test/api/upload", {
        method: "POST",
        headers: { cookie: `cargo_workspace=${workspace}` },
        body: data,
      }),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: string };
    assert.match(payload.error, /Only one .* field is allowed/);
  });
}

for (const revision of [
  "0",
  "-1",
  "1.5",
  "9007199254740992",
  "9".repeat(400),
]) {
  for (const [name, handler] of [
    ["case", readCase],
    ["document", readDocument],
  ] as const) {
    test(`${name} rejects invalid revision ${revision.slice(0, 20)} before storage`, async () => {
      const response = await handler(
        new Request(`https://cargo.test/api?id=unknown&revision=${revision}`),
      );
      assert.equal(response.status, 400);
    });
  }
}
