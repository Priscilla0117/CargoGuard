import type { Category } from "./types";

export interface RoutingLinearModel {
  version: string;
  feature_version: string;
  categories: Category[];
  vocabulary: string[];
  idf: number[];
  weights: number[][];
  bias: number[];
  thresholds: {
    minimumScore: number;
    minimumMargin: number;
    minimumKnownWords: number;
    minimumCoverage: number;
  };
  training: {
    provenance: string;
    source_sha256: string;
    train_rows: number;
    validation_rows: number;
    base_bodies: number;
    epochs: number;
    learning_rate: number;
    l2: number;
  };
}

export function linearRoutingScores(
  model: Pick<RoutingLinearModel, "weights" | "bias">,
  sparse: [number, number][],
) {
  const logits = model.bias.map((bias, category) =>
    sparse.reduce(
      (sum, [index, value]) => sum + model.weights[category][index] * value,
      bias,
    ),
  );
  const maximum = Math.max(...logits);
  const exponential = logits.map((value) => Math.exp(value - maximum));
  const sum = exponential.reduce((total, value) => total + value, 0);
  return exponential.map((value) => value / sum);
}
