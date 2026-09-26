// Pure state transitions for brain-dump parking and task step checklists.
import { describe, expect, it } from "vitest";

import { buildInitialState } from "../lib/daily-tasks/storage";
import {
  canTakeParkedTask,
  clearTaskSteps,
  parkTasks,
  removeParkedTask,
  setTaskSteps,
  toggleTaskStep,
} from "../lib/daily-tasks/task-extras";
import type { AppState, ParkedTask, Task } from "../lib/daily-tasks/types";
import { MAX_PARKED_TASKS } from "../lib/daily-tasks/types";

const NOW = "2026-09-26T12:00:00.000Z";

const task = (id: string, text: string, extra: Partial<Task> = {}): Task => ({
  id,
  text,
  createdAt: "",
  carriedOver: false,
  ...extra,
});
const parked = (id: string, text: string): ParkedTask => ({ id, text, parkedAt: "2026-09-25T08:00:00.000Z" });

function state(overrides: Partial<AppState> = {}): AppState {
  return { ...buildInitialState(new Date(2026, 8, 26)), ...overrides };
}

describe("parkTasks", () => {
  it("parks trimmed texts with ids and the time they were parked", () => {
    const next = parkTasks(state(), ["  Buy shoes ", "Water plants"], NOW);
    expect(next.parkedTasks.map((p) => p.text)).toEqual(["Buy shoes", "Water plants"]);
    for (const p of next.parkedTasks) {
      expect(p.parkedAt).toBe(NOW);
      expect(p.id).toMatch(/^parked_/);
    }
    expect(new Set(next.parkedTasks.map((p) => p.id)).size).toBe(2);
  });

  it("skips blanks, duplicates in the batch, already-parked items and today's tasks (case-insensitive)", () => {
    const start = state({
      tasks: [task("t1", "Call mum")],
      parkedTasks: [parked("p1", "Buy shoes")],
    });
    const next = parkTasks(start, ["", "   ", "call MUM", " buy shoes", "Walk", "walk ", "Swim"], NOW);
    expect(next.parkedTasks.map((p) => p.text)).toEqual(["Buy shoes", "Walk", "Swim"]);
    expect(next.parkedTasks[0]).toBe(start.parkedTasks[0]);
  });

  it("returns the same state object when nothing new is parked", () => {
    const start = state({ parkedTasks: [parked("p1", "Walk")] });
    expect(parkTasks(start, [], NOW)).toBe(start);
    expect(parkTasks(start, ["walk", "  "], NOW)).toBe(start);
  });

  it("keeps only the newest MAX_PARKED_TASKS, dropping the oldest", () => {
    const existing = Array.from({ length: MAX_PARKED_TASKS }, (_, i) => parked(`p${i}`, `old ${i}`));
    const next = parkTasks(state({ parkedTasks: existing }), ["new a", "new b"], NOW);
    expect(next.parkedTasks).toHaveLength(MAX_PARKED_TASKS);
    expect(next.parkedTasks[0].text).toBe("old 2");
    expect(next.parkedTasks.slice(-2).map((p) => p.text)).toEqual(["new a", "new b"]);
    expect(MAX_PARKED_TASKS).toBe(20);
  });

  it("doesn't touch anything else in state", () => {
    const start = state({ tasks: [task("t1", "A")] });
    const next = parkTasks(start, ["B"], NOW);
    expect(next.tasks).toBe(start.tasks);
    expect(next.history).toBe(start.history);
  });
});

describe("removeParkedTask", () => {
  it("removes by id and leaves the rest in order", () => {
    const start = state({ parkedTasks: [parked("a", "A"), parked("b", "B"), parked("c", "C")] });
    expect(removeParkedTask(start, "b").parkedTasks.map((p) => p.id)).toEqual(["a", "c"]);
  });

  it("returns the same state for an unknown id", () => {
    const start = state({ parkedTasks: [parked("a", "A")] });
    expect(removeParkedTask(start, "zzz")).toBe(start);
  });
});

