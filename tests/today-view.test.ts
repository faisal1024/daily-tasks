import { describe, expect, it } from "vitest";

import { isLatestRequest } from "../lib/daily-tasks/ai-status";
import { MILESTONE_IDS, buildMilestones, buildMomentumPlan } from "../lib/daily-tasks/momentum";
import {
  migrateCompletedMilestoneIds,
  migrateMilestoneId,
  milestonesWithCompletion,
} from "../lib/daily-tasks/milestones";
import {
  MIN_PERFECT_DAYS_BEFORE_REVIEW,
  REVIEW_COOLDOWN_DAYS,
  countPerfectDays,
  shouldRequestReview,
} from "../lib/daily-tasks/review-prompt";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import {
  THINKING_HINT_DELAY_MS,
  ideasSource,
  isPerfectDayTransition,
  showIdeasEntry,
  streakChipLabel,
  streakChipText,
  todayProgress,
  todayStatus,
} from "../lib/daily-tasks/today-view";
import type { DayRecord, History, MomentumPlan } from "../lib/daily-tasks/types";
import { DEFAULT_MOMENTUM_SETTINGS } from "../lib/daily-tasks/types";

describe("todayProgress", () => {
  it("describes an empty day without claiming progress", () => {
    const p = todayProgress(0, 0);
    expect(p).toMatchObject({ headline: "Pick today's three", ratio: 0, isPerfect: false });
    expect(p.label).not.toMatch(/\d of/);
  });

  it("counts progress against three slots so 1 of 1 isn't a full bar", () => {
    expect(todayProgress(1, 1).ratio).toBeCloseTo(1 / 3);
    expect(todayProgress(2, 3).ratio).toBeCloseTo(2 / 3);
    expect(todayProgress(3, 3).ratio).toBe(1);
  });

  it("only calls three-for-three a perfect day", () => {
    expect(todayProgress(3, 3)).toMatchObject({ headline: "Perfect day!", isPerfect: true });
    expect(todayProgress(2, 2)).toMatchObject({ headline: "All done!", isPerfect: true });
    expect(todayProgress(0, 3).headline).toBe("Let's go!");
    expect(todayProgress(1, 3).headline).toBe("Almost there!");
  });

  it("labels progress and clamps bad counts", () => {
    expect(todayProgress(2, 3).label).toBe("2 of 3 done");
    expect(todayProgress(5, 3)).toMatchObject({ completed: 3, label: "3 of 3 done" });
    expect(todayProgress(-1, 3)).toMatchObject({ completed: 0, ratio: 0 });
  });
});

describe("todayStatus", () => {
  const base = { locked: false, lockSource: null, taskCount: 2, completedCount: 0 } as const;

  it("doesn't offer to lock an empty day", () => {
    expect(todayStatus({ ...base, taskCount: 0 })).toMatchObject({ kind: "empty", canLock: false });
  });

  it("offers Lock in while choosing, with copy for a full list", () => {
    expect(todayStatus(base)).toMatchObject({ kind: "choosing", canLock: true });
    expect(todayStatus({ ...base, taskCount: 3 }).text).toContain("Lock them in");
  });

  it("distinguishes manual and automatic locks and shows what's left", () => {
    expect(
      todayStatus({ ...base, locked: true, lockSource: "manual", completedCount: 1 }),
    ).toMatchObject({
      kind: "set",
      text: "Today is set. 1 to go.",
      canLock: false,
    });
    expect(todayStatus({ ...base, locked: true, lockSource: "auto", completedCount: 2 }).text).toBe(
      "Locked in automatically. All done.",
    );
    expect(todayStatus({ ...base, locked: true, lockSource: "manual", taskCount: 0 }).text).toBe(
      "Today is set.",
    );
  });
});

describe("showIdeasEntry", () => {
  it("shows only while unlocked with room to add", () => {
    expect(showIdeasEntry({ locked: false, remainingSlots: 1 })).toBe(true);
    expect(showIdeasEntry({ locked: true, remainingSlots: 3 })).toBe(false);
    expect(showIdeasEntry({ locked: false, remainingSlots: 0 })).toBe(false);
  });
});

