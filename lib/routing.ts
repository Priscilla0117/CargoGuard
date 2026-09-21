import artifact from "./routing-model.json";
import { linearRoutingScores, type RoutingLinearModel } from "./routing-linear";
import {
  currentRoutingMessage,
  routingTokens,
  routingFeatureCounts,
  routingReviewGate,
  vectorizeRouting,
} from "./routing-features";
import type { Classification, Email } from "./types";

const model = artifact as RoutingLinearModel;
const indexes = new Map(
  model.vocabulary.map((feature, index) => [feature, index]),
);

/** Sparse learned inference; rules can request review but cannot select a category. */
export function classifyLearned(
  email: Pick<Email, "subject" | "body">,
  gates = true,
): Classification {
  const { features, tokens } = routingFeatureCounts(email);
  const sparse = vectorizeRouting(features, indexes, model.idf);
  const scores = linearRoutingScores(model, sparse);
  const ranked = scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  // Evidence coverage concerns the active request. A long subject full of
  // unfamiliar customer/port names must not drown out a clear body request.
  const bodyTokens = routingTokens(
    currentRoutingMessage(email.body).slice(0, 5000),
  );
  const words = [...new Set(bodyTokens.length ? bodyTokens : tokens)];
  const known = words.filter((word) => indexes.has(`w:${word}`));
  const coverage = known.length / Math.max(words.length, 1);
  const gate = gates ? routingReviewGate(email) : undefined;
  const uncertain =
    gates &&
    (best.score < model.thresholds.minimumScore ||
      best.score - ranked[1].score < model.thresholds.minimumMargin ||
      known.length < model.thresholds.minimumKnownWords ||
      coverage < model.thresholds.minimumCoverage);
  const evidence = sparse
    .map(([index, value]) => ({
      feature: model.vocabulary[index],
      contribution: value * model.weights[best.index][index],
    }))
    .filter((item) => item.contribution > 0 && !item.feature.startsWith("c:"))
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 5);
  return {
    category: model.categories[best.index],
    confidence: best.score,
    method: "Learned TF-IDF linear router",
    signals: [
      ...evidence.map(
        (item) => `${item.feature} (+${item.contribution.toFixed(3)})`,
      ),
      "Model scores are not calibrated probabilities.",
    ],
    scores: Object.fromEntries(
      model.categories.map((category, index) => [category, scores[index]]),
    ),
    needs_review: !!gate || !!uncertain,
    ...(gate || uncertain
      ? {
          review_note:
            gate ??
            "The learned router has insufficient evidence or competing categories. Confirm the current request before processing documents.",
        }
      : {}),
  };
}
