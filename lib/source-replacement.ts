import { analyze } from "./compare";
import { selectionStillMatches } from "./document-selection";
import { HttpError } from "./http";
import type { CaseResult, Classification, ParsedDocument } from "./types";
import { preserveSourceCorrections } from "./source-corrections";

export function replacementSources(
  previous: CaseResult,
  mode: "replace_all" | "replace_one" | "append",
  targetName?: string,
  targetSha256?: string,
) {
  if (mode === "replace_all")
    return { documents: [] as ParsedDocument[], paths: [] as string[] };
  if (mode === "replace_one") {
    const matches = previous.documents.filter((d) => d.name === targetName);
    if (
      matches.length !== 1 ||
      matches[0].sha256 !== (targetSha256 || undefined)
    )
      throw new HttpError(
        "The replacement target changed. Refresh and choose the current document.",
        409,
      );
  }
  const documents = previous.documents.filter(
    (d) => mode !== "replace_one" || d.name !== targetName,
  );
  const paths = previous.email.attachments.filter(
    (p) => mode !== "replace_one" || p.split("/").pop() !== targetName,
  );
  if (documents.length !== paths.length)
    throw new HttpError(
      "Source metadata is incomplete. Refresh before replacing documents.",
      409,
    );
  return { documents, paths };
}

/** Only unchanged source identities may carry human corrections into a new revision. */
export function analyzeReplacement(
  previous: CaseResult,
  documents: ParsedDocument[],
  paths: string[],
  classification?: Classification,
) {
  const result = analyze(
    { ...previous.email, attachments: paths },
    documents,
    0,
    previous.category_override,
    previous.policy,
    selectionStillMatches(documents, previous.document_selection),
    classification,
  );
  return {
    ...preserveSourceCorrections(previous, result),
    reviewed: true,
    source_replaced: true,
  };
}
