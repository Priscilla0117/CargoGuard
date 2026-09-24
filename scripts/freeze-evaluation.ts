import { freezeEvaluation } from "../lib/unseen-evaluation";

const args = process.argv.slice(2);
if (
  args.length !== 2 &&
  !(args.length === 4 && args[2] === "--development-manifest")
) {
  console.error(
    "Usage: node --import tsx scripts/freeze-evaluation.ts <dataset-dir> <new-manifest.json> [--development-manifest <prior-manifest.json>]",
  );
  process.exitCode = 1;
} else {
  try {
    const result = await freezeEvaluation(args[0], args[1], args[3]);
    console.log(
      JSON.stringify(
        {
          dataset_id: result.manifest.dataset_id,
          cases: result.manifest.cases.length,
          files: result.manifest.files.length,
          manifest_sha256: result.manifest_sha256,
          development_overlap_checked: !!result.manifest.development,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
