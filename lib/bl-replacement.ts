import { analyze, deriveResult, recomputeRows } from "./compare";
import { HttpError } from "./http";
import { processEmail } from "./processing";
import { requireCurrentEngine } from "./review-guard";
import type { CaseResult, ParsedDocument } from "./types";
import type { LabelRule } from "./label-rules";

/** Derive the reference from the saved case, never from a client-supplied path. */
export function blReplacementSources(previous: CaseResult) {
  requireCurrentEngine(previous);
  if (previous.category !== "BL_COMPARISON")
    throw new HttpError(
      "Confirm the BL comparison category before replacing its draft BL.",
      422,
    );
  let si: ParsedDocument | undefined;
  let bl: ParsedDocument | undefined;
  if (previous.document_selection) {
    const selected = previous.document_selection;
    const find = (side: "si" | "bl") => {
      const matches = previous.documents.filter(
        (doc) => doc.name === selected[side].name,
      );
      return matches.length === 1 && matches[0].sha256 === selected[side].sha256
        ? matches[0]
        : undefined;
    };
    si = find("si");
    bl = find("bl");
  } else if (previous.documents.length === 2) {
    const instructions = previous.documents.filter(
      (doc) => doc.type === "SI" && !doc.error,
    );
    if (instructions.length === 1) {
      si = instructions[0];
      bl = previous.documents.find((doc) => doc !== si);
    }
  }
  if (!si?.sha256 || si.type !== "SI" || si.error || !bl || si.name === bl.name)
    throw new HttpError(
      "Select one readable SI and the draft BL in Sources first. For ambiguous or missing sources, use Replace documents with the full pair.",
      422,
    );
  for (const source of [si, bl])
    if (
      previous.email.attachments.filter(
        (path) => path.split("/").pop() === source.name,
      ).length !== 1
    )
      throw new HttpError(
        "The saved source references are ambiguous. Recheck this case before replacing its BL.",
        409,
      );
  return { si, bl };
}

/** Reparse retained originals and replace only the selected draft. A damaged
 * replacement must never fall back to an excluded older BL. */
export async function replaceDraftBl(
  previous: CaseResult,
  replacement: ParsedDocument,
  read: (path: string) => Promise<Uint8Array | null>,
  reviewer: { actor: string; reason: string },
  labelRules: LabelRule[] = [],
) {
  const { si, bl } = blReplacementSources(previous);
  if (previous.documents.some((doc) => doc.name === replacement.name))
    throw new HttpError(
      "The revised BL must use a new immutable source name.",
      409,
    );
  if (!replacement.sha256)
    throw new HttpError(
      "The revised BL needs nonempty source bytes. Choose a document and retry.",
      422,
    );
  const attachments = previous.email.attachments.map((path) =>
    path.split("/").pop() === bl.name ? `uploads/${replacement.name}` : path,
  );
  const selection = previous.document_selection
    ? {
        si: { name: si.name, sha256: si.sha256! },
        bl: { name: replacement.name, sha256: replacement.sha256 },
        ...reviewer,
        selected_at: new Date().toISOString(),
      }
    : undefined;
  const reparsed = await processEmail(
    { ...previous.email, attachments },
    read,
    previous,
    false,
    previous.policy,
    labelRules,
  );
  const retainedSi = reparsed.documents.find((doc) => doc.name === si.name);
  if (retainedSi?.sha256 !== si.sha256)
    throw new HttpError(
      "The retained SI is missing or its fingerprint changed. Recheck the original sources before replacing the BL.",
      409,
    );
  if (
    reparsed.documents.find((doc) => doc.name === replacement.name)?.sha256 !==
    replacement.sha256
  )
    throw new HttpError(
      "The revised BL bytes changed while processing. Choose the file again.",
      409,
    );
  if (
    previous.documents.some(
      (doc) =>
        doc.name !== bl.name &&
        reparsed.documents.find((current) => current.name === doc.name)
          ?.sha256 !== doc.sha256,
    )
  )
    throw new HttpError(
      "A retained original attachment changed. Recheck the sources before replacing the BL.",
      409,
    );
  let result = analyze(
    reparsed.email,
    reparsed.documents,
    reparsed.duration_ms,
    previous.category_override,
    previous.policy,
    selection,
  );
  // Reuse only corrections explicitly tied to the unchanged SI. No old BL
  // values, extraction corrections or confirmations cross to the new source.
  const retainedCorrections: string[] = [];
  if (result.comparison.length) {
    const rows = structuredClone(result.comparison);
    for (const row of rows) {
      const original = previous.comparison.find(
        (old) => old.field === row.field,
      )?.si;
      if (
        original?.source === si.name &&
        row.si.source === si.name &&
        original.method.startsWith("Human correction")
      ) {
        row.si = structuredClone(original);
        retainedCorrections.push(row.field);
      }
    }
    if (retainedCorrections.length) {
      result = deriveResult(result, recomputeRows(rows));
      if (selection) {
        const excluded = result.documents.length - 2;
        result.summary += ` Human-selected pair only; ${excluded} other attachment${excluded === 1 ? " is" : "s are"} retained but not verified.`;
      }
    }
  }
  return {
    result: { ...result, reviewed: true, source_replaced: true },
    retainedSi: { name: si.name, sha256: si.sha256 },
    replacedBl: { name: bl.name, sha256: bl.sha256 },
    retainedCorrections,
  };
}
