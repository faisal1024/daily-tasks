// "Next on your path" in Ideas (1.4, PR #88), the pure part: which suggestions the
// group shows (the AI's, or the built-in ones), the built-in lines themselves,
// and the mark surviving a save.
import { describe, expect, it } from "vitest";

import {
  MAX_MILESTONE_IDEAS,
  buildMilestoneIdeaGroup,
  cutGraphemes,
  localMilestoneIdeas,
  milestoneKey,
  milestoneToAskAbout,
  settleMilestoneMarks,
  shortMilestoneTitle,
  splitGraphemes,
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
    expect(texts(g)?.every((text) => text.startsWith("Run 2 km: "))).toBe(true);
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
        expect(line.text).toMatch(/^[^:]+…: [^:]+$/);
      }
    }
    // Cut at a word, not mid-word.
    const leads = localMilestoneIdeas(step("m", long), TODAY).map((l) => /^(.+)…: /.exec(l.text)?.[1] ?? "");
    for (const part of leads) expect(long.startsWith(`${part} `)).toBe(true);
  });

  it("the title leads and a small action follows, so each line reads as a task", () => {
    const lines = localMilestoneIdeas(M1, TODAY).map((l) => l.text).sort();
    expect(lines).toEqual(
      [
        "Run 1 km: 10 easy minutes",
        "Run 1 km: do the first small step",
        "Run 1 km: 15 focused minutes",
        "Run 1 km: plan the next small step",
      ].sort(),
    );
    // Plain words: no quote marks, no dashes.
    for (const line of lines) expect(line).not.toMatch(/["“”«»–—]/);
  });

  it("takes quote marks and closing punctuation out of the title", () => {
    for (const line of localMilestoneIdeas(step("m", 'Read “Dune” and «Emma» "twice".'), TODAY)) {
      expect(line.text.startsWith("Read Dune and Emma twice: ")).toBe(true);
      expect(line.text).not.toMatch(/["“”«»]/);
    }
    expect(localMilestoneIdeas(step("m", "Sign up: "), TODAY)[0].text).toMatch(/^Sign up: [^:]+$/);
  });

  it("nothing for a blank or quote-only title, and then no group", () => {
    for (const title of ["", "   ", '""', " “ ” ", "«»", "..."]) {
      expect(localMilestoneIdeas(step("m", title), TODAY)).toEqual([]);
      expect(group({ milestones: [step("m", title)] })).toBeNull();
    }
  });

  it("each line's minutes are the ones it says", () => {
    const lines = localMilestoneIdeas(M1, TODAY);
    const minutes = Object.fromEntries(lines.map((l) => [l.text.replace(/^Run 1 km: /, ""), l.estimatedMinutes]));
    expect(minutes).toEqual({
      "10 easy minutes": 10,
      "do the first small step": 5,
      "15 focused minutes": 15,
      "plan the next small step": 5,
    });
    expect(new Set(lines.map((l) => l.id)).size).toBe(4);
  });

  it("a starter path's lines open with the goal's title, not the step's", () => {
    const starter = [step("milestone_start", "Start small"), step("milestone_repeat", "Repeat the rhythm")];
    const g = group({ milestones: starter, starterGoalTitle: "Run a 5K" });
    // The group is still for the step.
    expect(g).toMatchObject({ milestoneId: "milestone_start", title: "Start small", source: "local" });
    expect(g?.ideas).toHaveLength(2);
    for (const text of texts(g) ?? []) {
      expect(text.startsWith("Run a 5K: ")).toBe(true);
      expect(text).not.toContain("Start small");
      expect(text.length).toBeLessThanOrEqual(64);
    }
    // Same lines, same day-and-step order, only the opening differs.
    expect(texts(g)).toEqual(
      localMilestoneIdeas(starter[0], TODAY)
        .slice(0, 2)
        .map((l) => l.text.replace("Start small: ", "Run a 5K: ")),
    );
    // No goal title to use: the step's own title.
    for (const blank of [null, "", "  "]) {
      expect(texts(group({ milestones: starter, starterGoalTitle: blank }))?.[0]).toMatch(/^Start small: /);
    }
    // A long goal title is cut the same way.
    const long = group({ milestones: starter, starterGoalTitle: "Learn conversational Spanish well enough to travel alone" });
    for (const text of texts(long) ?? []) {
      expect(text.length).toBeLessThanOrEqual(64);
      expect(text).toMatch(/^Learn conversational Spanish[^:]*…: /);
    }
  });

  it("a cut never splits an emoji, a flag or an accented letter", () => {
    const family = "👨‍👩‍👧‍👦";
    const thumbs = "👍🏽";
    const flag = "🇨🇦";
    const accent = "e\u0301";
    for (const useIntl of [true, false]) {
      expect(splitGraphemes(`a${family}${thumbs}${flag}${accent}b`, useIntl)).toEqual(["a", family, thumbs, flag, accent, "b"]);
    }
    expect(cutGraphemes(`ab${family}`, 5)).toBe("ab");
    expect(cutGraphemes(`ab${thumbs}c`, 3)).toBe("ab");
    expect(cutGraphemes("abc", 3)).toBe("abc");
    // In a title: whole characters only, and still within the limit.
    const title = `Run ${"🏃🏽‍♀️".repeat(20)}`;
    const short = shortMilestoneTitle(title, 20);
    expect(short.length).toBeLessThanOrEqual(20);
    expect(short.endsWith("…")).toBe(true);
    const kept = short.slice(0, -1);
    expect(title.startsWith(kept)).toBe(true);
    expect(splitGraphemes(kept).every((part) => part === "🏃🏽‍♀️" || part.length === 1)).toBe(true);
    for (const line of localMilestoneIdeas(step("m", "🏃🏽‍♀️".repeat(30)), TODAY)) {
      expect(line.text.length).toBeLessThanOrEqual(64);
      const lead = line.text.slice(0, line.text.indexOf("…"));
      expect(splitGraphemes(lead).every((part) => part === "🏃🏽‍♀️")).toBe(true);
    }
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

describe("which milestone a plan request names", () => {
  const plan = (overrides: Partial<MomentumPlan> = {}): MomentumPlan => ({
    id: "p",
    goalTitle: "Run a 5K",
    generatedAt: "2026-10-10T08:00:00.000Z",
    provider: "ai",
    pathSource: "ai",
    milestones: PATH,
    taskPool: [],
    todaySuggestions: [],
    promptSummary: "",
    version: 1,
    ...overrides,
  });

  it("the first open milestone of an AI or user path", () => {
    expect(milestoneToAskAbout(plan(), [])).toBe(M1);
    expect(milestoneToAskAbout(plan({ pathSource: "user", provider: "template" }), [M1.id])).toBe(M2);
    expect(milestoneToAskAbout(plan(), [M1.id, M2.id])).toBeNull();
  });

  it("none for a starter path (the AI's plan replaces it), a fresh path, or no plan", () => {
    expect(milestoneToAskAbout(plan({ pathSource: "template" }), [])).toBeNull();
    // An older save without pathSource: a template plan's path is the starter one.
    expect(milestoneToAskAbout(plan({ pathSource: undefined, provider: "template" }), [])).toBeNull();
    expect(milestoneToAskAbout(plan({ pathSource: undefined, provider: "ai" }), [])).toBe(M1);
    expect(milestoneToAskAbout(plan(), [], true)).toBeNull();
    expect(milestoneToAskAbout(null, [])).toBeNull();
  });

  it("a stored plan keeps only the marks for its own first open milestone", () => {
    const marked = plan({ todaySuggestions: [forStep("Jog", M1), idea("Lay out shoes"), forStep("Stretch", M1)] });
    // Still the step that was asked about: untouched (the same object).
    expect(settleMilestoneMarks(marked, [])).toBe(marked);
    // Reached while the request was out, or the path was replaced or edited: the marks go.
    for (const settled of [
      settleMilestoneMarks(marked, [M1.id]),
      settleMilestoneMarks({ ...marked, milestones: [step(M1.id, "Walk 10 minutes"), M2] }, []),
      settleMilestoneMarks(marked, [M1.id, M2.id]),
    ]) {
      expect(settled.todaySuggestions.map((t) => t.text)).toEqual(["Jog", "Lay out shoes", "Stretch"]);
      for (const task of settled.todaySuggestions) expect(task).not.toHaveProperty("milestoneKey");
    }
    // Nothing marked: nothing to do.
    const plain = plan({ todaySuggestions: [idea("Jog")] });
    expect(settleMilestoneMarks(plain, [])).toBe(plain);
  });
});
