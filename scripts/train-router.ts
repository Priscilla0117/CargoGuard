import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { CATEGORIES } from "../lib/types";
import {
  routingFeatureCounts,
  vectorizeRouting,
  ROUTING_FEATURE_VERSION,
} from "../lib/routing-features";
import {
  linearRoutingScores,
  type RoutingLinearModel,
} from "../lib/routing-linear";
import {
  authoredRoutingRows,
  ROUTER_TRAINING,
  ROUTER_TRAINING_PROVENANCE,
} from "./router-training-data";

// Offline deterministic full-batch multinomial logistic regression. Its only
// labelled input is the authored corpus imported above, never organiser labels.
const rows = authoredRoutingRows();
const train = rows.filter((row) => row.split === "train");
const validation = rows.filter((row) => row.split === "validation");
const extracted = train.map((row) => routingFeatureCounts(row).features);
const frequencies = new Map<string, number>();
for (const features of extracted)
  for (const feature of features.keys())
    frequencies.set(feature, (frequencies.get(feature) ?? 0) + 1);
const vocabulary = [...frequencies]
  .filter(([, count]) => count >= 2)
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"))
  .slice(0, 12000)
  .map(([feature]) => feature)
  .sort();
const indexes = new Map(vocabulary.map((feature, index) => [feature, index]));
const idf = vocabulary.map(
  (feature) =>
    Math.log((1 + train.length) / (1 + frequencies.get(feature)!)) + 1,
);
const vectors = extracted.map((features) =>
  vectorizeRouting(features, indexes, idf),
);
const model: RoutingLinearModel = {
  version: "learned-router-1",
  feature_version: ROUTING_FEATURE_VERSION,
  categories: [...CATEGORIES],
  vocabulary,
  idf,
  weights: CATEGORIES.map(() => Array(vocabulary.length).fill(0)),
  bias: CATEGORIES.map(() => 0),
  thresholds: {
    minimumScore: 0.5,
    minimumMargin: 0.12,
    minimumKnownWords: 2,
    minimumCoverage: 0.25,
  },
  training: {
    provenance: ROUTER_TRAINING_PROVENANCE,
    source_sha256: createHash("sha256")
      .update(JSON.stringify(ROUTER_TRAINING))
      .digest("hex"),
    train_rows: train.length,
    validation_rows: validation.length,
    base_bodies: Object.values(ROUTER_TRAINING).reduce(
      (sum, category) => sum + category.bodies.length,
      0,
    ),
    epochs: 180,
    learning_rate: 4,
    l2: 0.0004,
  },
};
for (let epoch = 0; epoch < model.training.epochs; epoch++) {
  const gradient = CATEGORIES.map(() => new Float64Array(vocabulary.length));
  const biasGradient = CATEGORIES.map(() => 0);
  for (let index = 0; index < train.length; index++) {
    const scores = linearRoutingScores(model, vectors[index]);
    for (let category = 0; category < CATEGORIES.length; category++) {
      const error =
        scores[category] -
        Number(CATEGORIES[category] === train[index].category);
      biasGradient[category] += error;
      for (const [feature, value] of vectors[index])
        gradient[category][feature] += error * value;
    }
  }
  for (let category = 0; category < CATEGORIES.length; category++) {
    model.bias[category] -=
      (model.training.learning_rate * biasGradient[category]) / train.length;
    for (let feature = 0; feature < vocabulary.length; feature++)
      model.weights[category][feature] -=
        model.training.learning_rate *
        (gradient[category][feature] / train.length +
          model.training.l2 * model.weights[category][feature]);
  }
}
// Compact deterministic serialization; rounding error is far below gate margins.
model.weights = model.weights.map((weights) =>
  weights.map((weight) => +weight.toFixed(8)),
);
model.bias = model.bias.map((bias) => +bias.toFixed(8));
model.idf = model.idf.map((value) => +value.toFixed(8));
const measure = (samples: typeof rows) => {
  const predictions = samples.map((row) => {
    const scores = linearRoutingScores(
      model,
      vectorizeRouting(routingFeatureCounts(row).features, indexes, model.idf),
    );
    const ranked = scores
      .map((score, index) => ({ score, index }))
      .sort((a, b) => b.score - a.score);
    return {
      expected: row.category,
      predicted: CATEGORIES[ranked[0].index],
      accepted:
        ranked[0].score >= model.thresholds.minimumScore &&
        ranked[0].score - ranked[1].score >= model.thresholds.minimumMargin,
    };
  });
  return {
    records: samples.length,
    correct: predictions.filter((row) => row.expected === row.predicted).length,
    accuracy:
      predictions.filter((row) => row.expected === row.predicted).length /
      samples.length,
    macro_f1:
      CATEGORIES.reduce((sum, category) => {
        const tp = predictions.filter(
          (row) => row.expected === category && row.predicted === category,
        ).length;
        const fp = predictions.filter(
          (row) => row.expected !== category && row.predicted === category,
        ).length;
        const fn = predictions.filter(
          (row) => row.expected === category && row.predicted !== category,
        ).length;
        return sum + (2 * tp) / (2 * tp + fp + fn || 1);
      }, 0) / CATEGORIES.length,
    accepted: predictions.filter((row) => row.accepted).length,
    accepted_errors: predictions.filter(
      (row) => row.accepted && row.expected !== row.predicted,
    ).length,
  };
};
const output = path.resolve(process.argv[2] ?? "lib/routing-model.json");
await fs.mkdir(path.dirname(output), { recursive: true });
const bytes = JSON.stringify(model) + "\n";
await fs.writeFile(output, bytes);
const report = {
  version: model.version,
  model_sha256: createHash("sha256").update(bytes).digest("hex"),
  feature_version: model.feature_version,
  vocabulary: vocabulary.length,
  bytes: Buffer.byteLength(bytes),
  scope:
    "Authored training and grouped-by-body validation; no organiser labels; not a production benchmark. Thresholds are fixed development settings, not calibrated probabilities.",
  train: measure(train),
  validation: measure(validation),
};
await fs.mkdir("work/validation/ai-v31", { recursive: true });
await fs.writeFile(
  "work/validation/ai-v31/training-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
