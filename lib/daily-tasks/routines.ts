// Routines (1.3): things you do on repeat. A routine never fills a slot by
// itself; on its days it's suggested on Today (and in the Ideas sheet) and
// you choose whether it makes today's three. A day it isn't picked leaves no trace (no "missed",
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

/** What creating a routine did: see the store's addRoutine. */
export type AddRoutineResult = "added" | "exists" | "limit" | "invalid";

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

type GraphemeSegmenter = { segment(text: string): Iterable<{ segment: string }> };
type SegmenterCtor = new (locale?: string, options?: { granularity: "grapheme" }) => GraphemeSegmenter;

/**
 * The visible characters of `text`: grapheme clusters where Intl.Segmenter
 * exists (so a family emoji or a flag is one), code points otherwise (never
 * half a surrogate pair).
 */
export function visibleChars(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (typeof Segmenter === "function") {
    return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  }
  return Array.from(text);
}

/** Cut to at most `max` visible characters (no trimming): what the text field keeps. */
export function capVisibleChars(text: string, max: number = MAX_ROUTINE_TEXT): string {
  const chars = visibleChars(text);
  return chars.length > max ? chars.slice(0, max).join("") : text;
}

/** Trim and cap by visible characters (never splitting an emoji); null when empty. */
export function cleanRoutineText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return capVisibleChars(text).trim();
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

/**
 * Short, plain description of a routine's days, e.g. "Weekdays" or
 * "Mon, Wed, Fri". `spoken`: full day names, for VoiceOver.
 */
export function describeDays(days: readonly number[], options: { spoken?: boolean } = {}): string {
  const clean = cleanDays([...days]);
  const preset = presetFor(clean);
  if (preset !== "custom") return DAY_PRESETS.find((p) => p.id === preset)!.label;
  if (clean.length === 0) return "No days";
  const names = options.spoken ? DAY_NAMES : DAY_SHORT;
  return PICKER_ORDER.filter((day) => clean.includes(day))
    .map((day) => names[day])
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

/** Why routines can't be added to today right now (null: they can). */
export type RoutineBlock = "set" | "full" | null;

/** Same room and lock rules as the store's addRoutineToToday. */
export function routineBlock(input: { locked: boolean; remainingSlots: number }): RoutineBlock {
  if (input.locked) return "set";
  if (input.remainingSlots <= 0) return "full";
  return null;
}

/** The one muted line under "Today's routines" on Today when its Add buttons are off. */
export function routineBlockedLine(block: RoutineBlock): string | null {
  if (block === "set") return "Today is set. Change it to add one.";
  if (block === "full") return "Your three are picked. Free a slot to add one.";
  return null;
}

/**
 * Whether Today shows its "Today's routines" card: only with something due
 * and not yet on the list, and never once the day's tasks are all done (no
 * nagging after a finished day). Only ever about today: a past day's
 * routines are never mentioned.
 */
export function showTodaysRoutinesCard(input: { dueCount: number; allDone: boolean }): boolean {
  return input.dueCount > 0 && !input.allDone;
}

const listWithAnd = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * A routine's days inside a sentence: "every day", "on weekdays", "on
 * weekends", "on Mondays and Thursdays" (built on describeDays' presets).
 */
export function daysPhrase(days: readonly number[]): string {
  const clean = cleanDays([...days]);
  const preset = presetFor(clean);
  if (preset === "every_day") return "every day";
  if (preset === "weekdays") return "on weekdays";
  if (preset === "weekends") return "on weekends";
  const names = PICKER_ORDER.filter((day) => clean.includes(day)).map((day) => `${DAY_NAMES[day]}s`);
  return names.length ? `on ${listWithAnd(names)}` : describeDays(clean).toLowerCase();
}

/**
 * What the routines sheet says after a routine is saved, so it's clear when
 * it shows up: "Shows on Today on weekdays.", or, when it's due today and can
 * be added right now, "Shows on Today — you can add it now."
 */
export function routineSavedNote(input: {
  days: readonly number[];
  paused?: boolean;
  /** Due today and not on today's list yet. */
  dueToday: boolean;
  /** Today has room and isn't set. */
  canAddNow: boolean;
}): string {
  if (input.paused) return "Paused. It won't show on Today until you resume it.";
  if (input.dueToday && input.canAddNow) return "Shows on Today — you can add it now.";
  return `Shows on Today ${daysPhrase(input.days)}.`;
}

/** Whether a user can create another routine (free: FREE_ROUTINE_LIMIT; Plus: unlimited). */
export function canCreateRoutine(count: number, hasPlus: boolean): boolean {
  if (count >= MAX_ROUTINES) return false;
  return hasPlus || count < FREE_ROUTINE_LIMIT;
}

/**
 * `routines` with `routine` added, or null when it can't be: at `max` (null:
 * no free limit) or MAX_ROUTINES, its id is taken, or one with the same words
 * and days is already there (a double-tapped Save).
 */
export function withRoutineAdded(
  routines: readonly Routine[],
  routine: Routine,
  max: number | null,
): Routine[] | null {
  if (routines.length >= MAX_ROUTINES) return null;
  if (max !== null && routines.length >= max) return null;
  const key = looseKey(routine.text);
  const days = routine.days.join();
  if (routines.some((r) => r.id === routine.id || (looseKey(r.text) === key && r.days.join() === days))) {
    return null;
  }
  return [...routines, routine];
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
