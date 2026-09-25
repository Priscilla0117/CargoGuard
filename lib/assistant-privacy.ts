// Shared by the browser chat and the AI route: typed secrets and personal
// identifiers are refused before anything is searched, stored or sent.
export type SensitiveKind =
  | "password or one-time code"
  | "access key or token"
  | "payment card number"
  | "IC or passport number"
  | "bank account number";

interface Detector {
  kind: SensitiveKind;
  pattern: RegExp;
  valid?: (match: string) => boolean;
}

function luhn(digits: string) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

const DETECTORS: Detector[] = [
  {
    kind: "password or one-time code",
    pattern:
      /\b(?:password|passwd|pwd|passcode|pin|otp)\s*(?:is|was|:|=)\s*(?!(?:required|needed|wrong|incorrect|expired|correct|not|the|a|an|same|different|reset|changed|missing|invalid)\b)\S{3,}/gi,
  },
  {
    kind: "access key or token",
    pattern:
      /(?:\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{30,}|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bAIza[0-9A-Za-z_-]{30,}|\bGOCSPX-[A-Za-z0-9_-]{10,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_ -]?key|client[_ -]?secret|secret[_ -]?key|access[_ -]?token|bearer)\s*(?:is|:|=)?\s*(?=[A-Za-z_\-.]*\d)[A-Za-z0-9_\-.]{12,})/gi,
  },
  {
    kind: "payment card number",
    pattern: /(?:^|[^\w-])(\d(?:[ -]?\d){12,18})(?![\w-])/g,
    valid: (match) => luhn(match.replace(/\D/g, "")),
  },
  {
    kind: "IC or passport number",
    pattern:
      /(?:\b\d{6}-\d{2}-\d{4}\b|\b(?:nric|mykad|ic|passport)(?:\s*(?:no\.?|number|#))?\s*(?:is|:|=)?\s*(?:\d{6}-\d{2}-\d{4}|[A-Z]?\d{6,12})\b)/gi,
  },
  {
    kind: "bank account number",
    pattern:
      /\b(?:bank\s*(?:account|acct|a\/c)|a\/c)(?:\s*(?:no\.?|number|#))?\s*(?:is|:|=)?\s*\d[\d -]{6,20}\d\b/gi,
  },
];

function matches(text: string, detector: Detector) {
  // A fresh RegExp per call: global patterns carry lastIndex state.
  return [
    ...text.matchAll(
      new RegExp(detector.pattern.source, detector.pattern.flags),
    ),
  ]
    .map((m) => m[1] ?? m[0])
    .filter((m) => !detector.valid || detector.valid(m));
}

/** Kinds of secret or personal identifier found in typed text, if any. */
export function sensitiveFindings(text: string): SensitiveKind[] {
  return DETECTORS.filter((d) => matches(text, d).length).map((d) => d.kind);
}

/** Replace each detected secret so it is never kept in the chat transcript. */
export function redactSensitive(text: string) {
  let redacted = text;
  for (const detector of DETECTORS)
    for (const match of matches(redacted, detector))
      redacted = redacted.split(match).join("[removed]");
  return redacted;
}

export function sensitiveMessage(
  kinds: SensitiveKind[],
  where: "browser" | "server" = "browser",
) {
  const list =
    kinds.length > 1
      ? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)}`
      : kinds[0];
  const article = /^[aeiou]/i.test(list) || /^IC\b/.test(list) ? "an" : "a";
  return `This looks like it contains ${article} ${list}, so ${where === "server" ? "nothing was sent to AI or saved" : "it was not used, saved or sent anywhere"}. CargoGuard never needs credentials or personal identifiers; remove them and ask again.`;
}
