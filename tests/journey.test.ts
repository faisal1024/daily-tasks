import { describe, expect, it } from "vitest";

import {
  DEFAULT_JOURNEY,
  acknowledgeLevel,
  awardMilestone,
  awardPerfectDay,
  awardTaskCompletion,
  levelForXp,
  levelProgress,
  pendingLevelUp,
  registerShowedUp,
  stageForLevel,
  unlockedCosmetics,
  xpForLevel,
  XP_PERFECT_DAY,
  XP_PER_MILESTONE,
  XP_PER_TASK,
  type Journey,
} from "../lib/daily-tasks/journey";

function base(overrides: Partial<Journey> = {}): Journey {
  return { ...DEFAULT_JOURNEY, ...overrides };
}

describe("level math", () => {
  it("starts at level 1 and climbs on the quadratic curve", () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(49)).toBe(1);
    expect(levelForXp(50)).toBe(2);
    expect(levelForXp(200)).toBe(3);
    expect(levelForXp(450)).toBe(4);
  });

  it("xpForLevel is the inverse boundary of levelForXp", () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(2)).toBe(50);
    expect(xpForLevel(3)).toBe(200);
    expect(levelForXp(xpForLevel(5))).toBe(5);
  });

  it("reports progress toward the next level", () => {
    const progress = levelProgress(125); // level 2 (base 50, next 200)
    expect(progress.level).toBe(2);
    expect(progress.xpIntoLevel).toBe(75);
    expect(progress.xpForNextLevel).toBe(150);
    expect(progress.ratio).toBeCloseTo(0.5, 5);
  });
});

describe("task + perfect-day XP", () => {
  it("awards XP once per task per day (no farming by re-toggling)", () => {
    let journey = base();
    journey = awardTaskCompletion(journey, "task-1", "2026-05-30");
    expect(journey.xp).toBe(XP_PER_TASK);
    // re-completing the same task the same day grants no extra XP
    journey = awardTaskCompletion(journey, "task-1", "2026-05-30");
    expect(journey.xp).toBe(XP_PER_TASK);
    // a different task does
    journey = awardTaskCompletion(journey, "task-2", "2026-05-30");
    expect(journey.xp).toBe(XP_PER_TASK * 2);
  });

  it("resets per-day award guards on a new day", () => {
    let journey = awardTaskCompletion(base(), "task-1", "2026-05-30");
    journey = awardTaskCompletion(journey, "task-1", "2026-05-31");
    expect(journey.xp).toBe(XP_PER_TASK * 2);
    expect(journey.awardedTaskIds).toEqual(["task-1"]);
  });

  it("grants the perfect-day bonus only once per day", () => {
    let journey = awardPerfectDay(base(), "2026-05-30");
    expect(journey.xp).toBe(XP_PERFECT_DAY);
    journey = awardPerfectDay(journey, "2026-05-30");
    expect(journey.xp).toBe(XP_PERFECT_DAY);
  });

  it("awards milestone XP", () => {
    expect(awardMilestone(base()).xp).toBe(XP_PER_MILESTONE);
  });
});

describe("showed-up streak", () => {
  it("starts at 1 on the first day", () => {
    const journey = registerShowedUp(base(), "2026-05-30");
    expect(journey.showedUpStreak).toBe(1);
    expect(journey.lastShowedUpDate).toBe("2026-05-30");
  });

  it("increments on consecutive days and is idempotent within a day", () => {
    let journey = registerShowedUp(base(), "2026-05-30");
    journey = registerShowedUp(journey, "2026-05-30");
    expect(journey.showedUpStreak).toBe(1);
    journey = registerShowedUp(journey, "2026-05-31");
    expect(journey.showedUpStreak).toBe(2);
    expect(journey.longestShowedUpStreak).toBe(2);
  });

  it("absorbs a single missed day with a freeze instead of resetting", () => {
    let journey = registerShowedUp(base({ showedUpFreezes: 1 }), "2026-05-30");
    // skip the 31st, return on June 1 — one missed day, one freeze available
    journey = registerShowedUp(journey, "2026-06-01");
    expect(journey.showedUpStreak).toBe(2);
    expect(journey.showedUpFreezes).toBe(0);
  });

  it("resets to 1 when the gap exceeds available freezes", () => {
    let journey = registerShowedUp(base({ showedUpFreezes: 0 }), "2026-05-30");
    journey = registerShowedUp(journey, "2026-06-05");
    expect(journey.showedUpStreak).toBe(1);
  });
});

describe("level-up celebration", () => {
  it("flags a pending level-up until acknowledged", () => {
    const journey = base({ xp: 60, lastCelebratedLevel: 1 }); // level 2
    expect(pendingLevelUp(journey)).toBe(2);
    const acked = acknowledgeLevel(journey);
    expect(acked.lastCelebratedLevel).toBe(2);
    expect(pendingLevelUp(acked)).toBeNull();
  });
});

describe("growth stage", () => {
  it("advances the visual as the level climbs and never regresses below seed", () => {
    expect(stageForLevel(1).label).toBe("Seed");
    expect(stageForLevel(2).label).toBe("Sprout");
    expect(stageForLevel(5).label).toBe("Sapling");
    expect(stageForLevel(8).label).toBe("Tree");
    expect(stageForLevel(20).label).toBe("Grove");
    // below the first threshold still resolves to the first stage
    expect(stageForLevel(0).label).toBe("Seed");
  });
});

describe("cosmetics", () => {
  it("unlocks free cosmetics by level and gates premium ones", () => {
    const journey = base({ xp: xpForLevel(4) }); // level 4
    const free = unlockedCosmetics(journey).map((c) => c.id);
    expect(free).toContain("sprout");
    expect(free).toContain("grove");
    expect(free).not.toContain("dawn"); // premium, locked without entitlement

    const withPremium = unlockedCosmetics(journey, { premium: true }).map((c) => c.id);
    expect(withPremium).toContain("dawn");
  });
});