describe("canTakeParkedTask", () => {
  it("only while unlocked with a free slot", () => {
    expect(canTakeParkedTask(state())).toBe(true);
    expect(canTakeParkedTask(state({ tasks: [task("1", "a"), task("2", "b")] }))).toBe(true);
    expect(canTakeParkedTask(state({ tasks: [task("1", "a"), task("2", "b"), task("3", "c")] }))).toBe(
      false,
    );
    expect(canTakeParkedTask(state({ todayLocked: true }))).toBe(false);
  });
});

describe("setTaskSteps", () => {
  const start = () => state({ tasks: [task("t1", "Clean kitchen"), task("t2", "Walk")] });

  it("sets up to five trimmed, de-duplicated, unchecked steps on that task only", () => {
    const s = start();
    const next = setTaskSteps(
      s,
      "t1",
      [" Clear counter ", "", "clear COUNTER", "Load dishwasher", "Wipe", "Sweep", "Mop", "Bins"],
      NOW,
    );
    const steps = next.tasks[0].steps ?? [];
    expect(steps.map((st) => st.text)).toEqual(["Clear counter", "Load dishwasher", "Wipe", "Sweep", "Mop"]);
    expect(steps.every((st) => st.done === false)).toBe(true);
    expect(new Set(steps.map((st) => st.id)).size).toBe(5);
    expect(next.tasks[1]).toBe(s.tasks[1]);
  });

  it("replaces existing steps (and their done state)", () => {
    const once = setTaskSteps(start(), "t1", ["a", "b"], NOW);
    const toggled = toggleTaskStep(once, "t1", once.tasks[0].steps![0].id);
    const again = setTaskSteps(toggled, "t1", ["c", "d", "e"], NOW);
    expect(again.tasks[0].steps?.map((s) => [s.text, s.done])).toEqual([
      ["c", false],
      ["d", false],
      ["e", false],
    ]);
  });

  it("is a no-op for no usable steps or an unknown task", () => {
    const s = start();
    expect(setTaskSteps(s, "t1", [], NOW)).toBe(s);
    expect(setTaskSteps(s, "t1", ["  ", ""], NOW)).toBe(s);
    expect(setTaskSteps(s, "nope", ["a", "b"], NOW)).toBe(s);
  });
});

describe("toggleTaskStep / clearTaskSteps", () => {
  const withSteps = () =>
    setTaskSteps(state({ tasks: [task("t1", "Clean"), task("t2", "Walk")] }), "t1", ["a", "b", "c"], NOW);

  it("toggles only the chosen step, back and forth", () => {
    const s = withSteps();
    const [a, b] = s.tasks[0].steps!;
    const on = toggleTaskStep(s, "t1", b.id);
    expect(on.tasks[0].steps!.map((st) => st.done)).toEqual([false, true, false]);
    const off = toggleTaskStep(on, "t1", b.id);
    expect(off.tasks[0].steps!.map((st) => st.done)).toEqual([false, false, false]);
    expect(on.tasks[0].steps![0]).toBe(a);
  });

  it("returns the same state for an unknown step, unknown task, or a task without steps", () => {
    const s = withSteps();
    const stepId = s.tasks[0].steps![0].id;
    expect(toggleTaskStep(s, "t1", "missing")).toBe(s);
    expect(toggleTaskStep(s, "nope", stepId)).toBe(s);
    expect(toggleTaskStep(s, "t2", stepId)).toBe(s);
  });

  it("doesn't change the task's own completion", () => {
    const s = withSteps();
    let next = s;
    for (const st of s.tasks[0].steps!) next = toggleTaskStep(next, "t1", st.id);
    expect(next.todayCompletions).toEqual(s.todayCompletions);
  });

  it("clears steps by removing the key entirely", () => {
    const s = withSteps();
    const cleared = clearTaskSteps(s, "t1");
    expect(cleared.tasks[0]).not.toHaveProperty("steps");
    expect(cleared.tasks[0]).toEqual(task("t1", "Clean"));
    expect(clearTaskSteps(cleared, "t1")).toBe(cleared);
    expect(clearTaskSteps(s, "nope")).toBe(s);
  });
});
