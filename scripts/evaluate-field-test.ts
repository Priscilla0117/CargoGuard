/**
 * Honest evaluation on the team-authored field-test mailbox (lib/field-test.ts).
 * Runs the real pipeline: .eml parsing → document reading → routing →
 * comparison → conversation grouping → priority. Every mistake is reported.
 *
 *   node --import tsx scripts/evaluate-field-test.ts [--write] [--eml-dir dir]
 */
import fs from "node:fs/promises";
import { FIELD_TEST, renderEml } from "../lib/field-test";
import { parseEml } from "../lib/eml";
import { parseDocument } from "../lib/parsers";
import { analyze } from "../lib/compare";
import { groupThreads } from "../lib/mail-intel";
import { planFor } from "../lib/priority";
import { summaryOf, type CaseResult, type Email } from "../lib/types";

const BASE = new Date("2026-09-21T00:00:00Z");
const NOW = BASE.getTime() + 4 * 3600000; // 12:00 in Kuala Lumpur
const args = process.argv.slice(2);
const emlDir = args.includes("--eml-dir") ? args[args.indexOf("--eml-dir") + 1] : "";

type Metric = { correct: number; total: number };
const metrics: Record<string, Metric> = {};
const failures: { id: string; check: string; expected: string; actual: string }[] = [];
function score(name: string, id: string, ok: boolean, expected: unknown, actual: unknown) {
  metrics[name] ??= { correct: 0, total: 0 };
  metrics[name].total++;
  if (ok) metrics[name].correct++;
  else failures.push({ id, check: name, expected: String(expected), actual: String(actual) });
}

const results: CaseResult[] = [];
if (emlDir) await fs.mkdir(emlDir, { recursive: true });
for (const scenario of FIELD_TEST) {
  const raw = renderEml(scenario, BASE);
  if (emlDir) await fs.writeFile(`${emlDir}/${scenario.id}.eml`, raw);
  const mail = await parseEml(new TextEncoder().encode(raw));
  const email: Email = {
    email_id: scenario.id,
    from: mail.from,
    subject: mail.subject,
    body: mail.body,
    attachments: mail.attachments.map((file) => `uploads/${file.name}`),
    received_at: mail.received_at,
    message_id: mail.message_id,
    in_reply_to: mail.in_reply_to,
    references: mail.references,
    source: "eml",
  };
  score(
    "email_files_read",
    scenario.id,
    !!mail.received_at && !!mail.message_id && mail.attachments.length === scenario.docs.length,
    `${scenario.docs.length} attachments with date`,
    `${mail.attachments.length} attachments, date ${mail.received_at ?? "missing"}`,
  );
  const docs = await Promise.all(mail.attachments.map((file) => parseDocument(file.name, file.bytes)));
  const result = analyze(email, docs, 0);
  results.push(result);
  score("email_type", scenario.id, result.category === scenario.expect.category, scenario.expect.category, result.category);
  score(
    "email_type_without_asking_a_person",
    scenario.id,
    result.category === scenario.expect.category && !result.classification.needs_review,
    `${scenario.expect.category}, confident`,
    `${result.category}${result.classification.needs_review ? ", asks a person to confirm" : ""}`,
  );
  if (scenario.expect.outcome) {
    score("document_check_outcome", scenario.id, result.status === scenario.expect.outcome, scenario.expect.outcome, `${result.status} (${result.summary})`);
    if (scenario.expect.outcome === "MISMATCH") {
      const expected = [...(scenario.expect.defects ?? [])].sort().join(",");
      const actual = [...result.defect_fields].sort().join(",");
      score("exact_differences_found", scenario.id, expected === actual, expected, actual || "none");
    }
    if (scenario.expect.outcome === "OK")
      score("no_false_alarm_on_matching_documents", scenario.id, result.status === "OK", "OK", result.status);
  }
}

// Conversations: pairwise agreement with the authored threads.
const summaries = results.map(summaryOf);
const threads = groupThreads(
  summaries.map((row) => ({
    id: row.email.email_id,
    subject: row.email.subject,
    refs: row.email.insight?.refs,
    message_id: row.email.message_id,
    in_reply_to: row.email.in_reply_to,
    references: row.email.references,
    excluded: row.result?.category === "SPAM",
  })),
);
const ids = FIELD_TEST.map((s) => s.id);
let tp = 0, fp = 0, fn = 0;
for (let i = 0; i < ids.length; i++)
  for (let j = i + 1; j < ids.length; j++) {
    const a = FIELD_TEST[i], b = FIELD_TEST[j];
    const expected = !!a.thread && a.thread === b.thread;
    const actual = !!threads.get(a.id) && threads.get(a.id)?.key === threads.get(b.id)?.key;
    if (expected && actual) tp++;
    else if (actual) {
      fp++;
      failures.push({ id: `${a.id}+${b.id}`, check: "conversation_grouping", expected: "separate", actual: "grouped" });
    } else if (expected) {
      fn++;
      failures.push({ id: `${a.id}+${b.id}`, check: "conversation_grouping", expected: "same conversation", actual: "separate" });
    }
  }
metrics.conversation_pairs_grouped = { correct: tp, total: tp + fn };
metrics.conversation_pairs_wrongly_joined = { correct: fp, total: tp + fp };

// Priority: urgent emails must be ranked first; deadlines must be found.
const plans = summaries.map((row) => ({ row, plan: planFor(row, undefined, NOW) }));
const ranked = plans
  .filter(({ plan }) => plan.bucket === "todo" || plan.bucket === "other")
  .sort((a, b) => b.plan.score - a.plan.score);
const urgent = FIELD_TEST.filter((s) => s.expect.urgent).map((s) => s.id);
const top = ranked.slice(0, urgent.length + 2).map(({ row }) => row.email.email_id);
for (const id of urgent)
  score("urgent_email_in_top_of_plan", id, top.includes(id), `rank ≤ ${urgent.length + 2}`, `rank ${ranked.findIndex(({ row }) => row.email.email_id === id) + 1}`);
for (const { row, plan } of plans) {
  const scenario = FIELD_TEST.find((s) => s.id === row.email.email_id)!;
  if (scenario.expect.deadline === undefined) continue;
  const want = new Date(BASE.getTime() + scenario.expect.deadline * 86400000).toISOString().slice(0, 10);
  const found = row.email.insight?.dates.some((d) => d.date === want && d.kind !== "Mentioned");
  score("deadline_found_in_email", scenario.id, !!found, want, row.email.insight?.dates.map((d) => `${d.kind} ${d.date}`).join("; ") || "none");
  void plan;
}

const report = {
  name: "CargoGuard field-test mailbox v1",
  emails: FIELD_TEST.length,
  measured_at: new Date().toISOString(),
  note: "Team-authored Averis-style emails (not the organiser generator): real .eml headers and dates, conversations on one order number, PDF/Word/text files, unit variations, a missing and a scanned attachment, phishing. Small and authored by us, so it shows robustness — it is not a blind real-world accuracy figure.",
  metrics,
  failures,
};
console.log(JSON.stringify({ ...report, failures: undefined }, null, 1));
for (const failure of failures) console.log("FAIL", failure.id, failure.check, "| expected:", failure.expected, "| actual:", failure.actual);
if (args.includes("--write")) {
  await fs.writeFile("public/field-test.json", `${JSON.stringify(report, null, 2)}\n`);
  console.log("Wrote public/field-test.json");
}
