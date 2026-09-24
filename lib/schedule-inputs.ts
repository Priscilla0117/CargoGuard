import type { CaseScheduling } from "./types";

/** Convert the office's wall-clock input, independently of the browser's timezone. */
export function scheduleDateToIso(
  value: string,
  label = "date",
): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    throw new Error(`Enter a valid ${label} and time.`);
  }
  const local = value.length === 16 ? `${value}:00` : value;
  const instant = new Date(`${local}+08:00`);
  // Round-trip in the office offset so impossible dates cannot normalize silently.
  const office = new Date(instant.getTime() + 8 * 60 * 60 * 1000);
  if (
    value.startsWith("0000-") ||
    !Number.isFinite(instant.getTime()) ||
    office.toISOString().slice(0, 19) !== local
  ) {
    throw new Error(`Enter a valid ${label} and time.`);
  }
  return instant.toISOString();
}

export function scheduleFormValues(form: FormData) {
  const field = (name: string) => {
    const value = form.get(name);
    if (typeof value !== "string") {
      throw new Error(
        "The schedule form is incomplete. Reopen it and try again.",
      );
    }
    return value;
  };
  const priority = field("priority");
  if (!["normal", "high", "urgent"].includes(priority)) {
    throw new Error("Choose a valid priority.");
  }
  const actor = field("actor").trim();
  if (actor.length < 2 || actor.length > 80) {
    throw new Error("Enter your name (2–80 characters).");
  }
  return {
    priority: priority as CaseScheduling["priority"],
    due_at: scheduleDateToIso(field("due_at"), "due date"),
    follow_up_at: scheduleDateToIso(field("follow_up_at"), "follow-up date"),
    actor,
  };
}
