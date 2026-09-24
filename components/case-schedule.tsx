"use client";
import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flag,
} from "lucide-react";
import {
  dailyCaseCounts,
  dayKey,
  DEFAULT_SCHEDULING,
  OFFICE_TIME_ZONE,
  matchesSchedule,
  type ScheduleFilter,
} from "@/lib/case-scheduling";
import { requestJson } from "@/lib/client-api";
import { scheduleFormValues } from "@/lib/schedule-inputs";
import type { CaseScheduling, CaseSummary } from "@/lib/types";

export type CalendarKind = "received" | "imported" | "due" | "follow_up";
export function calendarDateFor(row: CaseSummary, kind: CalendarKind) {
  return dayKey(
    kind === "received"
      ? row.email.received_at
      : kind === "imported"
        ? row.email.imported_at
        : kind === "due"
          ? row.scheduling?.due_at
          : row.scheduling?.follow_up_at,
  );
}
export function WorkspaceSchedule({
  cases,
  filter,
  onFilter,
  selectedDay,
  onDay,
  kind,
  onKind,
  priority,
  onPriority,
}: {
  cases: CaseSummary[];
  filter: ScheduleFilter;
  onFilter: (filter: ScheduleFilter) => void;
  selectedDay: string;
  onDay: (day: string) => void;
  kind: CalendarKind;
  onKind: (kind: CalendarKind) => void;
  priority: string;
  onPriority: (priority: string) => void;
}) {
  const [month, setMonth] = useState(() => dayKey(new Date())!.slice(0, 7));
  const counts = dailyCaseCounts(cases);
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7;
  function move(delta: number) {
    const date = new Date(Date.UTC(year, number - 1 + delta, 1));
    setMonth(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return (
    <section
      className="workspace-schedule"
      aria-label="Daily cases and priority"
    >
      <div className="schedule-toolbar">
        <div className="schedule-shortcuts">
          {(
            [
              ["all", "All dates"],
              ["received_today", "Received today"],
              ["overdue", "Overdue"],
              ["due_soon", "Due in 3 days"],
              ["follow_up", "Follow up"],
            ] as [ScheduleFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={filter === key ? "active" : ""}
              aria-pressed={filter === key}
              onClick={() => {
                onFilter(key);
                onDay("");
              }}
            >
              {label}
              {key !== "all" && (
                <span>
                  {cases.filter((row) => matchesSchedule(row, key)).length}
                </span>
              )}
            </button>
          ))}
        </div>
        <label>
          <Flag size={14} /> Priority
          <select
            value={priority}
            onChange={(event) => onPriority(event.target.value)}
          >
            <option value="all">All priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
          </select>
        </label>
      </div>
      <details className="workload-calendar">
        <summary>
          <CalendarDays size={17} /> Daily workload calendar{" "}
          {selectedDay && <strong>· {selectedDay}</strong>}
        </summary>
        <div className="calendar-header">
          <button
            className="icon-button"
            aria-label="Previous month"
            onClick={() => move(-1)}
          >
            <ChevronLeft size={18} />
          </button>
          <h3>
            {first.toLocaleDateString("en", {
              timeZone: "UTC",
              month: "long",
              year: "numeric",
            })}
          </h3>
          <button
            className="icon-button"
            aria-label="Next month"
            onClick={() => move(1)}
          >
            <ChevronRight size={18} />
          </button>
          <label>
            Count
            <select
              value={kind}
              onChange={(event) => onKind(event.target.value as CalendarKind)}
            >
              <option value="received">Emails received</option>
              <option value="imported">Cases imported</option>
              <option value="due">Due dates</option>
              <option value="follow_up">Follow-ups</option>
            </select>
          </label>
        </div>
        <div className="calendar-grid">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <span className="calendar-weekday" key={day}>
              {day}
            </span>
          ))}
          {Array.from({ length: offset }, (_, index) => (
            <span key={`empty-${index}`} />
          ))}
          {Array.from({ length }, (_, index) => {
            const day = `${month}-${String(index + 1).padStart(2, "0")}`,
              count = counts.days[day]?.[kind] ?? 0;
            return (
              <button
                key={day}
                className={selectedDay === day ? "selected" : ""}
                aria-label={`${day}: ${count} ${kind.replaceAll("_", " ")} cases`}
                aria-pressed={selectedDay === day}
                onClick={() => {
                  onDay(selectedDay === day ? "" : day);
                  onFilter("all");
                }}
              >
                <span>{index + 1}</span>
                {count > 0 && <b>{count}</b>}
              </button>
            );
          })}
        </div>
        <div className="calendar-note">
          <span>
            Dates use {OFFICE_TIME_ZONE}. Each case counts once per date type.
          </span>
          {selectedDay && (
            <button className="text-button" onClick={() => onDay("")}>
              Clear selected day
            </button>
          )}
        </div>
        <p>
          {counts.undated} case(s) have no recorded received date.{" "}
          <button
            className="text-button"
            onClick={() => {
              onFilter("undated");
              onDay("");
            }}
          >
            Show undated cases
          </button>
        </p>
      </details>
      <p className="schedule-note">
        Urgent cases appear first, then deadlines and arrival dates. Priority
        and dates are set by your team; the verification outcome stays separate.
      </p>
    </section>
  );
}

