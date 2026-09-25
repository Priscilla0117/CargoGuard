const SIGN_OFF =
  /^[ \t]*(?:best regards|kind regards|warm regards|warmest regards|regards|thanks(?: (?:and|&) regards)?|thank you|many thanks|cheers|sincerely|yours sincerely|yours faithfully|br|rgds)[ \t]*[,.!]?[ \t]*$/im;

/** Splits the newest message into body and signature (from the sign-off). */
export function splitSignature(text: string) {
  const clean = text.replace(/\r\n?/g, "\n").trim();
  const match = SIGN_OFF.exec(clean);
  if (!match || match.index < 2) return { body: clean, signature: "" };
  return {
    body: clean.slice(0, match.index).trim(),
    signature: clean.slice(match.index).trim(),
  };
}
