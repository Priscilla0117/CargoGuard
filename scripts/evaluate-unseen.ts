import fs from "node:fs/promises";
import path from "node:path";
import { evaluateFrozenDataset } from "../lib/unseen-evaluation";

const args = process.argv.slice(2);
if (args.length !== 3 && !(args.length === 5 && args[3] === "--timings")) {
  console.error(
    "Usage: node --import tsx scripts/evaluate-unseen.ts <dataset-dir> <manifest.json> <new-output-dir> [--timings <pilot-timings.json>]",
  );
  process.exitCode = 1;
} else {
  try {
    const output = path.resolve(args[2]);
    // Refuse replacement of a previous report. No evidence files are overwritten.
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.mkdir(output);
    const { report, predictions } = await evaluateFrozenDataset(
      args[0],
      args[1],
      args[4],
    );
    await fs.writeFile(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx" },
    );
    await fs.writeFile(
      path.join(output, "predictions.json"),
      JSON.stringify(predictions, null, 2) + "\n",
      { flag: "wx" },
    );
    console.log(
      JSON.stringify(
        {
          output,
          ...report.overall,
          pilot_observations: report.pilot?.samples ?? 0,
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
