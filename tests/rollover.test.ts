import { describe, expect, it } from "vitest";

import { applyRollover, syncTodayHistory } from "../lib/daily-tasks/rollover";
import type { AppState } from "../lib/daily-tasks/types";
import { DEFAULT_NOTIFICATIONS } from "../lib/daily-tasks/types";

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    tasks: [
      { id: "a", text: "A", createdAt: "x", carriedOver: false },
      { id: "b", text: "B", createdAt: "x", carriedOver: false },
      { id: "c", text: "C", createdAt: "x", carriedOver: false },
    ],
    todayCompletions: ["a"],
    lastOpenedDate: "2026-04-17",
    history: { "2026-04-17": { date: "2026-04-17", total: 3, completed: 1 } },
    notifications: DEFAULT_NOTIFICATIONS,
    ...overrides,
  };
}

describe("applyRollover", () => {
  it("is a no-op when the day hasn't changed", () => {
    const state = makeState();
    expect(applyRollover(state, "2026-04-17")).toBe(state);
  });

  it("marks uncompleted tasks as carriedOver and resets completions", () => {
    const state = makeState();
    const next = applyRollover(state, "2026-04-18");

    const a = next.tasks.find((t) => t.id === "a")!;
    const b = next.tasks.find((t) => t.id === "b")!;
    expect(a.carriedOver).toBe(false);
    expect(b.carriedOver).toBe(true);
    expect(next.todayCompletions).toEqual([]);
    expect(next.lastOpenedDate).toBe("2026-04-18");
  });

  it("preserves yesterday's history record", () => {
    const next = applyRollover(makeState(), "2026-04-18");
    expect(next.history["2026-04-17"]).toEqual({
      date: "2026-04-17",
      total: 3,
      completed: 1,
    });
  });

  it("clears prior carryover flag for tasks that were completed yesterday", () => {
    const state = makeState({
      tasks: [{ id: "a", text: "A", createdAt: "x", carriedOver: true }],
      todayCompletions: ["a"],
    });
    const next = applyRollover(state, "2026-04-18");
    expect(next.tasks[0].carriedOver).toBe(false);
  });
});

describe("syncTodayHistory", () => {
  it("creates today's record reflecting current tasks/completions", () => {
    const state = makeState({
      todayCompletions: ["a", "b"],
      history: {},
      lastOpenedDate: "2026-04-18",
    });
    const next = syncTodayHistory(state, "2026-04-18");
    expect(next.history["2026-04-18"]).toEqual({
      date: "2026-04-18",
      total: 3,
      completed: 2,
    });
  });

  it("returns the same state when nothing changed", () => {
    const state = makeState({
      todayCompletions: ["a"],
      history: { "2026-04-17": { date: "2026-04-17", total: 3, completed: 1 } },
    });
    expect(syncTodayHistory(state, "2026-04-17")).toBe(state);
  });

  it("ignores deleted tasks when counting completions", () => {
    const state = makeState({
      tasks: [{ id: "a", text: "A", createdAt: "x", carriedOver: false }],
      todayCompletions: ["a", "ghost"],
      history: {},
    });
    const next = syncTodayHistory(state, "2026-04-18");
    expect(next.history["2026-04-18"]).toEqual({
      date: "2026-04-18",
      total: 1,
      completed: 1,
    });
  });
});
