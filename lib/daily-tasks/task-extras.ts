// Pure state transitions for brain-dump parking and task step checklists.
// Kept out of the React store so they're unit-tested directly.

import type { AppState, ParkedTask, Task, TaskStep } from "./types";
import { MAX_PARKED_TASKS, MAX_TASKS } from "./types";

const key = (text: string) => text.trim().toLowerCase();

function makeId(prefix: string, index: number, now: string): string {
  return `${prefix}_${Date.parse(now) || 0}_${index}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Park brain-dump leftovers. Skips blanks and anything already parked or on
 * today's list; keeps the newest MAX_PARKED_TASKS.
 */
export function parkTasks(state: AppState, texts: string[], now: string): AppState {
  const taken = new Set([
    ...state.parkedTasks.map((p) => key(p.text)),
    ...state.tasks.map((t) => key(t.text)),
  ]);
  const added: ParkedTask[] = [];
  texts.forEach((raw, index) => {
    const text = raw.trim();
    if (!text || taken.has(key(text))) return;
    taken.add(key(text));
    added.push({ id: makeId("parked", index, now), text, parkedAt: now });
  });
  if (added.length === 0) return state;
  const parkedTasks = [...state.parkedTasks, ...added].slice(-MAX_PARKED_TASKS);
  return { ...state, parkedTasks };
}

export function removeParkedTask(state: AppState, id: string): AppState {
  if (!state.parkedTasks.some((p) => p.id === id)) return state;
  return { ...state, parkedTasks: state.parkedTasks.filter((p) => p.id !== id) };
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
