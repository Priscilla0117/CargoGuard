import { storage, getCases } from "./storage";
import { HttpError } from "./http";
import { completionBlocker } from "./follow-up";
import { normalize } from "./normalization";
import { checkDocumentIntegrity } from "./integrity-checks";
import {
  shipmentCommand,
  approvedComparison,
  shipmentPair,
  taskDraft,
  type Shipment,
  type ShipmentCommand,
} from "./shipments";
import type { CaseResult } from "./types";
import { requireCurrentEngine } from "./review-guard";
import {
  loadApprovedSiTemplate,
  siTemplateDraft,
  type SiTemplate,
} from "./si-templates";

export async function listShipments(
  ws: string,
  db = storage().DB,
): Promise<Shipment[]> {
  const rows = await db
    .prepare(
      "SELECT payload FROM shipments WHERE workspace=? ORDER BY id LIMIT 250",
    )
    .bind(ws)
    .all<{ payload: string }>();
  return rows.results.map((r) => JSON.parse(r.payload));
}
export async function getShipment(
  ws: string,
  id: string,
  db = storage().DB,
): Promise<Shipment | null> {
  const row = await db
    .prepare("SELECT payload FROM shipments WHERE workspace=? AND id=?")
    .bind(ws, id)
    .first<{ payload: string }>();
  return row ? JSON.parse(row.payload) : null;
}
export async function shipmentHistory(
  ws: string,
  id: string,
  db = storage().DB,
) {
  return (
    await db
      .prepare(
        "SELECT version,action,actor,created_at,payload FROM shipment_revisions WHERE workspace=? AND id=? ORDER BY version DESC LIMIT 100",
      )
      .bind(ws, id)
      .all()
  ).results;
}
function fail(message: string): never {
  throw new HttpError(message, 409);
}
function sourceFor(
  input: { case_id: string; case_version: number },
  cases: CaseResult[],
) {
  const source = cases.find((c) => c.email.email_id === input.case_id);
  if (!source || source.version !== input.case_version)
    fail(
      "The linked case changed or is unavailable. Refresh and inspect its current evidence.",
    );
  return source;
}

