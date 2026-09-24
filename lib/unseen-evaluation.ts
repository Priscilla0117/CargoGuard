/** Offline evaluation only. Do not import external labels into application routes. */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { processEmail } from "./processing";
import { CATEGORIES, FIELDS, PIPELINE_VERSION, type CaseResult } from "./types";

const meaningful = z
  .string()
  .trim()
  .min(1)
  .max(2000)
  .refine(
    (value) =>
      !/^(?:todo|tbd|tba|unknown|none|n\/a|placeholder|replace(?:[ _-].*)?|your[ _-].*|<.*>|\{\{.*\}\})$/i.test(
        value,
      ),
    "Replace placeholder metadata with independently supplied evidence.",
  );
const relativeFile = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !/[\\:\0]/.test(value) &&
      !value.startsWith("/") &&
      value.split("/").every((part) => !!part && part !== "." && part !== ".."),
    "Use a relative path inside the dataset with forward slashes and no traversal.",
  );
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const workflow = z.enum([
  "verified",
  "discrepancy",
  "review",
  "awaiting_documents",
  "routed",
]);
const provenanceSchema = z
  .object({
    source_description: meaningful,
    permission_reference: meaningful,
    collected_by: meaningful,
    collected_at: z.string().datetime(),
    holdout_independence_attested: z.boolean(),
    holdout_not_used_for_tuning: z.boolean(),
    holdout_frozen_before_model_run: z.boolean(),
  })
  .strict();
const caseSchema = z
  .object({
    id: meaningful,
    split: z.enum(["development", "holdout"]),
    shipment_group: meaningful,
    template_family: meaningful,
    email_file: relativeFile,
    missing_attachments: z.array(relativeFile).max(20).default([]),
  })
  .strict();
export const datasetSchema = z
  .object({
    schema_version: z.literal(1),
    ready_for_freeze: z.literal(true),
    dataset_id: meaningful,
    provenance: provenanceSchema,
    cases: z.array(caseSchema).min(1).max(10000),
  })
  .strict();
const labelProvenanceSchema = z
  .object({
    reviewers: z.array(meaningful).min(2).max(20),
    adjudicator: meaningful,
    adjudicated: z.literal(true),
    labelled_without_model_outputs: z.literal(true),
  })
  .strict();
const labelSchema = z
  .object({
    case_id: meaningful,
    category: z.enum(CATEGORIES),
    workflow,
    blocking: z.boolean(),
    defect_fields: z.array(z.enum(FIELDS)).max(FIELDS.length),
    review_reason: z
      .enum([
        "wrong_doc_type",
        "missing_attachment",
        "unreadable",
        "missing_value",
        "uncertain_category",
      ])
      .nullable(),
    rationale: meaningful,
  })
  .strict();
export const labelsSchema = z
  .object({
    schema_version: z.literal(1),
    dataset_id: meaningful,
    provenance: labelProvenanceSchema,
    labels: z.array(labelSchema).min(1).max(10000),
  })
  .strict();
const emailSchema = z
  .object({
    email_id: meaningful,
    from: z.string().max(1000),
    subject: z.string().max(2000),
    body: z.string().max(100000),
    attachments: z.array(relativeFile).max(20),
    received_at: z.string().optional(),
    imported_at: z.string().optional(),
  })
  .strict();
const frozenFileSchema = z
  .object({
    path: relativeFile,
    role: z.enum(["definition", "labels", "email", "attachment"]),
    bytes: z.number().int().nonnegative().nullable(),
    sha256: hash.nullable(),
  })
  .strict()
  .refine(
    (file) =>
      (file.bytes === null) === (file.sha256 === null) &&
      (file.sha256 !== null || file.role === "attachment"),
    "Only an explicitly absent attachment can have a null hash.",
  );
const frozenCaseSchema = caseSchema.extend({
  attachments: z.array(relativeFile).max(20),
});
const developmentSchema = z
  .object({
    dataset_id: meaningful,
    manifest_sha256: hash,
    shipment_groups: z.array(meaningful),
    template_families: z.array(meaningful),
    source_sha256s: z.array(hash),
  })
  .strict();
export const frozenManifestSchema = z
  .object({
    schema_version: z.literal(1),
    dataset_id: meaningful,
    frozen_at: z.string().datetime(),
    provenance: provenanceSchema,
    label_provenance: labelProvenanceSchema,
    cases: z.array(frozenCaseSchema).min(1).max(10000),
    files: z.array(frozenFileSchema).min(3),
    development: developmentSchema.nullable(),
  })
  .strict();
