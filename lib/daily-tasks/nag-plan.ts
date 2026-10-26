// Nag mode (1.4, Plus, opt-in): when the day's nags go off and what each one
// says. Pure (no storage, no network, no notifications API), so it is
// unit-tested; nag-day.ts keeps the day's record and asks for the lines.
//
// The rules:
// - A level sets how many nags a day: Gentle 4, Firm 7, Relentless 11, and
//   never more than the whole hours left in the window.
// - Times are drawn once for the day from a generator seeded by the day and
//   a per-install salt, each at least 60 minutes after the one before. They
//   are kept when the day is planned again (a task added, another persona):
//   only the words change. Another level or window draws the rest of the day
//   again, still 60 minutes after the last one that went off.
// - Later nags take the later (pushier) lines.
// - 1.5: a task moved to another day more often is named in more of the
//   day's built-in lines (weight 1 + times moved, at most 3; see
//   nagTaskWeights). Times and counts don't change.

import { formatTime, fromDateKey, toDateKey } from "./date";
import {
  builtInNagLines,
  isAffectionateNagLine,
  NAG_DRILL_RUDE,
  nagDistinctiveWords,
  nagLineFitsTask,
  nagLineWords,
  NAG_LEVELS,
  NAG_PERSONAS,
  nagTaskIsSensitive,
  nagTitle,
  seededRandom,
  type NagLevel,
  type NagLine,
  type NagPersona,
} from "./nag";
import { fillNagOwnLine, MAX_NAG_OWN_LINES, nagOwnLineHoldsTask, nagOwnLineNamesTask, nagOwnSteps } from "./nag-own-lines";
import type { ReminderContext, ReminderPlan } from "./reminder-plan";
import { NAG_CATEGORY_ID, NAG_GENERAL_CATEGORY_ID, NAG_KIND } from "./reminders";
import {
  DEFAULT_NAG_WINDOW,
  NAG_WINDOW_LAST_MINUTE,
  NAG_WINDOW_MIN_SPAN,
  type NagWindow,
  type NotificationConfig,
  type NotificationPermissionState,
} from "./types";

/** Where the day's record is kept (AsyncStorage). */
export const NAG_STORAGE_KEY = "daily-tasks/nag/v1";
export { NAG_CATEGORY_ID, NAG_GENERAL_CATEGORY_ID, NAG_KIND };

/** Nags a day, by level. */
export const NAG_LEVEL_COUNTS: Record<NagLevel, number> = { gentle: 4, firm: 7, relentless: 11 };
/** No two nags are ever closer than this. */
export const NAG_MIN_GAP_MINUTES = 60;
/** The first nag planned is at least this long after the planning. */
export const NAG_FIRST_DELAY_MINUTES = 20;
/** AI requests for lines per day: the day's batch, and one more if the tasks, persona or level change. */
export const MAX_NAG_AI_CALLS_PER_DAY = 2;
/** 1.6 G: "Snooze 1 hour" on a nag: the next one comes this long after the tap (snoozeNagRecord). */
export const NAG_SNOOZE_MINUTES = 60;

/** How much of the spare room the random gaps use, on average three quarters of it (see planNagTimes). */
const NAG_SPREAD = 1.5;

const MINUTE_MS = 60_000;
const GAP_MS = NAG_MIN_GAP_MINUTES * MINUTE_MS;

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

function wholeMinute(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
}

/**
 * A usable window from anything saved: both ends inside the day, the end at
 * least three hours after the start (the end moves, then the start).
 */
export function normalizeNagWindow(value: unknown): NagWindow {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  if (!record) return DEFAULT_NAG_WINDOW;
  const start = wholeMinute(record.startMinutes, DEFAULT_NAG_WINDOW.startMinutes);
  const end = wholeMinute(record.endMinutes, DEFAULT_NAG_WINDOW.endMinutes);
  return adjustNagWindow({ startMinutes: start, endMinutes: end }, "start", start);
}

/**
 * The window after one end is set to `minutes`: the other end moves if it has
 * to, so the span is never under three hours and both stay inside the day.
 */
export function adjustNagWindow(window: NagWindow, edge: "start" | "end", minutes: number): NagWindow {
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(Math.round(value), min), max);
  if (edge === "start") {
    const startMinutes = clamp(minutes, 0, NAG_WINDOW_LAST_MINUTE - NAG_WINDOW_MIN_SPAN);
    const endMinutes = clamp(window.endMinutes, startMinutes + NAG_WINDOW_MIN_SPAN, NAG_WINDOW_LAST_MINUTE);
    return { startMinutes, endMinutes };
  }
  const endMinutes = clamp(minutes, NAG_WINDOW_MIN_SPAN, NAG_WINDOW_LAST_MINUTE);
  const startMinutes = clamp(window.startMinutes, 0, endMinutes - NAG_WINDOW_MIN_SPAN);
  return { startMinutes, endMinutes };
}

/** A minute of the local day `dayKey` as a moment. */
export function nagMinuteAt(dayKey: string, minutes: number): Date {
  const at = fromDateKey(dayKey);
  at.setHours(0, minutes, 0, 0);
  return at;
}

/**
 * The local clock a day is planned for: minutes ahead of UTC at the day's
 * noon. The same all day (also on a day the clocks change), and different
 * once the phone is in another time zone, when the times drawn for the old
 * clock no longer sit inside the window.
 */
export function nagZoneOffset(dayKey: string): number {
  const noon = fromDateKey(dayKey);
  noon.setHours(12, 0, 0, 0);
  // "|| 0": never -0 (UTC), which would not survive being saved as JSON.
  return -noon.getTimezoneOffset() || 0;
}

// ---------------------------------------------------------------------------
// Who gets nags
// ---------------------------------------------------------------------------

/**
 * Nag mode applies: reminders on, the Nag style chosen, Plus, and permission
 * to notify. Without Plus a saved "nag" is simply calm.
 */
