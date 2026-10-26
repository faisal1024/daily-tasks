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
// weekday names and "next week", with "by"/"before"/"due" making it a
// deadline ("until"/"till" don't: "Wait until Friday" is a day, not a
// deadline). Anything else (months, dates, "in two weeks") is left to the AI
// sort (Plus). Never guess: no date for two different days in one item, a
// weekday after "every"/"each" (a routine) or after "from"/"since"/"last"/
// "past" (a day gone by), a possessive ("Tuesday's email"), a name
// ("Thursday Murder Club", "Black Friday", "Monday.com").

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
// Short forms only after a day cue ("by fri", "on Thurs."), never after
// "for" ("for sun", "for SAT") and never in capitals: alone they're words.
const SHORT_DAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6,
};
const CUE = "(?:on|for|by|before|until|till|due|this|next)";
const SHORT_CUES = new Set(["on", "by", "before", "until", "till", "due", "this", "next"]);
const DEADLINE = /^(?:by|before|due)$/i;

const DAY_WORD = new RegExp(
  `\\b(?:(${CUE})\\s+)?(?:(today|tonight|tomorrow|tmrw)|(next\\s+week)|(${WEEKDAYS.join("|")})|(${Object.keys(SHORT_DAYS).join("|")})\\.?)\\b`,
  "gi",
);
const ROUTINE = /\b(?:every|each)\s+(?:other\s+)?(?:day|week|morning|evening|night|weekday|weekend|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b|\b(?:sun|mon|tues|wednes|thurs|fri|satur)days\b|\bdaily\b|\bweekly\b/i;
// A day gone by: "the email from Monday", "since Tuesday", "last Friday".
const PAST_BEFORE = /\b(?:from|since|last|past|previous)\s+$/i;
// Named days, not dates.
const NAMED_DAY = /\b(?:black|cyber|good|easter|palm|ash|holy|super|giving|boxing|blue|fat|maundy|whit)\s+$/i;
// After the day: a possessive, a dot joined to a word (Monday.com), or a
// capitalised word (Thursday Murder Club).
const AFTER_NAME = /^(?:['’]s\b|\.\w|\s+[A-Z][a-z])/;

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
    const [whole, cueRaw, relative, nextWeek, weekday, short] = match;
    const cue = (cueRaw ?? "").toLowerCase();
    const start = match.index ?? 0;
    const dayText = (weekday ?? short ?? relative ?? nextWeek ?? "").toLowerCase();
    const dayStart = start + Math.max(0, whole.toLowerCase().indexOf(dayText, cueRaw ? cueRaw.length : 0));
    const before = text.slice(0, cueRaw ? start : dayStart);
    const after = text.slice(start + whole.length);
    if (weekday || short) {
      // A short day name needs a day cue ("by fri"), lowercase or "Fri".
      if (short && (!SHORT_CUES.has(cue) || (short.length > 1 && short === short.toUpperCase()))) continue;
      if (PAST_BEFORE.test(before) || NAMED_DAY.test(text.slice(0, dayStart)) || AFTER_NAME.test(after)) continue;
    }
    const deadline = DEADLINE.test(cue);
    // "before X" is due the day before X; "by X" on X.
    const isBefore = cue === "before";
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
      if (ahead === 0 && (cue === "next" || isBefore)) ahead = 7;
      date = addDays(today, ahead);
    }
    if (isBefore) date = addDays(date, -1);
    found.push({ date, kind: deadline ? "by" : "on" });
  }
  if (found.length === 0) return null;
  const first = found[0];
  if (found.some((w) => w.date !== first.date)) return null;
  // "Before today" is already past.
  return normalizeWhen({ date: first.date, kind: found.some((w) => w.kind === "by") ? "by" : "on" }, today);
}

// --- Showing it ---------------------------------------------------------------

/** How long a missed deadline still says "Overdue" (and leads) before its label goes. */
export const OVERDUE_DAYS = 7;

function shortWeekday(dateKey: string): string {
  return fromDateKey(dateKey).toLocaleDateString("en-US", { weekday: "short" });
}

function longWeekday(dateKey: string): string {
  return fromDateKey(dateKey).toLocaleDateString("en-US", { weekday: "long" });
}

