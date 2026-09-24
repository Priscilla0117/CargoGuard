import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleDateToIso, scheduleFormValues } from "../lib/schedule-inputs";

test("office date inputs become UTC instants, including midnight and leap day", () => {
  assert.equal(
    scheduleDateToIso("2026-09-24T18:00"),
    "2026-09-24T10:00:00.000Z",
  );
  assert.equal(
    scheduleDateToIso("2026-01-01T00:00"),
    "2025-12-31T16:00:00.000Z",
  );
  assert.equal(
    scheduleDateToIso("2028-02-29T08:30"),
    "2028-02-29T00:30:00.000Z",
  );
  assert.equal(
    scheduleDateToIso("2026-09-24T18:00:12"),
    "2026-09-24T10:00:12.000Z",
  );
  assert.equal(scheduleDateToIso(""), null);
});

test("invalid and normalized calendar inputs fail rather than changing the date", () => {
  for (const value of [
    "2026-02-29T12:00",
    "2026-04-31T12:00",
    "2026-13-01T12:00",
    "2026-01-00T12:00",
    "2026-09-24T24:00",
    "2026-09-24T18:60",
    "2026-09-24T18:00:60",
    "2026-09-24",
    "2026-09-24T18:00Z",
    "0000-01-01T12:00",
  ]) {
    assert.throws(
      () => scheduleDateToIso(value, "due date"),
      /valid due date and time/,
      value,
    );
  }
});

test("submission reads both dates and priority from the current named fields", () => {
  const form = new FormData();
  form.set("priority", "urgent");
  form.set("due_at", "2026-09-24T18:00");
  form.set("follow_up_at", "2026-09-25T09:15");
  form.set("actor", "  Reviewer  ");
  assert.deepEqual(scheduleFormValues(form), {
    priority: "urgent",
    due_at: "2026-09-24T10:00:00.000Z",
    follow_up_at: "2026-09-25T01:15:00.000Z",
    actor: "Reviewer",
  });
  form.set("due_at", "");
  assert.equal(scheduleFormValues(form).due_at, null);
  form.delete("follow_up_at");
  assert.throws(() => scheduleFormValues(form), /incomplete/);
});
