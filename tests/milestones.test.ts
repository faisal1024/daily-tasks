import { describe, expect, it } from "vitest";

import { DEFAULT_JOURNEY, XP_PER_MILESTONE } from "../lib/daily-tasks/journey";
import {
  completeMilestone,
  milestonesWithCompletion,
  pickCelebration,
} from "../lib/daily-tasks/milestones";
import type { MomentumMilestone } from "../lib/daily-tasks/types";

function milestone(id: string, completedAt: string | null = null): MomentumMilestone {
  return { id, title: `Title ${id}`, description: `Desc ${id}`, completedAt };
}

const plan = [milestone("m1"), milestone("m2"), milestone("m3")];

describe("milestonesWithCompletion", () => {
  it("marks milestones done from the completed-id set or an existing completedAt", () => {
    const view = milestonesWithCompletion(
      [milestone("m1"), milestone("m2", "2026-05-30T00:00:00.000Z")],
      ["m1"],
    );
    expect(view.find((m) => m.id === "m1")?.done).toBe(true); // via id set
    expect(view.find((m) => m.id === "m2")?.done).toBe(true); // via completedAt
  });

  it("leaves uncompleted milestones not done", () => {
    const view = milestonesWithCompletion(plan, []);
    expect(view.every((m) => !m.done)).toBe(true);
  });
});

describe("completeMilestone", () => {
  it("awards milestone XP, records the id, and returns the celebration title", () => {
    const result = completeMilestone({
      milestones: plan,
      completedMilestoneIds: [],
      journey: DEFAULT_JOURNEY,
      id: "m2",
    });
    expect(result).not.toBeNull();
    expect(result?.completedMilestoneIds).toEqual(["m2"]);
    expect(result?.journey.xp).toBe(DEFAULT_JOURNEY.xp + XP_PER_MILESTONE);
    expect(result?.pendingMilestoneCelebration).toBe("Title m2");
  });

  it("is a no-op for an already-completed milestone", () => {
    expect(
      completeMilestone({
        milestones: plan,
        completedMilestoneIds: ["m2"],
        journey: DEFAULT_JOURNEY,
        id: "m2",
      }),
    ).toBeNull();
  });

  it("is a no-op for an unknown milestone id", () => {
    expect(
      completeMilestone({
        milestones: plan,
        completedMilestoneIds: [],
        journey: DEFAULT_JOURNEY,
        id: "does-not-exist",
      }),
    ).toBeNull();
  });
});

describe("pickCelebration", () => {
  it("prioritizes a milestone, then a level-up, then nothing", () => {
    expect(
      pickCelebration({ pendingMilestoneCelebration: "Start small", pendingLevelUp: 3 }),
    ).toBe("milestone");
    expect(
      pickCelebration({ pendingMilestoneCelebration: null, pendingLevelUp: 3 }),
    ).toBe("level");
    expect(
      pickCelebration({ pendingMilestoneCelebration: null, pendingLevelUp: null }),
    ).toBeNull();
  });
});
