import { describe, expect, it } from "vitest";

import {
  DEFAULT_JOURNEY,
  FREEZE_EARN_EVERY,
  MAX_SHOWED_UP_FREEZES,
  acknowledgeLevel,
  awardPerfectDay,
  awardTaskCompletion,
  levelForXp,
  levelProgress,
  pendingLevelUp,
  registerShowedUp,
  unlockedCosmetics,
  xpForLevel,
  XP_PERFECT_DAY,
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
    expect(progress.xpSpanForLevel).toBe(150);
    expect(progress.xpRemaining).toBe(75);
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

  it("absorbs a multi-day gap when enough freezes are banked", () => {
    let journey = registerShowedUp(base({ showedUpFreezes: 2 }), "2026-06-01");
    // return on the 4th: missed the 2nd and 3rd (2 days), 2 freezes available
    journey = registerShowedUp(journey, "2026-06-04");
    expect(journey.showedUpStreak).toBe(2);
    expect(journey.showedUpFreezes).toBe(0);
  });

  it(`earns a freeze every ${FREEZE_EARN_EVERY} days, capped at ${MAX_SHOWED_UP_FREEZES}`, () => {
    const days = [
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
      "2026-06-05",
      "2026-06-06",
      "2026-06-07",
    ];
    let journey = base({ showedUpFreezes: 1 });
    for (const day of days) journey = registerShowedUp(journey, day);
    expect(journey.showedUpStreak).toBe(7);
    expect(journey.longestShowedUpStreak).toBe(7);
    // started with 1, earned 1 at the 7-day mark, capped at MAX
    expect(journey.showedUpFreezes).toBe(Math.min(MAX_SHOWED_UP_FREEZES, 2));
  });

  it("ignores a backwards date (clock skew / replay)", () => {
    let journey = registerShowedUp(base(), "2026-06-05");
    const before = journey;
    journey = registerShowedUp(journey, "2026-06-01");
    expect(journey.showedUpStreak).toBe(before.showedUpStreak);
    expect(journey.lastShowedUpDate).toBe("2026-06-05");
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
