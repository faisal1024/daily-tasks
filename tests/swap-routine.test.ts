// 1.6.1 "Swap" on a routine: on a full, unlocked day a routine due today takes
// an open task's place, in the same spot, and that task is saved for later
// (with its date). Refused (same state object back) when locked, done, unknown,
// or the routine isn't due / is paused / is already on today.
import { describe, expect, it } from "vitest";

import { buildInitialState } from "../lib/daily-tasks/storage";
import { swapRoutineIntoToday } from "../lib/daily-tasks/task-extras";
import type { AppState, Routine, Task } from "../lib/daily-tasks/types";

// Thursday 1 Oct 2026 (local weekday 4), built from local parts.
const TODAY = "2026-10-01";
const NOW = new Date(2026, 9, 1, 12).toISOString();
const task = (id: string, text: string, extra: Partial<Task> = {}): Task => ({
  id,
  text,
  createdAt: "",
  carriedOver: false,
  ...extra,
});
const routine = (id: string, text: string, days: number[], paused = false): Routine => ({
  id,
  text,
  days,
  paused,
  createdAt: "",
});

function full(over: Partial<AppState> = {}): AppState {
  return {
    ...buildInitialState(new Date(2026, 9, 1, 8)),
    tasks: [task("a", "Alpha"), task("b", "Bravo"), task("c", "Charlie")],
    routines: [routine("r1", "  Stretch  ", [4])],
    parkedTasks: [],
    ...over,
  };
}
const swap = (state: AppState, routineId = "r1", taskId = "b") =>
  swapRoutineIntoToday(state, { routineId, taskId, now: NOW, newId: "new1", today: TODAY });

describe("swapRoutineIntoToday", () => {
  it("puts the routine in the same spot with its routineId and a new id; the task that left is saved for later with its date", () => {
    const when: Task["when"] = { kind: "on", date: "2026-10-05" };
    const start = full({ tasks: [task("a", "Alpha"), task("b", "Bravo", { when }), task("c", "Charlie")] });
    const next = swap(start);
    expect(next.tasks.map((t) => t.text)).toEqual(["Alpha", "Stretch", "Charlie"]);
    expect(next.tasks[1]).toMatchObject({ id: "new1", text: "Stretch", routineId: "r1", carriedOver: false, createdAt: NOW });
    expect(next.tasks[0]).toBe(start.tasks[0]);
    expect(next.tasks[2]).toBe(start.tasks[2]);
    expect(next.parkedTasks.map((p) => p.text)).toEqual(["Bravo"]);
    expect(next.parkedTasks[0].when).toEqual(when);
  });

  it("refuses on a locked day", () => {
    const state = full({ todayLocked: true, todayLockSource: "manual" });
    expect(swap(state)).toBe(state);
  });

  it("refuses to swap out a task that is done, or one that isn't on today", () => {
    const done = full({ todayCompletions: ["b"] });
    expect(swap(done)).toBe(done);
    const state = full();
    expect(swap(state, "r1", "nope")).toBe(state);
  });

  it.each([
    ["isn't due today", { routines: [routine("r1", "Stretch", [5])] }],
    ["is paused", { routines: [routine("r1", "Stretch", [4], true)] }],
    ["is already on today by routineId", { tasks: [task("a", "Alpha"), task("b", "Bravo"), task("c", "Stretch (short)", { routineId: "r1" })] }],
    ["has the same words as a task on today", { tasks: [task("a", "Alpha"), task("b", "Bravo"), task("c", " STRETCH ")] }],
  ])("refuses when the routine %s", (_label, over) => {
    const state = full(over as Partial<AppState>);
    expect(swap(state)).toBe(state);
  });

  it("refuses an unknown routine", () => {
    const state = full();
    expect(swap(state, "nope")).toBe(state);
  });
});
