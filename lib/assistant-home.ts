import { assistantWorkspaceSummary } from "./assistant-navigation";
import type { CaseSummary } from "./types";

export interface HomeReply {
  kind: "guide" | "case" | "choose";
  text: string;
  caseId?: string;
  carryQuestion?: boolean;
}

// Deliberately local, bounded product guidance, never presented as an LLM answer.
// Case questions take precedence over help keywords. Only IDs in this workspace
// may be selected; unknown IDs never trigger a lookup in another workspace.
export function assistantHomeReply(
  question: string,
  cases: CaseSummary[],
  workspaceReady = true,
): HomeReply {
  if (!workspaceReady)
    return {
      kind: "guide",
      text: "The workspace is still loading or unavailable, so I cannot report reliable counts or find a case yet. Close this panel and use Refresh workspace, then try again. No AI request was made.",
    };
  const ids = [
    ...new Set(
      (
        question.match(
          /\b(?:email_\d+|upload_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/gi,
        ) ?? []
      ).map((id) => id.toLowerCase()),
    ),
  ];
  if (ids.length > 1)
    return {
      kind: "choose",
      text: "You mentioned more than one case. Choose one shipment and ask about it separately so their evidence stays apart.",
      carryQuestion: false,
    };
  if (ids.length === 1) {
    const row = cases.find(
      (item) => item.email.email_id.toLowerCase() === ids[0],
    );
    return row
      ? {
          kind: "case",
          caseId: row.email.email_id,
          text: "Your question is ready in this case’s chat. Review the evidence-sharing preview before sending to AI.",
          carryQuestion: true,
        }
      : {
          kind: "choose",
          text: "I cannot find that case in this workspace. Choose an available case, then check the ID in your question.",
          carryQuestion: false,
        };
  }
  const normalized = question
    .toLowerCase()
    .trim()
    .replace(/[?.!]+$/g, "");
  if (
    [
      "what needs attention",
      "show my priorities",
      "workspace summary",
    ].includes(normalized)
  ) {
    const c = assistantWorkspaceSummary(cases);
    return {
      kind: "guide",
      text: `In the currently loaded workspace: ${c.discrepancies} cases have discrepancies, ${c.reviews} need review, ${c.awaiting} await documents, and ${c.pending} have not been verified.\n\nStart with discrepancies and unreadable evidence. These are saved workspace counts, not a live deadline or risk assessment. Attach a case for its evidence and next steps.`,
    };
  }
  if (
    [
      "how does checking work",
      "how do i use cargoguard",
      "how to use cargoguard",
    ].includes(normalized)
  ) {
    return {
      kind: "guide",
      text: "1. Verify an inbox case or upload shipping documents.\n2. CargoGuard classifies the email and compares seven fields in the Bill of Lading against the Shipping Instructions.\n3. Review differences, missing documents or unreadable evidence.\n4. Attach a case here for an AI explanation, correction-request draft or handover. A person must check and approve the work; chat never releases a shipment or sends an email.",
    };
  }
  if (["what can you help with", "help", "hello", "hi"].includes(normalized)) {
    return {
      kind: "guide",
      text: "I can show workspace priorities and explain how CargoGuard works without an AI request. For shipment-specific questions, attach a case or include its ID, such as email_004. Case AI can explain evidence, suggest next steps and draft a correction request. You review the data and consent before it goes to OpenAI.",
    };
  }
  return {
    kind: "choose",
    text: "For a shipment-specific answer, attach the case you mean. I’ll keep your question ready in its chat. Without a case, I can help with the workspace and the CargoGuard checking process, but I cannot give an evidence-backed answer to this question.",
    carryQuestion: true,
  };
}
