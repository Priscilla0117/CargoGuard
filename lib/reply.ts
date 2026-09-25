import { emailInsight, extractReferences } from "./mail-intel";
import { FIELD_LABELS, type CaseResult, type ComparisonRow } from "./types";

/**
 * Grounded reply drafts. Every fact in a draft comes from the saved case:
 * field values, references, missing documents and the sender's own words.
 * Nothing is sent from here; the employee always reviews the text first.
 */
export type ReplyIntent =
  | "request_correction"
  | "confirm_match"
  | "request_documents"
  | "ask_clarification"
  | "acknowledge"
  | "blank";
export type ReplyTone = "formal" | "friendly" | "short";

export const INTENT_LABELS: Record<ReplyIntent, string> = {
  request_correction: "Ask for a corrected BL",
  confirm_match: "Confirm documents match",
  request_documents: "Ask for missing documents",
  ask_clarification: "Ask to clarify / resend",
  acknowledge: "Acknowledge & follow up",
  blank: "Blank reply",
};
export const TONE_LABELS: Record<ReplyTone, string> = {
  formal: "Formal",
  friendly: "Friendly",
  short: "Short",
};

export interface ReplyDraft {
  intent: ReplyIntent;
  tone: ReplyTone;
  to: string;
  cc: string[];
  subject: string;
  body: string;
  /** Short facts the employee should double-check before sending. */
  checks: string[];
  in_reply_to?: string;
  references: string[];
}

export function suggestedIntent(result: CaseResult): ReplyIntent {
  if (result.comparison.some((row) => row.result === "mismatch"))
    return "request_correction";
  if (
    result.workflow === "awaiting_documents" ||
    result.review_reason === "missing_attachment" ||
    result.review_reason === "wrong_doc_type"
  )
    return result.category === "BL_COMPARISON" ||
      result.category === "SI_REQUEST"
      ? "request_documents"
      : "acknowledge";
  if (
    result.review_reason === "unreadable" ||
    result.review_reason === "missing_value" ||
    result.comparison.some((row) => row.result === "uncertain")
  )
    return "ask_clarification";
  if (result.workflow === "verified") return "confirm_match";
  return "acknowledge";
}

/**
 * The name to greet. Uses the whole name as written: many colleagues in
 * Malaysia and Singapore write the family name first ("Teo Ei Leen",
 * "Lee Guan Cheng"), so "Dear Teo" would be wrong.
 */
