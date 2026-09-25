import type { DocumentSelection, ParsedDocument } from "./types";
import { HttpError } from "./http";
import { pdfCoverageIssue } from "./pdf-coverage";

/** A human may choose a pair, but may not invent a role or bypass unreadability. */
export function selectedDocuments(
  documents: ParsedDocument[],
  selection: DocumentSelection,
) {
  const pair = (["si", "bl"] as const).map((side) => {
    const ref = selection[side];
    const matches = documents.filter((d) => d.name === ref.name);
    const doc = matches[0];
    if (matches.length !== 1 || !doc?.sha256 || doc.sha256 !== ref.sha256)
      throw new HttpError(
        "Selected source changed. Reopen the case and choose the current documents.",
        409,
      );
    if (doc.error || pdfCoverageIssue(doc) || doc.type !== side.toUpperCase())
      throw new HttpError(
        "Choose a readable, identified SI and draft BL. Confirm scan or AI-recovered evidence first if necessary.",
        422,
      );
    return doc;
  });
  if (pair[0].name === pair[1].name)
    throw new HttpError("The SI and BL must be different attachments.", 422);
  return pair;
}

export function selectionStillMatches(
  documents: ParsedDocument[],
  selection?: DocumentSelection,
) {
  if (!selection) return undefined;
  try {
    selectedDocuments(documents, selection);
    return selection;
  } catch {
    return undefined;
  }
}

/** Resolve the same pair that automatic comparison accepts. Retained invoices
 * are not a third member of that pair; ambiguous shipping drafts still block. */
export function comparisonDocuments(
  documents: ParsedDocument[],
  selection?: DocumentSelection,
) {
  if (selection) return selectedDocuments(documents, selection);
  const si = documents.filter((doc) => doc.type === "SI");
  const bl = documents.filter((doc) => doc.type === "BL");
  if (
    si.length !== 1 ||
    bl.length !== 1 ||
    documents.some(
      (doc) =>
        doc.error ||
        pdfCoverageIssue(doc) ||
        !["SI", "BL", "OTHER"].includes(doc.type),
    )
  )
    throw new HttpError(
      "Confirm the current readable SI and draft BL pair.",
      409,
    );
  if (
    si[0].name === bl[0].name ||
    [si[0], bl[0]].some(
      (source) =>
        documents.filter((doc) => doc.name === source.name).length !== 1,
    )
  )
    throw new HttpError(
      "The SI and draft BL need distinct, unambiguous source names.",
      409,
    );
  return [si[0], bl[0]];
}