export type GoldLabel = z.infer<typeof labelSchema>;
export type FrozenManifest = z.infer<typeof frozenManifestSchema>;
type FrozenFile = z.infer<typeof frozenFileSchema>;
type FrozenCase = z.infer<typeof frozenCaseSchema>;
const canonicalGroup = (value: string) =>
  value.normalize("NFKC").trim().toLowerCase();
export const sha256 = (bytes: Uint8Array | string) =>
  createHash("sha256").update(bytes).digest("hex");

function unique(values: string[], name: string) {
  if (new Set(values.map(canonicalGroup)).size !== values.length)
    throw new Error(`Duplicate ${name}.`);
}
function inside(root: string, file: string) {
  const relative = path.relative(root, file);
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
async function datasetPath(root: string, name: string, absent = false) {
  relativeFile.parse(name);
  const base = await fs.realpath(root);
  const target = path.resolve(base, name);
  try {
    const real = await fs.realpath(target);
    if (!inside(base, real))
      throw new Error(`Dataset path leaves its root: ${name}`);
    if (!(await fs.stat(real)).isFile())
      throw new Error(`Dataset input is not a file: ${name}`);
    return real;
  } catch (error) {
    if (absent && (error as NodeJS.ErrnoException).code === "ENOENT")
      return null;
    throw error;
  }
}
async function readJsonFile(file: string): Promise<unknown> {
  if ((await fs.stat(file)).size > 12 * 1024 * 1024)
    throw new Error(`JSON input exceeds 12 MB: ${file}`);
  return JSON.parse(await fs.readFile(file, "utf8"));
}
async function fingerprintFile(
  root: string,
  name: string,
  role: FrozenFile["role"],
  absent = false,
): Promise<FrozenFile> {
  const file = await datasetPath(root, name, absent);
  if (!file) return { path: name, role, bytes: null, sha256: null };
  if (absent)
    throw new Error(`Attachment declared missing is present: ${name}`);
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    bytes += chunk.length;
    digest.update(chunk);
  }
  return { path: name, role, bytes, sha256: digest.digest("hex") };
}