export function nagModeOn(
  settings: Pick<NotificationConfig, "enabled" | "style">,
  plus: boolean,
  permissionState: NotificationPermissionState,
): boolean {
  return settings.enabled && settings.style === "nag" && plus && permissionState === "granted";
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/** `daily-tasks:<yyyy-MM-dd>:nag:<HHmm>`: the scheduler's own prefix, and the day the widget's last tick clears. */
export function nagSlotId(at: Date): string {
  const hour = String(at.getHours()).padStart(2, "0");
  const minute = String(at.getMinutes()).padStart(2, "0");
  return `daily-tasks:${toDateKey(at)}:${NAG_KIND}:${hour}${minute}`;
}

export interface NagTimesInput {
  dayKey: string;
  /** Per-install, so two phones don't nag at the same minutes. */
  salt: string;
  window: NagWindow;
  now: Date;
  /** How many are wanted (fewer come back when fewer whole hours are left). */
  count: number;
  /** Nothing before this moment (ms): an hour after the last nag that went off. */
  notBefore?: number | null;
  /** Which drawing of the day this is (0 for the first), so a redraw differs. */
  draw?: number;
  /** Slot ids already used today (nags that went off), so no new time gets one of them. */
  takenIds?: readonly string[];
}

/**
 * Times for up to `count` nags (ms, rising, whole minutes), all inside the
 * window and each at least 60 minutes after the one before:
 *
 *   base   = the latest of: the window's start, now + 20 min, `notBefore`
 *   n      = min(count, whole hours between base and the window's end)
 *   slack  = (end - base) - 60 min x (n - 1)
 *   J      = floor(1.5 x slack / n)     (slack itself for a single nag)
 *   t(0)   = base + random(0..J)
 *   t(i+1) = t(i) + 60 min + random(0..J)
 *
 * and each t(i) is held back to `end - 60 min x (n - 1 - i)` so the rest
 * still fit (rarely needed: on average the last nag lands three quarters of
 * the way through the slack). So the nags are spread over what is left of
 * the window (a Gentle day isn't over by lunch, a Relentless one still fits
 * its eleven), and the same day, salt and inputs always give the same times.
 *
 * A slot's id is its local HHmm, and on the day the clocks go back an hour
 * of the local clock happens twice, so two times 60 minutes apart can share
 * one. The later of two such times is moved a minute at a time until its id
 * is free, the ones after it are pushed along to stay 60 minutes apart, and
 * one pushed past the window's end is dropped. So every time has its own id.
 */
export function planNagTimes({ dayKey, salt, window, now, count, notBefore = null, draw = 0, takenIds = [] }: NagTimesInput): number[] {
  const startMs = nagMinuteAt(dayKey, window.startMinutes).getTime();
  const endMs = nagMinuteAt(dayKey, window.endMinutes).getTime();
  const earliest = Math.ceil((now.getTime() + NAG_FIRST_DELAY_MINUTES * MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
  const held = typeof notBefore === "number" && Number.isFinite(notBefore) ? Math.ceil(notBefore / MINUTE_MS) * MINUTE_MS : -Infinity;
  const base = Math.max(startMs, earliest, held);
  const room = Math.floor((endMs - base) / MINUTE_MS);
  const n = Math.min(Math.floor(Number.isFinite(count) ? count : 0), Math.floor(room / NAG_MIN_GAP_MINUTES));
  if (n <= 0) return [];
  const slack = room - NAG_MIN_GAP_MINUTES * (n - 1);
  const jitter = Math.floor(((n > 1 ? NAG_SPREAD : 1) * slack) / n);
  const random = seededRandom(`${dayKey}|${salt}|${draw}`);
  const times: number[] = [];
  let at = base;
  for (let index = 0; index < n; index += 1) {
    const wanted = at + (index > 0 ? GAP_MS : 0) + Math.floor(random() * (jitter + 1)) * MINUTE_MS;
    at = Math.min(wanted, endMs - GAP_MS * (n - 1 - index));
    times.push(at);
  }
  return withUniqueIds(times, endMs, takenIds);
}

/** `times` with no two sharing a slot id (see planNagTimes): only ever different on a clocks-back day. */
function withUniqueIds(times: number[], endMs: number, takenIds: readonly string[]): number[] {
  const taken = new Set(takenIds);
  const out: number[] = [];
  for (const time of times) {
    let at = out.length > 0 ? Math.max(time, out[out.length - 1] + GAP_MS) : time;
    // The repeated hour is 60 minutes long, so this ends within an hour of tries.
    for (let tries = 0; taken.has(nagSlotId(new Date(at))) && tries < 2 * NAG_MIN_GAP_MINUTES; tries += 1) at += MINUTE_MS;
    if (at > endMs || taken.has(nagSlotId(new Date(at)))) break;
    taken.add(nagSlotId(new Date(at)));
    out.push(at);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

/** An open task as nags see it. */
export interface NagOpenTask {
  id: string;
  text: string;
}

/** Today's open tasks with any words, in Today's order. */
export function nagOpenTasks(tasks: ReminderContext["tasks"]): NagOpenTask[] {
  return tasks
    .map((task, index) => ({ id: task.id ?? `#${index}`, text: typeof task.text === "string" ? task.text.trim() : "", done: task.done }))
    .filter((task) => !task.done && task.text !== "")
    .map(({ id, text }) => ({ id, text }));
}

function textKey(text: string): string {
  const clean = text.trim().toLowerCase().replace(/\s+/g, " ");
  let hash = 2166136261;
  for (let index = 0; index < clean.length; index += 1) hash = Math.imul(hash ^ clean.charCodeAt(index), 16777619) >>> 0;
  return hash.toString(36);
}

/**
 * One open task as the key knows it: a hash of its id and its words
 * together (1.6 G; the words alone before). So a line written for a task is
 * only ever said about that task with those words: two tasks that swap their
 * words, or a task edited to words another one had, is a change too.
 */
function nagTaskKey(task: NagOpenTask): string {
  return textKey(`${task.id}\u0001${task.text.trim()}`);
}

/** 1.6 G: one distinctive word as the record keeps it: a hash, never the word. */
function wordKey(word: string): string {
  return textKey(`w\u0001${word}`);
}

/** 1.6 G: hashes of each task's distinctive words (nagDistinctiveWords), by task id. */
export function nagTaskWordKeys(tasks: readonly NagOpenTask[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const task of tasks) out[task.id] = nagDistinctiveWords(task.text).map(wordKey);
  return out;
}

/** `earlier` and `later` together: a task's hashes from both, so a task edited today keeps its old words too. */
function mergeWordKeys(earlier: Readonly<Record<string, string[]>> | undefined, later: Readonly<Record<string, string[]>>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [id, keys] of Object.entries(earlier ?? {})) out[id] = [...keys];
  for (const [id, keys] of Object.entries(later)) out[id] = [...new Set([...(out[id] ?? []), ...keys])];
  return out;
}

/** The open tasks as a short key (hashes of each task's id and words, never the words). */
export function nagTasksKey(open: NagOpenTask[]): string {
  return [...new Set(open.map(nagTaskKey))].sort().join(",");
}

/**
 * The open tasks changed in a way the lines can't cover: one of them has
 * words that weren't there, for that task, when `key` was made (added,
 * reworded, swapped in, or given another task's words). A task ticked off,
 * removed or moved in the list isn't that; its nags are pointed at another
 * task. A key saved before 1.6 (words only) knows no task: the day is
 * planned again once.
 */
export function nagTasksChanged(key: string, open: NagOpenTask[]): boolean {
  const known = new Set(key.split(",").filter(Boolean));
  return open.some((task) => !known.has(nagTaskKey(task)));
}

/**
 * Which of `lines` the nag at `step` (1-based) of `total` says. With enough
 * lines the first nag takes the first line and the last nag the last, the
 * ones between spread evenly: a day with one nag gets an opening line, two
 * get an opening and a closing one, three an opening, a middle and a closing
 * one. With fewer lines than nags the lines are spread over the day and the
 * nags left over get none (null).
 */
export function lineForStep<T>(lines: readonly T[], step: number, total: number): T | null {
  const count = lines.length;
  if (count === 0 || step < 1 || step > total) return null;
  if (count >= total) return lines[Math.round(((step - 1) * (count - 1)) / Math.max(1, total - 1))] ?? null;
  const index = Math.floor(((step - 1) * count) / total);
  if (step > 1 && Math.floor(((step - 2) * count) / total) === index) return null;
  return lines[index] ?? null;
}

export interface NagWords {
  text: string;
  taskId: string | null;
}

// ---------------------------------------------------------------------------
// The day's record
// ---------------------------------------------------------------------------

export interface NagSlot {
  /** `daily-tasks:<yyyy-MM-dd>:nag:<HHmm>`. */
  id: string;
  fireAtMs: number;
  /** Its place in the day, from 1. */
  step: number;
  /** Its words; "" when there is no line for it (it stays in the record and isn't scheduled). */
  text: string;
  /** The task it names; null for a line about the list in general. */
  taskId: string | null;
  /**
   * 1.4.1: the words it was last scheduled with, when those were not `text`
   * (a line put in for a ticked task, and the like: nagPlanFromRecord). Only
   * read once the slot has gone off, as what it said; `text` stays the
   * day's own line, so an undone tick brings it back. Absent in records
   * saved before 1.4.1 and whenever the slot says its own words.
   */
  sent?: string;
  /**
   * 1.6 G: one of the day's steps for the user's own lines (nagOwnSteps),
   * marked when the slot is planned. So which nags say one doesn't depend on
   * what was written back, or on how many lines there are; and "never two
   * in a row" reads it for nags that went off. Absent on other slots.
   */
  own?: true;
}

/** What a slot that went off said: the words it was scheduled with. */
function saidText(slot: NagSlot): string {
  return slot.sent ?? slot.text;
}

/** `slot` without `sent`: for a slot whose words are written again. */
function unsent({ sent: _sent, ...slot }: NagSlot): NagSlot {
  return slot;
}

export interface NagDayRecord {
  dayKey: string;
  persona: NagPersona;
  level: NagLevel;
  /** Per-install; carried from day to day. */
  salt: string;
  /** The open tasks the slots were written for (see nagTasksKey). */
  tasksKey: string;
  /** The day's batch of lines, AI or built-in. */
  lines: NagLine[];
  /** The ids of the tasks `lines[].taskIndex` points into. */
  lineTasks: string[];
  source: "ai" | "local";
  /** Passed ones are history; future ones are what is (or will be) pending. */
  slots: NagSlot[];
  /** How many nags the day was planned with (the steps run 1..total). */
  total: number;
  /** Level and window the times were drawn for. */
  timingKey: string;
  /** How many times the day's times have been drawn. */
  draws: number;
  /** The local clock the times were drawn for (nagZoneOffset); null in a record saved before this was kept. */
  zone: number | null;
  /** Written with task names hidden: general lines only. */
  hideNames: boolean;
  /** When the AI was last asked today (ms); null when it wasn't. */
  aiFetchedAt: number | null;
  /** AI requests made today (see MAX_NAG_AI_CALLS_PER_DAY). */
  aiCalls: number;
  /** What the AI was last asked about: `persona|level|tasksKey`. */
  aiFor: string | null;
  /** Goes up with every change, so the store knows to sync the reminders again. */
  version: number;
  /**
   * 1.6 G: "Snooze 1 hour" was tapped today; no nag before this moment (ms).
   * Absent when it wasn't (and in records saved before 1.6).
   */
  snoozedUntil?: number;
  /**
   * 1.6 G: hashes of the distinctive words (nagDistinctiveWords) of every
   * task the day was planned for, by task id (nagTaskWordKeys), never the
   * words. So a line that holds a word of a task since ticked or removed is
   * known for one (nagSlotWords). Absent in records saved before.
   */
  taskWords?: Record<string, string[]>;
  /**
   * 1.6 G: the open tasks (nagTasksKey) the AI's `lines` were written for.
   * `aiFor` is what was last asked about, also when that request failed, so
   * it can be newer than the lines. Absent in records saved before (aiFor
   * is used then).
   */
  linesFor?: string;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DATE_MS = 8.64e15;

function asNagLine(value: unknown): NagLine | null {
  if (!value || typeof value !== "object") return null;
  const { step, taskIndex, text } = value as Record<string, unknown>;
  if (typeof step !== "number" || !Number.isFinite(step) || typeof text !== "string" || !text) return null;
  if (taskIndex !== null && !(typeof taskIndex === "number" && Number.isInteger(taskIndex) && taskIndex >= 0)) return null;
  return { step, taskIndex: taskIndex as number | null, text };
}

function asNagSlot(value: unknown): NagSlot | null {
  if (!value || typeof value !== "object") return null;
  const { id, fireAtMs, step, text, taskId, sent, own } = value as Record<string, unknown>;
  if (typeof id !== "string" || !id.startsWith("daily-tasks:")) return null;
  // A moment a Date can hold (up to 8.64e15 ms): anything else would be an Invalid Date in the plan.
  if (typeof fireAtMs !== "number" || !Number.isFinite(fireAtMs) || fireAtMs <= 0 || fireAtMs > MAX_DATE_MS) return null;
  if (typeof step !== "number" || !Number.isInteger(step) || step < 1 || typeof text !== "string") return null;
  return {
    id,
    fireAtMs,
    step,
    text,
    taskId: typeof taskId === "string" && taskId ? taskId : null,
    ...(typeof sent === "string" && sent && sent !== text ? { sent } : {}),
    ...(own === true ? { own: true as const } : {}),
  };
}

function asWordKeys(value: unknown): Record<string, string[]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string[]> = {};
  for (const [id, keys] of Object.entries(value as Record<string, unknown>)) {
    if (id && Array.isArray(keys)) out[id] = keys.filter((key): key is string => typeof key === "string" && key !== "");
  }
  return out;
}

/** A saved record, checked; null for anything that isn't one. */
export function normalizeNagRecord(value: unknown): NagDayRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.dayKey !== "string" || !DAY_KEY.test(raw.dayKey)) return null;
  if (!(NAG_PERSONAS as readonly unknown[]).includes(raw.persona) || !(NAG_LEVELS as readonly unknown[]).includes(raw.level)) return null;
  if (typeof raw.salt !== "string" || !raw.salt) return null;
  const count = (field: unknown) => (typeof field === "number" && Number.isFinite(field) && field >= 0 ? Math.floor(field) : 0);
  const slots = (Array.isArray(raw.slots) ? raw.slots : [])
    .map(asNagSlot)
    .filter((slot): slot is NagSlot => slot !== null)
    .sort((a, b) => a.fireAtMs - b.fireAtMs);
  return {
    dayKey: raw.dayKey,
    persona: raw.persona as NagPersona,
    level: raw.level as NagLevel,
    salt: raw.salt,
    tasksKey: typeof raw.tasksKey === "string" ? raw.tasksKey : "",
    lines: (Array.isArray(raw.lines) ? raw.lines : []).map(asNagLine).filter((line): line is NagLine => line !== null),
    lineTasks: (Array.isArray(raw.lineTasks) ? raw.lineTasks : []).filter((id): id is string => typeof id === "string"),
    source: raw.source === "ai" ? "ai" : "local",
    slots,
    total: Math.max(count(raw.total), slots.reduce((most, slot) => Math.max(most, slot.step), 0)),
    timingKey: typeof raw.timingKey === "string" ? raw.timingKey : "",
    draws: count(raw.draws),
    zone: typeof raw.zone === "number" && Number.isFinite(raw.zone) ? raw.zone : null,
    hideNames: raw.hideNames === true,
    aiFetchedAt: typeof raw.aiFetchedAt === "number" && Number.isFinite(raw.aiFetchedAt) ? raw.aiFetchedAt : null,
    aiCalls: count(raw.aiCalls),
    aiFor: typeof raw.aiFor === "string" ? raw.aiFor : null,
    version: count(raw.version),
    ...(typeof raw.snoozedUntil === "number" && Number.isFinite(raw.snoozedUntil) && raw.snoozedUntil > 0 && raw.snoozedUntil <= MAX_DATE_MS
      ? { snoozedUntil: raw.snoozedUntil }
      : {}),
    ...(asWordKeys(raw.taskWords) ? { taskWords: asWordKeys(raw.taskWords) as Record<string, string[]> } : {}),
    ...(typeof raw.linesFor === "string" ? { linesFor: raw.linesFor } : {}),
  };
}

/**
 * What is kept of a day when the style goes back to Calm: no words at all
 * (no lines, no slot text, no task ids), only what Nag needs to carry on
 * should it be turned on again the same day. The nags that already went off
 * keep their id, time and step, so the day's count and the hour between nags
 * still hold; the AI requests made today stay counted, with what was last
 * asked about (`aiFor`: the voice, the level and hashes of the tasks' words,
 * never the words). Nags still to come are dropped; turning Nag on again
 * draws the rest of the day. The words of the nags that went off are gone,
 * so a built-in line said before Calm can come round again after it.
 */
export function nagRecordStub(record: NagDayRecord, now: Date): NagDayRecord {
  const nowMs = now.getTime();
  const slots = record.slots
    .filter((slot) => slot.fireAtMs <= nowMs)
    .map(({ own: _own, ...slot }) => ({ ...unsent(slot), text: "", taskId: null }));
  const { taskWords: _taskWords, linesFor: _linesFor, ...rest } = record;
  return {
    ...rest,
    tasksKey: "",
    lines: [],
    lineTasks: [],
    source: "local",
    slots,
    total: slots.reduce((most, slot) => Math.max(most, slot.step), 0),
    // Not any level's and window's key, so the rest of the day is drawn again.
    timingKey: "",
    version: record.version + 1,
  };
}

/** `record` is already a stub (nagRecordStub would change nothing but the version). */
export function isNagRecordStub(record: NagDayRecord, now: Date): boolean {
  const nowMs = now.getTime();
  return (
    record.lines.length === 0 &&
    record.lineTasks.length === 0 &&
    record.tasksKey === "" &&
    record.timingKey === "" &&
    record.taskWords === undefined &&
    record.linesFor === undefined &&
    record.slots.every((slot) => slot.fireAtMs <= nowMs && slot.text === "" && slot.taskId === null && slot.sent === undefined && slot.own === undefined)
  );
}

export function nagTimingKey(level: NagLevel, window: NagWindow): string {
  return `${level}|${window.startMinutes}-${window.endMinutes}`;
}

/** What the AI is asked about: persona, level and the open tasks. */
export function nagAiKey(persona: NagPersona, level: NagLevel, open: NagOpenTask[]): string {
  return `${persona}|${level}|${nagTasksKey(open)}`;
}

/**
 * The AI's lines in `record` that still fit (null when none can: another
 * persona or level, or no AI lines). With the same tasks, all of them. After
 * an edit (1.6 G: one edit no longer drops every line), the lines of a task
 * whose words changed go, and every other line is kept when it still reads
 * right with the open tasks as they are now (nagLineFitsTask: a general line
 * names none of them, a task's line no other). A line about a task since
 * ticked or removed is kept: the plan points it at an open task.
 */
function aiLinesThatFit(record: NagDayRecord, persona: NagPersona, level: NagLevel, open: NagOpenTask[]): Set<NagLine> | null {
  if (record.source !== "ai" || record.aiFor === null || record.lines.length === 0) return null;
  const [forPersona, forLevel, askedFor = ""] = record.aiFor.split("|");
  if (forPersona !== persona || forLevel !== level) return null;
  const forTasks = record.linesFor ?? askedFor;
  if (!nagTasksChanged(forTasks, open)) return new Set(record.lines);
  const known = new Set(forTasks.split(",").filter(Boolean));
  const openTexts = open.map((task) => task.text);
  const kept = new Set<NagLine>();
  for (const line of record.lines) {
    if (line.taskIndex === null) {
      if (nagLineFitsTask(line.text, null, openTexts)) kept.add(line);
      continue;
    }
    const id = record.lineTasks[line.taskIndex];
    const at = open.findIndex((task) => task.id === id);
    if (at === -1) kept.add(line);
    else if (known.has(nagTaskKey(open[at])) && nagLineFitsTask(line.text, at, openTexts)) kept.add(line);
  }
  return kept;
}

/**
 * The future slots of `slots` with the lines of a batch written in; a slot
 * the batch has no line for keeps its words. So does a slot whose line was
 * already said today (a nag that went off, or an earlier slot here): no two
 * nags of a day say the same thing. And so does a slot whose line is
 * affectionate (isAffectionateNagLine; `ownTexts` are the open tasks' words,
 * which are excused): the batch may be one saved before Nag mode stopped
 * saying such things, and the slot's built-in line is used instead. So does a
 * slot whose line isn't `usable` (an edited task's: aiLinesThatFit), each
 * line keeping its step, so the other slots say what they said before.
 */
function withLines(
  slots: NagSlot[],
  {
    lines,
    lineTasks,
    total,
    nowMs,
    ownTexts,
    usable,
  }: { lines: NagLine[]; lineTasks: string[]; total: number; nowMs: number; ownTexts: string[]; usable?: ReadonlySet<NagLine> },
): NagSlot[] {
  const said = new Set(slots.filter((slot) => slot.fireAtMs <= nowMs && saidText(slot)).map(saidText));
  return slots.map((slot) => {
    if (slot.fireAtMs <= nowMs) return slot;
    const line = lineForStep(lines, slot.step, total);
    if (!line || (usable && !usable.has(line)) || said.has(line.text) || isAffectionateNagLine(line.text, ownTexts)) {
      if (slot.text) said.add(slot.text);
      return slot;
    }
    said.add(line.text);
    return { ...unsent(slot), text: line.text, taskId: line.taskIndex === null ? null : (lineTasks[line.taskIndex] ?? null) };
  });
}

/**
 * The line for the nag at `step` of `total`, never one in `said`: when the
 * step's own line was said already (the day was drawn again with another
 * count, so the lines moved), the next unsaid line after it. Never one from
 * before it: a day that has got pushier doesn't go back to an opening line,
 * so with nothing later left the nag has no line (null).
 */
function unsaidLine(lines: readonly NagLine[], step: number, total: number, said: ReadonlySet<string>): NagLine | null {
  const own = lineForStep(lines, step, total);
  if (!own || !said.has(own.text)) return own;
  const from = lines.indexOf(own);
  for (let index = from + 1; index < lines.length; index += 1) if (!said.has(lines[index].text)) return lines[index];
  return null;
}

/** What planNagDay plans from (nag-day.ts has its own NagDayInput: what ensureNagDay is given). */
export interface NagDayPlanInput {
  /** The record as saved (any day's), or null. */
  previous: NagDayRecord | null;
  now: Date;
  dayKey: string;
  settings: Pick<NotificationConfig, "nagPersona" | "nagLevel" | "nagWindow" | "hideTaskNames">;
  open: NagOpenTask[];
  /** Used when there is no earlier record to take the salt from. */
  salt: string;
  /** 1.5: how many times each open task (by id) was moved to another day (coach-memory.ts). */
  moved?: Readonly<Record<string, number>>;
}

/**
 * Turns per task when the built-in lines that name a task are shared out:
 * 1, plus 1 for each time it was moved, at most 3. A task moved twice is
 * named about three times as often as one never moved.
 */
export function nagTaskWeights(tasks: readonly NagOpenTask[], moved: Readonly<Record<string, number>> = {}): number[] {
  return tasks.map((task) => {
    const times = moved[task.id];
    return 1 + (typeof times === "number" && Number.isFinite(times) ? Math.min(2, Math.max(0, Math.floor(times))) : 0);
  });
}

/**
 * The day's record, planned without the AI. Slots that already went off stay
 * as history. With the same level, window and time zone the future slots keep
 * their times (only their words are written again); otherwise the rest of
 * the day is drawn again, never under an hour after the last one that went
 * off (or yesterday's last), with steps that carry on from the last one.
 * Built-in lines fill the slots; the AI's lines from earlier today are put
 * back when they still fit. A slot there is no line for stays in the record
 * with no words (it isn't scheduled), so it is back when there is one again.
 * No two slots of the day share their words. No built-in line names a
 * sensitive task, and with one among the open tasks (names hidden or not)
 * the Drill sergeant has no rude line (builtInNagLines).
 */
export function planNagDay({ previous, now, dayKey, settings, open, salt: freshSalt, moved }: NagDayPlanInput): NagDayRecord {
  const { nagPersona: persona, nagLevel: level, nagWindow: window } = settings;
  const hideNames = settings.hideTaskNames === true;
  const nowMs = now.getTime();
  const salt = previous?.salt ?? freshSalt;
  const sameDay = previous?.dayKey === dayKey;
  const timingKey = nagTimingKey(level, window);
  const zone = nagZoneOffset(dayKey);
  const past = sameDay ? previous.slots.filter((slot) => slot.fireAtMs <= nowMs) : [];

  let future: NagSlot[];
  let total: number;
  let draws: number;
  if (sameDay && previous.timingKey === timingKey && (previous.zone === null || previous.zone === zone)) {
    future = previous.slots.filter((slot) => slot.fireAtMs > nowMs);
    total = previous.total;
    draws = previous.draws;
  } else {
    const before = sameDay ? past : (previous?.slots ?? []);
    const lastFired = before.reduce((latest, slot) => Math.max(latest, slot.fireAtMs), -Infinity);
    // 1.6 G: a snooze today holds the redrawn day back too (an hour after the tap).
    const snoozed = sameDay && typeof previous.snoozedUntil === "number" ? previous.snoozedUntil - GAP_MS : -Infinity;
    const last = Math.max(lastFired, snoozed);
    draws = sameDay ? previous.draws + 1 : 0;
    const times = planNagTimes({
      dayKey,
      salt,
      window,
      now,
      count: NAG_LEVEL_COUNTS[level] - past.length,
      notBefore: Number.isFinite(last) ? last + GAP_MS : null,
      draw: draws,
      takenIds: past.map((slot) => slot.id),
    });
    // The steps carry on from the last nag that went off, so they keep rising.
    const lastStep = past.reduce((most, slot) => Math.max(most, slot.step), 0);
    total = lastStep + times.length;
    future = times.map((fireAtMs, index) => ({
      id: nagSlotId(new Date(fireAtMs)),
      fireAtMs,
      step: lastStep + index + 1,
      text: "",
      taskId: null,
    }));
  }

  // 1.6 G: the steps for the user's own lines, marked on the slots still to
  // come (the same on every plan of the same draw; at most one in three).
  const ownSteps = new Set(nagOwnSteps(total, MAX_NAG_OWN_LINES, `${dayKey}|${salt}`));
  future = future.map(({ own: _own, ...slot }) => (ownSteps.has(slot.step) ? { ...slot, own: true as const } : slot));

  const tasks = hideNames ? [] : open;
  const sensitiveDay = open.some((task) => nagTaskIsSensitive(task.text));
  const lines = builtInNagLines({
    persona,
    level,
    tasks,
    count: total,
    seed: `${dayKey}|${salt}`,
    sensitiveDay,
    weights: nagTaskWeights(tasks, moved),
  });
  // What the nags that went off said: the words they were scheduled with.
  const said = new Set(past.filter((slot) => saidText(slot)).map(saidText));
  let slots = future.map((slot) => {
    const line = unsaidLine(lines, slot.step, total, said);
    if (!line) return { ...unsent(slot), text: "", taskId: null };
    said.add(line.text);
    return { ...unsent(slot), text: line.text, taskId: line.taskIndex === null ? null : (tasks[line.taskIndex]?.id ?? null) };
  });

  const fitting = sameDay && !hideNames ? aiLinesThatFit(previous, persona, level, open) : null;
  const keepAi = previous !== null && fitting !== null && fitting.size > 0;
  if (keepAi) {
    slots = withLines([...past, ...slots], {
      lines: previous.lines,
      lineTasks: previous.lineTasks,
      total,
      nowMs,
      ownTexts: open.map((task) => task.text),
      usable: fitting,
    }).slice(past.length);
  }

  return {
    dayKey,
    persona,
    level,
    salt,
    tasksKey: nagTasksKey(open),
    lines: keepAi ? previous.lines : lines,
    lineTasks: keepAi ? previous.lineTasks : tasks.map((task) => task.id),
    // What the kept lines were written for, pinned (an older record's from what was asked).
    ...(keepAi ? { linesFor: previous.linesFor ?? (previous.aiFor ?? "").split("|")[2] ?? "" } : {}),
    source: keepAi ? "ai" : "local",
    slots: [...past, ...slots],
    total,
    timingKey,
    draws,
    zone,
    hideNames,
    aiFetchedAt: sameDay ? previous.aiFetchedAt : null,
    aiCalls: sameDay ? previous.aiCalls : 0,
    aiFor: sameDay ? previous.aiFor : null,
    version: (previous?.version ?? 0) + 1,
    ...(sameDay && typeof previous.snoozedUntil === "number" ? { snoozedUntil: previous.snoozedUntil } : {}),
    taskWords: mergeWordKeys(sameDay ? previous.taskWords : undefined, nagTaskWordKeys(open)),
  };
}

/**
 * 1.6 G: "Snooze 1 hour" on a nag, tapped at `now`: the next nag of the day
 * comes an hour after the tap (whole minute), and then the day carries on.
 *
 * - The first nag still to come with words is moved to that moment when it
 *   was sooner; one already planned for later stays where it was (a snooze
 *   never brings a nag sooner). It keeps its id, step and words.
 * - Every other nag still to come that would be less than an hour after it
 *   is taken out of the day (so the hour between nags still holds), as are
 *   the wordless slots before it; the later ones keep their times.
 * - When that moment is outside the window (or the day), nothing is moved
 *   and every nag before it is taken out: quiet for the hour, or for the
 *   rest of the day's window.
 * - `snoozedUntil` notes the moment, so a day drawn again later today
 *   (another level or window) starts no earlier than that.
 *
 * Never closer than an hour to the nag before it: the tap is after the nag
 * that went off. The version goes up, so the reminders are written again.
 */
export function snoozeNagRecord(record: NagDayRecord, now: Date, window: NagWindow): NagDayRecord {
  const nowMs = now.getTime();
  const until = nagSnoozeUntil(now);
  const startMs = nagMinuteAt(record.dayKey, window.startMinutes).getTime();
  const endMs = nagMinuteAt(record.dayKey, window.endMinutes).getTime();
  const past = record.slots.filter((slot) => slot.fireAtMs <= nowMs);
  const future = record.slots.filter((slot) => slot.fireAtMs > nowMs);
  const inWindow = until >= startMs && until <= endMs && toDateKey(new Date(until)) === record.dayKey;
  const next = inWindow ? (future.find((slot) => slot.text !== "") ?? null) : null;
  // Never sooner than it was planned for.
  const nextAt = next ? Math.max(until, next.fireAtMs) : until;
  const kept = next
    ? future.filter((slot) => slot !== next && slot.fireAtMs > next.fireAtMs && slot.fireAtMs >= nextAt + GAP_MS)
    : future.filter((slot) => slot.fireAtMs >= until);
  const slots = [...past, ...(next ? [{ ...next, fireAtMs: nextAt }] : []), ...kept].sort((a, b) => a.fireAtMs - b.fireAtMs);
  return { ...record, slots, snoozedUntil: Math.max(until, record.snoozedUntil ?? 0), version: record.version + 1 };
}

/**
 * 1.6 G: what a snooze tapped at `now` leaves, for the note the app shows:
 * when the next nag with words comes (ms; null when none is left today), and
 * whether the hour runs past the end of the nag window.
 */
export function nagSnoozeOutcome(record: NagDayRecord, now: Date, window: NagWindow): { nextAt: number | null; pastWindow: boolean } {
  const nowMs = now.getTime();
  const until = nagSnoozeUntil(now);
  const endMs = nagMinuteAt(record.dayKey, window.endMinutes).getTime();
  const next = record.slots.find((slot) => slot.fireAtMs > nowMs && slot.text !== "") ?? null;
  return { nextAt: next ? next.fireAtMs : null, pastWindow: until > endMs || toDateKey(new Date(until)) !== record.dayKey };
}

/** 1.6 G: the moment a snooze tapped at `now` ends (the tap plus an hour, whole minute). */
export function nagSnoozeUntil(now: Date): number {
  return Math.ceil((now.getTime() + NAG_SNOOZE_MINUTES * MINUTE_MS) / MINUTE_MS) * MINUTE_MS;
}

/** 1.6 G: the note the app shows after a snooze ("Next nag around 3:40 PM"). */
export function nagSnoozeNote(
  { nextAt, pastWindow }: { nextAt: number | null; pastWindow: boolean },
  format: (hour: number, minute: number) => string = formatTime,
): string {
  if (nextAt !== null) {
    const next = new Date(nextAt);
    return `Next nag around ${format(next.getHours(), next.getMinutes())}`;
  }
  return pastWindow ? "No more nags today (past your nag hours)" : "No more nags today";
}

/**
 * Whether the day has to be planned again: a new day, another persona, level
 * or window, another time zone, names hidden or shown, or a task the slots
 * don't know.
 */
export function nagDayNeedsPlan(previous: NagDayRecord | null, input: Omit<NagDayPlanInput, "previous" | "now" | "salt">): boolean {
  if (!previous || previous.dayKey !== input.dayKey) return true;
  const { nagPersona, nagLevel, nagWindow, hideTaskNames } = input.settings;
  return (
    previous.persona !== nagPersona ||
    previous.level !== nagLevel ||
    previous.timingKey !== nagTimingKey(nagLevel, nagWindow) ||
    (previous.zone !== null && previous.zone !== nagZoneOffset(input.dayKey)) ||
    previous.hideNames !== (hideTaskNames === true) ||
    nagTasksChanged(previous.tasksKey, input.open)
  );
}

/**
 * The AI should be asked now: names aren't hidden, there is a nag left to
 * write, today's requests aren't used up, and it hasn't been asked about
 * this persona, level and these tasks.
 */
export function nagDayWantsAi(record: NagDayRecord, open: NagOpenTask[], now: Date): boolean {
  if (record.hideNames || open.length === 0 || record.aiCalls >= MAX_NAG_AI_CALLS_PER_DAY) return false;
  if (!record.slots.some((slot) => slot.fireAtMs > now.getTime())) return false;
  if (record.aiFor === null) return true;
  const [forPersona, forLevel, forTasks = ""] = record.aiFor.split("|");
  return forPersona !== record.persona || forLevel !== record.level || nagTasksChanged(forTasks, open);
}

/** `record` with the AI's lines (their `taskIndex` points into `open`) written into the future slots. */
export function applyAiNagLines(record: NagDayRecord, lines: NagLine[], open: NagOpenTask[], now: Date): NagDayRecord {
  const lineTasks = open.map((task) => task.id);
  return {
    ...record,
    lines,
    lineTasks,
    source: "ai",
    slots: withLines(record.slots, { lines, lineTasks, total: record.total, nowMs: now.getTime(), ownTexts: open.map((task) => task.text) }),
    version: record.version + 1,
    taskWords: mergeWordKeys(record.taskWords, nagTaskWordKeys(open)),
    linesFor: nagTasksKey(open),
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export type NagPlanContext = Pick<ReminderContext, "now" | "today" | "settings" | "permissionState" | "tasks" | "plus">;

/**
 * The day's record is the one to plan from: nag mode applies, it isn't
 * paused today, the record is for the store's day, which is the clock's, and
 * it was planned for the time zone the phone is in (until it is planned
 * again its times are for another clock).
 */
export function nagRecordApplies(record: NagDayRecord | null, context: NagPlanContext): record is NagDayRecord {
  const { settings, today, now } = context;
  if (!nagModeOn(settings, context.plus === true, context.permissionState)) return false;
  if (settings.nagPausedDate === today) return false;
  if (record === null || record.dayKey !== today || today !== toDateKey(now)) return false;
  return record.zone === null || record.zone === nagZoneOffset(today);
}

/**
 * The nags to have pending, from the day's record: its future slots with the
 * same id, time and words, so the scheduler leaves them alone. A slot whose
 * task is done or gone is pointed at the next open task with a built-in line
 * for the same step. So is a slot holding an affectionate AI line saved
 * before Nag mode stopped saying such things (isAffectionateNagLine; the
 * open tasks' own words are excused), a slot of built-in lines that names a
 * sensitive task, and, on a day with a sensitive task among the open ones, a
 * Drill sergeant slot with a rude line (a record planned before those rules).
 * The line put in never names a sensitive task (nagTaskIsSensitive): it is
 * about the first open task that isn't one, or a general line when all are,
 * and it is never rude on such a day. Nothing when nag mode doesn't apply, it is paused today,
 * the record is another day's, or nothing is open. Never time-sensitive: a
 * nag does not break through a Focus.
 *
 * No two nags of the day share their words. A built-in line put in here is
 * never one the record already has in any slot (gone off or still to come)
 * or one given to an earlier slot of this plan: the next unsaid built-in
 * line is used instead (unsaidLine), and with none left the slot isn't
 * scheduled. Slots that went off are worked out the same way and only left
 * out at the end, so the answer doesn't change as the day's nags go off.
 */
export function nagPlanFromRecord(record: NagDayRecord | null, context: NagPlanContext): ReminderPlan {
  const worked = nagSlotWords(record, context);
  if (!worked) return [];
  const plan: ReminderPlan = [];
  for (const { slot, past, words } of worked.slots) {
    // No line for this slot (or none without a name): it isn't scheduled.
    if (!words || past) continue;
    plan.push({
      id: slot.id,
      fireAt: new Date(slot.fireAtMs),
      // "Three Today · Mom", never the persona alone: it must not read as a real person's message.
      title: nagTitle(worked.persona),
      body: words.text,
      kind: NAG_KIND,
      // Ids and numbers only, never the words.
      data: { ...(words.taskId && !worked.hide ? { taskId: words.taskId } : {}), step: slot.step },
      interruptionLevel: "active" as const,
      // 1.6 G: Done only on a nag about a task (it ticks that one).
      categoryId: words.taskId && !worked.hide ? NAG_CATEGORY_ID : NAG_GENERAL_CATEGORY_ID,
    });
  }
  return plan;
}

/**
 * The record with each slot still to come noting the words it is scheduled
 * with when they are not its own (`sent`: a slot whose task was ticked off
 * or removed, an affectionate stored AI line, a rude line on a sensitive
 * day), and the note taken off again when it says its own words (the tick
 * was undone). Once that nag has gone off its `sent` is what it said, so a
 * day drawn again later (another level or window) doesn't say it twice.
 * `text` and `taskId` are never changed, so the day's own lines come back
 * when a tick is undone, and the scheduled nags never depend on `sent`: a
 * note written late can't change one. A slot that already went off is never
 * touched. Nothing while names were just hidden and the record hasn't been
 * planned again (planNagDay rewrites it); with names hidden the words put
 * in never name a task. The version is kept: the plan is the one already
 * scheduled. Null when there is nothing to write.
 */
export function nagRecordWithPlannedWords(record: NagDayRecord | null, context: NagPlanContext): NagDayRecord | null {
  const worked = nagSlotWords(record, context);
  if (!worked || worked.rewrite || !record) return null;
  let changed = false;
  const slots = worked.slots.map(({ slot, past, words }) => {
    if (past) return slot;
    const sent = words && words.text !== slot.text ? words.text : undefined;
    if (sent === slot.sent) return slot;
    changed = true;
    return sent === undefined ? unsent(slot) : { ...slot, sent };
  });
  return changed ? { ...record, slots } : null;
}

/**
 * The words of every slot of the day's record as nagPlanFromRecord works
 * them out (see there), in the record's order; `words` is null for a slot
 * with no line. Null when the record doesn't apply or nothing is open.
 */
function nagSlotWords(
  record: NagDayRecord | null,
  context: NagPlanContext,
): { persona: NagPersona; hide: boolean; rewrite: boolean; slots: { slot: NagSlot; past: boolean; words: NagWords | null }[] } | null {
  if (!nagRecordApplies(record, context)) return null;
  const open = nagOpenTasks(context.tasks);
  if (open.length === 0) return null;
  const openIds = new Set(open.map((task) => task.id));
  // 1.6 G: the tasks, with their words, the slots were written for. A slot
  // about a task whose words have changed since (edited, or given another
  // task's words) is stale until the day is planned again: it is treated as
  // a ticked task's, so a line never names a task as it no longer is.
  const known = new Set(record.tasksKey.split(",").filter(Boolean));
  const staleIds = new Set(open.filter((task) => !known.has(nagTaskKey(task))).map((task) => task.id));
  const hide = context.settings.hideTaskNames === true;
  const nowMs = context.now.getTime();
  // Written before names were hidden: nothing of what is still to come is
  // used, and the general lines go in as planNagDay will write them.
  const rewrite = hide && !record.hideNames;
  const sensitiveIds = new Set(open.filter((task) => nagTaskIsSensitive(task.text)).map((task) => task.id));
  const sensitiveDay = sensitiveIds.size > 0;
  const builtIn = (tasks: NagOpenTask[]) =>
    builtInNagLines({ persona: record.persona, level: record.level, tasks, count: record.total, seed: `${record.dayKey}|${record.salt}`, sensitiveDay });
  // The task a line put in here is about: never a sensitive one, and none
  // while names are hidden (the line is a general one then).
  const next = hide ? null : (open.find((task) => !sensitiveIds.has(task.id)) ?? null);
  const general = rewrite ? builtIn([]) : [];
  const forNext = rewrite ? [] : builtIn(next ? [next] : []);
  const ownTexts = open.map((task) => task.text);
  // Only an AI batch can hold such a line: no built-in line is affectionate.
  const affectionate = (slot: NagSlot) => record.source === "ai" && isAffectionateNagLine(slot.text, ownTexts);
  // Left from a record planned before sensitive tasks were kept out of the
  // built-in lines. An AI line about such a task is the proxy's to keep plain.
  const insensitive = (slot: NagSlot) =>
    (record.source === "local" && slot.taskId !== null && sensitiveIds.has(slot.taskId)) ||
    (sensitiveDay && record.persona === "drill" && NAG_DRILL_RUDE.test(slot.text));
  // 1.6 G: a task ticked or removed today (one the day was planned for, or a
  // ticked one on the list), by its distinctive words' hashes; a word an open
  // task has too doesn't count. A line of the AI's, general or not, that holds
  // one isn't said: it gets the stand-in a ticked task's slot gets.
  const closedWords = closedTaskWords(record, context, open, openIds);
  const holdsClosedWord = (text: string) => closedWords.size > 0 && nagLineWords(text).some((word) => closedWords.has(wordKey(word)));
  const aiTexts = new Set(record.source === "ai" ? record.lines.map((line) => line.text) : []);
  const aboutClosedTask = (slot: NagSlot) => aiTexts.has(slot.text) && holdsClosedWord(slot.text);
  // A nag that went off counts with the words it was scheduled with.
  const used = new Set<string>();
  for (const slot of record.slots) {
    const past = slot.fireAtMs <= nowMs;
    const text = past ? saidText(slot) : slot.text;
    if (text && (!rewrite || past)) used.add(text);
  }
  // 1.6 G: the user's own lines (nag-own-lines.ts) at their steps of the day.
  const own = ownLinesFor(record, context, open, { hide, sensitiveIds, next, holdsClosedWord });
  const snoozedUntil = typeof record.snoozedUntil === "number" ? record.snoozedUntil : -Infinity;
  let lastWasOwn = false;
  const slots: { slot: NagSlot; past: boolean; words: NagWords | null }[] = [];
  for (const slot of record.slots) {
    const past = slot.fireAtMs <= nowMs;
    // Snoozed (1.6 G): no nag before the snooze is over. snoozeNagRecord
    // takes such slots out; this only covers a record that missed that.
    if (!past && slot.fireAtMs < snoozedUntil) {
      slots.push({ slot, past, words: null });
      continue;
    }
    const ownStep = own.steps.get(slot.step);
    if (!past && ownStep !== undefined && !lastWasOwn) {
      const mine = own.pick(ownStep, slot, used);
      if (mine) {
        used.add(mine.text);
        lastWasOwn = true;
        slots.push({ slot, past, words: mine });
        continue;
      }
    }
    let words: NagWords | null = { text: slot.text, taskId: slot.taskId };
    if (past && slot.sent !== undefined) {
      // Went off with words put in for it: those are what it said.
      words = { text: slot.sent, taskId: null };
    } else if (rewrite) {
      // Gone off before names were hidden: left out, and not counted as said.
      if (past) continue;
      const line = unsaidLine(general, slot.step, record.total, used);
      words = line ? { text: line.text, taskId: null } : null;
    } else if (
      (slot.taskId !== null && (!openIds.has(slot.taskId) || staleIds.has(slot.taskId))) ||
      affectionate(slot) ||
      insensitive(slot) ||
      (!past && aboutClosedTask(slot))
    ) {
      const line = unsaidLine(forNext, slot.step, record.total, used);
      words = line ? { text: line.text, taskId: line.taskIndex === null || !next ? null : next.id } : null;
    }
    if (!words || !words.text) {
      slots.push({ slot, past, words: null });
      continue;
    }
    used.add(words.text);
    // A nag that went off at one of the own steps counts as one of the
    // user's lines (marked when planned, so it doesn't wait on a write-back),
    // and the next own line waits a nag.
    lastWasOwn = past && ownStep !== undefined;
    slots.push({ slot, past, words });
  }
  return { persona: record.persona, hide, rewrite, slots };
}

/**
 * 1.6 G: the user's own lines for the day's record (Settings,
 * `nagOwnLines`): the steps that say one (nagOwnSteps: at most one nag in
 * three, never two in a row; the same steps on every sync), and `pick`, the
 * line for one of those steps. The k-th own step starts at the k-th line and
 * takes the first not said yet today, so each line is said once a day at
 * most and a sync later in the day gives the same answer.
 *
 * Which lines can be used: one with `{task}` only while names are shown,
 * about the slot's own task when it is still open and not sensitive, else
 * the next open task that isn't; with "Hide task names" on, a line without
 * it unless it holds an open task's words (nagOwnLineHoldsTask). Not checked
 * against the voices' blocklists: they are the user's own words.
 */
function ownLinesFor(
  record: NagDayRecord,
  context: NagPlanContext,
  open: NagOpenTask[],
  {
    hide,
    sensitiveIds,
    next,
    holdsClosedWord,
  }: { hide: boolean; sensitiveIds: ReadonlySet<string>; next: NagOpenTask | null; holdsClosedWord: (text: string) => boolean },
): { steps: Map<number, number>; pick: (ordinal: number, slot: NagSlot, used: ReadonlySet<string>) => NagWords | null } {
  const saved = Array.isArray(context.settings.nagOwnLines) ? context.settings.nagOwnLines : [];
  const openTexts = open.map((task) => task.text);
  const lines = saved.filter(
    (line) =>
      typeof line === "string" &&
      line !== "" &&
      (nagOwnLineNamesTask(line) ? !hide : !(hide && nagOwnLineHoldsTask(line, openTexts))) &&
      // 1.6 G: not a line about a task ticked or removed today ("Dentist, now!" once the dentist is done).
      !holdsClosedWord(line),
  );
  // The steps marked when the day was planned (NagSlot.own); a record planned
  // before they were marked works them out the same way.
  const marked = record.slots.filter((slot) => slot.own === true).map((slot) => slot.step);
  const ownSteps = marked.length > 0 ? marked : nagOwnSteps(record.total, MAX_NAG_OWN_LINES, `${record.dayKey}|${record.salt}`);
  const steps = new Map([...new Set(ownSteps)].sort((a, b) => a - b).map((step, ordinal) => [step, ordinal]));
  const pick = (ordinal: number, slot: NagSlot, used: ReadonlySet<string>): NagWords | null => {
    const ownTask = open.find((task) => task.id === slot.taskId && !sensitiveIds.has(task.id)) ?? next;
    for (let turn = 0; turn < lines.length; turn += 1) {
      const line = lines[(ordinal + turn) % lines.length];
      const named = nagOwnLineNamesTask(line);
      const text = fillNagOwnLine(line, named ? (ownTask?.text ?? null) : null);
      if (!text || used.has(text)) continue;
      return { text, taskId: named && ownTask ? ownTask.id : null };
    }
    return null;
  };
  // No line to say: no step is an own one (so a past one doesn't hold the next nag back).
  return { steps: lines.length > 0 ? steps : new Map(), pick };
}

/**
 * 1.6 G: hashes of the distinctive words of the tasks ticked or removed
 * today: the ones the day was planned for (`taskWords`) that aren't open,
 * and the ticked ones on the list. A word an open task has too is left out.
 */
function closedTaskWords(record: NagDayRecord, context: NagPlanContext, open: NagOpenTask[], openIds: ReadonlySet<string>): Set<string> {
  const openWords = new Set(open.flatMap((task) => nagDistinctiveWords(task.text)).map(wordKey));
  const closed = new Set<string>();
  for (const [id, keys] of Object.entries(record.taskWords ?? {})) {
    if (!openIds.has(id)) for (const key of keys) if (!openWords.has(key)) closed.add(key);
  }
  for (const task of context.tasks) {
    if (!task.done || typeof task.text !== "string" || (task.id !== undefined && openIds.has(task.id))) continue;
    for (const word of nagDistinctiveWords(task.text)) if (!openWords.has(wordKey(word))) closed.add(wordKey(word));
  }
  return closed;
}
