// What your coach remembers (1.5): simple, deterministic patterns worked out
// on the phone from the last 30 days of history, for everyone (free too).
// Plus users also have the AI coach memory (AppState.coachMemory), which the
// evening check-in rewrites.
//
// Nothing here is stored: it is derived from `history` (kept on the device)
// each time, from the day after `memoryClearedAt` when that is more recent.
// "Clear memory" sets that date (and empties the AI memory), so what was
// noticed before it is no longer shown, sent or used for nags; the history
// itself (calendar, streaks) is untouched.
//
// "Moved": a past day the task was on and not finished, after which it came
// back (carried over, or on a later day's list in the window). Same words,
// ignoring case and spacing. Routine tasks don't count: coming back is what
// they do.

import { isWaitingReason, WAITING_REASON, type BrainDumpResult } from "./ai-helpers";
import { addDays, fromDateKey, nextDay } from "./date";
import type { DayRecord, History } from "./types";

export const MEMORY_DAYS = 30;
/** Moved this many times or more: named as a task that keeps slipping. */
export const MOVED_NOTICE_TIMES = 2;
/** Most moved tasks kept in the memory (shown) and sent with a request. */
export const MAX_MOVED_SHOWN = 3;
/** A kind of task (its first word) needs this many tasks before it is named. */
const MIN_KIND_TASKS = 3;
const MAX_STATS_TEXT = 64;
const MAX_TIMES = 99;

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface MovedTask {
  text: string;
  times: number;
}

export interface BasicMemory {
  /** The first day looked at (yyyy-MM-dd). */
  from: string;
  /** Memory was cleared inside the window: `from` is the day after. */
  sinceCleared: boolean;
  /** Days the window covers: 30, or fewer after "Clear memory" (0 on the day it was cleared). */
  span: number;
  /** Days with at least one task. */
  activeDays: number;
  completed: number;
  total: number;
  /** Up to two weekdays (Sunday = 0) that do best. */
  bestWeekdays: number[];
  /** Tasks moved MOVED_NOTICE_TIMES or more, most first (at most MAX_MOVED_SHOWN). */
  moved: MovedTask[];
  /** First words of tasks that usually get done / tend to slip (up to two each). */
  finishedKinds: string[];
  slippingKinds: string[];
}

/** Same words, ignoring case and spacing. */
export function memoryTaskKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The first day the memory looks at: 30 days back, or the day after it was
 * cleared. A clearing dated after today (the clock was ahead) counts as
 * today. `span` is how many days the window covers (1 to 30; 0 when it was
 * cleared today).
 */
export function memoryStart(today: string, clearedAt: string | null): { from: string; sinceCleared: boolean; span: number } {
  const start = addDays(today, -MEMORY_DAYS);
  const cleared = clearedAt && DAY_KEY.test(clearedAt) ? (clearedAt > today ? today : clearedAt) : null;
  if (cleared && cleared >= start) {
    const from = nextDay(cleared);
    let span = 0;
    for (let key = from; key < today && span < MEMORY_DAYS; key = nextDay(key)) span += 1;
    return { from, sinceCleared: true, span };
  }
  return { from: start, sinceCleared: false, span: MEMORY_DAYS };
}

/** The days of the window that have a record, oldest first: 30 lookups, never the whole history. */
function pastDays(history: History, today: string, from: string): DayRecord[] {
  const days: DayRecord[] = [];
  for (let back = MEMORY_DAYS; back >= 1; back -= 1) {
    const key = addDays(today, -back);
    if (key < from) continue;
    const day = history[key];
    if (day && Array.isArray(day.tasks)) days.push(day);
  }
  return days;
}

/** Moved counts from the window's days (and today's record, which only shows what came back). */
function movedFromDays(days: DayRecord[], todayRecord: DayRecord | undefined): Map<string, MovedTask> {
  const lastSeen = new Map<string, string>();
  const wording = new Map<string, string>();
  for (const day of todayRecord ? [...days, todayRecord] : days) {
    for (const task of day.tasks) {
      const key = memoryTaskKey(task.text);
      if (!key) continue;
      lastSeen.set(key, day.date);
      wording.set(key, task.text.trim().replace(/\s+/g, " "));
    }
  }
  const out = new Map<string, MovedTask>();
  for (const day of days) {
    const counted = new Set<string>();
    for (const task of day.tasks) {
      const key = memoryTaskKey(task.text);
      if (!key || task.completed || task.routineId || counted.has(key)) continue;
      const cameBack = task.rolloverOutcome === "carried" || (lastSeen.get(key) ?? "") > day.date;
      if (!cameBack) continue;
      counted.add(key);
      const times = Math.min(MAX_TIMES, (out.get(key)?.times ?? 0) + 1);
      out.set(key, { text: wording.get(key) ?? task.text, times });
    }
  }
  return out;
}

