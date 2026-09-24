import { classify } from "./classifier";
import type { Category, Email, ParsedDocument } from "./types";

/**
 * Decide from the email alone whether its attachments should be opened.
 * Messages routed as spam are quarantined unopened: their files are kept as
 * evidence but never parsed. Every other message is parsed, because a
 * mis-routed SI and draft BL must still reach review instead of being dismissed.
 * A reviewer's confirmed category always wins, so an override reopens the files.
 */
export function shouldOpenAttachments(
  email: Pick<Email, "subject" | "body" | "from" | "attachments">,
  categoryOverride?: Category,
): boolean {
  if (categoryOverride) return true;
  if (!email.attachments.length) return false;
  return classify(email as Email).category !== "SPAM";
}

export function unopenedAttachment(path: string): ParsedDocument {
  const name = path.split("/").pop()!;
  return {
    name,
    format: name.split(".").pop()?.toLowerCase() ?? "unknown",
    type: "UNKNOWN",
    lines: [],
    method:
      "Not opened: the message was routed as spam. Confirm a different category to open it.",
  };
}
