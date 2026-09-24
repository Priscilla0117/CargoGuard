// Local, approved-data pilot runner. Freeze before the first run; never overwrite evidence.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import { processEmail } from "../lib/processing";
import { batchReviewBlocker } from "../lib/batch-review";
import {
  pilotStudySchema,
  pilotTimingSchema,
  scorePilot,
  type PilotObservation,
} from "../lib/pilot-evaluation";
import { PIPELINE_VERSION } from "../lib/types";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const fingerprintSchema = z
  .object({
    schema_version: z.literal(1),
    frozen_at: z.string().datetime(),
    study_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    engine_version: z.string(),
    engine_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    documents: z.array(
      z
        .object({
          case_id: z.string(),
          name: z.string(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
  })
  .strict();

/** Resolve symlinks too: a manifest must not read files outside its study directory. */
export async function studyFile(directory: string, relative: string) {
  if (path.isAbsolute(relative) || /^[A-Za-z]:|^[/\\]/.test(relative))
    throw new Error("Study documents must use relative paths.");
  const base = await fs.realpath(directory);
  const candidate = await fs.realpath(path.resolve(base, relative));
  const relation = path.relative(base, candidate);
  if (
    !relation ||
    relation === ".." ||
    relation.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relation)
  )
    throw new Error("A study document is outside the study directory.");
  const stat = await fs.stat(candidate);
  if (!stat.isFile() || stat.size > 20 * 1024 * 1024)
    throw new Error("Study documents must be files of at most 20 MB.");
  return candidate;
}
async function engineFingerprint() {
  const files: string[] = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "scripts/evaluate-pilot.ts",
  ];
  async function walk(folder: string) {
    for (const entry of await fs.readdir(path.join(root, folder), {
      withFileTypes: true,
    })) {
      const relative = `${folder}/${entry.name}`;
      if (entry.isDirectory()) await walk(relative);
      else if (/\.(ts|json)$/.test(entry.name)) files.push(relative);
    }
  }
  await walk("lib");
  return hash(
    JSON.stringify(
      await Promise.all(
        files
          .sort()
          .map(async (file) => [
            file,
            hash(await fs.readFile(path.join(root, file))),
          ]),
      ),
    ),
  );
}
async function snapshot(studyPath: string) {
  const bytes = await fs.readFile(studyPath);
  if (bytes.length > 20 * 1024 * 1024)
    throw new Error("Study manifest is too large.");
  const study = pilotStudySchema.parse(JSON.parse(bytes.toString("utf8")));
  const sources = new Map<string, Uint8Array>();
  const documents: { case_id: string; name: string; sha256: string }[] = [];
  let total = 0;
  for (const item of study.cases)
    for (const doc of item.documents) {
      const filename = await studyFile(path.dirname(studyPath), doc.file);
      const content = new Uint8Array(await fs.readFile(filename));
      total += content.length;
      if (total > 256 * 1024 * 1024)
        throw new Error(
          "Pilot exceeds the local runner's 256 MB source limit; use smaller predeclared cohorts.",
        );
      sources.set(JSON.stringify([item.id, doc.name]), content);
      documents.push({
        case_id: item.id,
        name: doc.name,
        sha256: hash(content),
      });
    }
  return {
    study,
    sources,
    fingerprint: {
      schema_version: 1 as const,
      study_sha256: hash(bytes),
      engine_version: PIPELINE_VERSION,
      engine_sha256: await engineFingerprint(),
      documents,
    },
  };
}
export async function freezePilot(studyPath: string, lockPath: string) {
  const { study, fingerprint } = await snapshot(studyPath);
  const frozen_at = new Date().toISOString();
  if (Date.parse(study.labelled_at) > Date.parse(frozen_at))
    throw new Error("Labels must be dated before the freeze.");
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  await fs.writeFile(
    lockPath,
    JSON.stringify({ ...fingerprint, frozen_at }, null, 2) + "\n",
    { flag: "wx" },
  );
  return {
    study_id: study.study_id,
    cases: study.cases.length,
    ...fingerprint,
  };
}
export async function runPilot(
  studyPath: string,
  lockPath: string,
  reportPath: string,
  timingPath?: string,
) {
  const lockBytes = await fs.readFile(lockPath);
  const lockHash = hash(lockBytes);
  const lock = fingerprintSchema.parse(JSON.parse(lockBytes.toString("utf8")));
  const { study, sources, fingerprint } = await snapshot(studyPath);
  const { frozen_at, ...expected } = lock;
  if (JSON.stringify(fingerprint) !== JSON.stringify(expected))
    throw new Error(
      "Frozen study, documents or engine changed. Preserve the first evidence and freeze a separately named new study/run.",
    );
  if (
    Date.parse(frozen_at) > Date.now() ||
    Date.parse(study.labelled_at) > Date.parse(frozen_at)
  )
    throw new Error("Invalid freeze/label chronology.");
  const timingBytes = timingPath ? await fs.readFile(timingPath) : null;
  const timings = timingBytes
    ? pilotTimingSchema.parse(JSON.parse(timingBytes.toString("utf8")))
    : [];
  // Reserve the first-run report before execution. A crash leaves an explicit incomplete artifact.
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const report = await fs.open(reportPath, "wx");
  try {
    await report.writeFile(
      JSON.stringify({
        complete: false,
        study_id: study.study_id,
        frozen_at,
        message:
          "Run started; results are incomplete until this artifact is finalized.",
      }) + "\n",
    );
    const observations: PilotObservation[] = [];
    for (const item of study.cases) {
      try {
        const result = await processEmail(
          {
            ...item.email,
            email_id: item.id,
            attachments: item.documents.map((doc) => doc.name),
          },
          async (name) => sources.get(JSON.stringify([item.id, name])) ?? null,
        );
        observations.push({
          id: item.id,
          category: result.category,
          workflow: result.workflow,
          batch_eligible: batchReviewBlocker(result) === null,
        });
      } catch {
        observations.push({
          id: item.id,
          category: null,
          workflow: "processing_error",
          batch_eligible: false,
        });
      }
    }
    if ((await engineFingerprint()) !== lock.engine_sha256)
      throw new Error(
        "Engine changed during the run. Incomplete run retained; do not report it as measured accuracy.",
      );
    if (hash(await fs.readFile(lockPath)) !== lockHash)
      throw new Error(
        "The frozen lock changed during the run. Incomplete evidence retained.",
      );
    const result = {
      complete: true,
      study_id: study.study_id,
      provenance: study.provenance,
      labeler_id: study.labeler_id,
      labelled_at: study.labelled_at,
      protocol: study.protocol,
      frozen_at,
      completed_at: new Date().toISOString(),
      engine_version: PIPELINE_VERSION,
      engine_sha256: lock.engine_sha256,
      study_sha256: lock.study_sha256,
      lock_sha256: lockHash,
      timing_sha256: timingBytes ? hash(timingBytes) : null,
      scope:
        "Untouched automatic document-check outcomes. Batch eligibility still requires human sign-off; it is not cargo/compliance clearance. Independence is a study-owner declaration, not established by this tool. Zero observed errors does not establish zero production risk.",
      metrics: scorePilot(study, observations, timings),
      observations,
    };
    const output = Buffer.from(JSON.stringify(result, null, 2) + "\n");
    let offset = 0;
    while (offset < output.length) {
      const { bytesWritten } = await report.write(
        output,
        offset,
        output.length - offset,
        offset,
      );
      if (bytesWritten <= 0)
        throw new Error("Unable to finish writing the pilot report.");
      offset += bytesWritten;
    }
    await report.truncate(output.length);
    await report.sync();
    return result;
  } finally {
    await report.close();
  }
}
async function main() {
  const [mode, study, lock, report, timings] = process.argv.slice(2);
  if (
    !study ||
    !lock ||
    (mode !== "freeze" && mode !== "run") ||
    (mode === "run" && !report)
  )
    throw new Error(
      "Usage: evaluate-pilot.ts freeze STUDY.json LOCK.json | run STUDY.json LOCK.json REPORT.json [TIMINGS.json]",
    );
  const result =
    mode === "freeze"
      ? await freezePilot(path.resolve(study), path.resolve(lock))
      : await runPilot(
          path.resolve(study),
          path.resolve(lock),
          path.resolve(report),
          timings ? path.resolve(timings) : undefined,
        );
  console.log(
    JSON.stringify(
      mode === "freeze"
        ? { frozen: true, study_id: result.study_id }
        : {
            study_id: result.study_id,
            ...("metrics" in result ? result.metrics : {}),
          },
      null,
      2,
    ),
  );
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main().catch(() => {
    console.error(
      "Pilot run refused or incomplete. Verify schema, frozen checksums, allowed document paths, chronology and unused output paths. No source content logged.",
    );
    process.exitCode = 1;
  });