/**
 * How many times each task was moved (keyed by memoryTaskKey), with the
 * newest wording. Only tasks moved at least once are in the map.
 */
export function movedCounts(history: History, today: string, clearedAt: string | null = null): Map<string, MovedTask> {
  const { from } = memoryStart(today, clearedAt);
  return movedFromDays(pastDays(history, today, from), history[today]);
}

/** A task's first word, as a kind of task ("Call", "Email"); null for none. */
function kindOf(text: string): string | null {
  const word = text.trim().match(/^[\p{L}\p{N}][\p{L}\p{M}\p{N}'’-]*/u)?.[0];
  if (!word || Array.from(word).length < 2) return null;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** The basic memory for `today`, from the history before it. */
export function buildBasicMemory(history: History, today: string, clearedAt: string | null = null): BasicMemory {
  const { from, sinceCleared, span } = memoryStart(today, clearedAt);
  const inWindow = pastDays(history, today, from);
  const days = inWindow.filter((day) => day.tasks.length > 0);
  let completed = 0;
  let total = 0;
  const weekdays = new Map<number, { days: number; done: number; total: number }>();
  const kinds = new Map<string, { done: number; total: number }>();
  for (const day of days) {
    const done = day.tasks.filter((task) => task.completed).length;
    completed += done;
    total += day.tasks.length;
    const weekday = fromDateKey(day.date).getDay();
    const entry = weekdays.get(weekday) ?? { days: 0, done: 0, total: 0 };
    weekdays.set(weekday, { days: entry.days + 1, done: entry.done + done, total: entry.total + day.tasks.length });
    for (const task of day.tasks) {
      const kind = kindOf(task.text);
      if (!kind) continue;
      const counts = kinds.get(kind) ?? { done: 0, total: 0 };
      kinds.set(kind, { done: counts.done + (task.completed ? 1 : 0), total: counts.total + 1 });
    }
  }
  const overall = total === 0 ? 0 : completed / total;
  // A weekday seen at least twice that beats the overall rate, best first.
  const bestWeekdays = [...weekdays.entries()]
    .filter(([, entry]) => entry.days >= 2 && entry.total > 0 && entry.done / entry.total > overall && entry.done / entry.total >= 0.5)
    .sort(([dayA, a], [dayB, b]) => b.done / b.total - a.done / a.total || b.days - a.days || dayA - dayB)
    .slice(0, 2)
    .map(([weekday]) => weekday);
  const kindList = [...kinds.entries()]
    .filter(([, counts]) => counts.total >= MIN_KIND_TASKS)
    .sort(([kindA, a], [kindB, b]) => b.total - a.total || kindA.localeCompare(kindB));
  const finishedKinds = kindList.filter(([, c]) => c.done / c.total >= 0.8).slice(0, 2).map(([kind]) => kind);
  const slippingKinds = kindList.filter(([, c]) => c.done / c.total <= 1 / 3).slice(0, 2).map(([kind]) => kind);
  const moved = [...movedFromDays(inWindow, history[today]).values()]
    .filter((task) => task.times >= MOVED_NOTICE_TIMES)
    .sort((a, b) => b.times - a.times || a.text.localeCompare(b.text))
    .slice(0, MAX_MOVED_SHOWN);
  return {
    from,
    sinceCleared,
    span,
    activeDays: days.length,
    completed,
    total,
    bestWeekdays,
    moved,
    finishedKinds,
    slippingKinds,
  };
}

const quote = (text: string) => `“${text}”`;
const listOf = (items: string[], joiner: string) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
const tasksWord = (count: number) => (count === 1 ? "task" : "tasks");

/** The basic memory in plain sentences, for "What your coach remembers". Kind, never a verdict. */
export function memorySentences(memory: BasicMemory): string[] {
  if (memory.total === 0) {
    return [
      memory.sinceCleared
        ? "Nothing since you cleared it. After a few days with your three, patterns show up here."
        : "Nothing yet. After a few days with your three, patterns show up here.",
    ];
  }
  const when = memory.sinceCleared ? "since you cleared it" : `in the last ${MEMORY_DAYS} days`;
  const sentences = [
    memory.completed > 0
      ? `You finished ${memory.completed} ${tasksWord(memory.completed)} ${when}.`
      : `You set ${memory.total} ${tasksWord(memory.total)} ${when}.`,
  ];
  if (memory.bestWeekdays.length > 0) {
    sentences.push(`You get the most done on ${listOf(memory.bestWeekdays.map((day) => `${WEEKDAY_NAMES[day]}s`), "and")}.`);
  }
  if (memory.finishedKinds.length > 0) {
    sentences.push(`Tasks that start with ${listOf(memory.finishedKinds.map(quote), "or")} usually get done.`);
  }
  if (memory.moved.length > 0) {
    sentences.push(`Tasks that keep coming back: ${memory.moved.map((task) => quote(task.text)).join(", ")}.`);
  }
  if (memory.slippingKinds.length > 0) {
    sentences.push(`Tasks starting with ${listOf(memory.slippingKinds.map(quote), "or")} are harder to get to.`);
  }
  return sentences;
}

/** What is sent with brain-dump and plan requests (server/providers/stats.mjs). */
export interface MemoryStatsPayload {
  days: number;
  done: number;
  total: number;
  /** Days the window covers, only when under 30 (after "Clear memory"). */
  span?: number;
  bestDays?: string[];
  moved?: MovedTask[];
}

function capText(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("").trimEnd()}…` : text;
}

/** The proxy's limits (server/providers/stats.mjs). */
const MAX_STATS_DAYS = 31;
const MAX_STATS_TASKS = 93;

/**
 * The compact summary sent to the AI: counts, up to two weekday names and
 * up to three short task titles. Null when there is nothing to tell yet.
 * Over the proxy's 93 tasks (a day can hold more than three from an older
 * build), the total is capped and `done` scaled to keep the same share.
 */
export function memoryStatsPayload(memory: BasicMemory): MemoryStatsPayload | null {
  if (memory.activeDays === 0 || memory.total === 0) return null;
  const total = Math.min(memory.total, MAX_STATS_TASKS);
  const done = memory.total > MAX_STATS_TASKS ? Math.round((memory.completed * MAX_STATS_TASKS) / memory.total) : memory.completed;
  return {
    days: Math.min(memory.activeDays, MAX_STATS_DAYS),
    done: Math.min(done, total),
    total,
    ...(memory.span >= 1 && memory.span < MEMORY_DAYS ? { span: memory.span } : {}),
    ...(memory.bestWeekdays.length > 0 ? { bestDays: memory.bestWeekdays.map((day) => WEEKDAY_NAMES[day]) } : {}),
    ...(memory.moved.length > 0
      ? { moved: memory.moved.slice(0, MAX_MOVED_SHOWN).map((task) => ({ text: capText(task.text, MAX_STATS_TEXT), times: task.times })) }
      : {}),
  };
}

/** The memory has this pick as one that keeps moving (twice or more). */
function keepsMoving(text: string, memory: BasicMemory | null): boolean {
  if (!memory) return false;
  const key = memoryTaskKey(text);
  return memory.moved.some((item) => memoryTaskKey(item.text) === key);
}

/**
 * "Been waiting a while" for a pick the memory has as one that keeps moving,
 * or null. Never a count: how often it moved isn't said under a pick.
 */
export function movedReason(text: string, memory: BasicMemory | null): string | null {
  return keepsMoving(text, memory) ? WAITING_REASON : null;
}

/**
 * The picks' reasons checked against the memory: a "waiting"-style reason
 * the AI gave a pick that doesn't keep moving is dropped, and a pick that
 * does keep moving with no reason gets "Been waiting a while". Other AI
 * reasons stay. The same object back when nothing changes.
 */
export function withMovedReasons(result: BrainDumpResult, memory: BasicMemory | null): BrainDumpResult {
  let changed = false;
  const reasons = result.picks.map((pick, index) => {
    const given = result.reasons?.[index] ?? "";
    const kept = given && isWaitingReason(given) && !keepsMoving(pick, memory) ? "" : given;
    const reason = kept || movedReason(pick, memory) || "";
    if (reason !== given) changed = true;
    return reason;
  });
  if (!changed) return result;
  if (reasons.some(Boolean)) return { ...result, reasons };
  const { reasons: _dropped, ...rest } = result;
  return rest;
}

/** How many times each of `tasks` was moved, by id (only those moved at least once): nag weights (1.5). */
export function movedTimesById(
  tasks: { id: string; text: string }[],
  history: History,
  today: string,
  clearedAt: string | null,
): Record<string, number> {
  const moved = movedCounts(history, today, clearedAt);
  const out: Record<string, number> = {};
  for (const task of tasks) {
    const times = moved.get(memoryTaskKey(task.text))?.times ?? 0;
    if (times > 0) out[task.id] = times;
  }
  return out;
}

/** Longest AI coach memory kept (the evening route's limit). */
export const MAX_COACH_MEMORY = 500;

/** The AI coach memory as edited by hand: trimmed and capped (whole characters); blank is none. */
export function cleanCoachMemory(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const chars = Array.from(trimmed);
  return chars.length > MAX_COACH_MEMORY ? chars.slice(0, MAX_COACH_MEMORY).join("").trimEnd() : trimmed;
}
