import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { classify } from "../lib/classifier";
import { classifyLearned } from "../lib/routing";
import { emails } from "../lib/bundle";
import { CATEGORIES, type Category, type Email } from "../lib/types";

const truthPath = process.argv[2];
if (!truthPath)
  throw new Error(
    "Pass the organiser ground-truth JSON path. It is used only by this offline evaluator.",
  );
const truth = JSON.parse(await fs.readFile(truthPath, "utf8"));
type Row = {
  email: Email;
  expected: { category: Category; needs_review: boolean };
};
const development: Row[] = emails.map((email) => ({
  email,
  expected: { category: truth[email.email_id].category, needs_review: false },
}));
function evaluate(rows: Row[]) {
  return [
    "model",
    "rules-only",
    "legacy",
    "learned-only",
    "learned",
    "hybrid",
  ].map((mode) => {
    const predictions = rows.map((row) => {
      const prediction =
        mode === "learned-only"
          ? classifyLearned(row.email, false)
          : classify(
              row.email,
              mode === "rules-only"
                ? "legacy"
                : (mode as "model" | "legacy" | "learned" | "hybrid"),
            );
      const abstained =
        mode === "rules-only"
          ? !prediction.method.includes("intent rule")
          : !!prediction.needs_review;
      return { ...row, prediction, abstained };
    });
    const clear = predictions.filter((p) => !p.expected.needs_review);
    const accepted = clear.filter((p) => !p.abstained);
    const ambiguous = predictions.filter((p) => p.expected.needs_review);
    const scored = mode === "rules-only" ? accepted : clear;
    return {
      mode,
      total: rows.length,
      clear: clear.length,
      category_accuracy:
        scored.filter((p) => p.expected.category === p.prediction.category)
          .length / Math.max(scored.length, 1),
      category_macro_f1:
        CATEGORIES.reduce((sum, category) => {
          const tp = scored.filter(
            (p) =>
              p.expected.category === category &&
              p.prediction.category === category,
          ).length;
          const fp = scored.filter(
            (p) =>
              p.expected.category !== category &&
              p.prediction.category === category,
          ).length;
          const fn = scored.filter(
            (p) =>
              p.expected.category === category &&
              p.prediction.category !== category,
          ).length;
          return sum + (2 * tp) / (2 * tp + fp + fn || 1);
        }, 0) / CATEGORIES.length,
      accepted_clear: accepted.length,
      accepted_errors: accepted.filter(
        (p) => p.expected.category !== p.prediction.category,
      ).length,
      clear_review: clear.filter((p) => p.abstained).length,
      ambiguous: ambiguous.length,
      ambiguous_sent_to_review: ambiguous.filter((p) => p.abstained).length,
      rule_involved: predictions.filter((p) =>
        p.prediction.method.includes("intent rule"),
      ).length,
      incorrect_ids: clear
        .filter((p) => p.expected.category !== p.prediction.category)
        .map((p) => p.email.email_id),
    };
  });
}
const hashes = Object.fromEntries(
  await Promise.all(
    [
      "lib/routing-model.json",
      "lib/routing-features.ts",
      "lib/routing.ts",
      "lib/classifier.ts",
    ].map(async (file) => [
      file,
      createHash("sha256")
        .update(await fs.readFile(file))
        .digest("hex"),
    ]),
  ),
);
const challengePath = process.argv[3];
const challengeBytes = challengePath ? await fs.readFile(challengePath) : null;
const report = {
  generated_at: new Date().toISOString(),
  hashes,
  scope:
    "Supplied corpus and the separately authored synthetic challenge are development evidence, not representative of production or an untouched holdout. Version 3.2 adds independently authored security-incident training examples after targeted diagnostic failures. Rules-only metrics are conditional on coverage, not whole-corpus accuracy.",
  development: evaluate(development),
  ...(challengeBytes
    ? {
        challenge_sha256: createHash("sha256")
          .update(challengeBytes)
          .digest("hex"),
        challenge: evaluate(JSON.parse(challengeBytes.toString()).cases),
      }
    : {}),
};
await fs.mkdir("work/validation/ai-v31", { recursive: true });
await fs.writeFile(
  "work/validation/ai-v31/routing-evaluation.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
