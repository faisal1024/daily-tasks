// The evening teaser for a free user (1.5, PR #102): when it shows, and which
// one real line it carries. Pure rules, so the whole matrix runs here.
import { describe, expect, it } from "vitest";

import { addDays } from "../lib/daily-tasks/date";
import {
  EVENING_TEASER_PLACEHOLDER_LINES,
  EVENING_TEASER_MIN_DONE,
  eveningTeaserLine,
  showsEveningTeaser,
  type EveningTeaserInput,
} from "../lib/daily-tasks/evening-teaser";
import { localMilestoneIdeas } from "../lib/daily-tasks/milestone-ideas";
import type { MomentumMilestone, MomentumPlan } from "../lib/daily-tasks/types";

// Local date keys, as the app passes them.
const TODAY = "2026-10-10";
const TOMORROW = addDays(TODAY, 1);

describe("showsEveningTeaser", () => {
  const perfectFreeDay: EveningTeaserInput = {
    paywallEnabled: true,
    hasPlus: false,
    eveningAiAvailable: true,
    dayClosed: true,
    hasDraft: false,
    taskCount: 3,
    completedCount: 3,
  };

  it("shows on a closed, perfect day for a free user", () => {
    expect(EVENING_TEASER_MIN_DONE).toBe(3);
    expect(EVENING_TEASER_PLACEHOLDER_LINES).toBe(2);
    expect(showsEveningTeaser(perfectFreeDay)).toBe(true);
  });

  it.each<[string, Partial<EveningTeaserInput>]>([
    ["Plus, a trial, grandfathered or still being checked", { hasPlus: true }],
    ["a build with no paywall", { paywallEnabled: false }],
    ["a build that can't reach the AI evening coach (no proxy)", { eveningAiAvailable: false }],
    ["the day isn't closed yet", { dayClosed: false }],
    ["the close already drafted tomorrow", { hasDraft: true }],
    ["something is still open (2 of 3)", { completedCount: 2 }],
    ["everything done, but fewer than three tasks", { taskCount: 2, completedCount: 2 }],
    ["no tasks at all", { taskCount: 0, completedCount: 0 }],
    ["more done than tasks (bad data) with none to do", { taskCount: 0, completedCount: 3 }],
  ])("stays hidden when %s", (_name, change) => {
    expect(showsEveningTeaser({ ...perfectFreeDay, ...change })).toBe(false);
  });
});

describe("eveningTeaserLine", () => {
  const step = (id: string, title: string): MomentumMilestone => ({ id, title, description: "", completedAt: null });
  const M1 = step("m1", "Run 1 km");
  const M2 = step("m2", "Run 3 km");
  const plan = (extra: Partial<MomentumPlan> = {}): MomentumPlan => ({
    id: "p",
    goalTitle: "Run a 5K",
    generatedAt: new Date(2026, 9, 10, 8).toISOString(),
    provider: "ai",
    milestones: [M1, M2],
    taskPool: [],
    todaySuggestions: [],
    promptSummary: "",
    version: 1,
    ...extra,
  });
  const base = {
    tasks: [
      { text: "Walk", done: true },
      { text: "Read", done: true },
      { text: "Stretch", done: true },
    ],
    parkedTasks: [] as { text: string }[],
    plan: null as MomentumPlan | null,
    completedMilestoneIds: [] as string[],
    today: TODAY,
  };

  it("starts with the oldest saved-for-later (the list is oldest first), ahead of the path", () => {
    const line = eveningTeaserLine({
      ...base,
      parkedTasks: [{ text: "  " }, { text: "Call the dentist" }, { text: "Water plants" }],
      plan: plan(),
    });
    expect(line).toBe("Call the dentist");
  });

  it("never offers a saved task that is already on today's list (case and spaces aside)", () => {
    const line = eveningTeaserLine({
      ...base,
      parkedTasks: [{ text: "  WALK " }, { text: "Water  plants" }],
    });
    expect(line).toBe("Water  plants");
  });

  it("then the built-in idea for the next open step, picked for tomorrow's date", () => {
    const line = eveningTeaserLine({ ...base, plan: plan() });
    const expected = localMilestoneIdeas(M1, TOMORROW, M1.title)[0].text;
    expect(line).toBe(expected);
    expect(line).toContain("Run 1 km");
    // Not today's pick: tomorrow's draft is what is being teased.
    const days = Array.from({ length: 12 }, (_, i) => addDays("2026-10-01", i));
    const picks = days.map((d) => localMilestoneIdeas(M1, addDays(d, 1), M1.title)[0].text);
    expect(new Set(picks).size).toBeGreaterThan(1);
    for (const [i, d] of days.entries()) {
      expect(eveningTeaserLine({ ...base, today: d, plan: plan() })).toBe(picks[i]);
    }
  });

  it("moves on to the next step once the first is reached", () => {
    const line = eveningTeaserLine({ ...base, plan: plan(), completedMilestoneIds: [M1.id] });
    expect(line).toContain("Run 3 km");
    expect(line).not.toContain("Run 1 km");
  });

  it("a starter path leads with the goal, not its generic step; an AI or edited path leads with the step", () => {
    const starter = plan({ provider: "template", pathSource: "template", milestones: [step("m1", "Start small")] });
    const fromStarter = eveningTeaserLine({ ...base, plan: starter });
    expect(fromStarter).toContain("Run a 5K");
    expect(fromStarter).not.toContain("Start small");
    const edited = plan({ provider: "template", pathSource: "user", milestones: [step("m1", "Run 1 km")] });
    expect(eveningTeaserLine({ ...base, plan: edited })).toContain("Run 1 km");
  });

  it("is null (so no teaser) with nothing saved and no path, or a finished path", () => {
    expect(eveningTeaserLine(base)).toBeNull();
    expect(eveningTeaserLine({ ...base, plan: plan(), completedMilestoneIds: [M1.id, M2.id] })).toBeNull();
    expect(eveningTeaserLine({ ...base, plan: plan({ milestones: [] }) })).toBeNull();
    expect(eveningTeaserLine({ ...base, parkedTasks: [{ text: "Walk" }, { text: " " }] })).toBeNull();
  });
});
