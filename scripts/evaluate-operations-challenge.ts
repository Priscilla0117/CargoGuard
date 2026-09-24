import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { analyze } from "../lib/compare";
import { parseDocument } from "../lib/parsers";
import {
  checkDocumentIntegrity,
  INTEGRITY_RULE_VERSION,
  type IntegrityRule,
  type IntegrityStatus,
} from "../lib/integrity-checks";
import { FIELDS, PIPELINE_VERSION, type CaseResult } from "../lib/types";

const fieldResult = z.enum(["match", "mismatch", "uncertain"]);
const expectationSchema = z
  .object({
    strict: z
      .object({
        category: z.enum([
          "BL_COMPARISON",
          "SI_REQUEST",
          "INVOICE_QUERY",
          "GENERAL",
          "SPAM",
        ]),
        status: z.enum(["OK", "MISMATCH", "NEEDS_REVIEW"]),
        review_reason: z
          .enum([
            "wrong_doc_type",
            "missing_attachment",
            "unreadable",
            "missing_value",
            "uncertain_category",
          ])
          .nullable(),
        has_defect: z.boolean(),
        defect_fields: z
          .array(z.enum(FIELDS))
          .refine(
            (values) => new Set(values).size === values.length,
            "Duplicate expected defect field",
          ),
        field_results: z
          .record(z.enum(FIELDS), fieldResult)
          .refine(
            (values) => FIELDS.every((field) => field in values),
            "Declare every field result",
          ),
      })
      .strict(),
    integrity: z.array(
      z
        .object({
          document: z.enum(["si.txt", "bl.txt"]),
          rule: z.enum([
            "source",
            "container_identifier",
            "container_count",
            "container_capacity",
            "port_route",
          ]),
          status: z.enum(["passed", "blocking", "review", "not_checked"]),
        })
        .strict(),
    ),
    requires_attention: z.boolean(),
  })
  .strict();
const inputSchema = z
  .object({
    email: z
      .object({
        email_id: z.string().min(1),
        from: z.string().endsWith("@example.test"),
        subject: z.string().min(1),
        body: z.string().min(1),
        attachments: z.array(z.enum(["si.txt", "bl.txt"])).length(2),
      })
      .strict(),
    documents: z
      .array(
        z
          .object({
            name: z.enum(["si.txt", "bl.txt"]),
            text: z.string().min(1).max(20000),
          })
          .strict(),
      )
      .length(2),
  })
  .strict()
  .refine(
    (input) =>
      new Set(input.documents.map((doc) => doc.name)).size === 2 &&
      new Set(input.email.attachments).size === 2,
    "Supply exactly one SI and one BL text source",
  );
