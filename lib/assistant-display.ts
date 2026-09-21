import type { AssistantFact } from "./assistant";

/** Only hide redundant, validated citation markers; preserve all other model text. */
export function assistantDisplayText(text: string, citations: string[]) {
  for (const id of citations) text = text.split(`[${id}]`).join("");
  return text.replace(/[ \t]+/g, " ").trim();
}
/** A saved field finding is more useful alongside its related SI / BL evidence. */
export function relatedAssistantFacts(
  fact: AssistantFact,
  facts: AssistantFact[],
) {
  if (!fact.id.endsWith("_result")) return [];
  const field = fact.id.slice(0, -"_result".length);
  return facts.filter(
    (item) => item.id === `${field}_si` || item.id === `${field}_bl`,
  );
}
export function assistantFieldDisplay(
  fact: AssistantFact,
): {
  value: string;
  method: string;
  issue: string | null;
  excerpts: string[];
  provenance: string;
} | null {
  try {
    const data = JSON.parse(fact.text);
    if (
      typeof data.saved_value !== "string" ||
      typeof data.method !== "string" ||
      typeof data.provenance !== "string" ||
      !Array.isArray(data.original_excerpts) ||
      !data.original_excerpts.every((line: unknown) => typeof line === "string")
    )
      return null;
    return {
      value: data.saved_value,
      method: data.method,
      issue: typeof data.issue === "string" ? data.issue : null,
      excerpts: data.original_excerpts,
      provenance: data.provenance,
    };
  } catch {
    return null;
  }
}