function inputTime(value: string | null) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OFFICE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function CaseScheduleEditor({
  id,
  scheduling = DEFAULT_SCHEDULING,
  onSaved,
}: {
  id: string;
  scheduling?: CaseScheduling;
  onSaved: (scheduling: CaseScheduling) => void;
}) {
  const [priority, setPriority] = useState(scheduling.priority);
  const [actor, setActor] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    // Capture before disabling the fieldset; submit what is currently visible.
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const values = scheduleFormValues(form);
      setPriority(values.priority);
      setActor(values.actor);
      const response = await requestJson<{ scheduling: CaseScheduling }>(
        "/api/case-metadata",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            version: scheduling.version,
            ...values,
          }),
        },
      );
      // Scheduling updates the inbox cache only; finishing after closing the drawer
      // must still retain the saved dates without reopening an abandoned case.
      onSaved(response.scheduling);
    } catch (failure) {
      if (mounted.current) setError((failure as Error).message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <details className="case-scheduling">
      <summary>
        <span className="case-scheduling-label">
          <Flag size={15} aria-hidden="true" /> Priority &amp; dates
        </span>
        {scheduling.priority !== "normal" && (
          <span className={`case-scheduling-priority ${scheduling.priority}`}>
            {scheduling.priority === "urgent" ? "Urgent" : "High"}
          </span>
        )}
        {(
          [
            ["Due", scheduling.due_at],
            ["Follow up", scheduling.follow_up_at],
          ] as const
        ).map(
          ([label, value]) =>
            value && (
              <time
                key={label}
                className="case-scheduling-date"
                dateTime={value}
                title={`${label} ${new Date(value).toLocaleString("en-GB", {
                  timeZone: OFFICE_TIME_ZONE,
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                })} MYT`}
              >
                {label}{" "}
                {new Date(value).toLocaleString("en-GB", {
                  timeZone: OFFICE_TIME_ZONE,
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                  hourCycle: "h23",
                })}{" "}
                MYT
              </time>
            ),
        )}
        <ChevronDown
          size={16}
          className="case-scheduling-chevron"
          aria-hidden="true"
        />
      </summary>
      <form onSubmit={save}>
        <fieldset disabled={busy}>
          <label>
            Priority
            <select
              name="priority"
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as CaseScheduling["priority"])
              }
            >
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label>
            Due at
            <input
              type="datetime-local"
              name="due_at"
              defaultValue={inputTime(scheduling.due_at)}
            />
          </label>
          <label>
            Follow up at
            <input
              type="datetime-local"
              name="follow_up_at"
              defaultValue={inputTime(scheduling.follow_up_at)}
            />
          </label>
          <label>
            Updated by
            <input
              required
              name="actor"
              minLength={2}
              maxLength={80}
              value={actor}
              onChange={(event) => setActor(event.target.value)}
              placeholder="Your name"
            />
          </label>
          <p>
            All times use Kuala Lumpur (UTC+8). Leave dates empty if unknown.
          </p>
          {error && (
            <p className="alert error" role="alert">
              {error}
            </p>
          )}
          <button className="button secondary">
            {busy ? "Saving…" : "Save priority & dates"}
          </button>
        </fieldset>
      </form>
    </details>
  );
}
