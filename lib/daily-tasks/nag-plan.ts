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

import { fromDateKey, toDateKey } from "./date";
import {
  builtInNagLines,
  NAG_LEVELS,
  NAG_PERSONA_LABELS,
  NAG_PERSONAS,
  seededRandom,
  type NagLevel,
  type NagLine,
  type NagPersona,
} from "./nag";
import type { ReminderContext, ReminderPlan } from "./reminder-plan";
import { NAG_CATEGORY_ID, NAG_KIND } from "./reminders";
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
export { NAG_CATEGORY_ID, NAG_KIND };

/** Nags a day, by level. */
export const NAG_LEVEL_COUNTS: Record<NagLevel, number> = { gentle: 4, firm: 7, relentless: 11 };
/** No two nags are ever closer than this. */
export const NAG_MIN_GAP_MINUTES = 60;
/** The first nag planned is at least this long after the planning. */
export const NAG_FIRST_DELAY_MINUTES = 20;
/** AI requests for lines per day: the day's batch, and one more if the tasks, persona or level change. */
export const MAX_NAG_AI_CALLS_PER_DAY = 2;

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
 */
export function planNagTimes({ dayKey, salt, window, now, count, notBefore = null, draw = 0 }: NagTimesInput): number[] {
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
  return times;
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

/** The open tasks' words as a short key (hashes, not the words). */
export function nagTasksKey(open: NagOpenTask[]): string {
  return [...new Set(open.map((task) => textKey(task.text)))].sort().join(",");
}

/**
 * The open tasks changed in a way the lines can't cover: one of them has
 * words that weren't there when `key` was made (added or reworded). A task
 * ticked off or removed isn't that; its nags are pointed at another task.
 */
export function nagTasksChanged(key: string, open: NagOpenTask[]): boolean {
  const known = new Set(key.split(",").filter(Boolean));
  return open.some((task) => !known.has(textKey(task.text)));
}

/**
 * Which of `lines` the nag at `step` (1-based) of `total` says. With enough
 * lines the last nag takes the last line (a day planned late starts with
 * later lines). With fewer lines than nags the lines are spread over the day
 * and the nags left over get none (null).
 */
export function lineForStep<T>(lines: readonly T[], step: number, total: number): T | null {
  const count = lines.length;
  if (count === 0 || step < 1 || step > total) return null;
  if (count >= total) return lines[step - 1 + (count - total)] ?? null;
  const index = Math.floor(((step - 1) * count) / total);
  if (step > 1 && Math.floor(((step - 2) * count) / total) === index) return null;
  return lines[index] ?? null;
}

export interface NagWords {
  text: string;
  taskId: string | null;
}

/**
 * A built-in line for the nag at `step` of `total`, about `tasks` (none: a
 * general line). The same inputs always give the same line, so the scheduler
 * sees an unchanged reminder on every sync.
 */
export function localNagWords(input: {
  persona: NagPersona;
  level: NagLevel;
  dayKey: string;
  salt: string;
  step: number;
  total: number;
  tasks: NagOpenTask[];
}): NagWords | null {
  const { persona, level, dayKey, salt, step, total, tasks } = input;
  const lines = builtInNagLines({ persona, level, tasks, count: total, seed: `${dayKey}|${salt}` });
  const line = lineForStep(lines, step, total);
  if (!line) return null;
  return { text: line.text, taskId: line.taskIndex === null ? null : (tasks[line.taskIndex]?.id ?? null) };
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
  text: string;
  /** The task it names; null for a line about the list in general. */
  taskId: string | null;
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
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function asNagLine(value: unknown): NagLine | null {
  if (!value || typeof value !== "object") return null;
  const { step, taskIndex, text } = value as Record<string, unknown>;
  if (typeof step !== "number" || !Number.isFinite(step) || typeof text !== "string" || !text) return null;
  if (taskIndex !== null && !(typeof taskIndex === "number" && Number.isInteger(taskIndex) && taskIndex >= 0)) return null;
  return { step, taskIndex: taskIndex as number | null, text };
}

function asNagSlot(value: unknown): NagSlot | null {
  if (!value || typeof value !== "object") return null;
  const { id, fireAtMs, step, text, taskId } = value as Record<string, unknown>;
  if (typeof id !== "string" || !id.startsWith("daily-tasks:")) return null;
  if (typeof fireAtMs !== "number" || !Number.isFinite(fireAtMs) || fireAtMs <= 0) return null;
  if (typeof step !== "number" || !Number.isInteger(step) || step < 1 || typeof text !== "string" || !text) return null;
  return { id, fireAtMs, step, text, taskId: typeof taskId === "string" && taskId ? taskId : null };
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
    hideNames: raw.hideNames === true,
    aiFetchedAt: typeof raw.aiFetchedAt === "number" && Number.isFinite(raw.aiFetchedAt) ? raw.aiFetchedAt : null,
    aiCalls: count(raw.aiCalls),
    aiFor: typeof raw.aiFor === "string" ? raw.aiFor : null,
    version: count(raw.version),
  };
}

export function nagTimingKey(level: NagLevel, window: NagWindow): string {
  return `${level}|${window.startMinutes}-${window.endMinutes}`;
}

/** What the AI is asked about: persona, level and the open tasks. */
export function nagAiKey(persona: NagPersona, level: NagLevel, open: NagOpenTask[]): string {
  return `${persona}|${level}|${nagTasksKey(open)}`;
}

/** The AI's lines in `record` still fit: same persona, level and no task they don't know. */
function aiLinesFit(record: NagDayRecord, persona: NagPersona, level: NagLevel, open: NagOpenTask[]): boolean {
  if (record.source !== "ai" || record.aiFor === null || record.lines.length === 0) return false;
  const [forPersona, forLevel, forTasks = ""] = record.aiFor.split("|");
  return forPersona === persona && forLevel === level && !nagTasksChanged(forTasks, open);
}

/** The future slots of `slots` with the lines of a batch written in; a slot the batch has no line for keeps its words. */
function withLines(
  slots: NagSlot[],
  { lines, lineTasks, total, nowMs }: { lines: NagLine[]; lineTasks: string[]; total: number; nowMs: number },
): NagSlot[] {
  return slots.map((slot) => {
    if (slot.fireAtMs <= nowMs) return slot;
    const line = lineForStep(lines, slot.step, total);
    if (!line) return slot;
    return { ...slot, text: line.text, taskId: line.taskIndex === null ? null : (lineTasks[line.taskIndex] ?? null) };
  });
}

export interface NagDayInput {
  /** The record as saved (any day's), or null. */
  previous: NagDayRecord | null;
  now: Date;
  dayKey: string;
  settings: Pick<NotificationConfig, "nagPersona" | "nagLevel" | "nagWindow" | "hideTaskNames">;
  open: NagOpenTask[];
  /** Used when there is no earlier record to take the salt from. */
  salt: string;
}

/**
 * The day's record, planned without the AI. Slots that already went off stay
 * as history. With the same level and window the future slots keep their
 * times (only their words are written again); otherwise the rest of the day
 * is drawn again, never under an hour after the last one that went off (or
 * yesterday's last). Built-in lines fill the slots; the AI's lines from
 * earlier today are put back when they still fit.
 */
export function planNagDay({ previous, now, dayKey, settings, open, salt: freshSalt }: NagDayInput): NagDayRecord {
  const { nagPersona: persona, nagLevel: level, nagWindow: window } = settings;
  const hideNames = settings.hideTaskNames === true;
  const nowMs = now.getTime();
  const salt = previous?.salt ?? freshSalt;
  const sameDay = previous?.dayKey === dayKey;
  const timingKey = nagTimingKey(level, window);
  const past = sameDay ? previous.slots.filter((slot) => slot.fireAtMs <= nowMs) : [];

  let future: NagSlot[];
  let total: number;
  let draws: number;
  if (sameDay && previous.timingKey === timingKey) {
    future = previous.slots.filter((slot) => slot.fireAtMs > nowMs);
    total = previous.total;
    draws = previous.draws;
  } else {
    const before = sameDay ? past : (previous?.slots ?? []);
    const last = before.reduce((latest, slot) => Math.max(latest, slot.fireAtMs), -Infinity);
    draws = sameDay ? previous.draws + 1 : 0;
    const times = planNagTimes({
      dayKey,
      salt,
      window,
      now,
      count: NAG_LEVEL_COUNTS[level] - past.length,
      notBefore: Number.isFinite(last) ? last + GAP_MS : null,
      draw: draws,
    });
    total = past.length + times.length;
    future = times.map((fireAtMs, index) => ({
      id: nagSlotId(new Date(fireAtMs)),
      fireAtMs,
      step: past.length + index + 1,
      text: "",
      taskId: null,
    }));
  }

  const tasks = hideNames ? [] : open;
  const lines = builtInNagLines({ persona, level, tasks, count: total, seed: `${dayKey}|${salt}` });
  let slots = future.flatMap((slot) => {
    const line = lineForStep(lines, slot.step, total);
    if (!line) return [];
    return [{ ...slot, text: line.text, taskId: line.taskIndex === null ? null : (tasks[line.taskIndex]?.id ?? null) }];
  });

  const keepAi = sameDay && !hideNames && aiLinesFit(previous, persona, level, open);
  if (keepAi) slots = withLines(slots, { lines: previous.lines, lineTasks: previous.lineTasks, total, nowMs });

  return {
    dayKey,
    persona,
    level,
    salt,
    tasksKey: nagTasksKey(open),
    lines: keepAi ? previous.lines : lines,
    lineTasks: keepAi ? previous.lineTasks : tasks.map((task) => task.id),
    source: keepAi ? "ai" : "local",
    slots: [...past, ...slots],
    total,
    timingKey,
    draws,
    hideNames,
    aiFetchedAt: sameDay ? previous.aiFetchedAt : null,
    aiCalls: sameDay ? previous.aiCalls : 0,
    aiFor: sameDay ? previous.aiFor : null,
    version: (previous?.version ?? 0) + 1,
  };
}

/**
 * Whether the day has to be planned again: a new day, another persona, level
 * or window, names hidden or shown, or a task the slots don't know.
 */
export function nagDayNeedsPlan(previous: NagDayRecord | null, input: Omit<NagDayInput, "previous" | "now" | "salt">): boolean {
  if (!previous || previous.dayKey !== input.dayKey) return true;
  const { nagPersona, nagLevel, nagWindow, hideTaskNames } = input.settings;
  return (
    previous.persona !== nagPersona ||
    previous.level !== nagLevel ||
    previous.timingKey !== nagTimingKey(nagLevel, nagWindow) ||
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
    slots: withLines(record.slots, { lines, lineTasks, total: record.total, nowMs: now.getTime() }),
    version: record.version + 1,
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export type NagPlanContext = Pick<ReminderContext, "now" | "today" | "settings" | "permissionState" | "tasks" | "plus">;

/**
 * The day's record is the one to plan from: nag mode applies, it isn't
 * paused today, and the record is for the store's day, which is the clock's.
 */
export function nagRecordApplies(record: NagDayRecord | null, context: NagPlanContext): record is NagDayRecord {
  const { settings, today, now } = context;
  if (!nagModeOn(settings, context.plus === true, context.permissionState)) return false;
  if (settings.nagPausedDate === today) return false;
  return record !== null && record.dayKey === today && today === toDateKey(now);
}

/**
 * The nags to have pending, from the day's record: its future slots with the
 * same id, time and words, so the scheduler leaves them alone. A slot whose
 * task is done or gone is pointed at the next open task with a built-in line
 * for the same step. Nothing when nag mode doesn't apply, it is paused today,
 * the record is another day's, or nothing is open. Never time-sensitive: a
 * nag does not break through a Focus.
 */
export function nagPlanFromRecord(record: NagDayRecord | null, context: NagPlanContext): ReminderPlan {
  if (!nagRecordApplies(record, context)) return [];
  const open = nagOpenTasks(context.tasks);
  if (open.length === 0) return [];
  const openIds = new Set(open.map((task) => task.id));
  const hide = context.settings.hideTaskNames === true;
  const nowMs = context.now.getTime();
  const local = (step: number, tasks: NagOpenTask[]) =>
    localNagWords({ persona: record.persona, level: record.level, dayKey: record.dayKey, salt: record.salt, step, total: record.total, tasks });
  return record.slots.flatMap((slot) => {
    if (slot.fireAtMs <= nowMs) return [];
    let words: NagWords | null = { text: slot.text, taskId: slot.taskId };
    if (hide && !record.hideNames) {
      // Written before names were hidden: nothing of it is used.
      words = local(slot.step, []);
    } else if (slot.taskId !== null && !openIds.has(slot.taskId)) {
      words = local(slot.step, [open[0]]);
    }
    if (!words) return [];
    return [
      {
        id: slot.id,
        fireAt: new Date(slot.fireAtMs),
        title: NAG_PERSONA_LABELS[record.persona],
        body: words.text,
        kind: NAG_KIND,
        // Ids and numbers only, never the words.
        data: { ...(words.taskId && !hide ? { taskId: words.taskId } : {}), step: slot.step },
        interruptionLevel: "active" as const,
        categoryId: NAG_CATEGORY_ID,
      },
    ];
  });
}
