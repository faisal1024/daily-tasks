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

/** Where a routines list is shown: Today's card or the Ideas sheet. */
export type RoutinesWhere = "today" | "ideas";

/**
 * The one muted line under "Today's routines" when its Add buttons are off.
 * A full day reads the same in both places; a set day on Today collapses the
 * card to this line (nothing to add until next time), while Ideas points back
 * to Today, where the day can be changed.
 */
export function routineBlockedLine(block: RoutineBlock, options: { where: RoutinesWhere }): string | null {
  if (block === "set") {
    return options.where === "today"
      ? "Today is set. Your routines will be here next time."
      : "Today is set. Change it on Today to add one.";
  }
  if (block === "full") return "Your three are picked. Free a slot to add one.";
  return null;
}

/**
 * Today's "Today's routines" card, in one place (Today's screen and the
 * routines sheet's save note both read it, so the note never promises an Add
 * the card doesn't offer):
 * - `due`: active routines due today and not on today's list yet;
 * - `show`: the card is on screen: something is due, and the day isn't
 *   finished (every task done), closed in the evening, or still waiting on
 *   last night's draft (that card leads; this one follows once it's used or
 *   dismissed). Only ever about today: a past day's routines never show;
 * - `block`: why Add is off (set or full), or null.
 */
export function todaysRoutinesState(input: {
  routines: readonly Routine[];
  tasks: readonly Pick<Task, "text" | "routineId">[];
  today: string | Date;
  locked: boolean;
  remainingSlots: number;
  /** completed >= total > 0. */
  allDone: boolean;
  /** Last night's draft card is showing. */
  draftShowing?: boolean;
  /** The day was closed in the evening check-in. */
  dayClosed?: boolean;
}): { due: Routine[]; show: boolean; block: RoutineBlock } {
  const due = routinesDueToday(input.routines, input.tasks, input.today);
  const show = due.length > 0 && !input.allDone && !input.draftShowing && !input.dayClosed;
  return { due, show, block: routineBlock(input) };
}

/** Whether every one of today's tasks is done (there's at least one). */
export function allTasksDone(completed: number, total: number): boolean {
  return total > 0 && completed >= total;
}

/**
 * The next day (strictly after `today`) an active routine is due: how many
 * days away (1–7) and its weekday. Null when paused or it has no days.
 */
export function nextDueDay(
  routine: { days: readonly number[]; paused?: boolean },
  today: string | Date,
): { inDays: number; weekday: number } | null {
  if (routine.paused) return null;
  const days = cleanDays([...routine.days]);
  if (days.length === 0) return null;
  const from = weekdayOf(today);
  for (let inDays = 1; inDays <= 7; inDays++) {
    const weekday = (from + inDays) % 7;
    if (days.includes(weekday)) return { inDays, weekday };
  }
  return null;
}

/** "tomorrow" or "on Monday" for a nextDueDay. */
export function nextDayPhrase(next: { inDays: number; weekday: number }): string {
  return next.inDays === 1 ? "tomorrow" : `on ${DAY_NAMES[next.weekday]}`;
}

/**
 * The routine coming up next (soonest day after today; list order breaks a
 * tie), for Ideas' "Next: Stretch on Monday" when nothing is due today.
 */
export function nextRoutineUp(
  routines: readonly Routine[],
  today: string | Date,
): { routine: Routine; inDays: number; weekday: number } | null {
  let best: { routine: Routine; inDays: number; weekday: number } | null = null;
  for (const routine of routines) {
    const next = nextDueDay(routine, today);
    if (next && (!best || next.inDays < best.inDays)) best = { routine, ...next };
  }
  return best;
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
 * it shows up: "Shows on Today on weekdays — next on Monday." for one not due
 * today, or, when it's due today and Today's card offers it right now,
 * "Shows on Today — you can add it now."
 */
export function routineSavedNote(input: {
  days: readonly number[];
  paused?: boolean;
  /** Due today and not on today's list yet. */
  dueToday: boolean;
  /** Today's routines card is showing with Add on (todaysRoutinesState: show && !block). */
  canAddNow: boolean;
  /** Today (for the next day it shows); without it, no "next on" part. */
  today?: string | Date;
}): string {
  if (input.paused) return "Paused. It won't show on Today until you resume it.";
  if (input.dueToday && input.canAddNow) return "Shows on Today — you can add it now.";
  const base = `Shows on Today ${daysPhrase(input.days)}`;
  const next = !input.dueToday && input.today !== undefined ? nextDueDay({ days: input.days }, input.today) : null;
  return next ? `${base} — next ${nextDayPhrase(next)}.` : `${base}.`;
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
