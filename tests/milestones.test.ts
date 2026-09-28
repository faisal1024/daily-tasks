import { describe, expect, it } from "vitest";

import { DEFAULT_JOURNEY, XP_PER_MILESTONE } from "../lib/daily-tasks/journey";
import {
  cleanMilestones,
  completeMilestone,
  keepPath,
  milestonesWithCompletion,
  nextIncompleteMilestone,
  pickCelebration,
} from "../lib/daily-tasks/milestones";
import type { MomentumMilestone, MomentumPlan } from "../lib/daily-tasks/types";

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

describe("nextIncompleteMilestone", () => {
  it("returns the first milestone not yet completed", () => {
    expect(nextIncompleteMilestone(plan, ["m1"])?.id).toBe("m2");
    expect(nextIncompleteMilestone(plan, ["m1", "m2"])?.id).toBe("m3");
  });

  it("skips milestones marked done via completedAt", () => {
    const withDone = [milestone("m1", "2026-05-30T00:00:00.000Z"), milestone("m2")];
    expect(nextIncompleteMilestone(withDone, [])?.id).toBe("m2");
  });

  it("returns null when all milestones are complete", () => {
    expect(nextIncompleteMilestone(plan, ["m1", "m2", "m3"])).toBeNull();
    expect(nextIncompleteMilestone([], [])).toBeNull();
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

function planFor(goalTitle: string, milestones: MomentumMilestone[], id = "p"): MomentumPlan {
  return {
    id,
    goalTitle,
    generatedAt: "2026-09-28T08:00:00.000Z",
    provider: "ai",
    milestones,
    taskPool: [],
    todaySuggestions: [],
    promptSummary: "",
    version: 1,
  };
}

describe("keepPath", () => {
  const edited = [milestone("mine1"), milestone("mine2")];

  it("keeps the existing path when the plan is rebuilt for the same goal", () => {
    const next = planFor("Run a 5K", [milestone("m1")], "fresh");
    const kept = keepPath(planFor("Run a 5K", edited), next);
    expect(kept?.id).toBe("fresh"); // the day's ideas still update
    expect(kept?.milestones).toBe(edited);
  });

  it("takes the new path when the goal changed", () => {
    const next = planFor("Learn guitar", [milestone("m1")]);
    expect(keepPath(planFor("Run a 5K", edited), next)).toBe(next);
  });

  it("takes the new path when there was none, or no previous/next plan", () => {
    const next = planFor("Run a 5K", [milestone("m1")]);
    expect(keepPath(planFor("Run a 5K", []), next)).toBe(next);
    expect(keepPath(null, next)).toBe(next);
    expect(keepPath(planFor("Run a 5K", edited), null)).toBeNull();
  });
});

describe("cleanMilestones", () => {
  it("trims and collapses whitespace, drops blank steps, and never marks a step done", () => {
    const out = cleanMilestones(
      [
        { id: "m1", title: "  Walk   5 minutes ", description: "  every   day " },
        { id: "m2", title: "   " },
        { title: "Jog", completedAt: "x" } as { title: string },
      ],
      1000,
    );
    expect(out.map((m) => m.title)).toEqual(["Walk 5 minutes", "Jog"]);
    expect(out[0]).toEqual({ id: "m1", title: "Walk 5 minutes", description: "every day", completedAt: null });
    expect(out[1].description).toBe("");
    expect(out.every((m) => m.completedAt === null)).toBe(true);
  });

  it("keeps existing ids, mints unique ids for new and duplicate steps", () => {
    const out = cleanMilestones([{ id: "m1", title: "A" }, { title: "B" }, { id: "m1", title: "C" }, { title: "D" }], 1000);
    expect(out[0].id).toBe("m1");
    const ids = out.map((m) => m.id);
    expect(new Set(ids).size).toBe(4);
    expect(ids.slice(1).every((id) => id.startsWith("milestone_"))).toBe(true);
  });

  it("caps the path at six steps and the text at its field limits", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ title: `Step ${i + 1}` }));
    const out = cleanMilestones(items, 1000);
    expect(out).toHaveLength(6);
    expect(out[5].title).toBe("Step 6");
    const [long] = cleanMilestones([{ title: "t".repeat(120), description: "d".repeat(300) }], 1000);
    expect(long.title).toHaveLength(80);
    expect(long.description).toHaveLength(200);
  });

  it("counts only kept steps toward the cap (blanks don't use up a slot)", () => {
    const items = [{ title: "" }, ...Array.from({ length: 6 }, (_, i) => ({ title: `S${i}` }))];
    expect(cleanMilestones(items, 1000)).toHaveLength(6);
  });
});

describe("keepPath honours where the path came from", () => {
  const base = (over: Partial<MomentumPlan>): MomentumPlan => ({
    id: "p",
    goalTitle: "Run a 5K",
    generatedAt: "x",
    provider: "template",
    milestones: [{ id: "a", title: "Mine", description: "", completedAt: null }],
    taskPool: [],
    todaySuggestions: [],
    promptSummary: "",
    version: 1,
    ...over,
  });
  const ai = base({ provider: "ai", milestones: [{ id: "b", title: "AI step", description: "", completedAt: null }] });

  it("an edited path on a template-provider plan (as restored after a relaunch) is kept", () => {
    expect(keepPath(base({ pathSource: "user" }), ai)?.milestones[0].title).toBe("Mine");
  });

  it("an untouched starter path is upgraded by an AI plan", () => {
    expect(keepPath(base({}), ai)?.milestones[0].title).toBe("AI step");
  });
});