/** "Mar 1", or "Mar 1, 2027" when it isn't this year. */
function monthDay(dateKey: string, today: string): string {
  const sameYear = dateKey.slice(0, 4) === today.slice(0, 4);
  return fromDateKey(dateKey).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** A deadline missed in the last OVERDUE_DAYS days. */
export function isOverdue(when: TaskWhen, today: string): boolean {
  const ahead = daysBetween(today, when.date);
  return when.kind === "by" && ahead < 0 && ahead >= -OVERDUE_DAYS;
}

/**
 * The quiet label beside a saved item: "Today", "Tomorrow", "Tue" (within
 * the week), else "Mar 1" ("Mar 1, 2027" in another year); a deadline reads
 * "By Tue". Once the day has passed: none for a plan; "Overdue" for a
 * deadline for OVERDUE_DAYS days, then none.
 */
export function whenLabel(when: TaskWhen, today: string): string | null {
  const ahead = daysBetween(today, when.date);
  if (ahead < 0) return isOverdue(when, today) ? "Overdue" : null;
  const day =
    ahead === 0 ? "today" : ahead === 1 ? "tomorrow" : ahead < 7 ? shortWeekday(when.date) : monthDay(when.date, today);
  if (when.kind === "by") return `By ${day}`;
  return day.charAt(0).toUpperCase() + day.slice(1);
}

/**
 * The reason line for an item brought back (1.5 C's muted line). A plan
 * reads "For today", "For tomorrow", "For Tuesday"; a deadline "Due today",
 * "Due tomorrow", "Due Tuesday", or "Overdue" (OVERDUE_DAYS). Null further
 * out, or for a plan whose day has passed.
 */
export function dueReason(when: TaskWhen, today: string): string | null {
  const ahead = daysBetween(today, when.date);
  if (ahead < 0) return isOverdue(when, today) ? "Overdue" : null;
  const lead = when.kind === "by" ? "Due" : "For";
  if (ahead === 0) return `${lead} today`;
  if (ahead === 1) return `${lead} tomorrow`;
  if (ahead < 7) return `${lead} ${longWeekday(when.date)}`;
  return null;
}

/** Whether a saved item comes back on `day`. */
export function isDueOn(when: TaskWhen | undefined, day: string): boolean {
  return Boolean(when) && when!.date === day;
}

export interface SavedItemView {
  id: string;
  text: string;
  /** Its date as stored (for "Change day"). */
  when?: TaskWhen;
  /** Quiet date label ("Tue", "Mar 1", "Overdue"), while there is one to show. */
  label?: string;
  /** "For today" / "Due today" / "Overdue" for an item that leads. */
  reason?: string;
  /** Leads Ideas under "For today": its day is today, or a deadline just missed. */
  dueToday: boolean;
}

/**
 * Saved for later as shown in Ideas: what's for today (and deadlines missed
 * in the last week) first, then the rest in their saved order, each dated
 * one labelled.
 */
export function savedItemsView(parked: ParkedTask[], today: string): SavedItemView[] {
  const items = parked.map((item): SavedItemView => {
    const dueToday = Boolean(item.when) && (isDueOn(item.when, today) || isOverdue(item.when!, today));
    const label = item.when ? whenLabel(item.when, today) : null;
    const reason = dueToday ? dueReason(item.when!, today) : null;
    return {
      id: item.id,
      text: item.text,
      ...(item.when ? { when: item.when } : {}),
      ...(label ? { label } : {}),
      ...(reason ? { reason } : {}),
      dueToday,
    };
  });
  return [...items.filter((item) => item.dueToday), ...items.filter((item) => !item.dueToday)];
}

/** The days "Change day" offers: today, tomorrow and the five after (by weekday). */
export function whenChoices(today: string): { label: string; date: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(today, i);
    return { label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : longWeekday(date), date };
  });
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
 * evening close), still at most three. When that leaves out any of the
 * coach's picks (or there were none), the because line is about the saved
 * items instead.
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
  // The because line only speaks for what's in the draft: the coach's stays
  // when all its picks made it; otherwise it's about the saved items.
  const kept = new Set(tomorrow.map(looseKey));
  const intact = close.tomorrow.length > 0 && close.tomorrow.every((text) => kept.has(looseKey(text)));
  const saved = due.filter((text) => kept.has(looseKey(text))).length;
  const because = intact
    ? close.because
    : saved === 1
      ? "Something you saved is for tomorrow."
      : "A few things you saved are for tomorrow.";
  return { ...close, tomorrow, because };
}

/** The local date key of an ISO time (for a date set at park time). */
export function localDayOf(iso: string): string | null {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? todayKey(new Date(at)) : null;
}
