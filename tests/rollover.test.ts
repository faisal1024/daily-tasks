import { describe, expect, it } from "vitest";

import {
  applyRollover,
  resolvePendingRollover,
  syncTodayHistory,
} from "../lib/daily-tasks/rollover";
import { DEFAULT_JOURNEY } from "../lib/daily-tasks/journey";
import type { AppState } from "../lib/daily-tasks/types";
import {
  DEFAULT_AUTO_LOCK,
  DEFAULT_MOMENTUM_PROFILE,
  DEFAULT_MOMENTUM_SETTINGS,
  DEFAULT_NOTIFICATIONS,
} from "../lib/daily-tasks/types";

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    tasks: [
      { id: "a", text: "A", createdAt: "x", carriedOver: false },
      { id: "b", text: "B", createdAt: "x", carriedOver: false },
      { id: "c", text: "C", createdAt: "x", carriedOver: false },
    ],
    todayCompletions: ["a"],
    lastOpenedDate: "2026-04-17",
    todayLocked: false,
    todayLockSource: null,
    autoLockNoticeDate: null,
    pendingRollover: null,
    history: {},
    notifications: DEFAULT_NOTIFICATIONS,
    autoLock: DEFAULT_AUTO_LOCK,
    hasSeenOnboarding: true,
    todayReflection: null,
    todayReflectionResult: null,
    momentumProfile: DEFAULT_MOMENTUM_PROFILE,
    momentumPlan: null,
    momentumSettings: DEFAULT_MOMENTUM_SETTINGS,
    momentumPlanStatus: "idle",
    momentumPlanError: null,
    adaptationSnapshot: null,
    completedMilestoneIds: [],
    pendingMilestoneCelebration: null,
    journey: DEFAULT_JOURNEY,
    ...overrides,
  };
}

describe("applyRollover", () => {
  it("is a no-op when the day has not changed", () => {
    const state = makeState();
    expect(applyRollover(state, "2026-04-17")).toBe(state);
  });

  it("creates a pending rollover flow for unfinished tasks and starts today empty", () => {
    const next = applyRollover(makeState(), "2026-04-18");

    expect(next.lastOpenedDate).toBe("2026-04-18");
    expect(next.tasks).toEqual([]);
    expect(next.todayCompletions).toEqual([]);
    expect(next.pendingRollover?.sourceDate).toBe("2026-04-17");
    expect(next.pendingRollover?.tasks.map((task) => task.id)).toEqual(["b", "c"]);
    expect(next.history["2026-04-17"]?.tasks.find((task) => task.id === "b")?.rolloverOutcome).toBe(
      "unresolved",
    );
  });

  it("resets the new day to unlocked", () => {
    const next = applyRollover(
      makeState({ todayLocked: true, todayLockSource: "manual", autoLockNoticeDate: "2026-04-17" }),
      "2026-04-18",
    );

    expect(next.todayLocked).toBe(false);
    expect(next.todayLockSource).toBeNull();
    expect(next.autoLockNoticeDate).toBeNull();
  });

  it("preserves tasks already added for today while creating yesterday's rollover", () => {
    const next = applyRollover(
      makeState({
        tasks: [{ id: "today-1", text: "Already today", createdAt: "x", carriedOver: false }],
        todayCompletions: ["today-1"],
        history: {
          "2026-04-17": {
            date: "2026-04-17",
            total: 2,
            completed: 1,
            locked: true,
            lockSource: "auto",
            reflection: null,
            reflectionResult: null,
            tasks: [
              {
                id: "done-yesterday",
                text: "Done yesterday",
                completed: true,
                carriedOver: false,
                rolloverOutcome: null,
              },
              {
                id: "unfinished-yesterday",
                text: "Unfinished yesterday",
                completed: false,
                carriedOver: false,
                rolloverOutcome: null,
              },
            ],
          },
          "2026-04-18": {
            date: "2026-04-18",
            total: 1,
            completed: 1,
            locked: false,
            lockSource: null,
            reflection: null,
            reflectionResult: null,
            tasks: [
              {
                id: "today-1",
                text: "Already today",
                completed: true,
                carriedOver: false,
                rolloverOutcome: null,
              },
            ],
          },
        },
      }),
      "2026-04-18",
    );

    expect(next.tasks.map((task) => task.id)).toEqual(["today-1"]);
    expect(next.todayCompletions).toEqual(["today-1"]);
    expect(next.pendingRollover?.tasks.map((task) => task.id)).toEqual(["unfinished-yesterday"]);
    expect(
      next.history["2026-04-17"]?.tasks.find((task) => task.id === "unfinished-yesterday")
        ?.rolloverOutcome,
    ).toBe("unresolved");
  });
});

describe("resolvePendingRollover", () => {
  it("carries chosen tasks into today and marks the rest dropped", () => {
    const rolled = applyRollover(makeState(), "2026-04-18");
    const resolved = resolvePendingRollover(rolled, ["b"], new Date("2026-04-18T09:00:00Z"));

    expect(resolved.pendingRollover).toBeNull();
    expect(resolved.tasks).toHaveLength(1);
    expect(resolved.tasks[0]?.text).toBe("B");
    expect(resolved.tasks[0]?.carriedOver).toBe(true);
    expect(resolved.history["2026-04-17"]?.tasks.find((task) => task.id === "b")?.rolloverOutcome).toBe(
      "carried",
    );
    expect(resolved.history["2026-04-17"]?.tasks.find((task) => task.id === "c")?.rolloverOutcome).toBe(
      "dropped",
    );
  });

  it("respects the 3-task cap when carrying tasks", () => {
    const rolled = applyRollover(
      makeState({
        tasks: [{ id: "keep", text: "Keep", createdAt: "x", carriedOver: false }],
      }),
      "2026-04-18",
    );
    const withTodayTasks: AppState = {
      ...rolled,
      tasks: [
        { id: "t1", text: "Today 1", createdAt: "x", carriedOver: false },
        { id: "t2", text: "Today 2", createdAt: "x", carriedOver: false },
      ],
    };

    const resolved = resolvePendingRollover(
      withTodayTasks,
      rolled.pendingRollover?.tasks.map((task) => task.id) ?? [],
      new Date("2026-04-18T09:00:00Z"),
    );

    expect(resolved.tasks).toHaveLength(3);
    expect(resolved.tasks.filter((task) => task.carriedOver)).toHaveLength(1);
  });
});

describe("syncTodayHistory", () => {
  it("captures lock state and task snapshots for the current day", () => {
    const next = syncTodayHistory(
      makeState({
        lastOpenedDate: "2026-04-18",
        todayLocked: true,
        todayLockSource: "auto",
        todayReflection: "Started earlier than usual.",
        tasks: [{ id: "a", text: "A", createdAt: "x", carriedOver: true }],
        todayCompletions: [],
      }),
      "2026-04-18",
    );

    expect(next.history["2026-04-18"]).toEqual({
      date: "2026-04-18",
      total: 1,
      completed: 0,
      locked: true,
      lockSource: "auto",
      reflection: "Started earlier than usual.",
      reflectionResult: null,
      tasks: [
        {
          id: "a",
          text: "A",
          completed: false,
          carriedOver: true,
          rolloverOutcome: null,
        },
      ],
    });
  });

  it("resets today's reflection on rollover and keeps yesterday's note", () => {
    const next = applyRollover(
      makeState({ todayReflection: "Kept the list small." }),
      "2026-04-18",
    );

    expect(next.todayReflection).toBeNull();
    expect(next.history["2026-04-17"]?.reflection).toBe("Kept the list small.");
  });
});