export const operationsChallengeSchema = z
  .object({
    schema_version: z.literal(1),
    title: z.string().min(1),
    provenance: z
      .object({
        classification: z.literal("SYNTHETIC_SELF_AUTHORED"),
        author: z.string().min(1),
        authored_at: z.string().datetime(),
        organiser_generator_used: z.literal(false),
        external_customer_records_used: z.literal(false),
        expectations_predeclared_before_first_run: z.literal(true),
        limitations: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    references: z.array(
      z
        .object({
          title: z.string(),
          url: z.string().url(),
          purpose: z.string(),
        })
        .strict(),
    ),
    cases: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            operation_scenario: z.string().min(1),
            rationale: z.string().min(1),
            input: inputSchema,
            expected: expectationSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((dataset, context) => {
    if (
      new Set(dataset.cases.map((item) => item.id)).size !==
      dataset.cases.length
    )
      context.addIssue({
        code: "custom",
        message: "Challenge case IDs must be unique",
      });
    for (const [index, item] of dataset.cases.entries())
      if (item.id !== item.input.email.email_id)
        context.addIssue({
          code: "custom",
          path: ["cases", index],
          message: "Case ID must equal its email ID",
        });
  });

export type ChallengeInput = z.infer<typeof inputSchema>;
export type ChallengeExpectation = z.infer<typeof expectationSchema>;
export interface ChallengeObserved {
  strict: {
    category: CaseResult["category"];
    status: CaseResult["status"];
    review_reason: CaseResult["review_reason"];
    has_defect: boolean;
    defect_fields: CaseResult["defect_fields"];
    field_results: Record<string, "match" | "mismatch" | "uncertain">;
  };
  integrity: {
    document: string;
    rule: IntegrityRule;
    status: IntegrityStatus;
  }[];
  requires_attention: boolean;
}

/** Only input reaches the real pipeline. Expectations are scored afterwards. */
export async function evaluateOperationsInput(input: ChallengeInput) {
  const documents = await Promise.all(
    input.documents.map((doc) =>
      parseDocument(doc.name, new TextEncoder().encode(doc.text)),
    ),
  );
  const result = analyze(input.email, documents);
  const before = JSON.stringify(result);
  const integrity = checkDocumentIntegrity(result);
  if (JSON.stringify(result) !== before)
    throw new Error("Independent checks mutated the strict case result");
  const observed: ChallengeObserved = {
    strict: {
      category: result.category,
      status: result.status,
      review_reason: result.review_reason,
      has_defect: result.has_defect,
      defect_fields: [...result.defect_fields],
      field_results: Object.fromEntries(
        result.comparison.map((row) => [row.field, row.result]),
      ),
    },
    integrity: integrity.findings.map(({ document, rule, status }) => ({
      document,
      rule,
      status,
    })),
    requires_attention: integrity.requires_attention,
  };
  return {
    observed,
    source_sha256: documents.map(({ name, sha256 }) => ({ name, sha256 })),
  };
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
const sortedFindings = (findings: ChallengeObserved["integrity"]) =>
  findings.map((finding) => stable(finding)).sort();

/** Exact status/field and complete finding-multiset equality. No ignored extras. */
export function scoreOperationsCase(
  expected: ChallengeExpectation,
  actual: ChallengeObserved,
) {
  const strictPassed =
    stable({
      ...expected.strict,
      defect_fields: [...expected.strict.defect_fields].sort(),
    }) ===
    stable({
      ...actual.strict,
      defect_fields: [...actual.strict.defect_fields].sort(),
    });
  const integrityPassed =
    stable(sortedFindings(expected.integrity)) ===
      stable(sortedFindings(actual.integrity)) &&
    expected.requires_attention === actual.requires_attention;
  return {
    strict_passed: strictPassed,
    integrity_passed: integrityPassed,
    passed: strictPassed && integrityPassed,
    differences: [
      ...(!strictPassed
        ? ["Strict category/status/reason/defect/field results differ."]
        : []),
      ...(!integrityPassed
        ? ["Independent finding multiset or attention flag differs."]
        : []),
    ],
  };
}

export async function runOperationsChallenge(
  datasetPath: string,
  reportPath: string,
) {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const workRoot = path.resolve(projectRoot, "work");
  const output = path.resolve(reportPath);
  if (!output.toLowerCase().startsWith(`${workRoot}${path.sep}`.toLowerCase()))
    throw new Error(
      "Write challenge reports under this project's ignored work directory",
    );
  const raw = await fs.readFile(datasetPath);
  const sha256 = (bytes: Uint8Array) =>
    createHash("sha256").update(bytes).digest("hex");
  const datasetHash = sha256(raw);
  const dataset = operationsChallengeSchema.parse(
    JSON.parse(raw.toString("utf8")),
  );
  const started = new Date().toISOString();
  const rows = [];
  for (const item of dataset.cases) {
    const { observed, source_sha256 } = await evaluateOperationsInput(
      item.input,
    );
    rows.push({
      id: item.id,
      title: item.title,
      operation_scenario: item.operation_scenario,
      ...scoreOperationsCase(item.expected, observed),
      expected: item.expected,
      observed,
      source_sha256,
    });
  }
  const datasetUnchanged =
    datasetHash === sha256(await fs.readFile(datasetPath));
  const report = {
    schema_version: 1,
    scope:
      "Synthetic self-authored operations challenge, not external customer data, a blinded holdout, or persisted workflow acceptance.",
    started_at: started,
    completed_at: new Date().toISOString(),
    pipeline_version: PIPELINE_VERSION,
    integrity_rule_version: INTEGRITY_RULE_VERSION,
    dataset_sha256: datasetHash,
    dataset_unchanged_during_run: datasetUnchanged,
    provenance: dataset.provenance,
    summary: {
      cases: rows.length,
      strict_passed: rows.filter((row) => row.strict_passed).length,
      integrity_passed: rows.filter((row) => row.integrity_passed).length,
      combined_passed: rows.filter((row) => row.passed).length,
      expected_mismatches: rows.filter(
        (row) => row.expected.strict.status === "MISMATCH",
      ).length,
      expected_reviews: rows.filter(
        (row) => row.expected.strict.status === "NEEDS_REVIEW",
      ).length,
      expected_independent_attention: rows.filter(
        (row) => row.expected.requires_attention,
      ).length,
      false_strict_verified: rows.filter(
        (row) =>
          row.expected.strict.status !== "OK" &&
          row.observed.strict.category === "BL_COMPARISON" &&
          row.observed.strict.status === "OK",
      ).length,
      missed_independent_attention: rows.filter(
        (row) =>
          row.expected.requires_attention && !row.observed.requires_attention,
      ).length,
      passed: datasetUnchanged && rows.every((row) => row.passed),
    },
    cases: rows,
  };
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, {
    flag: "wx",
  });
  return report;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const options: Record<string, string> = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index],
      value = process.argv[index + 1];
    if (!["--dataset", "--report"].includes(name) || !value || name in options)
      throw new Error(
        "Usage: node --import tsx scripts/evaluate-operations-challenge.ts [--dataset path] [--report work/path.json]",
      );
    options[name] = value;
  }
  const reportPath =
    options["--report"] ??
    `work/validation/operations-challenge/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const report = await runOperationsChallenge(
    options["--dataset"] ??
      fileURLToPath(
        new URL("../tests/fixtures/operations-challenge.json", import.meta.url),
      ),
    reportPath,
  );
  console.log(
    JSON.stringify(
      {
        report: path.resolve(reportPath),
        dataset_sha256: report.dataset_sha256,
        ...report.summary,
      },
      null,
      2,
    ),
  );
  if (!report.summary.passed) process.exitCode = 1;
}
