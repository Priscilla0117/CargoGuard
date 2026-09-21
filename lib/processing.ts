import { analyze, deriveResult, recomputeRows } from "./compare";
import { parseDocument } from "./parsers";
import type { CaseResult, Email, ParsedDocument } from "./types";
import { canTranscribe, transcribeDocument } from "./transcription";
import { DEFAULT_POLICY, type PolicySnapshot } from "./policy";
import { recoverDocument } from "./recovery";
import { selectionStillMatches } from "./document-selection";

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
  const docs = await mapLimited(email.attachments, 2, async (path) => {
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
  );
  result.source_replaced = previous?.source_replaced;
  if (
    docs.some((d) => d.transcription || d.recovery) ||
    previous?.category_override ||
    result.document_selection
  )
    result.reviewed = true;
  // An engine upgrade is not permission to erase a reviewed fact. Preserve
  // corrections only when every source fingerprint is unchanged.
  if (
    preserveCorrections &&
    previous?.reviewed &&
    previous.documents.length === docs.length &&
    docs.every(
      (d) =>
        d.sha256 &&
        previous.documents.some(
          (old) => old.name === d.name && old.sha256 === d.sha256,
        ),
    ) &&
    result.comparison.length
  ) {
    const rows = structuredClone(result.comparison);
    for (const row of rows)
      for (const side of ["si", "bl"] as const) {
        const old = previous.comparison.find((r) => r.field === row.field)?.[
          side
        ];
        if (old?.method.startsWith("Human correction")) row[side] = old;
      }
    result = deriveResult({ ...result, reviewed: true }, recomputeRows(rows));
  }
  return result;
}
