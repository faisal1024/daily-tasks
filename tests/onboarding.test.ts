import { describe, expect, it } from "vitest";

import { buildInitialState } from "../lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, TASK_SUGGESTIONS } from "../lib/daily-tasks/types";

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

  it("does not seed any default task text", () => {
    const state = buildInitialState();
    const removedDefaults = ["Morning Exercise", "Read for 30 Minutes", "Review Daily Goals"];
    for (const text of removedDefaults) {
      expect(state.tasks.find((task) => task.text === text)).toBeUndefined();
    }
  });
});

describe("TASK_SUGGESTIONS", () => {
  it("provides at least three calm suggestions", () => {
    expect(TASK_SUGGESTIONS.length).toBeGreaterThanOrEqual(3);
  });

  it("contains only short, finishable phrases (no auto-fill)", () => {
    for (const suggestion of TASK_SUGGESTIONS) {
      expect(suggestion.length).toBeLessThanOrEqual(50);
      expect(suggestion.trim()).toBe(suggestion);
    }
  });
});
