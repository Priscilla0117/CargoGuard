import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import { revisionDiff, revisionSourceUrl } from "../lib/revision-diff";
import { FIELDS, type CaseResult } from "../lib/types";

const fields =
  "Shipper: Atlas Export\nConsignee: Buyer Two\nNotify party: SAME AS CONSIGNEE\nPort of loading: Port Klang\nPort of discharge: Singapore\nContainer count: 2\nGross weight (KG): 42000";
async function fixture(bl = fields, si = fields): Promise<CaseResult> {
  const result = analyze(
    {
      email_id: "revision-test",
      from: "desk@example.test",
      subject: "Verify draft BL against SI",
      body: "Please compare the attached SI and draft BL and report differences.",
      attachments: ["source.txt", "draft.txt"],
    },
    await Promise.all([
      parseDocument(
        "source.txt",
        new TextEncoder().encode(`SHIPPING INSTRUCTION\n${si}`),
      ),
      parseDocument(
        "draft.txt",
        new TextEncoder().encode(`DRAFT BILL OF LADING\n${bl}`),
      ),
    ]),
  );
  return { ...result, version: 1 };
}
const current = (r: CaseResult) => ({ ...r, version: 2 });
test("unchanged comparison accounts for all seven fields and mutates neither revision", async () => {
  const before = await fixture(),
    after = current(before),
    original = JSON.stringify([before, after]);
  const d = revisionDiff(before, after);
  assert.equal(d.changes.length, 7);
  assert.equal(d.counts.unchanged, 7);
  assert.equal(d.remaining, 0);
  assert.equal(JSON.stringify([before, after]), original);
});
test("an issuer correction becomes now-matches, not automatic case approval", async () => {
  const before = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  const d = revisionDiff(before, current(await fixture()));
  assert.equal(d.counts.fixed, 1);
  assert.equal(
    d.changes.find((r) => r.field === "container_count")?.kind,
    "fixed",
  );
  assert.equal(d.referenceChanged, false);
  assert.equal(d.remaining, 0);
});
test("a revision can fix one issue, introduce another and retain a third", async () => {
  const before = await fixture(
    fields
      .replace("Container count: 2", "Container count: 4")
      .replace("Gross weight (KG): 42000", "Gross weight (KG): unknown"),
  );
  const after = current(
    await fixture(
      fields
        .replace("Port of discharge: Singapore", "Port of discharge: Hamburg")
        .replace("Gross weight (KG): 42000", "Gross weight (KG): unknown"),
    ),
  );
  const d = revisionDiff(before, after);
  assert.equal(d.counts.fixed, 1);
  assert.equal(d.counts.new_issue, 1);
  assert.equal(d.counts.unresolved, 1);
  assert.equal(d.remaining, 2);
});
test("mismatch becoming uncertain is still unresolved, not fixed", async () => {
  const before = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  const after = current(
    await fixture(
      fields.replace("Container count: 2", "Container count: unknown"),
    ),
  );
  const d = revisionDiff(before, after);
  assert.equal(d.counts.fixed, 0);
  assert.equal(d.counts.unresolved, 1);
});
test("a matching field becoming unreadable is a new issue", async () => {
  const before = await fixture();
  const after = current(
    await fixture(
      fields.replace("Container count: 2", "Container count: unknown"),
    ),
  );
  assert.equal(revisionDiff(before, after).counts.new_issue, 1);
});
test("removing comparison rows leaves all fields not compared", async () => {
  const before = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  const d = revisionDiff(before, {
    ...current(before),
    comparison: [],
    status: "NEEDS_REVIEW",
    workflow: "review",
  });
  assert.equal(d.counts.not_compared, 7);
  assert.equal(d.counts.fixed, 0);
  assert.equal(d.remaining, 7);
});
test("routing away cannot masquerade as a corrected document, even with stale rows", async () => {
  const before = await fixture();
  const d = revisionDiff(before, {
    ...current(before),
    category: "GENERAL",
    workflow: "routed",
  });
  assert.equal(d.categoryChanged, true);
  assert.equal(d.counts.not_compared, 7);
  assert.equal(d.remaining, 7);
});
test("first complete comparison after missing attachments is now checked, not seven fixes", async () => {
  const before = {
    ...(await fixture()),
    comparison: [],
    status: "NEEDS_REVIEW" as const,
  };
  const d = revisionDiff(before, current(await fixture()));
  assert.equal(d.counts.now_checked, 7);
  assert.equal(d.counts.fixed, 0);
});
test("newly available mismatches are unresolved rather than previously matching fields", async () => {
  const before = { ...(await fixture()), comparison: [] };
  const d = revisionDiff(
    before,
    current(
      await fixture(fields.replace("Container count: 2", "Container count: 4")),
    ),
  );
  assert.equal(d.counts.unresolved, 1);
  assert.equal(d.counts.new_issue, 0);
  assert.equal(d.counts.now_checked, 6);
});
test("SI changing to match BL produces an explicit reference-change warning", async () => {
  const changed = fields.replace("Container count: 2", "Container count: 4");
  const d = revisionDiff(
    await fixture(changed),
    current(await fixture(changed, changed)),
  );
  assert.equal(d.counts.fixed, 1);
  assert.equal(d.referenceChanged, true);
  assert.equal(
    d.changes.find((r) => r.field === "container_count")?.referenceChanged,
    true,
  );
});
test("matching pair changed on both sides is a values change, never silently unchanged", async () => {
  const changed = fields.replace("Container count: 2", "Container count: 4");
  const d = revisionDiff(
    await fixture(),
    current(await fixture(changed, changed)),
  );
  assert.equal(d.counts.changed, 1);
  assert.equal(d.counts.unchanged, 6);
});
test("normalization-equivalent raw edits remain visible", async () => {
  const before = await fixture(),
    after = structuredClone(current(before));
  after.comparison[0].bl.raw += " ";
  const d = revisionDiff(before, after);
  assert.equal(d.counts.changed, 1);
});
test("match flag with missing or uncertain values is never counted as fixed", async () => {
  const before = await fixture(
    fields.replace("Container count: 2", "Container count: 4"),
  );
  for (const invalid of [
    { normalized: null },
    { issue: "Uncertain source" },
    { extraction_issue: "Conflicting evidence" },
    { raw: " " },
  ]) {
    const after = structuredClone(current(await fixture()));
    const row = after.comparison.find((r) => r.field === "container_count")!;
    Object.assign(row.bl, invalid);
    assert.equal(revisionDiff(before, after).counts.fixed, 0);
    assert.equal(revisionDiff(before, after).remaining, 1);
  }
});
test("engine and policy changes are separately signalled", async () => {
  const before = await fixture(),
    after = current(before);
  after.pipeline_version = "another-engine";
  after.policy = {
    ...before.policy!,
    version: (before.policy?.version ?? 0) + 1,
  };
  const d = revisionDiff(before, after);
  assert.equal(d.engineChanged, true);
  assert.equal(d.policyChanged, true);
});
test("cross-case and invalid revision comparisons fail closed", async () => {
  const before = await fixture();
  assert.throws(
    () =>
      revisionDiff(before, {
        ...current(before),
        email: { ...before.email, email_id: "other" },
      }),
    /same case/,
  );
  for (const version of [0, 1, -1, 1.5, NaN, Infinity])
    assert.throws(
      () => revisionDiff(before, { ...before, version }),
      /earlier saved revision/,
    );
  assert.throws(
    () => revisionDiff({ ...before, version: 0 }, current(before)),
    /earlier/,
  );
});
test("duplicate or unknown field rows fail closed", async () => {
  const before = await fixture();
  assert.throws(
    () =>
      revisionDiff(before, {
        ...current(before),
        comparison: [...before.comparison, before.comparison[0]],
      }),
    /duplicate/,
  );
  const invalid = structuredClone(current(before));
  invalid.comparison[0].field = "invented" as (typeof FIELDS)[number];
  assert.throws(() => revisionDiff(before, invalid), /invalid/);
});
test("source URLs are bound to known documents and the exact saved revision", async () => {
  const r = await fixture();
  assert.equal(revisionSourceUrl(r, "missing.txt"), null);
  assert.equal(revisionSourceUrl({ ...r, version: 0 }, "source.txt"), null);
  r.email.email_id = "a/b & c";
  r.documents[0].name = "SI & BL #1.txt";
  assert.equal(
    revisionSourceUrl(r, r.documents[0].name),
    "/api/document?id=a%2Fb%20%26%20c&name=SI%20%26%20BL%20%231.txt&revision=1",
  );
});
