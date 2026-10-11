// "For your next milestone" (1.4, PR #88), the pure part: which suggestions the
// group shows (the AI's, or the built-in ones), the built-in lines themselves,
// and the mark surviving a save.
import { describe, expect, it } from "vitest";

import {
  MAX_MILESTONE_IDEAS,
  buildMilestoneIdeaGroup,
  localMilestoneIdeas,
  milestoneKey,
} from "../lib/daily-tasks/milestone-ideas";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import type { GeneratedTask, MomentumMilestone, MomentumPlan } from "../lib/daily-tasks/types";

// Local date keys, as the app passes them.
const TODAY = "2026-10-10";
const WEEK = ["2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];

const step = (id: string, title: string, completedAt: string | null = null): MomentumMilestone => ({
  id,
  title,
  description: "",
  completedAt,
});
const M1 = step("milestone_start", "Run 1 km");
const M2 = step("milestone_repeat", "Run 3 km");
const PATH = [M1, M2];

const idea = (text: string, extra: Partial<GeneratedTask> = {}): GeneratedTask => ({
  id: `id_${text}`,
  text,
  estimatedMinutes: 10,
  difficulty: "easy",
  reason: "",
  source: "ai",
  ...extra,
});
/** An AI suggestion the plan marked for `milestone`. */
const forStep = (text: string, milestone: MomentumMilestone, extra: Partial<GeneratedTask> = {}) =>
  idea(text, { milestoneKey: milestoneKey(milestone), ...extra });

const group = (params: Partial<Parameters<typeof buildMilestoneIdeaGroup>[0]> = {}) =>
  buildMilestoneIdeaGroup({ milestones: PATH, completedMilestoneIds: [], today: TODAY, ...params });
const texts = (g: ReturnType<typeof group>) => g?.ideas.map((i) => i.text);

describe("milestone group: the AI's suggestions or the built-in ones", () => {
  const suggestions = [forStep("Jog to the corner", M1), idea("Lay out shoes"), idea("Stretch calves")];

  it("groups only the AI suggestions marked for the next open milestone", () => {
    const g = group({ suggestions });
    expect(g).toMatchObject({ milestoneId: M1.id, title: "Run 1 km", source: "ai" });
    expect(g?.ideas).toEqual([{ id: "id_Jog to the corner", text: "Jog to the corner", estimatedMinutes: 10 }]);
  });

  it("a marked suggestion that isn't from the AI doesn't count", () => {
    const g = group({ suggestions: [forStep("Jog to the corner", M1, { source: "template" })] });
    expect(g?.source).toBe("local");
    expect(texts(g)).not.toContain("Jog to the corner");
  });

  it("once the milestone is reached the group moves to the next one with built-in lines", () => {
    const g = group({ suggestions, completedMilestoneIds: [M1.id] });
    expect(g).toMatchObject({ milestoneId: M2.id, title: "Run 3 km", source: "local" });
    expect(texts(g)).toEqual(localMilestoneIdeas(M2, TODAY).slice(0, 2).map((i) => i.text));
    expect(texts(g)).not.toContain("Jog to the corner");
  });

  it("an edited title stops the old AI suggestion counting, though the id is the same", () => {
    const edited = step(M1.id, "Run 2 km");
    const g = group({ suggestions, milestones: [edited, M2] });
    expect(g).toMatchObject({ milestoneId: M1.id, title: "Run 2 km", source: "local" });
    expect(texts(g)?.every((text) => text.includes("“Run 2 km”"))).toBe(true);
  });

  it("the same title on another step doesn't count either (ids are part of the key)", () => {
    const g = group({ suggestions: [forStep("Jog to the corner", step("milestone_grow", "Run 1 km"))] });
    expect(g?.source).toBe("local");
  });

  it("a title that only differs by case or spacing still matches", () => {
    const g = group({ suggestions, milestones: [step(M1.id, "  run  1 KM "), M2] });
    expect(g?.source).toBe("ai");
  });

  it("shows at most two AI suggestions, in the plan's order", () => {
    const three = [forStep("One", M1), forStep("Two", M1), forStep("Three", M1)];
    expect(MAX_MILESTONE_IDEAS).toBe(2);
    expect(texts(group({ suggestions: three }))).toEqual(["One", "Two"]);
  });

  it("an AI suggestion already listed as a routine due today is left out of the group", () => {
    const g = group({ suggestions: [forStep("Stretch", M1), forStep("Jog", M1)], otherTexts: [" stretch "] });
    expect(g?.source).toBe("ai");
    expect(texts(g)).toEqual(["Jog"]);
  });
});

describe("milestone group: when there is one", () => {
  it("none when every milestone is reached (ticked, or marked on the step itself)", () => {
    expect(group({ completedMilestoneIds: [M1.id, M2.id] })).toBeNull();
    expect(group({ milestones: [step("a", "Done", "2026-10-01T08:00:00.000Z")] })).toBeNull();
    expect(group({ milestones: [] })).toBeNull();
  });

  it("without suggestions: two built-in lines for the first open milestone", () => {
    const g = group();
    expect(g).toMatchObject({ milestoneId: M1.id, title: "Run 1 km", source: "local" });
    expect(g?.ideas).toHaveLength(2);
  });
});

describe("built-in milestone suggestions", () => {
  it("every line fits a task (64 characters) for an 80-character title, ending the title with an ellipsis", () => {
    const long = "Finish the complete first draft of the proposal for the community garden project";
    expect(long).toHaveLength(80);
    for (const title of [long, "x".repeat(80)]) {
      const lines = localMilestoneIdeas(step("m", title), TODAY);
      expect(lines).toHaveLength(4);
      for (const line of lines) {
        expect(line.text.length).toBeLessThanOrEqual(64);
        expect(line.text).toMatch(/“[^“”]+…”/);
      }
    }
    // Cut at a word, not mid-word.
    const quoted = localMilestoneIdeas(step("m", long), TODAY).map((l) => /“(.+)…”/.exec(l.text)?.[1] ?? "");
    for (const part of quoted) expect(long.startsWith(`${part} `)).toBe(true);
  });

  it("a short title is used whole", () => {
    const lines = localMilestoneIdeas(M1, TODAY).map((l) => l.text).sort();
    expect(lines).toEqual(
      [
        "Spend 15 minutes on “Run 1 km”",
        "Write the first step for “Run 1 km”",
        "Do one small thing toward “Run 1 km”",
        "Jot down what “Run 1 km” still needs",
      ].sort(),
    );
  });

  it("takes quote marks out of the title, so the line has just its own pair", () => {
    for (const line of localMilestoneIdeas(step("m", 'Read “Dune” and «Emma» "twice"'), TODAY)) {
      expect(line.text).toContain("“Read Dune and Emma twice”");
      expect(line.text.match(/["“”«»]/g)).toEqual(["“", "”"]);
    }
  });

  it("nothing for a blank or quote-only title, and then no group", () => {
    for (const title of ["", "   ", '""', " “ ” ", "«»"]) {
      expect(localMilestoneIdeas(step("m", title), TODAY)).toEqual([]);
      expect(group({ milestones: [step("m", title)] })).toBeNull();
    }
  });

  it("each line's minutes are the ones it says", () => {
    const lines = localMilestoneIdeas(M1, TODAY);
    const minutes = Object.fromEntries(lines.map((l) => [l.text.replace(/ ?“.*”/, " …"), l.estimatedMinutes]));
    expect(minutes).toEqual({
      "Spend 15 minutes on …": 15,
      "Write the first step for …": 5,
      "Do one small thing toward …": 10,
      "Jot down what … still needs": 5,
    });
    expect(new Set(lines.map((l) => l.id)).size).toBe(4);
  });

  it("the same day and milestone always give the same lines; days and milestones differ", () => {
    const first = (milestone: MomentumMilestone, day: string) => localMilestoneIdeas(milestone, day)[0].text;
    for (const day of WEEK) {
      expect(localMilestoneIdeas(M1, day)).toEqual(localMilestoneIdeas(M1, day));
    }
    // Over a week the lead line changes.
    expect(new Set(WEEK.map((day) => first(M1, day))).size).toBeGreaterThan(1);
    // On one day, different steps don't all lead with the same line.
    const ids = ["milestone_start", "milestone_repeat", "milestone_grow", "milestone_x1", "milestone_x2", "milestone_x3"];
    const leads = ids.map((id) => first(step(id, "Run 1 km"), TODAY));
    expect(new Set(leads).size).toBeGreaterThan(1);
  });

  it("skips a line that repeats a routine due today or a general idea; the next line takes its place", () => {
    const all = localMilestoneIdeas(M1, TODAY);
    expect(texts(group())).toEqual([all[0].text, all[1].text]);
    // A routine due today (any case, extra spaces).
    expect(texts(group({ otherTexts: [`  ${all[0].text.toUpperCase()} `] }))).toEqual([all[1].text, all[2].text]);
    // A general idea in the plan.
    expect(texts(group({ suggestions: [idea(all[1].text, { source: "template" })] }))).toEqual([
      all[0].text,
      all[2].text,
    ]);
    // Everything taken: no group at all.
    expect(group({ otherTexts: all.map((l) => l.text) })).toBeNull();
  });
});

describe("the milestone mark survives a save", () => {
  const plan = (todaySuggestions: unknown[]): MomentumPlan =>
    ({
      id: "p",
      goalTitle: "Run a 5K",
      generatedAt: new Date(2026, 9, 10, 8).toISOString(),
      provider: "ai",
      milestones: PATH,
      taskPool: [],
      todaySuggestions,
      promptSummary: "",
      version: 1,
    }) as MomentumPlan;
  const roundTrip = (todaySuggestions: unknown[]) => {
    const saved = JSON.stringify({ ...buildInitialState(new Date(2026, 9, 10, 8)), momentumPlan: plan(todaySuggestions) });
    return normalizeState(JSON.parse(saved))?.momentumPlan?.todaySuggestions ?? [];
  };

  it("milestoneKey is kept through storage, and the group is still the AI's after a restart", () => {
    const restored = roundTrip([forStep("Jog to the corner", M1), idea("Lay out shoes")]);
    expect(restored[0].milestoneKey).toBe(milestoneKey(M1));
    expect(restored[1]).not.toHaveProperty("milestoneKey");
    expect(group({ suggestions: restored })).toMatchObject({ source: "ai", ideas: [{ text: "Jog to the corner" }] });
  });

  it("a key that isn't a short string is dropped, not kept as junk", () => {
    const restored = roundTrip([
      { ...idea("A"), milestoneKey: 7 },
      { ...idea("B"), milestoneKey: "" },
      { ...idea("C"), milestoneKey: "k".repeat(241) },
    ]);
    expect(restored).toHaveLength(3);
    for (const task of restored) expect(task).not.toHaveProperty("milestoneKey");
  });
});
