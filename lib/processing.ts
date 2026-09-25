import { analyze } from "./compare";
import { parseDocument } from "./parsers";
import type { CaseResult, Email, ParsedDocument } from "./types";
import { canTranscribe, transcribeDocument } from "./transcription";
import { DEFAULT_POLICY, type PolicySnapshot } from "./policy";
import { recoverDocument } from "./recovery";
import { selectionStillMatches } from "./document-selection";
import { applyLabelRules, type LabelRule } from "./label-rules";
import { classify } from "./classifier";
import { currentRoutingMessage, routingReviewGate } from "./routing-features";
import { retainSourceCorrections } from "./source-corrections";

/** Route first, but retain parsing whenever attachment evidence may change the
 * route. Filename hints only make deferral more conservative, never classify. */
export function attachmentPlan(email: Email, previous?: CaseResult) {
  const classification = classify(email);
  const category = previous?.category_override ?? classification.category;
  if (
    category === "BL_COMPARISON" ||
    previous?.document_selection ||
    previous?.retained_corrections?.length ||
    previous?.documents.some((doc) => doc.sha256)
  )
    return {
      parse: true,
      reason:
        "Document comparison or existing source evidence requires parsing.",
    };
  if (previous?.category_override)
    return {
      parse: false,
      reason: "A reviewer confirmed a route without document comparison.",
    };
  if (classification.needs_review || routingReviewGate(email))
    return {
      parse: true,
      reason: "Uncertain or mixed requests need attachment evidence.",
    };
  if (category === "SPAM")
    return {
      parse: false,
      reason: "Spam attachments are retained without being opened.",
    };
  const current = `${email.subject}\n${currentRoutingMessage(email.body)}`;
  const shipping =
    /\b(?:s\/?i|b\/?l|shipping instructions?|bill of lading|draft|container|consignee|shipper)\b/i;
  if (
    category === "INVOICE_QUERY" &&
    !shipping.test(current) &&
    email.attachments.every((path) => {
      const name = (path.split("/").pop() ?? "").replace(/[_-]/g, " ");
      return (
        /\b(?:invoice|receipt|credit note)\b/i.test(name) &&
        !shipping.test(name)
      );
    })
  )
    return {
      parse: false,
      reason:
        "This confirmed invoice-only request needs billing follow-up, not an SI/BL comparison.",
    };
  return {
    parse: true,
    reason:
      "Attachment roles are not established; inspect them conservatively.",
  };
}

export function deferredDocument(path: string, reason: string): ParsedDocument {
  const name = path.split("/").pop()!;
  return {
    name,
    format: name.split(".").pop()?.toLowerCase() ?? "",
    type: "UNKNOWN",
    lines: [],
    method: `Deferred — ${reason}`,
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
  labelRules: LabelRule[] = [],
) {
  const started = performance.now();
  const plan = attachmentPlan(email, previous);
  if (!plan.parse) {
    const result = analyze(
      email,
      email.attachments.map((path) => deferredDocument(path, plan.reason)),
      Math.round(performance.now() - started),
      previous?.category_override,
      policy,
    );
    if (email.attachments.length)
      result.summary +=
        " Attachments are retained but have not been read or verified. Confirm the document-comparison route to inspect them.";
    result.source_replaced = previous?.source_replaced;
    return result;
  }
  let docs = await mapLimited(email.attachments, 2, async (path) => {
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
            doc.error ??
            "Previously confirmed recovery no longer matches the parsed source. Review or replace the document again.",
        };
      }
    }
    if (original?.transcription && canTranscribe(doc)) {
      try {
        return transcribeDocument(doc, original.transcription);
      } catch {
        // Older confirmations did not attest to every unread page. Keep the
        // source reviewable; never turn a failed recheck into cached clearance.
        return doc;
      }
    }
    return doc;
  });
  docs = await applyLabelRules(docs, labelRules);
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
    docs.some((d) => d.transcription || d.recovery || d.label_rules) ||
    previous?.category_override ||
    result.document_selection
  )
    result.reviewed = true;
  if (preserveCorrections && previous)
    result = retainSourceCorrections(previous, result);
  return result;
}
