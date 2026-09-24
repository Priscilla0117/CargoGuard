import { classify } from "./classifier";
import type { Category, Email, ParsedDocument } from "./types";

export type DeferredReason = "spam" | "unrelated";

/** Route before invoking a parser. Filenames only defer obvious non-comparison
 * documents on confident non-comparison routes; they never prove document type
 * or a match. A set with ambiguous names or SI/BL candidates still needs full
 * inspection so a mis-routed comparison can reach review. Confirming a non-spam category opens
 * all retained files; confirming spam must never open quarantined files. */
export function planAttachmentIntake(
  email: Pick<Email, "subject" | "body" | "from" | "attachments">,
  categoryOverride?: Category,
) {
  const classification = classify(email as Email);
  const category = categoryOverride ?? classification.category;
  const deferred = new Map<string, DeferredReason>();
  for (const path of email.attachments) {
    if (category === "SPAM") {
      deferred.set(path, "spam");
      continue;
    }
    if (
      categoryOverride ||
      category === "BL_COMPARISON" ||
      classification.needs_review
    )
      continue;
    const name = (path.split(/[\\/]/).pop() ?? path)
      .normalize("NFKC")
      .replace(/[_\-.]+/g, " ");
    const comparisonCandidate =
      /\b(?:s\s*\/?\s*i|b\s*\/?\s*l|obl|swb|bill of lading|shipping instructions?|draft)\b/i.test(
        name,
      );
    const unrelatedName =
      /\b(?:invoice|billing|credit note|payment receipt|packing list|certificate of origin|berthing report|vessel schedule|holiday notice|office closure|meeting agenda|meeting minutes)\b/i.test(
        name,
      );
    if (unrelatedName && !comparisonCandidate) deferred.set(path, "unrelated");
  }
  // A named BL may arrive alongside an SI mistakenly named invoice.pdf. Open
  // that entire set so partial deferral cannot hide the existing misroute guard.
  if (
    category !== "SPAM" &&
    email.attachments.some((path) => !deferred.has(path))
  )
    deferred.clear();
  return { category, deferred };
}

export function isUnopenedAttachment(doc: ParsedDocument): boolean {
  // The method prefix also recognizes quarantined results saved before this
  // intake metadata was introduced, so a category confirmation reopens them.
  return (
    doc.intake?.state === "deferred" || doc.method.startsWith("Not opened:")
  );
}

export function unopenedAttachment(
  path: string,
  reason: DeferredReason = "spam",
  category: Category = "SPAM",
): ParsedDocument {
  const name = path.split(/[\\/]/).pop()!;
  return {
    name,
    format: name.split(".").pop()?.toLowerCase() ?? "unknown",
    type: "UNKNOWN",
    lines: [],
    method:
      reason === "spam"
        ? "Not opened: the message was routed as spam. Confirm a different category to open it."
        : `Not opened: the attachment name indicates an unrelated document for the ${category.replaceAll("_", " ").toLowerCase()} route. Its contents have not been inspected. Confirm the category to open it if needed.`,
    intake: { state: "deferred", reason, category },
  };
}
