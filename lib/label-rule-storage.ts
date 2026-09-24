import { storage } from "./storage";
import { HttpError } from "./http";
import type { CaseResult } from "./types";
import {
  createLabelProposal,
  labelProposal,
  labelDecision,
  previewLabelRule,
  type LabelRule,
} from "./label-rules";
import type { z } from "zod";

export async function listLabelRules(
  ws: string,
  db = storage().DB,
): Promise<LabelRule[]> {
  const rows = await db
    .prepare("SELECT payload FROM label_rules WHERE workspace=? ORDER BY id")
    .bind(ws)
    .all<{ payload: string }>();
  return rows.results.map((row) => JSON.parse(row.payload));
}
export async function loadLabelRules(ws: string, db = storage().DB) {
  return (await listLabelRules(ws, db)).filter(
    (rule) => rule.state === "active",
  );
}
async function sourceCases(ws: string, db: D1Database): Promise<CaseResult[]> {
  const rows = await db
    .prepare(
      "SELECT payload,version FROM cases WHERE workspace=? ORDER BY email_id",
    )
    .bind(ws)
    .all<{ payload: string; version: number }>();
  return rows.results.map((row) => ({
    ...JSON.parse(row.payload),
    version: row.version,
  }));
}
export async function labelRuleSummary(ws: string, db = storage().DB) {
  const [rules, cases] = await Promise.all([
    listLabelRules(ws, db),
    sourceCases(ws, db),
  ]);
  const threshold = new Date(Date.now() - 7 * 86400000).toISOString();
  return {
    rules,
    approved_last_7_days: rules.filter(
      (rule) => rule.approved_at && rule.approved_at >= threshold,
    ).length,
    active_rules: rules.filter((rule) => rule.state === "active").length,
    cases_assisted: cases.filter((source) =>
      source.documents.some((doc) => !!doc.label_rules?.aliases.length),
    ).length,
  };
}
async function history(
  ws: string,
  rule: LabelRule,
  action: string,
  db: D1Database,
) {
  const payload = JSON.stringify(rule);
  return [
    db
      .prepare(
        "INSERT INTO label_rule_revisions(workspace,id,version,payload) SELECT ?,?,?,? WHERE changes()=1",
      )
      .bind(ws, rule.id, rule.version, payload),
    db
      .prepare(
        "INSERT INTO events(id,workspace,email_id,action,actor,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE changes()=1",
      )
      .bind(
        crypto.randomUUID(),
        ws,
        rule.source_id,
        action,
        rule.approved_by ?? rule.proposed_by,
        JSON.stringify({
          rule_id: rule.id,
          version: rule.version,
          label: rule.label,
          field: rule.field,
          state: rule.state,
          template_signature: rule.template_signature,
        }),
        rule.updated_at,
      ),
  ];
}
export async function proposeLabelRule(
  ws: string,
  input: z.infer<typeof labelProposal>,
  db = storage().DB,
) {
  input = labelProposal.parse(input);
  const row = await db
    .prepare(
      "SELECT payload,version FROM cases WHERE workspace=? AND email_id=?",
    )
    .bind(ws, input.id)
    .first<{ payload: string; version: number }>();
  if (!row)
    throw new HttpError(
      "The source case was not found in this workspace.",
      404,
    );
  const rule = await createLabelProposal(
    { ...JSON.parse(row.payload), version: row.version },
    input,
  );
  const count = await db
    .prepare("SELECT COUNT(*) AS count FROM label_rules WHERE workspace=?")
    .bind(ws)
    .first<{ count: number }>();
  if ((count?.count ?? 0) >= 200)
    throw new HttpError("This workspace has reached the 200-rule limit.", 409);
  const results = await db.batch([
    db
      .prepare(
        "INSERT INTO label_rules(workspace,id,version,state,template_signature,label,payload) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM cases WHERE workspace=? AND email_id=? AND version=?) AND (SELECT COUNT(*) FROM label_rules WHERE workspace=?)<200",
      )
      .bind(
        ws,
        rule.id,
        rule.version,
        rule.state,
        rule.template_signature,
        rule.label,
        JSON.stringify(rule),
        ws,
        input.id,
        input.case_version,
        ws,
      ),
    ...(await history(ws, rule, "LABEL_RULE_PROPOSED", db)),
  ]);
  if (results[0].meta.changes !== 1)
    throw new HttpError(
      "The source changed while proposing this rule. Refresh and inspect it again.",
      409,
    );
  return rule;
}
export async function getRulePreview(
  ws: string,
  id: string,
  db = storage().DB,
) {
  const [rules, cases] = await Promise.all([
    listLabelRules(ws, db),
    sourceCases(ws, db),
  ]);
  const rule = rules.find((candidate) => candidate.id === id);
  if (!rule) throw new HttpError("Rule not found in this workspace.", 404);
  const source = cases.find(
    (source) => source.email.email_id === rule.source_id,
  );
  if (
    !source ||
    source.version !== rule.source_case_version ||
    !source.documents.some((doc) => doc.sha256 === rule.source_sha256)
  )
    throw new HttpError(
      "The proposal source has changed. Inspect the current source and make a new proposal.",
      409,
    );
  const active = rules.filter((candidate) => candidate.state === "active");
  if (
    active.some(
      (candidate) =>
        candidate.id !== rule.id &&
        candidate.template_signature === rule.template_signature &&
        candidate.label === rule.label,
    )
  )
    throw new HttpError(
      "An active mapping already exists for this template heading. Disable it before proposing another mapping.",
      409,
    );
  return {
    rule,
    ...(await previewLabelRule(rule, cases, active)),
    case_version_sum: cases.reduce((sum, source) => sum + source.version, 0),
    case_count: cases.length,
    rule_version_sum: rules.reduce((sum, rule) => sum + rule.version, 0),
    rule_count: rules.length,
  };
}
export async function decideLabelRule(
  ws: string,
  input: z.infer<typeof labelDecision>,
  db = storage().DB,
) {
  input = labelDecision.parse(input);
  const previous = (await listLabelRules(ws, db)).find(
    (rule) => rule.id === input.rule_id,
  );
  if (!previous) throw new HttpError("Rule not found in this workspace.", 404);
  if (previous.version !== input.version)
    throw new HttpError("The rule changed. Refresh and preview again.", 409);
  if (
    (input.action === "approve" && previous.state !== "proposed") ||
    (input.action === "disable" && previous.state !== "active")
  )
    throw new HttpError(
      "Only proposed rules can be approved, and only active rules can be disabled. Re-propose a disabled mapping to activate it again.",
      409,
    );
  const preview =
    input.action === "approve"
      ? await getRulePreview(ws, previous.id, db)
      : null;
  if (
    preview &&
    (input.preview_token !== preview.token ||
      (preview.newly_verified > 0 && !input.acknowledge_new_verified))
  )
    throw new HttpError(
      "Preview the current impact and explicitly acknowledge any newly verified cases before approval.",
      409,
    );
  const now = new Date().toISOString();
  const rule: LabelRule = {
    ...previous,
    version: previous.version + 1,
    state: input.action === "approve" ? "active" : "disabled",
    approved_by: input.actor,
    updated_at: now,
    approved_at: input.action === "approve" ? now : previous.approved_at,
  };
  // Monotonic version sums + row counts fence all cases/rules read by preview.
  // Rule deletion is prohibited; case APIs only append revisions.
  const fence = preview
    ? " AND (SELECT COALESCE(SUM(version),0) FROM cases WHERE workspace=?)=? AND (SELECT COUNT(*) FROM cases WHERE workspace=?)=? AND (SELECT COALESCE(SUM(version),0) FROM label_rules WHERE workspace=?)=? AND (SELECT COUNT(*) FROM label_rules WHERE workspace=?)=? AND NOT EXISTS(SELECT 1 FROM label_rules WHERE workspace=? AND template_signature=? AND label=? AND state='active' AND id<>?)"
    : "";
  const args: (string | number)[] = [
    rule.version,
    rule.state,
    JSON.stringify(rule),
    ws,
    rule.id,
    input.version,
  ];
  if (preview)
    args.push(
      ws,
      preview.case_version_sum,
      ws,
      preview.case_count,
      ws,
      preview.rule_version_sum,
      ws,
      preview.rule_count,
      ws,
      rule.template_signature,
      rule.label,
      rule.id,
    );
  const rows = await db.batch([
    db
      .prepare(
        `UPDATE label_rules SET version=?,state=?,payload=? WHERE workspace=? AND id=? AND version=?${fence}`,
      )
      .bind(...args),
    ...(await history(
      ws,
      rule,
      input.action === "approve"
        ? "LABEL_RULE_APPROVED"
        : "LABEL_RULE_DISABLED",
      db,
    )),
  ]);
  if (rows[0].meta.changes !== 1)
    throw new HttpError(
      "A case or rule changed during approval. Refresh and preview the new impact.",
      409,
    );
  return rule;
}
