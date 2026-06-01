import { describe, expect, it } from "vitest";

import {
  buildMomentumPlan,
  buildAdaptationSnapshot,
  generateMomentumSuggestions,
  isMomentumProfileComplete,
  summarizeRecentPerformance,
  summarizeRecentTasks,
  validateGeneratedTasks,
} from "../lib/daily-tasks/momentum";
import type { MomentumProfile } from "../lib/daily-tasks/types";
import {
  DEFAULT_MOMENTUM_PROFILE,
  DEFAULT_MOMENTUM_SETTINGS,
  TASK_SUGGESTIONS,
} from "../lib/daily-tasks/types";

const COMPLETE_PROFILE: MomentumProfile = {
  name: "Test User",
  goalTitle: "Get in shape",
  goalSource: "suggested",
  timeAvailability: "15_min",
  experienceLevel: "beginner",
  struggleType: "overwhelm",
  motivation: null,
  preferredTime: null,
  cadence: null,
  onboardingCompletedAt: "2026-05-02T12:00:00.000Z",
};

describe("isMomentumProfileComplete", () => {
  it("requires goal, context, and completion timestamp", () => {
    expect(isMomentumProfileComplete(DEFAULT_MOMENTUM_PROFILE)).toBe(false);
    expect(isMomentumProfileComplete(COMPLETE_PROFILE)).toBe(true);
  });
});

describe("generateMomentumSuggestions", () => {
  it("falls back to generic suggestions before onboarding", () => {
    expect(generateMomentumSuggestions(DEFAULT_MOMENTUM_PROFILE)).toEqual(TASK_SUGGESTIONS);
  });

  it("uses goal and context to create short suggestions", () => {
    const suggestions = generateMomentumSuggestions(COMPLETE_PROFILE);

    expect(suggestions).toContain("Take a 15-minute walk");
    expect(suggestions).toContain("Make the next step tiny");
    expect(suggestions.length).toBeLessThanOrEqual(5);
    for (const suggestion of suggestions) {
      expect(suggestion.length).toBeLessThanOrEqual(56);
    }
  });

  it("supports custom goals without creating a backlog", () => {
    const suggestions = generateMomentumSuggestions({
      ...COMPLETE_PROFILE,
      goalTitle: "Write a novel",
      goalSource: "custom",
      timeAvailability: "30_min",
    });

    expect(suggestions).toContain("Spend 15 minutes on Write a novel");
    expect(suggestions.length).toBeLessThanOrEqual(5);
  });
});

describe("buildMomentumPlan", () => {
  it("creates a stored plan with exactly three suggestions", () => {
    const plan = buildMomentumPlan({
      profile: COMPLETE_PROFILE,
      history: {},
      settings: DEFAULT_MOMENTUM_SETTINGS,
      now: new Date("2026-05-02T12:00:00"),
    });

    expect(plan?.provider).toBe("template");
    expect(plan?.todaySuggestions).toHaveLength(3);
    expect(plan?.milestones.length).toBeGreaterThanOrEqual(3);
    expect(plan?.promptSummary).toContain("Goal: Get in shape");
  });

  it("simplifies suggestions after weak recent completion", () => {
    const plan = buildMomentumPlan({
      profile: {
        ...COMPLETE_PROFILE,
        struggleType: "consistency",
      },
      history: {
        "2026-04-30": {
          date: "2026-04-30",
          total: 3,
          completed: 0,
          locked: true,
          lockSource: "manual",
          tasks: [],
          reflection: null,
          reflectionResult: null,
        },
        "2026-05-01": {
          date: "2026-05-01",
          total: 3,
          completed: 1,
          locked: true,
          lockSource: "manual",
          tasks: [],
          reflection: null,
          reflectionResult: null,
        },
      },
      settings: DEFAULT_MOMENTUM_SETTINGS,
      now: new Date("2026-05-02T12:00:00"),
    });

    expect(plan?.todaySuggestions.every((task) => task.difficulty === "easy")).toBe(true);
  });
});