function checkSplitLeakage(
  cases: FrozenCase[],
  files: FrozenFile[],
  development: FrozenManifest["development"],
) {
  for (const key of ["shipment_group", "template_family"] as const) {
    const seen = new Map<string, string>();
    for (const item of cases) {
      const group = canonicalGroup(item[key]);
      const prior = seen.get(group);
      if (prior && prior !== item.split)
        throw new Error(
          `Split leakage: ${key} ${item[key]} appears in development and holdout.`,
        );
      seen.set(group, item.split);
    }
    const external = new Set(
      (key === "shipment_group"
        ? development?.shipment_groups
        : development?.template_families
      )?.map(canonicalGroup),
    );
    for (const item of cases.filter((item) => item.split === "holdout")) {
      if (external.has(canonicalGroup(item[key])))
        throw new Error(`Development-manifest leakage: ${key} ${item[key]}.`);
    }
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  const hashes = new Map<string, string>();
  const developmentHashes = new Set(development?.source_sha256s);
  for (const item of cases) {
    for (const name of [item.email_file, ...item.attachments]) {
      const digest = byPath.get(name)?.sha256;
      if (!digest) continue;
      const prior = hashes.get(digest);
      if (prior && prior !== item.split)
        throw new Error(
          `Split leakage: identical source bytes in both splits (${name}).`,
        );
      if (item.split === "holdout" && developmentHashes.has(digest))
        throw new Error(
          `Development-manifest leakage: identical source bytes (${name}).`,
        );
      hashes.set(digest, item.split);
    }
  }
}

async function loadDataset(root: string) {
  const definition = datasetSchema.parse(
    await readJsonFile((await datasetPath(root, "dataset.json"))!),
  );
  const labels = labelsSchema.parse(
    await readJsonFile((await datasetPath(root, "labels.json"))!),
  );
  if (definition.dataset_id !== labels.dataset_id)
    throw new Error("Dataset and labels identify different datasets.");
  unique(
    definition.cases.map((item) => item.id),
    "case IDs",
  );
  unique(
    labels.labels.map((item) => item.case_id),
    "label IDs",
  );
  unique(labels.provenance.reviewers, "label reviewers");
  const ids = new Set(definition.cases.map((item) => item.id));
  if (
    labels.labels.length !== ids.size ||
    labels.labels.some((label) => !ids.has(label.case_id))
  )
    throw new Error(
      "Every case needs exactly one external adjudicated label, with no extra labels.",
    );
  if (
    definition.cases.some((item) => item.split === "holdout") &&
    (!definition.provenance.holdout_independence_attested ||
      !definition.provenance.holdout_not_used_for_tuning ||
      !definition.provenance.holdout_frozen_before_model_run)
  )
    throw new Error(
      "Holdout independence, non-tuning and pre-run freeze attestations are required.",
    );
  for (const label of labels.labels) {
    unique(label.defect_fields, "gold defect fields");
    if (
      label.workflow === "verified" &&
      (label.category !== "BL_COMPARISON" ||
        label.blocking ||
        label.defect_fields.length)
    )
      throw new Error(`Contradictory verified gold label: ${label.case_id}`);
    if (
      ["discrepancy", "awaiting_documents"].includes(label.workflow) &&
      (label.category !== "BL_COMPARISON" || !label.blocking)
    )
      throw new Error(
        `Comparison-blocking gold label is inconsistent: ${label.case_id}`,
      );
    if (label.workflow === "discrepancy" && !label.defect_fields.length)
      throw new Error(
        `A discrepancy needs gold defect fields: ${label.case_id}`,
      );
    if ((label.workflow === "review") !== (label.review_reason !== null))
      throw new Error(
        `Review reason and gold workflow disagree: ${label.case_id}`,
      );
    if (label.category === "BL_COMPARISON" && label.workflow === "routed")
      throw new Error(
        `BL comparison cannot be gold routing-only: ${label.case_id}`,
      );
    if (label.workflow === "review" && !label.blocking)
      throw new Error(`Gold review must block verification: ${label.case_id}`);
  }
  const files = new Map<string, FrozenFile>();
  const add = async (
    name: string,
    role: FrozenFile["role"],
    absent = false,
  ) => {
    const existing = files.get(name);
    if (existing) {
      if (existing.role !== role || (existing.sha256 === null) !== absent)
        throw new Error(`Conflicting source declarations: ${name}`);
      return;
    }
    files.set(name, await fingerprintFile(root, name, role, absent));
  };
  await add("dataset.json", "definition");
  await add("labels.json", "labels");
  const cases: FrozenCase[] = [];
  const emails = new Map<string, z.infer<typeof emailSchema>>();
  for (const item of definition.cases) {
    await add(item.email_file, "email");
    const email = emailSchema.parse(
      await readJsonFile((await datasetPath(root, item.email_file))!),
    );
    if (email.email_id !== item.id)
      throw new Error(`Email ID does not match its case: ${item.id}`);
    unique(email.attachments, "attachment paths");
    unique(item.missing_attachments, "missing attachment paths");
    if (
      item.missing_attachments.some((name) => !email.attachments.includes(name))
    )
      throw new Error(
        `Missing-attachment declaration is not attached to ${item.id}.`,
      );
    for (const name of email.attachments)
      await add(name, "attachment", item.missing_attachments.includes(name));
    cases.push({ ...item, attachments: email.attachments });
    emails.set(item.id, email);
  }
  return {
    definition,
    labels,
    cases,
    emails,
    files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

export async function freezeEvaluation(
  root: string,
  manifestPath: string,
  developmentManifestPath?: string,
) {
  const loaded = await loadDataset(root);
  let development: FrozenManifest["development"] = null;
  if (developmentManifestPath) {
    const raw = await fs.readFile(developmentManifestPath);
    const previous = frozenManifestSchema.parse(
      JSON.parse(raw.toString("utf8")),
    );
    development = {
      dataset_id: previous.dataset_id,
      manifest_sha256: sha256(raw),
      shipment_groups: [
        ...new Set(previous.cases.map((item) => item.shipment_group)),
      ],
      template_families: [
        ...new Set(previous.cases.map((item) => item.template_family)),
      ],
      source_sha256s: [
        ...new Set(
          previous.files
            .filter(
              (file) => file.role === "email" || file.role === "attachment",
            )
            .flatMap((file) => (file.sha256 ? [file.sha256] : [])),
        ),
      ],
    };
  }
  checkSplitLeakage(loaded.cases, loaded.files, development);
  const manifest: FrozenManifest = {
    schema_version: 1,
    dataset_id: loaded.definition.dataset_id,
    frozen_at: new Date().toISOString(),
    provenance: loaded.definition.provenance,
    label_provenance: loaded.labels.provenance,
    cases: loaded.cases,
    files: loaded.files,
    development,
  };
  const output = JSON.stringify(manifest, null, 2) + "\n";
  await fs.mkdir(path.dirname(path.resolve(manifestPath)), { recursive: true });
  await fs.writeFile(manifestPath, output, { flag: "wx" });
  return { manifest, manifest_sha256: sha256(output) };
}

export async function verifyFrozenEvaluation(
  root: string,
  manifestPath: string,
) {
  const raw = await fs.readFile(manifestPath);
  const manifest = frozenManifestSchema.parse(JSON.parse(raw.toString("utf8")));
  unique(
    manifest.files.map((file) => file.path),
    "manifest file paths",
  );
  for (const expected of manifest.files) {
    const actual = await fingerprintFile(
      root,
      expected.path,
      expected.role,
      expected.sha256 === null,
    );
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes)
      throw new Error(`Frozen input changed: ${expected.path}`);
  }
  const loaded = await loadDataset(root);
  if (
    manifest.dataset_id !== loaded.definition.dataset_id ||
    JSON.stringify(manifest.cases) !== JSON.stringify(loaded.cases) ||
    JSON.stringify(manifest.files) !== JSON.stringify(loaded.files) ||
    JSON.stringify(manifest.provenance) !==
      JSON.stringify(loaded.definition.provenance) ||
    JSON.stringify(manifest.label_provenance) !==
      JSON.stringify(loaded.labels.provenance)
  )
    throw new Error(
      "Manifest does not match the complete frozen dataset definition.",
    );
  checkSplitLeakage(loaded.cases, loaded.files, manifest.development);
  return { ...loaded, manifest, manifest_sha256: sha256(raw) };
}

export interface EvaluatedCase {
  id: string;
  template_family: string;
  formats: string[];
  gold: GoldLabel;
  prediction: Pick<
    CaseResult,
    "category" | "workflow" | "review_reason" | "defect_fields" | "duration_ms"
  >;
}
const rate = (numerator: number, denominator: number) => ({
  numerator,
  denominator,
  rate: denominator ? numerator / denominator : null,
});
export function evaluationMetrics(rows: EvaluatedCase[]) {
  const count = (predicate: (row: EvaluatedCase) => boolean) =>
    rows.filter(predicate).length;
  const verified = (row: EvaluatedCase) =>
    row.prediction.workflow === "verified";
  const safeGold = (row: EvaluatedCase) =>
    row.gold.workflow === "verified" &&
    row.gold.category === "BL_COMPARISON" &&
    !row.gold.blocking &&
    !row.gold.defect_fields.length;
  return {
    cases: rows.length,
    false_clear_among_gold_blocking: rate(
      count((row) => row.gold.blocking && verified(row)),
      count((row) => row.gold.blocking),
    ),
    error_among_verified: rate(
      count(
        (row) =>
          verified(row) &&
          (!safeGold(row) ||
            row.prediction.category !== row.gold.category ||
            row.prediction.defect_fields.length > 0),
      ),
      count(verified),
    ),
    review_fraction: rate(
      count((row) => row.prediction.workflow === "review"),
      rows.length,
    ),
    unnecessary_review_among_gold_verified: rate(
      count((row) => safeGold(row) && row.prediction.workflow === "review"),
      count(safeGold),
    ),
    routing_errors: rate(
      count((row) => row.prediction.category !== row.gold.category),
      rows.length,
    ),
    unreviewed_routing_errors: rate(
      count(
        (row) =>
          row.prediction.category !== row.gold.category &&
          row.prediction.workflow !== "review",
      ),
      rows.length,
    ),
  };
}
export function groupedEvaluationMetrics(rows: EvaluatedCase[]) {
  const by = (keys: (row: EvaluatedCase) => string[]) => {
    const groups = new Map<string, EvaluatedCase[]>();
    for (const row of rows)
      for (const key of new Set(keys(row)))
        groups.set(key, [...(groups.get(key) ?? []), row]);
    return Object.fromEntries(
      [...groups]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, values]) => [key, evaluationMetrics(values)]),
    );
  };
  return {
    overall: evaluationMetrics(rows),
    by_format: by((row) =>
      row.formats.length ? row.formats : ["no_attachments"],
    ),
    by_template_family: by((row) => [row.template_family]),
    by_gold_category: by((row) => [row.gold.category]),
    format_group_note:
      "A mixed-format case is included once in each applicable format group; format denominators are not additive.",
  };
}

