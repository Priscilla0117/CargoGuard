import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import { saveCases } from "../lib/storage";
import { parseDocument } from "../lib/parsers";
import { analyze, extract } from "../lib/compare";
import {
  applyLabelRules,
  createLabelProposal,
  labelProposal,
  resultWithLabelRules,
  templateSignature,
  type LabelRule,
} from "../lib/label-rules";
import {
  decideLabelRule,
  getRulePreview,
  labelRuleSummary,
  listLabelRules,
  loadLabelRules,
  proposeLabelRule,
} from "../lib/label-rule-storage";
import type { CaseResult } from "../lib/types";

const fields =
  "Shipper: Atlas Export\nConsignee: Buyer Two\nNotify party: SAME AS CONSIGNEE\nPort of loading: Port Klang\nPort of discharge: Singapore\nContainer count: 2\nGross weight (KG): 42000";
async function sample(): Promise<CaseResult> {
  const docs = await Promise.all([
    parseDocument(
      "si.txt",
      new TextEncoder().encode(`SHIPPING INSTRUCTION\n${fields}`),
    ),
    parseDocument(
      "bl.txt",
      new TextEncoder().encode(
        `DRAFT BILL OF LADING\n${fields.replace("Port of loading:", "Lading location:")}`,
      ),
    ),
  ]);
  return {
    ...analyze(
      {
        email_id: "alias-case",
        from: "fixture@example.test",
        subject: "Verify draft BL against SI",
        body: "Please compare attached SI and draft BL",
        attachments: ["si.txt", "bl.txt"],
      },
      docs,
    ),
    version: 1,
  };
}
async function fixture() {
  const client = createClient({ url: ":memory:" });
  for (const filename of (await fs.readdir("drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await client.executeMultiple(
      await fs.readFile(`drizzle/${filename}`, "utf8"),
    );
  const { DB } = createNodeBindings(client),
    result = await sample();
  await saveCases(
    "w",
    [
      {
        result,
        expected: 0,
        action: "PROCESSED",
        actor: "Test",
        detail: "Synthetic fixture",
      },
    ],
    DB,
  );
  return { client, DB, result };
}
function proposal(source: CaseResult) {
  return labelProposal.parse({
    action: "propose",
    id: source.email.email_id,
    case_version: source.version,
    sha256: source.documents[1].sha256,
    label: "Lading location",
    field: "port_of_loading",
    actor: "Test Operator",
  });
}
async function approve(
  f: Awaited<ReturnType<typeof fixture>>,
  rule: LabelRule,
) {
  const preview = await getRulePreview("w", rule.id, f.DB);
  return decideLabelRule(
    "w",
    {
      action: "approve",
      rule_id: rule.id,
      version: rule.version,
      actor: "Test Reviewer",
      preview_token: preview.token,
      acknowledge_new_verified: true,
    },
    f.DB,
  );
}

test("proposal binds to current original source and stores no shipment values", async () => {
  const source = await sample(),
    rule = await createLabelProposal(source, proposal(source));
  assert.equal(rule.state, "proposed");
  assert.equal(rule.label, "LADING LOCATION");
  assert.equal(rule.source_sha256, source.documents[1].sha256);
  for (const secret of [
    "Atlas Export",
    "Buyer Two",
    "42000",
    "fixture@example.test",
  ])
    assert.ok(!JSON.stringify(rule).includes(secret));
  await assert.rejects(
    () =>
      createLabelProposal(source, {
        ...proposal(source),
        sha256: "a".repeat(64),
      }),
    { status: 422 },
  );
  await assert.rejects(
    () => createLabelProposal(source, { ...proposal(source), case_version: 2 }),
    { status: 409 },
  );
  await assert.rejects(
    () =>
      createLabelProposal(source, { ...proposal(source), label: "Port Klang" }),
    { status: 422 },
  );
  await assert.rejects(
    () =>
      createLabelProposal(source, {
        ...proposal(source),
        label: "Port of discharge",
      }),
    { status: 422 },
  );
  assert.equal(
    labelProposal.safeParse({
      ...proposal(source),
      value: "new shipment value",
    }).success,
    false,
  );
});
test("template signature changes for role, format or heading set, never shipment values", async () => {
  const source = await sample(),
    doc = source.documents[1],
    signature = await templateSignature(doc);
  assert.equal(
    await templateSignature({
      ...doc,
      lines: doc.lines.map((line) => ({
        ...line,
        text: line.text
          .replace("42000", "43000")
          .replace("Atlas Export", "Other Exporter"),
      })),
    }),
    signature,
  );
  assert.notEqual(await templateSignature({ ...doc, type: "SI" }), signature);
  assert.notEqual(
    await templateSignature({ ...doc, format: "pdf" }),
    signature,
  );
  assert.notEqual(
    await templateSignature({
      ...doc,
      lines: [
        ...doc.lines,
        { text: "Delivery route: New route", location: "Line 9" },
      ],
    }),
    signature,
  );
});
test("only active exact-scope aliases apply, preserve bytes/values and remain reviewed", async () => {
  const source = await sample(),
    proposed = await createLabelProposal(source, proposal(source));
  assert.notEqual(source.workflow, "verified");
  assert.equal(
    (await resultWithLabelRules(source, [proposed])).workflow,
    source.workflow,
  );
  const active: LabelRule = { ...proposed, state: "active", version: 2 };
  const result = await resultWithLabelRules(source, [active]);
  assert.equal(result.workflow, "verified");
  assert.equal(result.reviewed, true);
  assert.deepEqual(result.documents[1].lines, source.documents[1].lines);
  assert.equal(result.documents[1].sha256, source.documents[1].sha256);
  assert.match(
    result.comparison.find((row) => row.field === "port_of_loading")!.bl.method,
    /approved label rule/,
  );
  const changed = { ...result.documents[1], sha256: "a".repeat(64) };
  assert.equal(extract(changed).port_of_loading.normalized, null);
  const different = await applyLabelRules(
    [{ ...source.documents[1], type: "SI" }],
    [active],
  );
  assert.equal(different[0].label_rules, undefined);
  assert.equal(
    (
      await applyLabelRules(result.documents, [
        { ...active, state: "disabled" },
      ])
    )[1].label_rules,
    undefined,
  );
});
test("conflicting aliases never silently produce a verified field", async () => {
  const source = await sample(),
    rule = await createLabelProposal(source, proposal(source));
  const a: LabelRule = { ...rule, state: "active" },
    b: LabelRule = {
      ...a,
      id: crypto.randomUUID(),
      field: "port_of_discharge",
    };
  const result = await resultWithLabelRules(source, [a, b]);
  assert.equal(result.workflow, "review");
  assert.match(
    extract(result.documents[1]).port_of_loading.extraction_issue!,
    /Conflicting approved/,
  );
});
test("proposal/preview/approval are versioned, source scoped and fully auditable", async () => {
  const f = await fixture();
  try {
    const rule = await proposeLabelRule("w", proposal(f.result), f.DB);
    assert.equal((await loadLabelRules("w", f.DB)).length, 0);
    const preview = await getRulePreview("w", rule.id, f.DB);
    assert.equal(preview.affected.length, 1);
    assert.equal(preview.newly_verified, 1);
    await assert.rejects(
      () =>
        decideLabelRule(
          "w",
          {
            action: "approve",
            rule_id: rule.id,
            version: 1,
            actor: "Reviewer",
            preview_token: preview.token,
          },
          f.DB,
        ),
      { status: 409 },
    );
    const active = await approve(f, rule);
    assert.equal(active.version, 2);
    assert.equal((await loadLabelRules("w", f.DB)).length, 1);
    const summary = await labelRuleSummary("w", f.DB);
    assert.equal(summary.approved_last_7_days, 1);
    assert.equal(summary.cases_assisted, 0);
    assert.equal(
      (await f.client.execute("SELECT * FROM label_rule_revisions")).rows
        .length,
      2,
    );
    assert.equal(
      (
        await f.client.execute(
          "SELECT * FROM events WHERE action LIKE 'LABEL_RULE_%'",
        )
      ).rows.length,
      2,
    );
    await assert.rejects(
      () => f.client.execute("UPDATE label_rule_revisions SET payload='{}'"),
      /immutable/,
    );
    assert.equal(
      (await f.client.execute("SELECT version FROM cases")).rows[0].version,
      1,
    );
  } finally {
    f.client.close();
  }
});
test("disabled rules roll back future processing while preserving historical evidence", async () => {
  const f = await fixture();
  try {
    const rule = await proposeLabelRule("w", proposal(f.result), f.DB),
      active = await approve(f, rule);
    const reviewed = await resultWithLabelRules(f.result, [active]);
    await saveCases(
      "w",
      [
        {
          result: reviewed,
          expected: 1,
          action: "REPROCESSED",
          actor: "Test",
          detail: "Used approved mapping",
        },
      ],
      f.DB,
    );
    assert.equal((await labelRuleSummary("w", f.DB)).cases_assisted, 1);
    const disabled = await decideLabelRule(
      "w",
      { action: "disable", rule_id: rule.id, version: 2, actor: "Reviewer" },
      f.DB,
    );
    assert.equal(disabled.version, 3);
    assert.equal((await loadLabelRules("w", f.DB)).length, 0);
    assert.notEqual(
      (await resultWithLabelRules(reviewed, [])).workflow,
      "verified",
    );
    assert.ok(reviewed.documents[1].label_rules);
    assert.equal(
      (await f.client.execute("SELECT * FROM label_rule_revisions")).rows
        .length,
      3,
    );
    await assert.rejects(
      () => f.client.execute("DELETE FROM label_rules"),
      /Disable/,
    );
  } finally {
    f.client.close();
  }
});
test("cross-workspace reads, proposals and decisions cannot access another source", async () => {
  const f = await fixture();
  try {
    const rule = await proposeLabelRule("w", proposal(f.result), f.DB);
    assert.deepEqual(await listLabelRules("other", f.DB), []);
    await assert.rejects(
      () => proposeLabelRule("other", proposal(f.result), f.DB),
      { status: 404 },
    );
    await assert.rejects(() => getRulePreview("other", rule.id, f.DB), {
      status: 404,
    });
    await assert.rejects(
      () =>
        decideLabelRule(
          "other",
          {
            action: "disable",
            rule_id: rule.id,
            version: 1,
            actor: "Reviewer",
          },
          f.DB,
        ),
      { status: 404 },
    );
  } finally {
    f.client.close();
  }
});
test("stale preview/source and duplicate active labels reject approval", async () => {
  const f = await fixture();
  try {
    const rule = await proposeLabelRule("w", proposal(f.result), f.DB),
      duplicate = await proposeLabelRule(
        "w",
        { ...proposal(f.result), field: "port_of_discharge" },
        f.DB,
      );
    const preview = await getRulePreview("w", rule.id, f.DB);
    await assert.rejects(
      () =>
        decideLabelRule(
          "w",
          {
            action: "approve",
            rule_id: rule.id,
            version: 1,
            actor: "Reviewer",
            preview_token: "0".repeat(64),
            acknowledge_new_verified: true,
          },
          f.DB,
        ),
      { status: 409 },
    );
    await approve(f, rule);
    await assert.rejects(() => getRulePreview("w", duplicate.id, f.DB), {
      status: 409,
    });
    await assert.rejects(
      () =>
        decideLabelRule(
          "w",
          {
            action: "approve",
            rule_id: rule.id,
            version: 1,
            actor: "Reviewer",
            preview_token: preview.token,
            acknowledge_new_verified: true,
          },
          f.DB,
        ),
      { status: 409 },
    );
    await f.client.execute("UPDATE cases SET version=2");
    await assert.rejects(() => getRulePreview("w", duplicate.id, f.DB), {
      status: 409,
    });
  } finally {
    f.client.close();
  }
});
test("concurrent source update between preview and commit prevents activation atomically", async () => {
  const f = await fixture();
  try {
    const rule = await proposeLabelRule("w", proposal(f.result), f.DB),
      preview = await getRulePreview("w", rule.id, f.DB);
    const db = Object.create(f.DB) as D1Database;
    db.batch = async <T>(statements: D1PreparedStatement[]) => {
      await f.client.execute("UPDATE cases SET version=version+1");
      return f.DB.batch<T>(statements);
    };
    await assert.rejects(
      () =>
        decideLabelRule(
          "w",
          {
            action: "approve",
            rule_id: rule.id,
            version: 1,
            actor: "Reviewer",
            preview_token: preview.token,
            acknowledge_new_verified: true,
          },
          db,
        ),
      { status: 409 },
    );
    assert.equal((await listLabelRules("w", f.DB))[0].state, "proposed");
    assert.equal(
      (await f.client.execute("SELECT * FROM label_rule_revisions")).rows
        .length,
      1,
    );
  } finally {
    f.client.close();
  }
});
test("audit failure rolls back mapping approval and its immutable snapshot", async () => {
  const f = await fixture();
  try {
    const rule = await proposeLabelRule("w", proposal(f.result), f.DB);
    await f.client.execute(
      "CREATE TRIGGER fail_rule_audit BEFORE INSERT ON events WHEN NEW.action='LABEL_RULE_APPROVED' BEGIN SELECT RAISE(ABORT,'Synthetic audit failure'); END",
    );
    await assert.rejects(() => approve(f, rule), /Synthetic audit failure/);
    assert.equal((await listLabelRules("w", f.DB))[0].state, "proposed");
    assert.equal(
      (await f.client.execute("SELECT * FROM label_rule_revisions")).rows
        .length,
      1,
    );
  } finally {
    f.client.close();
  }
});