describe("validateGeneratedTasks", () => {
  it("rejects duplicate, vague, or oversized generated tasks", () => {
    const valid = validateGeneratedTasks([
      {
        id: "1",
        text: "Practice for 15 minutes",
        estimatedMinutes: 15,
        difficulty: "easy",
        reason: "Small start.",
        source: "ai",
      },
      {
        id: "2",
        text: "Practice for 15 minutes",
        estimatedMinutes: 15,
        difficulty: "easy",
        reason: "Duplicate.",
        source: "ai",
      },
      {
        id: "3",
        text: "Build an entire company strategy, launch plan, investor deck, and website",
        estimatedMinutes: 90,
        difficulty: "stretch",
        reason: "Too large.",
        source: "ai",
      },
    ]);

    expect(valid).toHaveLength(1);
  });
});

describe("summarizeRecentPerformance", () => {
  it("summarizes the last five active days before today", () => {
    const summary = summarizeRecentPerformance(
      {
        "2026-04-30": {
          date: "2026-04-30",
          total: 3,
          completed: 2,
          locked: true,
          lockSource: "manual",
          tasks: [],
          reflection: null,
          reflectionResult: null,
        },
      },
      new Date("2026-05-02T12:00:00"),
    );

    expect(summary).toEqual({
      daysReviewed: 1,
      completed: 2,
      total: 3,
      missed: 1,
      completionRate: 2 / 3,
    });
  });
});

describe("summarizeRecentTasks", () => {
  const dayRecord = (date: string, tasks: { text: string; completed: boolean }[]) => ({
    date,
    total: tasks.length,
    completed: tasks.filter((t) => t.completed).length,
    locked: false,
    lockSource: null,
    reflection: null,
    reflectionResult: null,
    tasks: tasks.map((t, i) => ({
      id: `${date}-${i}`,
      text: t.text,
      completed: t.completed,
      carriedOver: false,
      rolloverOutcome: null,
    })),
  });

  it("returns recent task texts newest-first with completion, excluding today", () => {
    const result = summarizeRecentTasks(
      {
        "2026-05-01": dayRecord("2026-05-01", [
          { text: "Walk 10 min", completed: true },
          { text: "Stretch", completed: false },
        ]),
        "2026-04-30": dayRecord("2026-04-30", [{ text: "Read a page", completed: true }]),
        // today — must be excluded
        "2026-05-02": dayRecord("2026-05-02", [{ text: "Today task", completed: false }]),
      },
      new Date("2026-05-02T12:00:00"),
    );

    expect(result).toEqual([
      { text: "Walk 10 min", completed: true },
      { text: "Stretch", completed: false },
      { text: "Read a page", completed: true },
    ]);
  });

  it("caps the number of returned tasks", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ text: `Task ${i}`, completed: true }));
    const result = summarizeRecentTasks(
      { "2026-05-01": dayRecord("2026-05-01", many) },
      new Date("2026-05-02T12:00:00"),
      5,
    );
    expect(result).toHaveLength(5);
  });
});

describe("buildAdaptationSnapshot", () => {
  it("explains why tomorrow should simplify after missed work", () => {
    const snapshot = buildAdaptationSnapshot(
      {
        ...COMPLETE_PROFILE,
        struggleType: "consistency",
      },
      DEFAULT_MOMENTUM_SETTINGS,
      {
        "2026-05-01": {
          date: "2026-05-01",
          total: 3,
          completed: 0,
          locked: true,
          lockSource: "manual",
          tasks: [],
          reflection: null,
          reflectionResult: "hard",
        },
        "2026-04-30": {
          date: "2026-04-30",
          total: 3,
          completed: 1,
          locked: true,
          lockSource: "manual",
          tasks: [],
          reflection: null,
          reflectionResult: "missed",
        },
      },
      new Date("2026-05-02T12:00:00"),
    );

    expect(snapshot).toMatchObject({
      date: "2026-05-02",
      missedCount: 5,
      recommendation: "simplify",
    });
    expect(snapshot?.reason).toContain("smaller");
  });
});
