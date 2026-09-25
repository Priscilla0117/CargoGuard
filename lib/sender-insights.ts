import { FIELD_LABELS, type CaseSummary, type Field } from "./types";

/** Company part of an email address ("docs@fujitogrp.com" → "fujitogrp.com"). */
export function senderCompany(from: string) {
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  const domain = address.split("@")[1]?.trim().toLowerCase() ?? "";
  return domain.replace(/[>\s].*$/, "") || address.trim().toLowerCase();
}

export interface SenderScore {
  company: string;
  checked: number;
  with_errors: number;
  rate: number;
  top: { field: Field; label: string; count: number }[];
  last_ids: string[];
}

const checkedDraft = (row: CaseSummary) =>
  row.result?.category === "BL_COMPARISON" &&
  (row.result.workflow === "verified" || row.result.workflow === "discrepancy");

/**
 * Draft quality per sending company, from checks already in the inbox.
 * Shows where mistakes come from so the team can raise it with that
 * forwarder or carrier. Descriptive only: small numbers are labelled.
 */
export function senderScores(cases: CaseSummary[]): SenderScore[] {
  const groups = new Map<string, CaseSummary[]>();
  for (const row of cases)
    if (checkedDraft(row)) {
      const key = senderCompany(row.email.from);
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
  return [...groups.entries()]
    .map(([company, rows]) => {
      const counts = new Map<Field, number>();
      let errors = 0;
      for (const row of rows)
        if (row.result!.workflow === "discrepancy") {
          errors++;
          for (const field of row.result!.defect_fields)
            counts.set(field, (counts.get(field) ?? 0) + 1);
        }
      return {
        company,
        checked: rows.length,
        with_errors: errors,
        rate: rows.length ? errors / rows.length : 0,
        top: [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([field, count]) => ({
            field,
            label: FIELD_LABELS[field],
            count,
          })),
        last_ids: rows.map((row) => row.email.email_id),
      };
    })
    .sort(
      (a, b) =>
        b.with_errors - a.with_errors ||
        b.rate - a.rate ||
        a.company.localeCompare(b.company),
    );
}

/**
 * A one-line heads-up for the case page when the same company has sent
 * several drafts with mistakes before (excluding this email).
 */
export function senderHeadsUp(
  cases: CaseSummary[],
  from: string,
  currentId: string,
): string | null {
  const company = senderCompany(from);
  const others = cases.filter(
    (row) =>
      row.email.email_id !== currentId &&
      checkedDraft(row) &&
      senderCompany(row.email.from) === company,
  );
  if (others.length < 3) return null;
  const score = senderScores(others)[0];
  if (!score || score.rate < 0.4) return null;
  const top = score.top[0];
  return `Heads-up: ${score.with_errors} of ${score.checked} earlier drafts from ${company} had differences${top ? ` — most often ${top.label.toLowerCase()}` : ""}. Check ${top ? "that detail" : "every detail"} carefully.`;
}
