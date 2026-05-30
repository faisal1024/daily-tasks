import { describe, expect, it } from "vitest";

import {
  buildAiPlanRequestPayload,
  buildFallbackMomentumPlan,
} from "../lib/daily-tasks/momentum-ai";
import type { MomentumProfile } from "../lib/daily-tasks/types";
import { DEFAULT_MOMENTUM_PROFILE, DEFAULT_MOMENTUM_SETTINGS } from "../lib/daily-tasks/types";

const PROFILE: MomentumProfile = {
  goalTitle: "Learn guitar",
  goalSource: "custom",
  timeAvailability: "30_min",
  experienceLevel: "beginner",
  struggleType: "consistency",
  onboardingCompletedAt: "2026-05-02T12:00:00.000Z",
};

describe("buildAiPlanRequestPayload", () => {
  it("returns null until the Momentum profile is complete enough for AI", () => {
    expect(
      buildAiPlanRequestPayload({
        profile: DEFAULT_MOMENTUM_PROFILE,
        history: {},
        settings: DEFAULT_MOMENTUM_SETTINGS,
      }),
    ).toBeNull();
  });

  it("includes recent performance, reflection, and the user's own recent tasks", () => {
    const payload = buildAiPlanRequestPayload({
      profile: PROFILE,
      settings: DEFAULT_MOMENTUM_SETTINGS,
      now: new Date("2026-05-02T12:00:00"),
      history: {
        "2026-05-01": {
          date: "2026-05-01",
          total: 3,
          completed: 2,
          locked: true,
          lockSource: "manual",
          reflection: "Had a good rhythm.",
          reflectionResult: "good",
          tasks: [
            {
              id: "task-1",
              text: "Practice scales for 10 minutes",
              completed: true,
              carriedOver: false,
              rolloverOutcome: null,
            },
          ],
        },
      },
    });

    expect(payload).toMatchObject({
      profile: {
        goalTitle: "Learn guitar",
        timeAvailability: "30_min",
      },
      recentPerformance: {
        completed: 2,
        total: 3,
        missed: 1,
      },
      recentReflection: "Had a good rhythm.",
      recentReflectionResult: "good",
    });
    // The AI now builds on the user's own recent tasks.
    expect(payload?.recentTasks).toContainEqual({
      text: "Practice scales for 10 minutes",
      completed: true,
    });
  });
});

describe("buildFallbackMomentumPlan", () => {
  it("keeps the app usable when the proxy is unavailable", () => {
    const fallback = buildFallbackMomentumPlan({
      profile: PROFILE,
      history: {},
      settings: DEFAULT_MOMENTUM_SETTINGS,
      now: new Date("2026-05-02T12:00:00"),
    });

    expect(fallback?.provider).toBe("template");
    expect(fallback?.todaySuggestions).toHaveLength(3);
  });
});
