// Smart resurfacing (1.6 F): a soft date on a saved item ("deck for Tuesday",
// "passport before March"), kept with it and used to bring it back on its day.
//
// Dates are local date keys (yyyy-MM-dd). `kind: "on"` is a day the item is
// for; `kind: "by"` is a deadline, `date` being the last day it can be done
// ("before March" → the last day of February). Either way the item comes
// back on the morning of `date` (for a deadline, the morning before it
// passes), and last night's draft for that day puts it first (Plus).
//
// Nothing here ever adds a task to today on its own: it only orders, labels
// and offers.

import { addDays, daysBetween, fromDateKey, todayKey } from "./date";
import type { ParkedTask, TaskWhen } from "./types";
import { MAX_TASKS } from "./types";

/** The furthest ahead a soft date may be (a year and a day). */
export const MAX_WHEN_DAYS_AHEAD = 366;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day in yyyy-MM-dd ("2026-02-30" is not). */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/**
 * A stored or received `when`, or null: a real date and a known kind. With
 * `today`, also not in the past and at most MAX_WHEN_DAYS_AHEAD ahead (used
 * when a date is first set; a saved one that has since passed is kept, it
 * just no longer comes back).
 */
export function normalizeWhen(value: unknown, today?: string): TaskWhen | null {
  if (!value || typeof value !== "object") return null;
  const { date, kind } = value as { date?: unknown; kind?: unknown };
  if (!isDateKey(date) || (kind !== "on" && kind !== "by")) return null;
  if (today !== undefined) {
    if (!isDateKey(today)) return null;
    const ahead = daysBetween(today, date);
    if (ahead < 0 || ahead > MAX_WHEN_DAYS_AHEAD) return null;
  }
  return { date, kind };
}

// --- The on-device parse -----------------------------------------------------
//
// Deterministic and deliberately small: "today", "tonight", "tomorrow",
// weekday names and "next week", with "by"/"before"/"until"/"due" making it
// a deadline. Anything else (months, dates, "in two weeks") is left to the
// AI sort (Plus). Two different days in one item, or a weekday after
// "every"/"each" (a routine), give no date: never guess.

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// Short forms only after a cue word ("by fri"): bare "sun" or "wed" are words.
const SHORT_DAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const CUE = "(?:on|for|by|before|until|till|due|this|next)";
const DEADLINE = /^(?:by|before|until|till|due)$/i;

