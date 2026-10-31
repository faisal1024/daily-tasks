// Pure state transitions for brain-dump parking and task step checklists.
// Kept out of the React store so they're unit-tested directly.

import { isDateKey, isOverdue, localDayOf, normalizeWhen, parseLocalWhen } from "./resurface";
import { routinesDueToday } from "./routines";
import type { AppState, ParkedTask, Task, TaskStep, TaskWhen } from "./types";
import { MAX_PARKED_TASKS, MAX_TASKS } from "./types";

const key = (text: string) => text.trim().toLowerCase();
// Case- and space-insensitive, like the draft's and rollover's matching.
const looseKey = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

function makeId(prefix: string, index: number, now: string): string {
  return `${prefix}_${Date.parse(now) || 0}_${index}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface ParkOptions {
  /** The store's day (yyyy-MM-dd); else the local day of `now`. */
  today?: string;
  /**
   * Per item, in the order of `texts`: the day it was written (a capture
   * from the widget or share sheet, 1.6 E). Its words are read against that
   * day, and a date on that very day is kept: it was captured for it, not
   * set aside. Undefined entries are being saved today.
   */
  refDays?: (string | undefined)[];
  /**
   * `dates` are carried from a task going back to Saved for later (Not
   * today, swapped out), not read by the AI: an entry is used as it is,
   * never re-read from the words, and a missed deadline stays Overdue (and
   * isn't dropped by the same-day rule either).
   */
  carried?: boolean;
}

/**
 * Park brain-dump leftovers. Skips blanks and anything already parked or on
 * today's list; keeps the newest MAX_PARKED_TASKS.
 *
 * Each item keeps a soft date (1.6 F): the one in `dates` (the AI sort's,
 * or one carried from a task, keyed by looseKey of the text), else one read
 * from its own words (parseLocalWhen). Never one before today. And never
 * today itself for something set aside today (no refDay): left out of
 * today's picks, or "Not today", it isn't for today just because its words
 * say "today" or the AI read today's weekday.
 */
export function parkTasks(
  state: AppState,
  texts: string[],
  now: string,
  dates?: Record<string, TaskWhen>,
  options: ParkOptions = {},
): AppState {
  const today = isDateKey(options.today) ? options.today : localDayOf(now);
  const taken = new Set([
    ...state.parkedTasks.map((p) => key(p.text)),
    ...state.tasks.map((t) => key(t.text)),
  ]);
  const added: ParkedTask[] = [];
  texts.forEach((raw, index) => {
    const text = raw.trim();
    if (!text || taken.has(key(text))) return;
    taken.add(key(text));
    const parked: ParkedTask = { id: makeId("parked", index, now), text, parkedAt: now };
    const refDay = options.refDays?.[index];
    const written = isDateKey(refDay) && today && refDay <= today ? refDay : null;
    let when: TaskWhen | null = null;
    const carried = options.carried ? normalizeWhen(dates?.[looseKey(text)]) : null;
    if (today && carried) {
      // A carried date: kept while it's ahead, or a deadline still Overdue; a
      // plan set aside on its own day loses it (it was set aside).
      when = normalizeWhen(carried, today) ?? (isOverdue(carried, today) ? carried : null);
      if (when && when.kind === "on" && when.date === today) when = null;
    } else if (today) {
      // The AI's date, if it isn't before the day it's read against; else the words.
      const base = written ?? today;
      const read = normalizeWhen(dates?.[looseKey(text)], base) ?? parseLocalWhen(text, base);
      when = normalizeWhen(read, today);
      // A capture's deadline that passed before it was brought in still shows as Overdue.
      if (!when && written && read && isOverdue(read, today)) when = read;
      if (when && !written && when.date === today) when = null;
    }
    added.push(when ? { ...parked, when } : parked);
  });
  if (added.length === 0) return state;
  const parkedTasks = [...state.parkedTasks, ...added].slice(-MAX_PARKED_TASKS);
  return { ...state, parkedTasks };
}

/**
 * Take tasks that just landed on Today out of Saved for later, so the same
 * task isn't in both places (e.g. parked from last night's draft, then
 * carried in from yesterday's leftovers).
 */
export function unparkTexts(state: AppState, texts: string[]): AppState {
  if (texts.length === 0 || state.parkedTasks.length === 0) return state;
  const landed = new Set(texts.map(looseKey));
  const parkedTasks = state.parkedTasks.filter((p) => !landed.has(looseKey(p.text)));
  return parkedTasks.length === state.parkedTasks.length ? state : { ...state, parkedTasks };
}

export function removeParkedTask(state: AppState, id: string): AppState {
  if (!state.parkedTasks.some((p) => p.id === id)) return state;
  return { ...state, parkedTasks: state.parkedTasks.filter((p) => p.id !== id) };
}

/**
 * "Swap in" (1.5 D): a saved item takes an open task's place on a full,
 * unlocked day, in the same spot, and that task is saved for later instead.
 * Nothing changes on a locked day, for a done task, or for one already on
 * today under another id (the same words twice).
 */
export function swapParkedTask(
  state: AppState,
  input: { parkedId: string; taskId: string; now: string; newId: string; today?: string },
): AppState {
  if (state.todayLocked) return state;
  const parked = state.parkedTasks.find((p) => p.id === input.parkedId);
  const index = state.tasks.findIndex((task) => task.id === input.taskId);
  if (!parked || index < 0 || state.todayCompletions.includes(input.taskId)) return state;
  const text = parked.text.trim();
  const out = state.tasks[index];
  if (!text || state.tasks.some((task, i) => i !== index && key(task.text) === key(text))) return state;
  const tasks = state.tasks.slice();
  // Its date comes along (1.6 F), so it's still there if it's saved again.
  tasks[index] = { id: input.newId, text, createdAt: input.now, carriedOver: false, ...(parked.when ? { when: parked.when } : {}) };
  const swapped = { ...removeParkedTask(state, parked.id), tasks };
  // The task that left is saved for later (parkTasks skips what's still on today).
  return parkTasks(swapped, [out.text], input.now, taskDates(out), { today: input.today, carried: true });
}

/**
 * "Swap" on a routine (1.6.1): on a full, unlocked day a routine due today
 * takes an open task's place, in the same spot, and that task is saved for
 * later, the same as a saved item's "Swap in". Nothing changes on a locked
 * day, for a done task, or for a routine that isn't due or is already on today.
 */
export function swapRoutineIntoToday(
  state: AppState,
  input: { routineId: string; taskId: string; now: string; newId: string; today: string },
): AppState {
  if (state.todayLocked) return state;
  const index = state.tasks.findIndex((task) => task.id === input.taskId);
  if (index < 0 || state.todayCompletions.includes(input.taskId)) return state;
  const routine = routinesDueToday(state.routines, state.tasks, input.today).find((r) => r.id === input.routineId);
  const text = routine?.text.trim();
  if (!routine || !text) return state;
  const out = state.tasks[index];
  const tasks = state.tasks.slice();
  tasks[index] = { id: input.newId, text, createdAt: input.now, carriedOver: false, routineId: routine.id };
  // The task that left is saved for later, with its date (1.6 F).
  return parkTasks({ ...state, tasks }, [out.text], input.now, taskDates(out), { today: input.today, carried: true });
}

/** A task's carried date (1.6 F) in parkTasks' `dates` form, if it has one. */
export function taskDates(task: Task): Record<string, TaskWhen> | undefined {
  return task.when ? { [looseKey(task.text)]: task.when } : undefined;
}

/** A saved item's date changed by hand ("Change day"), or cleared with null. */
export function setParkedWhen(state: AppState, id: string, when: TaskWhen | null): AppState {
  const item = state.parkedTasks.find((p) => p.id === id);
  if (!item) return state;
  const next = when ? normalizeWhen(when) : null;
  if ((next?.date ?? null) === (item.when?.date ?? null) && (next?.kind ?? null) === (item.when?.kind ?? null)) return state;
  const parkedTasks = state.parkedTasks.map((p) => {
    if (p.id !== id) return p;
    const { when: _old, ...rest } = p;
    return next ? { ...rest, when: next } : rest;
  });
  return { ...state, parkedTasks };
}

/** Whether a parked item can move onto today's list right now. */
export function canTakeParkedTask(state: AppState): boolean {
  return !state.todayLocked && state.tasks.length < MAX_TASKS;
}

function updateTask(state: AppState, taskId: string, update: (task: Task) => Task): AppState {
  let changed = false;
  const tasks = state.tasks.map((task) => {
    if (task.id !== taskId) return task;
    const next = update(task);
    changed = changed || next !== task;
    return next;
  });
  return changed ? { ...state, tasks } : state;
}

/**
 * Replace a task's step checklist (at most 5 non-empty, de-duplicated steps).
 * With `forText`, only applies if the task still has that text: a slow AI
 * response mustn't attach steps written for wording the user has since edited.
 */
export function setTaskSteps(
  state: AppState,
  taskId: string,
  texts: string[],
  now: string,
  forText?: string,
): AppState {
  if (forText !== undefined) {
    const task = state.tasks.find((t) => t.id === taskId);
    if (!task || task.text !== forText) return state;
  }
  const seen = new Set<string>();
  const steps: TaskStep[] = [];
  texts.forEach((raw, index) => {
    const text = raw.trim();
    if (!text || seen.has(key(text)) || steps.length >= 5) return;
    seen.add(key(text));
    steps.push({ id: makeId("step", index, now), text, done: false });
  });
  if (steps.length === 0) return state;
  return updateTask(state, taskId, (task) => ({ ...task, steps }));
}

export function toggleTaskStep(state: AppState, taskId: string, stepId: string): AppState {
  return updateTask(state, taskId, (task) => {
    if (!task.steps?.some((s) => s.id === stepId)) return task;
    return {
      ...task,
      steps: task.steps.map((s) => (s.id === stepId ? { ...s, done: !s.done } : s)),
    };
  });
}

export function clearTaskSteps(state: AppState, taskId: string): AppState {
  return updateTask(state, taskId, (task) => {
    if (!task.steps) return task;
    const { steps: _removed, ...rest } = task;
    return rest;
  });
}
