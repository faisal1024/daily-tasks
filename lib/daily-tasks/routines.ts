// Routines (1.3): things you do on repeat. A routine never fills a slot by
// itself; on its days it waits in the Ideas sheet and you choose whether it
// makes today's three. A day it isn't picked leaves no trace (no "missed",
// no streak, nothing overdue).
//
// Pure helpers, kept out of the React store so they're unit-tested directly.

import { fromDateKey } from "./date";
import type { Routine, Task } from "./types";

/** Longest routine text kept, like a task typed on Today. */
export const MAX_ROUTINE_TEXT = 80;
/** Routines a free user can create; Plus is unlimited. Existing ones always keep working. */
export const FREE_ROUTINE_LIMIT = 2;
/** A hard ceiling so a bad save can't grow without bound. */
export const MAX_ROUTINES = 50;

export const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];
export const WEEKENDS: readonly number[] = [0, 6];

export type DaysPreset = "every_day" | "weekdays" | "weekends" | "custom";

export const DAY_PRESETS: { id: Exclude<DaysPreset, "custom">; label: string; days: readonly number[] }[] = [
  { id: "every_day", label: "Every day", days: ALL_DAYS },
  { id: "weekdays", label: "Weekdays", days: WEEKDAYS },
  { id: "weekends", label: "Weekends", days: WEEKENDS },
];

/** Sunday = 0, like Date#getDay. */
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Toggle order in the picker: Monday first, Sunday last. */
export const PICKER_ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Trim and cap by whole characters (never splitting an emoji); null when empty. */
export function cleanRoutineText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const chars = Array.from(text);
  return chars.length > MAX_ROUTINE_TEXT ? chars.slice(0, MAX_ROUTINE_TEXT).join("").trim() : text;
}

/** Whole numbers 0–6 only, deduped and sorted; [] when none are valid. */
export function cleanDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const days = new Set<number>();
  for (const day of value) {
    if (typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6) days.add(day);
  }
  return [...days].sort((a, b) => a - b);
}

const sameDays = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((day, index) => day === b[index]);

/** Which preset a set of days matches ("custom" otherwise). */
export function presetFor(days: readonly number[]): DaysPreset {
  const clean = cleanDays([...days]);
  return DAY_PRESETS.find((preset) => sameDays(preset.days, clean))?.id ?? "custom";
}

/** Short, plain description of a routine's days, e.g. "Weekdays" or "Mon, Wed, Fri". */
export function describeDays(days: readonly number[]): string {
  const clean = cleanDays([...days]);
  const preset = presetFor(clean);
  if (preset !== "custom") return DAY_PRESETS.find((p) => p.id === preset)!.label;
  if (clean.length === 0) return "No days";
  return PICKER_ORDER.filter((day) => clean.includes(day))
    .map((day) => DAY_SHORT[day])
    .join(", ");
}

/** Spoken version of describeDays, with full day names. */
export function describeDaysForAccessibility(days: readonly number[]): string {
  const clean = cleanDays([...days]);
  const preset = presetFor(clean);
  if (preset !== "custom") return DAY_PRESETS.find((p) => p.id === preset)!.label;
  if (clean.length === 0) return "No days";
  return PICKER_ORDER.filter((day) => clean.includes(day))
    .map((day) => DAY_NAMES[day])
    .join(", ");
}

/** Local weekday (Sunday = 0) of a yyyy-MM-dd day key or a Date. */
export function weekdayOf(date: string | Date): number {
  return (typeof date === "string" ? fromDateKey(date) : date).getDay();
}

// Case- and space-insensitive, like the other "already on today" checks.
const looseKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Active routines due on `date` (its local weekday) that aren't already on
 * today's list: not added from this routine (routineId) and no task with the
 * same words (whatever its source).
 */
export function routinesDueToday(
  routines: readonly Routine[],
  todayTasks: readonly Pick<Task, "text" | "routineId">[],
  date: string | Date,
): Routine[] {
  const weekday = weekdayOf(date);
  const onTodayIds = new Set(todayTasks.map((task) => task.routineId).filter(Boolean));
  const onTodayTexts = new Set(todayTasks.map((task) => looseKey(task.text)));
  return routines.filter(
    (routine) =>
      !routine.paused &&
      routine.days.includes(weekday) &&
      !onTodayIds.has(routine.id) &&
      !onTodayTexts.has(looseKey(routine.text)),
  );
}

/** Whether a user can create another routine (free: FREE_ROUTINE_LIMIT; Plus: unlimited). */
export function canCreateRoutine(count: number, hasPlus: boolean): boolean {
  if (count >= MAX_ROUTINES) return false;
  return hasPlus || count < FREE_ROUTINE_LIMIT;
}

/** Validate saved routines: drop broken entries and ones with no valid days. */
export function normalizeRoutines(value: unknown): Routine[] {
  if (!Array.isArray(value)) return [];
  const routines: Routine[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== "string" || !raw.id || seen.has(raw.id)) continue;
    const text = cleanRoutineText(raw.text);
    const days = cleanDays(raw.days);
    if (!text || days.length === 0) continue;
    seen.add(raw.id);
    routines.push({
      id: raw.id,
      text,
      days,
      paused: raw.paused === true,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    });
  }
  return routines.slice(0, MAX_ROUTINES);
}
