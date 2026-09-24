import type { CaseScheduling, CaseSummary } from "./types";

export const DEFAULT_SCHEDULING: CaseScheduling = {
  version: 0,
  due_at: null,
  follow_up_at: null,
  priority: "normal",
};
export const OFFICE_TIME_ZONE = "Asia/Kuala_Lumpur";
export function dayKey(
  value: string | Date | undefined | null,
  timeZone = OFFICE_TIME_ZONE,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export type ScheduleFilter =
  | "all"
  | "received_today"
  | "overdue"
  | "due_soon"
  | "follow_up"
  | "undated";
export function matchesSchedule(
  row: CaseSummary,
  filter: ScheduleFilter,
  now = new Date(),
  timeZone = OFFICE_TIME_ZONE,
) {
  const s = row.scheduling ?? DEFAULT_SCHEDULING;
  const due = s.due_at ? Date.parse(s.due_at) : Infinity;
  if (filter === "received_today")
    return dayKey(row.email.received_at, timeZone) === dayKey(now, timeZone);
  if (filter === "overdue") return due < now.getTime();
  if (filter === "due_soon")
    return due >= now.getTime() && due <= now.getTime() + 3 * 86400000;
  if (filter === "follow_up")
    return !!s.follow_up_at && Date.parse(s.follow_up_at) <= now.getTime();
  if (filter === "undated") return !row.email.received_at;
  return true;
}
/** Explicit user urgency first, then deadline and arrival. Never infer urgency from AI. */
export function compareSchedule(a: CaseSummary, b: CaseSummary) {
  const priority = { normal: 0, high: 1, urgent: 2 };
  const as = a.scheduling ?? DEFAULT_SCHEDULING,
    bs = b.scheduling ?? DEFAULT_SCHEDULING;
  const date = (s: string | null | undefined) =>
    s && Number.isFinite(Date.parse(s))
      ? Date.parse(s)
      : Number.MAX_SAFE_INTEGER;
  return (
    priority[bs.priority] - priority[as.priority] ||
    date(as.due_at) - date(bs.due_at) ||
    date(a.email.received_at) - date(b.email.received_at)
  );
}
export function dailyCaseCounts(
  cases: CaseSummary[],
  timeZone = OFFICE_TIME_ZONE,
) {
  const days: Record<
    string,
    { received: number; imported: number; due: number; follow_up: number }
  > = {};
  const seen = new Set<string>();
  let undated = 0;
  for (const row of cases) {
    if (seen.has(row.email.email_id)) continue;
    seen.add(row.email.email_id);
    if (!row.email.received_at) undated++;
    const fields = {
      received: row.email.received_at,
      imported: row.email.imported_at,
      due: row.scheduling?.due_at,
      follow_up: row.scheduling?.follow_up_at,
    };
    for (const [kind, value] of Object.entries(fields)) {
      const day = dayKey(value, timeZone);
      if (!day) continue;
      days[day] ??= { received: 0, imported: 0, due: 0, follow_up: 0 };
      days[day][kind as keyof typeof fields]++;
    }
  }
  return { days, undated, timeZone };
}
