// What the home/lock-screen widget shows, and how taps made in the widget come
// back into the app. Pure functions; the native bridge is widget-bridge.ts and
// the Swift side is targets/widget/Shared.swift (keep the shapes in sync).

import type { AppState, TaskId } from "./types";

export interface WidgetTask {
  id: string;
  text: string;
  done: boolean;
}

export interface WidgetSnapshot {
  /** Local day (yyyy-MM-dd) the tasks belong to; the widget ignores other days. */
  date: string;
  tasks: WidgetTask[];
  streak: number;
  /** Plus users can tick tasks off from the widget. */
  plus: boolean;
  /** "Day N": days the user has shown up, including today (same as the Today header). */
  day: number;
}

/** One tick/untick made in the widget, queued for the app. */
export interface WidgetToggle {
  seq: number;
  id: TaskId;
  date: string;
  done: boolean;
  /** "live_activity" for Done on the Live Activity (1.3); absent for a widget tap. */
  source?: string;
}

export function buildWidgetSnapshot(input: {
  state: Pick<AppState, "tasks" | "todayCompletions">;
  today: string;
  streak: number;
  plus: boolean;
  day: number;
}): WidgetSnapshot {
  const done = new Set(input.state.todayCompletions);
  return {
    date: input.today,
    tasks: input.state.tasks.map((task) => ({ id: task.id, text: task.text, done: done.has(task.id) })),
    streak: Math.max(0, Math.floor(input.streak)),
    plus: input.plus,
    day: Math.max(1, Math.floor(input.day)),
  };
}

/**
 * Parse the widget's queue (a JSON string) and keep only toggles newer than
 * `processedSeq`, in order. Anything malformed is ignored.
 */
export function parseWidgetToggles(raw: string | null, processedSeq: number): WidgetToggle[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is WidgetToggle =>
        Boolean(item) &&
        typeof item === "object" &&
        Number.isInteger((item as WidgetToggle).seq) &&
        typeof (item as WidgetToggle).id === "string" &&
        typeof (item as WidgetToggle).date === "string" &&
        typeof (item as WidgetToggle).done === "boolean",
    )
    .filter((item) => item.seq > processedSeq)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Which of today's tasks need their completion flipped so the app matches the
 * widget. Only today's toggles for tasks that still exist count; for several
 * toggles of one task the last wins. Returns ids whose state differs.
 */
export function tasksToFlip(
  state: Pick<AppState, "tasks" | "todayCompletions">,
  toggles: WidgetToggle[],
  today: string,
): TaskId[] {
  const wanted = new Map<TaskId, boolean>();
  for (const toggle of toggles) {
    if (toggle.date !== today) continue;
    if (!state.tasks.some((task) => task.id === toggle.id)) continue;
    wanted.set(toggle.id, toggle.done);
  }
  const done = new Set(state.todayCompletions);
  return [...wanted.entries()].filter(([id, want]) => done.has(id) !== want).map(([id]) => id);
}

/** Highest sequence number in the queue (to record as processed). */
export function lastSeq(toggles: WidgetToggle[], processedSeq: number): number {
  return toggles.reduce((max, toggle) => Math.max(max, toggle.seq), processedSeq);
}
