import fs from "node:fs/promises";
import { classify } from "../lib/classifier";
import { emails } from "../lib/bundle";
import { CATEGORIES } from "../lib/types";
// Labels enter only this offline evaluation file, never application inference.
const truth = JSON.parse(
  await fs.readFile(
    "../sdoc-hackathon-docker/data_v2/ground_truth.json",
    "utf8",
  ),
);
const report = {
  dataset: "520 supplied development emails; not a held-out benchmark",
  modes: ["model", "hybrid"].map((mode) => {
    const predictions = emails.map((e) => ({
      expected: truth[e.email_id].category,
      predicted: classify(e, mode as "model" | "hybrid"),
    }));
    const accuracy =
      predictions.filter((p) => p.expected === p.predicted.category).length /
      predictions.length;
    const macro_f1 =
      CATEGORIES.reduce((sum, c) => {
        const tp = predictions.filter(
            (p) => p.expected === c && p.predicted.category === c,
          ).length,
          fp = predictions.filter(
            (p) => p.expected !== c && p.predicted.category === c,
          ).length,
          fn = predictions.filter(
            (p) => p.expected === c && p.predicted.category !== c,
          ).length;
        return sum + (2 * tp) / (2 * tp + fp + fn || 1);
      }, 0) / CATEGORIES.length;
    return {
      mode,
      accuracy,
      macro_f1,
      rule_decisions: predictions.filter((p) =>
        p.predicted.method.includes("intent rule"),
      ).length,
      uncertain_category: predictions.filter((p) => p.predicted.needs_review)
        .length,
    };
  }),
};
await fs.mkdir("work/validation", { recursive: true });
await fs.writeFile(
  "work/validation/ablation.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