const timingSchema = z
  .object({
    pair_id: meaningful,
    case_id: meaningful,
    reviewer_id: meaningful,
    order: z.enum(["manual_first", "assisted_first"]),
    manual_active_seconds: z.number().finite().positive().nullable(),
    assisted_active_seconds: z.number().finite().positive().nullable(),
    manual_complete: z.boolean(),
    assisted_complete: z.boolean(),
    manual_correct: z.boolean(),
    assisted_correct: z.boolean(),
  })
  .strict();
export const pilotTimingsSchema = z
  .object({
    schema_version: z.literal(1),
    provenance: z
      .object({
        observer: meaningful,
        captured_at: z.string().datetime(),
        protocol_reference: meaningful,
        active_time_definition: meaningful,
        outcomes_independently_adjudicated: z.literal(true),
      })
      .strict(),
    samples: z.array(timingSchema).min(1).max(10000),
  })
  .strict();
export function timingStatistics(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const length = sorted.length;
  return {
    n: length,
    median: length
      ? (sorted[Math.floor((length - 1) / 2)] +
          sorted[Math.floor(length / 2)]) /
        2
      : null,
    p95: length ? sorted[Math.ceil(length * 0.95) - 1] : null,
  };
}
export function summarizePilotTimings(input: unknown, evaluatedIds: string[]) {
  const parsed = pilotTimingsSchema.parse(input);
  unique(
    parsed.samples.map((sample) => sample.pair_id),
    "pilot pair IDs",
  );
  unique(
    parsed.samples.map((sample) =>
      JSON.stringify([sample.case_id, sample.reviewer_id]),
    ),
    "case/reviewer pilot pairs",
  );
  const available = new Set(evaluatedIds);
  for (const sample of parsed.samples) {
    if (!available.has(sample.case_id))
      throw new Error(
        `Pilot sample does not refer to an evaluated holdout case: ${sample.case_id}`,
      );
    for (const mode of ["manual", "assisted"] as const) {
      if (
        sample[`${mode}_complete`] &&
        sample[`${mode}_active_seconds`] === null
      )
        throw new Error("Completed pilot tasks need measured active seconds.");
      if (sample[`${mode}_correct`] && !sample[`${mode}_complete`])
        throw new Error("An incomplete pilot task cannot be marked correct.");
    }
  }
  const pairs = parsed.samples.filter(
    (sample) =>
      sample.manual_complete &&
      sample.assisted_complete &&
      sample.manual_correct &&
      sample.assisted_correct,
  );
  const mode = (key: "manual" | "assisted") => ({
    active_seconds_for_completed_tasks: timingStatistics(
      parsed.samples
        .filter((sample) => sample[`${key}_complete`])
        .map((sample) => sample[`${key}_active_seconds`]!),
    ),
    completion: rate(
      parsed.samples.filter((sample) => sample[`${key}_complete`]).length,
      parsed.samples.length,
    ),
    correct_completion: rate(
      parsed.samples.filter(
        (sample) => sample[`${key}_complete`] && sample[`${key}_correct`],
      ).length,
      parsed.samples.length,
    ),
  });
  return {
    provenance: parsed.provenance,
    samples: parsed.samples.length,
    unique_cases: new Set(parsed.samples.map((sample) => sample.case_id)).size,
    unique_reviewers: new Set(
      parsed.samples.map((sample) => sample.reviewer_id),
    ).size,
    manual: mode("manual"),
    assisted: mode("assisted"),
    completed_correct_pairs: pairs.length,
    excluded_from_paired_time_comparison: parsed.samples.length - pairs.length,
    paired_seconds_saved: timingStatistics(
      pairs.map(
        (sample) =>
          sample.manual_active_seconds! - sample.assisted_active_seconds!,
      ),
    ),
    paired_fraction_saved: timingStatistics(
      pairs.map(
        (sample) =>
          (sample.manual_active_seconds! - sample.assisted_active_seconds!) /
          sample.manual_active_seconds!,
      ),
    ),
    order_counts: {
      manual_first: parsed.samples.filter(
        (sample) => sample.order === "manual_first",
      ).length,
      assisted_first: parsed.samples.filter(
        (sample) => sample.order === "assisted_first",
      ).length,
    },
    limitation:
      "Externally recorded supervised task times, not model latency. Paired savings use only tasks completed correctly in both conditions; report the excluded tasks and all-condition correctness alongside them. Repeated exposure can bias timings.",
  };
}

