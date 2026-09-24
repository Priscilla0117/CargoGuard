import { analyze } from "./compare";
import { parseDocument } from "./parsers";
import type { CaseResult, Category, Email, ParsedDocument } from "./types";
import { classify } from "./classifier";
import { canTranscribe, transcribeDocument } from "./transcription";
import { DEFAULT_POLICY, type PolicySnapshot } from "./policy";
import { recoverDocument } from "./recovery";
import { selectionStillMatches } from "./document-selection";
import { preserveSourceCorrections } from "./source-corrections";

/** Decide before reading or parsing attachments. Uncertain routes retain review. */
export function attachmentPlan(email: Email, override?: Category) {
  const classification = classify(email);
  return {
    classification,
    parse:
      (override ?? classification.category) === "BL_COMPARISON" ||
      (!override && !!classification.needs_review),
  };
}
export function deferredDocument(name: string): ParsedDocument {
  return {
    name,
    format: name.split(".").pop()?.toLowerCase() ?? "unknown",
    type: "UNKNOWN",
    lines: [],
    method: "Not inspected — routed before parsing",
    deferred: true,
  };
}

export async function mapLimited<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      output[index] = await task(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () =>
      worker(),
    ),
  );
  return output;
}

export async function processEmail(
  email: Email,
  read: (path: string) => Promise<Uint8Array | null>,
  previous?: CaseResult,
  preserveCorrections = false,
  policy: PolicySnapshot = previous?.policy ?? DEFAULT_POLICY,
) {
  const started = performance.now();
  const plan = attachmentPlan(email, previous?.category_override);
  const docs = await mapLimited(email.attachments, 2, async (path) => {
    if (!plan.parse)
      return (
        previous?.documents.find((d) => d.name === path.split("/").pop()) ??
        deferredDocument(path.split("/").pop()!)
      );
    const bytes = await read(path);
    const doc = bytes
      ? await parseDocument(path.split("/").pop()!, bytes)
      : ({
          name: path.split("/").pop()!,
          format: "unknown",
          type: "UNKNOWN",
          lines: [],
          method: "File validation",
          error: "The attachment is missing from storage.",
        } as ParsedDocument);
    const original = previous?.documents.find(
      (d) => d.name === doc.name && d.sha256 && d.sha256 === doc.sha256,
    );
    if (original?.recovery) {
      try {
        return await recoverDocument(doc, original.recovery);
      } catch {
        return {
          ...doc,
          error:
            "Previously confirmed recovery no longer matches the parsed source. Review or replace the document again.",
        };
      }
    }
    return original?.transcription && canTranscribe(doc)
      ? transcribeDocument(doc, original.transcription)
      : doc;
  });
  let result = analyze(
    email,
    docs,
    Math.round(performance.now() - started),
    previous?.category_override,
    policy,
    selectionStillMatches(docs, previous?.document_selection),
    plan.classification,
  );
  result.source_replaced = previous?.source_replaced;
  if (
    docs.some((d) => d.transcription || d.recovery) ||
    previous?.category_override ||
    result.document_selection
  )
    result.reviewed = true;
  // Keep corrections on unchanged sources through upgrades and unresolved pairs.
  // Explicit reprocessing (preserveCorrections=false) starts from source evidence.
  if (preserveCorrections && previous)
    result = preserveSourceCorrections(previous, result);
  return result;
}
