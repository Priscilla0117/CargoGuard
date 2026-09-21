import type { DocumentSelection, ParsedDocument } from "./types";
import { HttpError } from "./http";

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
    if (doc.error || doc.type !== side.toUpperCase())
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