describe("ideasSource", () => {
  const plan = (provider: "ai" | "template") => ({ provider }) as MomentumPlan;

  it("labels AI plans as personalized for the goal", () => {
    expect(ideasSource(plan("ai"), "Run a 5K")).toEqual({
      personalized: true,
      label: "Personalized for Run a 5K",
    });
  });

  it("labels template plans and missing goals as starter ideas", () => {
    expect(ideasSource(plan("template"), "Run a 5K").personalized).toBe(false);
    expect(ideasSource(plan("ai"), null).label).toBe("Starter ideas");
    expect(ideasSource(null, "Run a 5K").label).toBe("Starter ideas");
  });
});

describe("streak chip", () => {
  it("formats text and a spoken label, clamping odd values", () => {
    expect(streakChipText(21, 4)).toBe("🔥 21 · Lv 4");
    expect(streakChipText(-2, 0)).toBe("🔥 0 · Lv 1");
    expect(streakChipLabel(21, 4)).toBe("21-day streak, level 4");
  });
});

describe("isPerfectDayTransition", () => {
  it("fires when the third task is checked off", () => {
    expect(isPerfectDayTransition({ previousCompleted: 2, completed: 3, total: 3 })).toBe(true);
  });

  it("does not fire when the app opens on an already-perfect day", () => {
    expect(isPerfectDayTransition({ previousCompleted: null, completed: 3, total: 3 })).toBe(false);
    expect(isPerfectDayTransition({ previousCompleted: 3, completed: 3, total: 3 })).toBe(false);
  });

  it("needs all three slots filled, and fires again after un-check/re-check", () => {
    expect(isPerfectDayTransition({ previousCompleted: 1, completed: 2, total: 2 })).toBe(false);
    expect(isPerfectDayTransition({ previousCompleted: 3, completed: 2, total: 3 })).toBe(false);
    expect(isPerfectDayTransition({ previousCompleted: 2, completed: 3, total: 3 })).toBe(true);
  });
});

describe("THINKING_HINT_DELAY_MS", () => {
  it("waits a while before saying 'still thinking'", () => {
    expect(THINKING_HINT_DELAY_MS).toBeGreaterThanOrEqual(5_000);
  });
});

function day(date: string, completed: number, total = 3): DayRecord {
  return {
    date,
    total,
    completed,
    locked: true,
    lockSource: "manual",
    tasks: [],
    reflection: null,
    reflectionResult: null,
  };
}

describe("review prompt policy", () => {
  const perfectHistory = (n: number): History =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => {
        const key = `2026-09-${String(i + 1).padStart(2, "0")}`;
        return [key, day(key, 3)];
      }),
    );
  const now = new Date("2026-09-26T20:00:00Z");

  it("counts only three-for-three days as perfect", () => {
    expect(
      countPerfectDays({ a: day("a", 3), b: day("b", 2), c: day("c", 2, 2), d: day("d", 3) }),
    ).toBe(2);
  });

  it("asks right after a perfect day once the user has had a few", () => {
    expect(
      shouldRequestReview({
        history: perfectHistory(MIN_PERFECT_DAYS_BEFORE_REVIEW),
        lastReviewPromptAt: null,
        now,
        justCompletedPerfectDay: true,
      }),
    ).toBe(true);
  });

  it("never asks new users or outside the perfect-day moment", () => {
    const base = { lastReviewPromptAt: null, now };
    expect(
      shouldRequestReview({
        ...base,
        history: perfectHistory(MIN_PERFECT_DAYS_BEFORE_REVIEW - 1),
        justCompletedPerfectDay: true,
      }),
    ).toBe(false);
    expect(
      shouldRequestReview({ ...base, history: perfectHistory(10), justCompletedPerfectDay: false }),
    ).toBe(false);
  });

  it("respects the cooldown after the last prompt", () => {
    const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
    const ask = (last: string) =>
      shouldRequestReview({
        history: perfectHistory(10),
        lastReviewPromptAt: last,
        now,
        justCompletedPerfectDay: true,
      });
    expect(ask(daysAgo(REVIEW_COOLDOWN_DAYS - 1))).toBe(false);
    expect(ask(daysAgo(REVIEW_COOLDOWN_DAYS))).toBe(true);
    expect(ask("garbage")).toBe(true);
  });
});