/** All operational updates, immutable snapshots and audit events share one CAS transaction. */
export async function saveShipment(
  ws: string,
  command: ShipmentCommand,
  db = storage().DB,
): Promise<Shipment> {
  const input = shipmentCommand.parse(command),
    now = new Date().toISOString();
  const previous =
    input.action === "create" ? null : await getShipment(ws, input.id, db);
  if (
    input.action !== "create" &&
    (!previous || previous.version !== input.version)
  )
    fail("Shipment changed or is unavailable. Refresh before saving.");
  const next: Shipment = previous
    ? structuredClone(previous)
    : {
        id: crypto.randomUUID(),
        version: 0,
        title: "",
        customer: "",
        carrier: "",
        references: [],
        case_ids: [],
        comparison_case_id: null,
        owner: "",
        owner_id: null,
        state: "open",
        completed_cases: {},
        deadlines: [],
        amendments: [],
        tasks: [],
        notes: "",
        created_at: now,
        updated_at: now,
        actor: input.actor,
      };
  const ids = [
    ...new Set([
      ...next.case_ids,
      ...("case_id" in input ? [input.case_id] : []),
    ]),
  ];
  if (ids.length > 50)
    throw new HttpError("A shipment can link at most 50 cases.", 400);
  const cases: CaseResult[] = [];
  for (const id of ids) {
    const row = await db
      .prepare(
        "SELECT payload,version FROM cases WHERE workspace=? AND email_id=?",
      )
      .bind(ws, id)
      .first<{ payload: string; version: number }>();
    if (row) cases.push({ ...JSON.parse(row.payload), version: row.version });
  }
  const bound = new Map<string, number>();
  let template: SiTemplate | null = null;
  const bind = (c: CaseResult) => {
    bound.set(c.email.email_id, c.version);
    return c;
  };
  if (input.action === "create" || input.action === "update") {
    next.title = input.title;
    next.customer = input.customer;
    next.carrier = input.carrier;
    next.references = [
      ...new Set(input.references.map((r) => r.toUpperCase())),
    ];
    if (input.action === "update") next.notes = input.notes;
  } else if (input.action === "link") {
    const source = bind(sourceFor(input, cases));
    next.case_ids = input.unlink
      ? next.case_ids.filter((id) => id !== input.case_id)
      : [...new Set([...next.case_ids, source.email.email_id])];
    next.state = "open";
    next.completed_cases = {};
    if (input.unlink) {
      if (next.comparison_case_id === input.case_id)
        next.comparison_case_id = null;
      next.deadlines = next.deadlines.filter(
        (d) => d.source_case !== input.case_id,
      );
      for (const a of next.amendments)
        if (
          a.source_case === input.case_id &&
          ["approved", "proposed"].includes(a.status)
        )
          a.status = "superseded";
    }
  } else if (input.action === "select_comparison") {
    const source = bind(sourceFor(input, cases));
    if (
      !next.case_ids.includes(input.case_id) ||
      source.category !== "BL_COMPARISON"
    )
      fail("Choose a linked document-comparison case.");
    next.comparison_case_id = input.case_id;
    next.state = "open";
    next.completed_cases = {};
  } else if (input.action === "assign") {
    if (input.claim && next.owner_id && next.owner_id !== input.owner_id)
      fail(
        "This shipment has already been claimed. Refresh or explicitly reassign it.",
      );
    next.owner = input.owner;
    next.owner_id = input.owner_id;
  } else if (input.action === "deadline") {
    const source = bind(sourceFor(input, cases));
    if (!next.case_ids.includes(input.case_id))
      fail("Link this case before using its deadline.");
    const text = [
      source.email.body,
      ...source.documents.flatMap((d) => d.lines.map((l) => l.text)),
    ].join("\n");
    if (!text.includes(input.quote))
      fail("The exact deadline quote was not found in the current source.");
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.zone });
    } catch {
      throw new HttpError("Choose a valid IANA time zone.", 400);
    }
    if (next.deadlines.length >= 20)
      fail("Remove a superseded deadline before adding another.");
    next.deadlines.push({
      id: crypto.randomUUID(),
      type: input.type,
      at: new Date(input.at).toISOString(),
      zone: input.zone,
      quote: input.quote,
      source_case: input.case_id,
      source_version: source.version,
      confirmed_by: input.actor,
      confirmed_at: now,
    });
    next.state = "open";
  } else if (input.action === "remove_deadline") {
    if (!next.deadlines.some((d) => d.id === input.deadline_id))
      fail("Deadline not found.");
    next.deadlines = next.deadlines.filter((d) => d.id !== input.deadline_id);
  } else if (input.action === "propose_amendment") {
    const source = bind(sourceFor(input, cases));
    const comparison = cases.find(
      (c) => c.email.email_id === next.comparison_case_id,
    );
    if (!comparison)
      fail(
        "Select the current SI/BL comparison before proposing an amendment.",
      );
    requireCurrentEngine(source);
    requireCurrentEngine(comparison);
    bind(comparison);
    const pair = shipmentPair(comparison);
    if (!next.case_ids.includes(input.case_id) || !pair.si?.sha256)
      fail(
        "Link a comparison with a confirmed SI before proposing an amendment.",
      );
    if (
      !source.email.body.includes(input.quote) ||
      !input.quote.includes(input.value)
    )
      fail("Quote the exact email instruction, including the proposed value.");
    if (normalize(input.field, input.value) === null)
      throw new HttpError(
        "The proposed value is not valid for this field.",
        400,
      );
    if (next.amendments.length >= 50)
      fail("Amendment limit reached for this shipment.");
    next.amendments.push({
      id: crypto.randomUUID(),
      field: input.field,
      value: input.value,
      quote: input.quote,
      source_case: input.case_id,
      source_version: source.version,
      si_sha256: pair.si.sha256,
      proposed_by: input.actor,
      proposed_at: now,
      status: "proposed",
    });
    next.state = "open";
  } else if (input.action === "decide_amendment") {
    const a = next.amendments.find((a) => a.id === input.amendment_id);
    if (!a || a.status !== "proposed")
      fail("This amendment is no longer awaiting a decision.");
    const source = cases.find((c) => c.email.email_id === a.source_case);
    if (input.approve) {
      const comparison = cases.find(
        (c) => c.email.email_id === next.comparison_case_id,
      );
      if (
        !source ||
        source.version !== a.source_version ||
        !comparison ||
        shipmentPair(comparison).si?.sha256 !== a.si_sha256
      )
        fail(
          "Instruction evidence changed. Reject this proposal and propose a new amendment from current evidence.",
        );
      requireCurrentEngine(source);
      requireCurrentEngine(comparison);
      bind(source);
      bind(comparison);
    }
    if (input.approve)
      for (const prior of next.amendments)
        if (
          prior.status === "approved" &&
          prior.field === a.field &&
          prior.si_sha256 === a.si_sha256
        )
          prior.status = "superseded";
    a.status = input.approve ? "approved" : "rejected";
    a.decided_by = input.actor;
    a.decided_at = now;
    a.reason = input.reason;
    next.state = "open";
  } else if (input.action === "withdraw_amendment") {
    const amendment = next.amendments.find((a) => a.id === input.amendment_id);
    if (!amendment || !["approved", "proposed"].includes(amendment.status))
      fail("This instruction is no longer active or proposed.");
    amendment.status = "superseded";
    amendment.decided_by = input.actor;
    amendment.decided_at = now;
    amendment.reason = input.reason;
    next.state = "open";
  } else if (input.action === "task") {
    const source = bind(sourceFor(input, cases));
    if (!next.case_ids.includes(input.case_id))
      fail("Link this case before creating its task.");
    if (next.tasks.length >= 100) fail("Shipment task limit reached.");
    const draft = taskDraft(input.kind, source, next);
    if (input.template_id || input.template_version) {
      if (
        input.kind !== "si_draft" ||
        !input.template_id ||
        !input.template_version
      )
        throw new HttpError(
          "Select a complete approved template version for an SI worksheet.",
          400,
        );
      template = await loadApprovedSiTemplate(
        ws,
        input.template_id,
        input.template_version,
        next.customer,
        db,
      );
      bound.set(template.source_case, template.source_version);
      draft.body = siTemplateDraft(template, next.references.join(", "));
    }
    next.tasks.push({
      id: crypto.randomUUID(),
      kind: input.kind,
      case_id: input.case_id,
      ...draft,
      owner: next.owner,
      state: "draft",
      created_at: now,
      updated_at: now,
      actor: input.actor,
    });
    next.state = "open";
  } else if (input.action === "update_task") {
    const task = next.tasks.find((t) => t.id === input.task_id);
    if (!task) fail("Task not found.");
    task.owner = input.owner;
    task.body = input.body;
    task.state = input.state;
    task.updated_at = now;
    task.actor = input.actor;
    if (task.state !== "done") next.state = "open";
  } else if (input.action === "complete") {
    if (!next.case_ids.length || cases.length !== next.case_ids.length)
      fail("All linked cases must have current saved results.");
    if (next.amendments.some((a) => a.status === "proposed"))
      fail("Resolve pending instruction proposals first.");
    let comparisonCount = 0;
    for (const source of cases) {
      if (input.cases[source.email.email_id] !== source.version)
        fail("Case revisions changed. Refresh the shipment before completion.");
      bind(source);
      if (
        source.email.email_id === next.comparison_case_id &&
        source.category === "BL_COMPARISON"
      ) {
        comparisonCount++;
        const blocker = completionBlocker(source);
        if (blocker) fail(`${source.email.email_id}: ${blocker}`);
        const instructions = approvedComparison(next, source, cases);
        if (instructions.blocked) fail(instructions.blocked);
        if (instructions.rows.some((r) => r.result !== "match"))
          fail(
            "Resolve discrepancies against approved later instructions before completing this shipment check.",
          );
        const extra = checkDocumentIntegrity(source);
        if (extra.findings.some((f) => f.status === "blocking"))
          fail(
            "Resolve blocking independent document checks before completion.",
          );
        if (
          extra.findings.some((f) => f.status === "review") &&
          !input.acknowledge_advisories
        )
          fail(
            "Inspect and explicitly acknowledge independent advisory findings.",
          );
      } else if (
        source.classification.needs_review &&
        !source.category_override
      )
        fail(
          "Confirm uncertain email categories before completing linked work.",
        );
    }
    if (!comparisonCount)
      fail(
        "Select the current BL comparison before completing this shipment check.",
      );
    if (next.tasks.some((t) => t.state !== "done"))
      fail("Finish or resolve open shipment tasks before completion.");
    next.state = "completed";
    next.completed_cases = Object.fromEntries(
      cases.map((c) => [c.email.email_id, c.version]),
    );
  } else if (input.action === "reopen") {
    next.state = "open";
    next.completed_cases = {};
  }
  next.version++;
  next.updated_at = now;
  next.actor = input.actor;
  const conditions = [...bound].map(
    () =>
      "EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?)",
  );
  const conditionArgs = [...bound].flatMap(([id, version]) => [
    ws,
    id,
    version,
  ]);
  if (template) {
    conditions.push(
      "EXISTS(SELECT 1 FROM si_templates WHERE workspace=? AND id=? AND version=?)",
    );
    conditionArgs.push(ws, template.id, template.version);
  }
  const condition = conditions.length ? ` AND ${conditions.join(" AND ")}` : "";
  const payload = JSON.stringify(next);
  const write = previous
    ? db
        .prepare(
          `UPDATE shipments SET version=?,payload=? WHERE workspace=? AND id=? AND version=?${condition}`,
        )
        .bind(
          next.version,
          payload,
          ws,
          next.id,
          previous.version,
          ...conditionArgs,
        )
    : db
        .prepare(
          "INSERT INTO shipments(workspace,id,version,payload) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM shipments WHERE workspace=?)<250",
        )
        .bind(ws, next.id, next.version, payload, ws);
  const outcomes = await db.batch([
    write,
    db
      .prepare(
        "INSERT INTO shipment_revisions(workspace,id,version,payload,action,actor,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(ws, next.id, next.version, payload, input.action, input.actor, now),
    db
      .prepare(
        "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        ws,
        `shipment:${next.id}`,
        `SHIPMENT_${input.action.toUpperCase()}`,
        input.actor,
        JSON.stringify({
          summary: `${next.title}: ${input.action}`,
          reason: "reason" in input ? input.reason : undefined,
          version: next.version,
        }),
        now,
      ),
  ]);
  if (outcomes[0].meta.changes !== 1)
    fail(
      "The shipment or source changed while saving, or the workspace limit was reached. Refresh before retrying.",
    );
  return next;
}
export async function shipmentCases(ws: string, shipment: Shipment) {
  return getCases(ws, shipment.case_ids);
}
