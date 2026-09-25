import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createClient } from "@libsql/client";
import { createNodeBindings } from "../lib/runtime-node";
import { saveCases } from "../lib/storage";
import { getShipment, saveShipment } from "../lib/shipment-storage";
import { parseDocument } from "../lib/parsers";
import { analyze } from "../lib/compare";
import {
  listSiTemplates,
  loadApprovedSiTemplate,
  saveSiTemplate,
  siTemplateCommand,
  siTemplateDraft,
  templateSource,
} from "../lib/si-templates";
async function fixture() {
  const client = createClient({ url: ":memory:" });
  for (const file of (await fs.readdir("drizzle"))
    .filter((file) => file.endsWith(".sql"))
    .sort())
    await client.executeMultiple(await fs.readFile(`drizzle/${file}`, "utf8"));
  const { DB } = createNodeBindings(client);
  const fields =
    "Shipper: Template Export Ltd\nConsignee: Template Buyer Ltd\nNotify party: SAME AS CONSIGNEE\nPort of loading: Singapore\nPort of discharge: Jakarta\nContainer count: 2\nGross weight (kg): 42500";
  const documents = await Promise.all([
    parseDocument(
      "si.txt",
      new TextEncoder().encode(`SHIPPING INSTRUCTION\n${fields}`),
    ),
    parseDocument(
      "bl.txt",
      new TextEncoder().encode(`DRAFT BILL OF LADING\n${fields}`),
    ),
  ]);
  const result = analyze(
    {
      email_id: "template-source",
      from: "desk@example.test",
      subject: "Verify draft BL against SI",
      body: "Please compare documents.",
      attachments: ["si.txt", "bl.txt"],
    },
    documents,
  );
  const saved = await saveCases(
    "workspace",
    [
      {
        result,
        expected: 0,
        action: "PROCESSED",
        actor: "Test setup",
        detail: "Synthetic template fixture",
      },
    ],
    DB,
  );
  return { client, DB, source: saved.results[0] };
}
const proposal = {
  action: "propose" as const,
  name: "Approved party template",
  customer: "Template Customer",
  source_case: "template-source",
  source_version: 1,
  actor: "Test operator",
};
test("templates capture only three source-bound party fields and require explicit reviewer confirmation", async () => {
  const f = await fixture();
  try {
    const proposed = await saveSiTemplate("workspace", proposal, f.DB);
    assert.deepEqual(Object.keys(proposed.fields), [
      "shipper",
      "consignee",
      "notify_party",
    ]);
    assert.equal(proposed.source_sha256, f.source.documents[0].sha256);
    assert.equal(proposed.state, "proposed");
    assert.equal(
      siTemplateCommand.safeParse({
        action: "approve",
        id: proposed.id,
        version: 1,
        actor: "Reviewer",
      }).success,
      false,
    );
    await assert.rejects(
      () =>
        loadApprovedSiTemplate(
          "workspace",
          proposed.id,
          1,
          "Template Customer",
          f.DB,
        ),
      { status: 409 },
    );
    const approved = await saveSiTemplate(
      "workspace",
      {
        action: "approve",
        id: proposed.id,
        version: 1,
        actor: "Test reviewer",
        confirmed: true,
      },
      f.DB,
    );
    assert.equal(approved.version, 2);
    assert.equal(approved.approved_by, "Test reviewer");
    assert.equal(
      (
        await loadApprovedSiTemplate(
          "workspace",
          approved.id,
          2,
          " template   CUSTOMER ",
          f.DB,
        )
      ).id,
      approved.id,
    );
    const draft = siTemplateDraft(approved, "BOOKING-NEW");
    assert.match(draft, /Shipper: Template Export Ltd/);
    assert.match(draft, /Gross weight \(kg\): \[enter current shipment\]/);
    assert.match(draft, /Containers: \[enter current shipment\]/);
    assert.ok(!draft.includes("42500"));
    assert.ok(!draft.includes("Port of loading: Singapore"));
  } finally {
    f.client.close();
  }
});
test("template approval and reuse reject stale source versions, cross-workspace access and wrong customers", async () => {
  const f = await fixture();
  try {
    const proposed = await saveSiTemplate("workspace", proposal, f.DB);
    await assert.rejects(
      () =>
        saveSiTemplate(
          "foreign",
          {
            action: "approve",
            id: proposed.id,
            version: 1,
            actor: "Reviewer",
            confirmed: true,
          },
          f.DB,
        ),
      { status: 409 },
    );
    const approved = await saveSiTemplate(
      "workspace",
      {
        action: "approve",
        id: proposed.id,
        version: 1,
        actor: "Reviewer",
        confirmed: true,
      },
      f.DB,
    );
    await assert.rejects(
      () =>
        loadApprovedSiTemplate(
          "workspace",
          approved.id,
          2,
          "Other Customer",
          f.DB,
        ),
      { status: 409 },
    );
    await assert.rejects(
      () =>
        loadApprovedSiTemplate(
          "foreign",
          approved.id,
          2,
          "Template Customer",
          f.DB,
        ),
      { status: 409 },
    );
    await f.client.execute(
      "UPDATE cases SET version=2 WHERE workspace='workspace'",
    );
    await assert.rejects(
      () =>
        loadApprovedSiTemplate(
          "workspace",
          approved.id,
          2,
          "Template Customer",
          f.DB,
        ),
      { status: 409 },
    );
  } finally {
    f.client.close();
  }
});
test("disabled templates cannot draft and history cannot be rewritten", async () => {
  const f = await fixture();
  try {
    const proposed = await saveSiTemplate("workspace", proposal, f.DB),
      approved = await saveSiTemplate(
        "workspace",
        {
          action: "approve",
          id: proposed.id,
          version: 1,
          confirmed: true,
          actor: "Reviewer",
        },
        f.DB,
      );
    await saveSiTemplate(
      "workspace",
      { action: "disable", id: approved.id, version: 2, actor: "Reviewer" },
      f.DB,
    );
    await assert.rejects(
      () =>
        loadApprovedSiTemplate(
          "workspace",
          approved.id,
          3,
          "Template Customer",
          f.DB,
        ),
      { status: 409 },
    );
    await assert.rejects(
      () =>
        saveSiTemplate(
          "workspace",
          { action: "disable", id: approved.id, version: 2, actor: "Reviewer" },
          f.DB,
        ),
      { status: 409 },
    );
    assert.equal(
      (await f.client.execute("SELECT * FROM si_template_revisions")).rows
        .length,
      3,
    );
    await assert.rejects(() =>
      f.client.execute("DELETE FROM si_template_revisions"),
    );
    assert.equal(
      (await listSiTemplates("workspace", f.DB))[0].state,
      "disabled",
    );
  } finally {
    f.client.close();
  }
});
test("source extraction issues and absent original fingerprints cannot become approved party data", async () => {
  const f = await fixture();
  try {
    const source = structuredClone(f.source);
    source.comparison[0].si.issue = "Unreadable source";
    assert.throws(() => templateSource(source, 1), { status: 422 });
    delete source.comparison[0].si.issue;
    source.documents[0].sha256 = undefined;
    assert.throws(() => templateSource(source, 1), { status: 422 });
    assert.equal(
      siTemplateCommand.safeParse({
        ...proposal,
        fields: { shipper: "Injected replacement" },
      }).success,
      false,
    );
  } finally {
    f.client.close();
  }
});
test("a concurrent source revision invalidates a proposal at commit", async () => {
  const f = await fixture();
  try {
    const db = {
      ...f.DB,
      batch: async (statements: D1PreparedStatement[]) => {
        await f.client.execute(
          "UPDATE cases SET version=2 WHERE workspace='workspace'",
        );
        return f.DB.batch(statements);
      },
    } as D1Database;
    await assert.rejects(() => saveSiTemplate("workspace", proposal, db), {
      status: 409,
    });
    assert.equal((await listSiTemplates("workspace", f.DB)).length, 0);
  } finally {
    f.client.close();
  }
});
test("audit failure rolls the template and its immutable revision back together", async () => {
  const f = await fixture();
  try {
    const db = {
      ...f.DB,
      prepare: (sql: string) =>
        f.DB.prepare(
          sql.startsWith("INSERT INTO events")
            ? sql.replace("events", "missing_events")
            : sql,
        ),
    } as D1Database;
    await assert.rejects(() => saveSiTemplate("workspace", proposal, db));
    assert.equal((await listSiTemplates("workspace", f.DB)).length, 0);
    assert.equal(
      (await f.client.execute("SELECT * FROM si_template_revisions")).rows
        .length,
      0,
    );
  } finally {
    f.client.close();
  }
});