function greetingName(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (
    !words.length ||
    words.length > 4 ||
    words.some((word) => !/^[A-Za-z][A-Za-z'.-]{0,30}$/.test(word)) ||
    /^(info|admin|sales|docs|documentation|shipping|operations|noreply|no-reply|hr|exports?|imports?|support|team|cs|mail|administrator)$/i.test(
      words[0],
    )
  )
    return "";
  return words
    .map((word) =>
      word === word.toUpperCase() || word === word.toLowerCase()
        ? word[0].toUpperCase() + word.slice(1).toLowerCase()
        : word,
    )
    .join(" ");
}
function oneLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
function replySubject(subject: string) {
  const clean = subject.replace(/^\s*(?:(?:re|fw|fwd)\s*[:_]\s*)+/i, "").trim();
  return `RE: ${clean || "(No subject)"}`;
}
function referenceLine(result: CaseResult) {
  const refs = extractReferences(result.email.subject, result.email.body);
  const parts = [
    refs.shipment.length ? `Order ${refs.shipment.join(", ")}` : "",
    refs.po.length ? `PO ${refs.po.join(", ")}` : "",
    refs.booking.length
      ? `Booking/BL ${refs.booking.slice(0, 2).join(", ")}`
      : "",
    refs.invoice.length ? `Invoice ${refs.invoice.join(", ")}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
function differenceLines(rows: ComparisonRow[], tone: ReplyTone) {
  return rows.map((row, index) =>
    tone === "short"
      ? `${index + 1}. ${FIELD_LABELS[row.field]}: should be "${oneLine(row.si.raw) || "(not stated)"}" (BL shows "${oneLine(row.bl.raw) || "(blank)"}")`
      : `${index + 1}. ${FIELD_LABELS[row.field]}\n   Per our SI:     ${oneLine(row.si.raw) || "(not stated)"}\n   Draft BL shows: ${oneLine(row.bl.raw) || "(blank)"}`,
  );
}
function missingDocuments(result: CaseResult) {
  const types = new Set(result.documents.map((doc) => doc.type));
  const missing: string[] = [];
  if (!types.has("SI")) missing.push("Shipping Instruction (SI)");
  if (!types.has("BL")) missing.push("draft Bill of Lading (BL)");
  return missing.length
    ? missing
    : ["Shipping Instruction (SI)", "draft Bill of Lading (BL)"];
}

export function quoteOriginal(result: CaseResult) {
  const when = result.email.received_at
    ? new Date(result.email.received_at).toUTCString().replace(" GMT", " UTC")
    : "";
  const quoted = result.email.body
    .split(/\r?\n/)
    .slice(0, 60)
    .map((line) => `> ${line}`)
    .join("\n");
  return `${when ? `On ${when}, ` : ""}${result.email.from} wrote:\n${quoted}`;
}

export function draftReply(
  result: CaseResult,
  options: {
    intent?: ReplyIntent;
    tone?: ReplyTone;
    signature?: string;
    followUpBy?: string;
  } = {},
): ReplyDraft {
  const intent = options.intent ?? suggestedIntent(result);
  const tone = options.tone ?? "formal";
  const insight = emailInsight(result.email);
  const name = greetingName(insight.sender_name);
  const greeting =
    tone === "formal"
      ? `Dear ${name || "Sir/Madam"},`
      : `Hi ${name || "there"},`;
  const thanks =
    tone === "short"
      ? ""
      : tone === "friendly"
        ? "Thanks for your email."
        : "Thank you for your email.";
  const refs = referenceLine(result);
  const about = refs ? ` for ${refs}` : "";
  const closing =
    tone === "formal"
      ? "Best regards,"
      : tone === "friendly"
        ? "Thanks and regards,"
        : "Regards,";
  const signature = options.signature?.trim() || "Shipping Documentation Team";
  const checks: string[] = [];
  const mismatches = result.comparison.filter(
    (row) => row.result === "mismatch",
  );
  const uncertain = result.comparison.filter(
    (row) => row.result === "uncertain",
  );
  let lines: string[] = [];

  switch (intent) {
    case "request_correction": {
      // "SAME AS CONSIGNEE" on both sides differs only because the consignee
      // differs: explain it once instead of asking to change identical text.
      const same = (row: ComparisonRow) =>
        oneLine(row.si.raw).toUpperCase() === oneLine(row.bl.raw).toUpperCase();
      const direct = mismatches.filter((row) => !same(row));
      const derived = mismatches.filter(same);
      const listed = direct.length ? direct : mismatches;
      lines = [
        thanks,
        `We have checked the draft BL${about} against our Shipping Instruction. ${
          listed.length === 1
            ? "The following detail does not match and needs to be corrected:"
            : `The following ${listed.length} details do not match and need to be corrected:`
        }`,
        "",
        ...differenceLines(listed, tone),
        ...(direct.length && derived.length
          ? [
              "",
              `${derived.map((row) => FIELD_LABELS[row.field]).join(" and ")} (“${oneLine(derived[0].bl.raw)}”) will be correct once the above is amended.`,
            ]
          : []),
        "",
        tone === "short"
          ? "Please amend and send the revised draft BL."
          : "Could you please amend the draft BL accordingly and send us the revised draft for our final check?",
      ];
      if (uncertain.length)
        lines.push(
          "",
          `We could not confirm ${uncertain.map((row) => FIELD_LABELS[row.field].toLowerCase()).join(", ")} from the copy received. Please also make sure ${uncertain.length === 1 ? "it is" : "they are"} clearly stated in the revised draft.`,
        );
      checks.push(
        ...listed.map(
          (row) =>
            `${FIELD_LABELS[row.field]} — SI value copied from ${row.si.evidence}`,
        ),
      );
      if (!mismatches.length)
        checks.push(
          "No confirmed difference is saved — choose another reply type.",
        );
      break;
    }
    case "confirm_match":
      lines = [
        thanks,
        `We have checked the draft BL${about} against our Shipping Instruction. Shipper, consignee, notify party, ports, container count and gross weight all match.`,
        "",
        tone === "short"
          ? "Please proceed to finalise the BL."
          : "Please proceed to finalise the BL on this basis. This confirms the document details only.",
      ];
      if (result.workflow !== "verified")
        checks.push(
          "This case is not marked as matching — confirm before sending.",
        );
      break;
    case "request_documents": {
      const missing = missingDocuments(result);
      lines = [
        thanks,
        `To check the documents${about}, we still need the following:`,
        "",
        ...missing.map((item) => `• ${item}`),
        "",
        tone === "short"
          ? "Please send them at your earliest convenience."
          : "Could you please send them at your earliest convenience so we can complete the check?",
      ];
      break;
    }
    case "ask_clarification": {
      const unreadable = result.documents.filter((doc) => doc.error);
      lines = [
        thanks,
        `We are checking the documents${about}, but some information could not be confirmed:`,
        "",
        ...uncertain.map(
          (row) =>
            `• ${FIELD_LABELS[row.field]}${row.bl.issue || row.si.issue ? ` — ${oneLine(row.bl.issue || row.si.issue || "")}` : ""}`,
        ),
        ...unreadable.map((doc) => `• ${doc.name} could not be read clearly`),
        ...(uncertain.length || unreadable.length
          ? []
          : ["• Some details in the attached documents are unclear"]),
        "",
        tone === "short"
          ? "Please confirm these details or resend a clearer copy."
          : "Could you please confirm these details or resend a clear, text-based copy (PDF or Word) of the documents?",
      ];
      break;
    }
    case "acknowledge": {
      const followUp = options.followUpBy
        ? ` We will revert by ${options.followUpBy}.`
        : " We will revert to you shortly.";
      const invoice = extractReferences(
        result.email.subject,
        result.email.body,
      ).invoice;
      lines = [
        thanks,
        result.category === "INVOICE_QUERY" && invoice.length
          ? `We have received your query regarding invoice ${invoice.join(", ")}${refs && !refs.startsWith("Invoice") ? ` (${refs})` : ""} and are checking it with the relevant team.${followUp}`
          : result.category === "SI_REQUEST"
            ? `We have received your request${about} and are preparing the Shipping Instruction.${followUp}`
            : `We have received your email${about} and are looking into it.${followUp}`,
      ];
      break;
    }
    case "blank":
      lines = [""];
      break;
  }
  const body = [
    greeting,
    "",
    ...lines.filter((line, i) => !(i === 0 && !line)),
    "",
    closing,
    signature,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  return {
    intent,
    tone,
    to: result.email.from,
    cc: (result.email.cc ?? []).slice(0, 10),
    subject: replySubject(result.email.subject),
    body,
    checks,
    in_reply_to: result.email.message_id,
    references: [
      ...(result.email.references ?? []),
      ...(result.email.message_id ? [result.email.message_id] : []),
    ].slice(-20),
  };
}

/** Values the AI may not drop or change when it polishes a grounded draft. */
export function protectedFacts(draft: string) {
  const facts = new Set<string>();
  for (const match of draft.matchAll(
    /"([^"\n]{2,300})"|: {2,}([^\n]{2,300})|Per our SI: +([^\n]+)|Draft BL shows: +([^\n]+)/g,
  )) {
    const value = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (value) facts.add(value);
  }
  const refs = extractReferences("", draft);
  for (const group of Object.values(refs))
    for (const value of group) facts.add(value);
  return [...facts];
}
export function missingFacts(original: string, rewritten: string) {
  const normalize = (value: string) => value.replace(/\s+/g, " ").toUpperCase();
  const target = normalize(rewritten);
  return protectedFacts(original).filter(
    (fact) => !target.includes(normalize(fact)),
  );
}

/** Gmail web compose link: works for any signed-in Gmail user, no API setup. */
export function gmailComposeUrl(draft: {
  to: string;
  cc?: string[];
  subject: string;
  body: string;
}) {
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: draft.to,
    su: draft.subject,
    body: draft.body,
  });
  if (draft.cc?.length) params.set("cc", draft.cc.join(","));
  return `https://mail.google.com/mail/?${params.toString()}`;
}
export function mailtoUrl(draft: {
  to: string;
  cc?: string[];
  subject: string;
  body: string;
}) {
  const params = new URLSearchParams({
    subject: draft.subject,
    body: draft.body,
  });
  if (draft.cc?.length) params.set("cc", draft.cc.join(","));
  return `mailto:${encodeURIComponent(draft.to)}?${params.toString().replace(/\+/g, "%20")}`;
}