async function pipelineFingerprint() {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const files: string[] = [
    "package-lock.json",
    "scripts/evaluate-unseen.ts",
    "scripts/freeze-evaluation.ts",
  ];
  async function walk(directory: string) {
    for (const entry of await fs.readdir(path.join(root, directory), {
      withFileTypes: true,
    })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(relative);
      else if (/\.(?:ts|tsx|json)$/.test(entry.name)) files.push(relative);
    }
  }
  await walk("lib");
  const hashes = [];
  for (const file of files.sort())
    hashes.push({
      path: file,
      sha256: sha256(await fs.readFile(path.join(root, file))),
    });
  return { sha256: sha256(JSON.stringify(hashes)), file_count: hashes.length };
}

export async function evaluateFrozenDataset(
  root: string,
  manifestPath: string,
  timingsPath?: string,
) {
  const loaded = await verifyFrozenEvaluation(root, manifestPath);
  const cases = loaded.cases.filter((item) => item.split === "holdout");
  if (!cases.length)
    throw new Error("The frozen dataset has no holdout cases to evaluate.");
  const source = await pipelineFingerprint();
  const started = performance.now();
  const files = new Map(loaded.files.map((file) => [file.path, file]));
  const labels = new Map(
    loaded.labels.labels.map((label) => [label.case_id, label]),
  );
  const predictions: EvaluatedCase[] = [];
  for (const item of cases) {
    // Gold labels are never supplied to processing; no category override or prior corrections.
    const result = await processEmail(
      loaded.emails.get(item.id)!,
      async (name) => {
        const expected = files.get(name);
        if (!expected || expected.role !== "attachment")
          throw new Error(`Unfrozen attachment requested: ${name}`);
        const file = await datasetPath(root, name, expected.sha256 === null);
        if (expected.sha256 === null) {
          if (file)
            throw new Error(`Frozen missing attachment appeared: ${name}`);
          return null;
        }
        const bytes = await fs.readFile(file!);
        if (
          sha256(bytes) !== expected.sha256 ||
          bytes.byteLength !== expected.bytes
        )
          throw new Error(`Frozen attachment changed: ${name}`);
        return new Uint8Array(bytes);
      },
    );
    predictions.push({
      id: item.id,
      template_family: item.template_family,
      formats: [
        ...new Set(
          item.attachments.map(
            (name) => path.extname(name).slice(1).toLowerCase() || "unknown",
          ),
        ),
      ].sort(),
      gold: labels.get(item.id)!,
      prediction: {
        category: result.category,
        workflow: result.workflow,
        review_reason: result.review_reason,
        defect_fields: result.defect_fields,
        duration_ms: result.duration_ms,
      },
    });
  }
  let pilot = null;
  if (timingsPath) {
    const timingBytes = await fs.readFile(timingsPath);
    pilot = {
      input_sha256: sha256(timingBytes),
      ...summarizePilotTimings(
        JSON.parse(timingBytes.toString("utf8")),
        cases.map((item) => item.id),
      ),
    };
  }
  const after = await verifyFrozenEvaluation(root, manifestPath);
  if (
    after.manifest_sha256 !== loaded.manifest_sha256 ||
    (await pipelineFingerprint()).sha256 !== source.sha256
  )
    throw new Error(
      "Frozen manifest or application source changed during evaluation; discard this run.",
    );
  return {
    report: {
      schema_version: 1,
      dataset_id: loaded.manifest.dataset_id,
      evaluated_at: new Date().toISOString(),
      manifest_sha256: loaded.manifest_sha256,
      pipeline_version: PIPELINE_VERSION,
      source_fingerprint: source,
      node_version: process.version,
      engine:
        "processEmail; deterministic fresh run without prior corrections, category overrides, OCR confirmation or external AI calls",
      provenance: loaded.manifest.provenance,
      label_provenance: loaded.manifest.label_provenance,
      development_manifest_sha256:
        loaded.manifest.development?.manifest_sha256 ?? null,
      development_overlap_checked: !!loaded.manifest.development,
      development_cases_excluded: loaded.cases.length - cases.length,
      ...groupedEvaluationMetrics(predictions),
      processing_latency_ms: timingStatistics(
        predictions.map((row) => row.prediction.duration_ms),
      ),
      total_wall_ms: Math.round(performance.now() - started),
      pilot,
      limitations: [
        "Independence and reviewer provenance are user attestations, not facts the tool can authenticate.",
        "Without a development manifest, overlap with prior development data is not checked.",
        "One frozen dataset is not proof of real-world accuracy; after inspection or tuning it is development evidence.",
        "Null rates and timing statistics mean no eligible denominator or no recorded observations, never perfect accuracy or zero time.",
      ],
    },
    predictions,
  };
}