test("shipment SI worksheets reuse approved party fields explicitly and bind template/source versions at commit", async () => {
  for (const changed of ["none", "template", "source"] as const) {
    const f = await fixture();
    try {
      const proposed = await saveSiTemplate("workspace", proposal, f.DB);
      const approved = await saveSiTemplate(
        "workspace",
        {
          action: "approve",
          id: proposed.id,
          version: 1,
          actor: "Reviewer",
          confirmed: true,
        },
        f.DB,
      );
      const request = structuredClone(f.source);
      request.email.email_id = "new-si-request";
      request.category = "SI_REQUEST";
      request.workflow = "routed";
      request.comparison = [];
      request.documents = [];
      await saveCases(
        "workspace",
        [
          {
            result: request,
            expected: 0,
            action: "PROCESSED",
            actor: "Setup",
            detail: "New shipment request",
          },
        ],
        f.DB,
      );
      let card = await saveShipment(
        "workspace",
        {
          action: "create",
          title: "New shipment",
          customer: "Template Customer",
          carrier: "",
          references: ["NEW-BOOKING-001"],
          actor: "Operator",
        },
        f.DB,
      );
      card = await saveShipment(
        "workspace",
        {
          action: "link",
          id: card.id,
          version: card.version,
          case_id: request.email.email_id,
          case_version: 1,
          reason: "Confirmed current request",
          unlink: false,
          actor: "Operator",
        },
        f.DB,
      );
      const db =
        changed === "none"
          ? f.DB
          : ({
              ...f.DB,
              batch: async (statements: D1PreparedStatement[]) => {
                if (changed === "template")
                  await f.client.execute(
                    "UPDATE si_templates SET version=version+1",
                  );
                else
                  await f.client.execute(
                    "UPDATE cases SET version=version+1 WHERE email_id='template-source'",
                  );
                return f.DB.batch(statements);
              },
            } as D1Database);
      const task = {
        action: "task" as const,
        id: card.id,
        version: card.version,
        case_id: request.email.email_id,
        case_version: 1,
        kind: "si_draft" as const,
        template_id: approved.id,
        template_version: approved.version,
        actor: "Operator",
      };
      if (changed === "none") {
        const saved = await saveShipment("workspace", task, db);
        assert.equal(saved.tasks.length, 1);
        assert.match(saved.tasks[0].body, /Template Export Ltd/);
        assert.match(saved.tasks[0].body, /NEW-BOOKING-001/);
        assert.ok(!saved.tasks[0].body.includes("42500"));
      } else {
        await assert.rejects(() => saveShipment("workspace", task, db), {
          status: 409,
        });
        const unchanged = await getShipment("workspace", card.id, f.DB);
        assert.equal(unchanged?.version, card.version);
        assert.equal(unchanged?.tasks.length, 0);
      }
    } finally {
      f.client.close();
    }
  }
});
