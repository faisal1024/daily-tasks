import { describe, expect, it } from "vitest";

import {
  personalizedTaskSuggestions,
  TASK_CATALOG,
  TASK_CATALOG_SIZE,
  TASKS_BY_GOAL,
  USER_GOALS,
} from "../lib/daily-tasks/task-catalog";
import { buildInitialState } from "../lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_PROFILE, type UserProfile } from "../lib/daily-tasks/types";

describe("buildInitialState (new install)", () => {
  it("starts with zero tasks", () => {
    const state = buildInitialState(new Date("2026-04-25T09:00:00Z"));
    expect(state.tasks).toEqual([]);
    expect(state.todayCompletions).toEqual([]);
  });

  it("has not seen onboarding yet", () => {
    const state = buildInitialState();
    expect(state.hasSeenOnboarding).toBe(false);
  });

  it("creates an empty history entry for today", () => {
    const state = buildInitialState(new Date("2026-04-25T09:00:00Z"));
    expect(state.history[state.lastOpenedDate]).toEqual({
      date: state.lastOpenedDate,
      total: 0,
      completed: 0,
      locked: false,
      lockSource: null,
      tasks: [],
      reflection: null,
    });
  });

  it("starts unlocked", () => {
    const state = buildInitialState();
    expect(state.todayLocked).toBe(false);
    expect(state.todayLockSource).toBeNull();
  });

  it("starts without a completion reflection", () => {
    const state = buildInitialState();
    expect(state.todayReflection).toBeNull();
  });

  it("starts with noon auto-lock enabled", () => {
    const state = buildInitialState();
    expect(state.autoLock).toEqual(DEFAULT_AUTO_LOCK);
  });

  it("starts with a suggestion profile", () => {
    const state = buildInitialState();
    expect(state.profile).toEqual(DEFAULT_PROFILE);
  });

  it("does not seed any default task text", () => {
    const state = buildInitialState();
    const removedDefaults = ["Morning Exercise", "Read for 30 Minutes", "Review Daily Goals"];
    for (const text of removedDefaults) {
      expect(state.tasks.find((task) => task.text === text)).toBeUndefined();
    }
  });
});

describe("task catalog", () => {
  it("generates 10000 productive task options", () => {
    expect(TASK_CATALOG).toHaveLength(TASK_CATALOG_SIZE);
  });

  it("groups task options by goal", () => {
    for (const goal of USER_GOALS) {
      expect(TASKS_BY_GOAL[goal].length).toBeGreaterThan(0);
      expect(TASKS_BY_GOAL[goal].every((task) => task.goal === goal)).toBe(true);
    }
  });

  it("selects suggestions that match the user's goals", () => {
    const suggestions = personalizedTaskSuggestions(
      {
        goals: ["finance"],
        energy: "steady",
        timeWindow: "quick",
        workStyle: "structured",
      },
      "2026-04-25",
      3,
    );

    expect(suggestions).toHaveLength(3);
    expect(suggestions.every((suggestion) => suggestion.goal === "finance")).toBe(true);
  });

  it("does not recommend tasks the user already has today", () => {
    const profile: UserProfile = {
      goals: ["finance"],
      energy: "steady",
      timeWindow: "quick",
      workStyle: "structured",
    };
    const first = personalizedTaskSuggestions(profile, "2026-04-25", 1)[0];
    const next = personalizedTaskSuggestions(profile, "2026-04-25", 1, [first.text])[0];

    expect(next.text).not.toBe(first.text);
  });
});
