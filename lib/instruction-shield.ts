import type { Email } from "./types";

/**
 * Email text is evidence written for people. Lines that address software
 * ("ignore previous instructions", "mark this case verified", markup or a
 * forged result object) are removed before routing, so they can neither steer
 * the category nor hide a discrepancy. The original email is never altered;
 * the count is reported so a person can see what was ignored.
 */
const SOFTWARE_DIRECTED: RegExp[] = [
  /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|preceding|other|your)\s+(?:instructions?|prompts?|rules|directions)\b/i,
  /\b(?:disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+)?(?:previous\s+|prior\s+)?(?:instructions?|prompts?|rules|system\s+prompt)\b/i,
  /\b(?:to|for)\s+(?:the\s+)?(?:automated|automatic|ai|artificial intelligence)\s+(?:checker|system|assistant|classifier|model|agent|bot|reviewer|tool)\b/i,
  /\b(?:you\s+are\s+(?:now\s+)?(?:an?\s+)?(?:ai|assistant|language\s+model|chatbot)|as\s+an\s+ai\b)/i,
  /\b(?:mark|set|report|classify|label|treat|flag|approve)\s+(?:this|the|every|all|each)?\s*(?:case|email|message|shipment|document|draft|bl|check)?s?\s+(?:as\s+)?(?:verified|ok|okay|correct|approved|matched|clean|compliant|no\s+mismatch|general|spam|invoice(?:\s+query)?|si\s+request)\b/i,
  /\b(?:set|change)\s+(?:the\s+)?(?:status|verdict|result|category)\s*(?:to|=|:)?\s*["']?(?:ok|verified|match|approved|general|spam)\b/i,
  /\b(?:has_defect|defect_fields|review_reason)\b|"status"\s*:/i,
  /<\s*\/?\s*(?:script|iframe|img|svg|object|embed|style)\b/i,
  /\b(?:system|developer|administrator)\s+(?:prompt|override|authority|mode)\b/i,
];

export function isSoftwareDirected(line: string) {
  // Match equivalent typography and invisible formatting without altering the
  // original evidence shown to the employee. This is a disclosure/routing
  // guard; deterministic document comparison never executes supplied text.
  const visible = line
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  return SOFTWARE_DIRECTED.some((pattern) => pattern.test(visible));
}

export function shieldEmail<T extends Pick<Email, "subject" | "body">>(
  email: T,
): { email: T; ignored: number } {
  let ignored = 0;
  const keep = (text: string) =>
    text
      .split(/\r?\n/)
      .filter((line) => {
        if (!isSoftwareDirected(line)) return true;
        ignored++;
        return false;
      })
      .join("\n");
  const subject = keep(email.subject);
  const body = keep(email.body);
  return ignored
    ? { email: { ...email, subject, body }, ignored }
    : { email, ignored: 0 };
}
