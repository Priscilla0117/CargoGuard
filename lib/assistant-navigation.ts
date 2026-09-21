import { PIPELINE_VERSION, type CaseSummary } from "./types";

export function refersToAnotherCase(question: string, selectedId: string) {
  const identifiers =
    question.match(
      /\b(?:email_\d+|upload_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/gi,
    ) ?? [];
  return identifiers.some(
    (id) => id.toLowerCase() !== selectedId.toLowerCase(),
  );
}

// Search stays in this browser; only an explicitly selected case reaches the API.
export function assistantCases(cases: CaseSummary[], query: string) {
  const needle = query.trim().toLowerCase();
  const rank: Record<string, number> = {
    discrepancy: 0,
    review: 1,
    awaiting_documents: 2,
    verified: 3,
    routed: 4,
  };
  return cases
    .filter(({ email }) =>
      `${email.email_id} ${email.subject} ${email.from}`
        .toLowerCase()
        .includes(needle),
    )
    .sort(
      (a, b) =>
        (rank[a.result?.workflow ?? ""] ?? 5) -
          (rank[b.result?.workflow ?? ""] ?? 5) ||
        a.email.email_id.localeCompare(b.email.email_id),
    );
}

export function assistantAvailability(row: CaseSummary) {
  if (!row.result) return "Verify this case first";
  if (row.result.pipeline_version !== PIPELINE_VERSION)
    return "Refresh the older engine result first";
  return null;
}

export function assistantWorkspaceSummary(cases: CaseSummary[]) {
  return {
    total: cases.length,
    discrepancies: cases.filter((c) => c.result?.workflow === "discrepancy")
      .length,
    reviews: cases.filter((c) => c.result?.workflow === "review").length,
    awaiting: cases.filter((c) => c.result?.workflow === "awaiting_documents")
      .length,
    pending: cases.filter((c) => !c.result).length,
  };
}