describe("milestone ids are shared by template and AI plans", () => {
  it("template milestones use the shared positional ids", () => {
    expect(buildMilestones("Run a 5K").map((m) => m.id)).toEqual([...MILESTONE_IDS]);
  });

  it("completion carries over when the day's plan switches source", () => {
    const aiDone = ["milestone_start"];
    const template = buildMomentumPlan({
      profile: {
        name: null,
        goalTitle: "Run a 5K",
        goalSource: "custom",
        timeAvailability: "30_min",
        experienceLevel: "beginner",
        struggleType: "consistency",
        motivation: null,
        preferredTime: null,
        cadence: null,
        onboardingCompletedAt: "2026-09-01T00:00:00Z",
      },
      history: {},
      settings: DEFAULT_MOMENTUM_SETTINGS,
      now: new Date("2026-09-26T12:00:00Z"),
    });
    const view = milestonesWithCompletion(template!.milestones, aiDone);
    expect(view[0].done).toBe(true);
    expect(view[1].done).toBe(false);
  });

  it("migrates legacy AI ids and de-duplicates", () => {
    expect(migrateMilestoneId("m1")).toBe("milestone_start");
    expect(migrateMilestoneId("m3")).toBe("milestone_grow");
    expect(migrateMilestoneId("milestone_repeat")).toBe("milestone_repeat");
    expect(migrateMilestoneId("m4")).toBe("m4");
    expect(migrateCompletedMilestoneIds(["m1", "milestone_start", "m2"])).toEqual([
      "milestone_start",
      "milestone_repeat",
    ]);
  });

  it("migrates saved state on load: completed ids and saved plan milestones", () => {
    const saved = {
      ...buildInitialState(),
      completedMilestoneIds: ["m1", "m2"],
      momentumPlan: {
        id: "p",
        goalTitle: "Run a 5K",
        generatedAt: "2026-09-26T08:00:00Z",
        provider: "ai",
        milestones: [
          { id: "m1", title: "One", description: "", completedAt: null },
          { id: "m2", title: "Two", description: "", completedAt: null },
        ],
        taskPool: [],
        todaySuggestions: [],
        promptSummary: "",
        version: 1,
      },
    };
    const restored = normalizeState(JSON.parse(JSON.stringify(saved)));
    expect(restored?.completedMilestoneIds).toEqual(["milestone_start", "milestone_repeat"]);
    expect(restored?.momentumPlan?.milestones.map((m) => m.id)).toEqual([
      "milestone_start",
      "milestone_repeat",
    ]);
    const view = milestonesWithCompletion(
      restored!.momentumPlan!.milestones,
      restored!.completedMilestoneIds,
    );
    expect(view.every((m) => m.done)).toBe(true);
  });

  it("keeps a saved review-prompt timestamp and defaults it to null", () => {
    expect(normalizeState(buildInitialState())?.lastReviewPromptAt).toBeNull();
    expect(
      normalizeState({ ...buildInitialState(), lastReviewPromptAt: "2026-09-01T00:00:00Z" })
        ?.lastReviewPromptAt,
    ).toBe("2026-09-01T00:00:00Z");
    expect(
      normalizeState({ ...buildInitialState(), lastReviewPromptAt: 42 })?.lastReviewPromptAt,
    ).toBeNull();
  });
});

describe("isLatestRequest", () => {
  it("only lets the newest AI request update state", () => {
    expect(isLatestRequest(3, 3)).toBe(true);
    expect(isLatestRequest(2, 3)).toBe(false);
  });
});