const DAY_WORD = new RegExp(
  `\\b(?:(${CUE})\\s+)?(?:(today|tonight|tomorrow|tmrw)|(next\\s+week)|(${WEEKDAYS.join("|")})|(${Object.keys(SHORT_DAYS).join("|")})\\.?)\\b`,
  "gi",
);
const ROUTINE = /\b(?:every|each)\s+(?:other\s+)?(?:day|week|morning|evening|night|weekday|weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(?:sun|mon|tues|wednes|thurs|fri|satur)days\b|\bdaily\b|\bweekly\b/i;

/** Days from `today` to the next `dow` (0 when it is today). */
function daysUntil(today: string, dow: number): number {
  return (dow - fromDateKey(today).getDay() + 7) % 7;
}

/**
 * The soft date written in a task's own words, or null. `today` is the local
 * date key the words are read against.
 */
export function parseLocalWhen(text: string, today: string): TaskWhen | null {
  if (typeof text !== "string" || !isDateKey(today) || ROUTINE.test(text)) return null;
  const found: TaskWhen[] = [];
  for (const match of text.matchAll(DAY_WORD)) {
    const [, cueRaw, relative, nextWeek, weekday, short] = match;
    const cue = (cueRaw ?? "").toLowerCase();
    // A short day name needs a cue ("by fri"); alone it's probably a word.
    if (short && !cue) continue;
    const deadline = DEADLINE.test(cue);
    // "before X" is due the day before X; "by X" on X.
    const before = cue === "before";
    let date: string;
    if (relative) {
      const word = relative.toLowerCase();
      date = word === "tomorrow" || word === "tmrw" ? addDays(today, 1) : today;
    } else if (nextWeek) {
      // The Monday of next week (tomorrow on a Sunday).
      date = addDays(today, daysUntil(today, 1) || 7);
    } else {
      const dow = weekday ? WEEKDAYS.indexOf(weekday.toLowerCase()) : SHORT_DAYS[short.toLowerCase()];
      let ahead = daysUntil(today, dow);
      // "next Tuesday" or "before Tuesday" said on a Tuesday: the one after.
      if (ahead === 0 && (cue === "next" || before)) ahead = 7;
      date = addDays(today, ahead);
    }
    if (before) date = addDays(date, -1);
    found.push({ date, kind: deadline ? "by" : "on" });
  }
  if (found.length === 0) return null;
  const first = found[0];
  if (found.some((w) => w.date !== first.date)) return null;
  // "Before today" is already past.
  return normalizeWhen({ date: first.date, kind: found.some((w) => w.kind === "by") ? "by" : "on" }, today);
}

// --- Showing it ---------------------------------------------------------------

function shortWeekday(dateKey: string): string {
  return fromDateKey(dateKey).toLocaleDateString("en-US", { weekday: "short" });
}

function longWeekday(dateKey: string): string {
  return fromDateKey(dateKey).toLocaleDateString("en-US", { weekday: "long" });
}

function monthDay(dateKey: string): string {
  return fromDateKey(dateKey).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The quiet label beside a saved item: "Today", "Tomorrow", "Tue" (within
 * the week), else "Mar 1"; a deadline reads "By Tue". A day already past is
 * always "Oct 20" (a bare weekday would read as the coming one).
 */
export function whenLabel(when: TaskWhen, today: string): string {
  const ahead = daysBetween(today, when.date);
  const day =
    ahead === 0 ? "today" : ahead === 1 ? "tomorrow" : ahead > 1 && ahead < 7 ? shortWeekday(when.date) : monthDay(when.date);
  if (when.kind === "by") return `By ${day}`;
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/**
 * The reason line for an item brought back (1.5 C's muted line): "Due
 * today", "Due tomorrow", "Due Tuesday" (within the week); null otherwise.
 */
export function dueReason(when: TaskWhen, today: string): string | null {
  const ahead = daysBetween(today, when.date);
  if (ahead === 0) return "Due today";
  if (ahead === 1) return "Due tomorrow";
  if (ahead > 1 && ahead < 7) return `Due ${longWeekday(when.date)}`;
  return null;
}

/** Whether a saved item comes back on `day`. */
export function isDueOn(when: TaskWhen | undefined, day: string): boolean {
  return Boolean(when) && when!.date === day;
}

export interface SavedItemView {
  id: string;
  text: string;
  /** Quiet date label ("Tue", "Mar 1"), when it has a date. */
  label?: string;
  /** "Due today" for an item whose day is today. */
  reason?: string;
  dueToday: boolean;
}

/**
 * Saved for later as shown in Ideas: items due today first (with "Due
 * today"), then the rest in their saved order, each dated one labelled.
 */
export function savedItemsView(parked: ParkedTask[], today: string): SavedItemView[] {
  const items = parked.map((item): SavedItemView => {
    const dueToday = isDueOn(item.when, today);
    return {
      id: item.id,
      text: item.text,
      ...(item.when ? { label: whenLabel(item.when, today) } : {}),
      ...(dueToday ? { reason: "Due today" } : {}),
      dueToday,
    };
  });
  return [...items.filter((item) => item.dueToday), ...items.filter((item) => !item.dueToday)];
}

const looseKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/** Saved items whose day is `day`, oldest first, by text (one per wording). */
export function savedDueOn(parked: ParkedTask[], day: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of parked) {
    if (!isDueOn(item.when, day) || seen.has(looseKey(item.text))) continue;
    seen.add(looseKey(item.text));
    out.push(item.text);
  }
  return out;
}

/**
 * Reason lines for a draft's tasks that are saved items due on the draft's
 * day ("Due today" the morning of), keyed by the task's text.
 */
export function draftDueReasons(tasks: string[], parked: ParkedTask[], today: string): Record<string, string> {
  const byKey = new Map<string, TaskWhen>();
  for (const item of parked) if (item.when) byKey.set(looseKey(item.text), item.when);
  const out: Record<string, string> = {};
  for (const text of tasks) {
    const when = byKey.get(looseKey(text));
    const reason = when ? dueReason(when, today) : null;
    if (reason) out[text] = reason;
  }
  return out;
}

/**
 * Tomorrow's draft with the saved items due tomorrow put first (Plus, at the
 * evening close), still at most three. With nothing else drafted, the
 * because line says why the draft has them.
 */
export function withDueTomorrow<T extends { tomorrow: string[]; because: string }>(
  close: T,
  parked: ParkedTask[],
  day: string,
): T {
  const due = savedDueOn(parked, addDays(day, 1));
  if (due.length === 0) return close;
  const seen = new Set<string>();
  const tomorrow = [...due, ...close.tomorrow]
    .filter((text) => {
      const key = looseKey(text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_TASKS);
  const because =
    close.tomorrow.length === 0
      ? due.length === 1
        ? "Something you saved is due tomorrow."
        : "A few things you saved are due tomorrow."
      : close.because;
  return { ...close, tomorrow, because };
}

/** The local date key of an ISO time (for a date set at park time). */
export function localDayOf(iso: string): string | null {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? todayKey(new Date(at)) : null;
}
