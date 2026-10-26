// 1.5 D "Swap in": a saved item takes an open task's place on a full,
// unlocked day, in the same spot; the replaced task is saved for later.
// Refused (same state object back) when locked, done, a duplicate, or unknown.
import { describe, expect, it } from "vitest";

import { buildInitialState } from "../lib/daily-tasks/storage";
import { swapParkedTask } from "../lib/daily-tasks/task-extras";
import type { AppState, ParkedTask, Task } from "../lib/daily-tasks/types";
import { MAX_PARKED_TASKS } from "../lib/daily-tasks/types";

const NOW = "2026-10-26T12:00:00.000Z";
const task = (id: string, text: string): Task => ({ id, text, createdAt: "", carriedOver: false });
const parked = (id: string, text: string): ParkedTask => ({ id, text, parkedAt: "2026-10-25T08:00:00.000Z" });

function full(over: Partial<AppState> = {}): AppState {
  return {
    ...buildInitialState(new Date(2026, 9, 26)),
    tasks: [task("a", "Alpha"), task("b", "Bravo"), task("c", "Charlie")],
    parkedTasks: [parked("p1", "Zulu"), parked("p2", "Yankee")],
    ...over,
  };
}
const swap = (state: AppState, parkedId = "p1", taskId = "b") =>
  swapParkedTask(state, { parkedId, taskId, now: NOW, newId: "new1" });

describe("swapParkedTask", () => {
  it("puts the saved item in the same position with a new id, and saves the replaced task for later", () => {
    const start = full();
    const next = swap(start);
    expect(next.tasks.map((t) => t.text)).toEqual(["Alpha", "Zulu", "Charlie"]);
    expect(next.tasks[1]).toMatchObject({ id: "new1", text: "Zulu", createdAt: NOW, carriedOver: false });
    // The others are untouched (same objects).
    expect(next.tasks[0]).toBe(start.tasks[0]);
    expect(next.tasks[2]).toBe(start.tasks[2]);
    expect(next.parkedTasks.map((p) => p.text)).toEqual(["Yankee", "Bravo"]);
    expect(next.parkedTasks[1].parkedAt).toBe(NOW);
  });

  it("keeps the position for the first and the last slot too", () => {
    expect(swap(full(), "p1", "a").tasks.map((t) => t.text)).toEqual(["Zulu", "Bravo", "Charlie"]);
    expect(swap(full(), "p2", "c").tasks.map((t) => t.text)).toEqual(["Alpha", "Bravo", "Yankee"]);
  });

  it("leaves ticks on the other tasks alone", () => {
    const next = swap(full({ todayCompletions: ["a", "c"] }));
    expect(next.todayCompletions).toEqual(["a", "c"]);
  });

  it("refuses on a locked day", () => {
    const state = full({ todayLocked: true, todayLockSource: "manual" });
    expect(swap(state)).toBe(state);
  });

  it("refuses to swap out a task that is done", () => {
    const state = full({ todayCompletions: ["b"] });
    expect(swap(state)).toBe(state);
  });

  it("refuses when the saved item's words are already on today (case and spacing aside)", () => {
    const state = full({ parkedTasks: [parked("p1", "  charlie "), parked("p2", "Yankee")] });
    expect(swap(state)).toBe(state);
  });

  it("refuses an unknown saved item, an unknown task, and a blank saved item", () => {
    const state = full();
    expect(swap(state, "nope")).toBe(state);
    expect(swap(state, "p1", "nope")).toBe(state);
    const blank = full({ parkedTasks: [parked("p1", "   ")] });
    expect(swap(blank)).toBe(blank);
  });

  it("a second swap with the same (now gone) saved item changes nothing", () => {
    const once = swap(full());
    expect(swap(once, "p1", "c")).toBe(once);
  });

  it("when saved for later is full, the oldest is dropped, not the new arrival", () => {
    const many = Array.from({ length: MAX_PARKED_TASKS }, (_, i) => parked(`q${i}`, `old ${i}`));
    const state = full({ parkedTasks: [parked("p1", "Zulu"), ...many] });
    const next = swap(state);
    expect(next.parkedTasks.length).toBeLessThanOrEqual(MAX_PARKED_TASKS);
    expect(next.parkedTasks.map((p) => p.text)).toContain("Bravo");
    expect(next.parkedTasks.map((p) => p.text)).not.toContain("Zulu");
  });
});
