// Plan contract changes: the schema asks only for what the app reads, and the
// prompt carries a short example per suggestion tone.
import { describe, expect, it } from "vitest";

import {
  RESPONSE_SCHEMA,
  TONES,
  buildPrompt,
  generatedTaskSchema,
  sanitizePlan,
  toneExample,
  validatePayload,
} from "../server/providers/plan-contract.mjs";

const PAYLOAD = {
  profile: { goalTitle: "Run a 5K" },
  settings: { suggestionTone: "calm", adaptivePlanning: true },
  recentPerformance: { completed: 1, total: 2, missed: 1, daysReviewed: 1 },
};
const promptFor = (tone: string) => buildPrompt({ ...PAYLOAD, settings: { ...PAYLOAD.settings, suggestionTone: tone } });

describe("plan schema", () => {
  it("no longer asks the model for ids, source or completion", () => {
    const task = generatedTaskSchema();
    expect(task.required).toEqual(["text", "estimatedMinutes", "difficulty", "reason"]);
    expect(task.properties).not.toHaveProperty("id");
    expect(task.properties).not.toHaveProperty("source");
    const milestone = RESPONSE_SCHEMA.properties.milestones.items;
    expect(milestone.required).toEqual(["title", "description"]);
    expect(milestone.properties).not.toHaveProperty("id");
    expect(milestone.properties).not.toHaveProperty("completedAt");
    expect(milestone.additionalProperties).toBe(false);
  });
});

describe("tone examples", () => {
  it.each(["calm", "friendly", "direct"])("includes the %s example in the prompt", (tone) => {
    const prompt = promptFor(tone);
    expect(prompt).toContain(`Suggestion tone: ${tone} (${toneExample(tone)})`);
  });

  it("gives each tone a different example", () => {
    const examples = new Set(["calm", "friendly", "direct"].map(toneExample));
    expect(examples.size).toBe(3);
  });

  it.each(["shouty", "__proto__", "toString", ""])("falls back to the calm example for %j", (tone) => {
    expect(toneExample(tone)).toBe(toneExample("calm"));
    expect(promptFor(tone)).toContain(toneExample("calm"));
  });
});

describe("tone validation and neutral examples", () => {
  it("accepts only calm, friendly and direct", () => {
    expect(TONES).toEqual(["calm", "friendly", "direct"]);
    for (const tone of TONES) {
      expect(validatePayload({ ...PAYLOAD, settings: { ...PAYLOAD.settings, suggestionTone: tone } })).toBeNull();
    }
    for (const tone of ["shouty", "__proto__", "", "Calm"]) {
      expect(validatePayload({ ...PAYLOAD, settings: { ...PAYLOAD.settings, suggestionTone: tone } })).toBe(
        "Invalid settings",
      );
    }
  });

  it("marks examples as voice only and tells the model not to reuse their activity", () => {
    for (const tone of TONES) expect(toneExample(tone)).toMatch(/^voice only/);
    expect(promptFor("direct")).toContain("The tone example shows voice only; never reuse its activity");
    // Neutral: no walking example that the model used to copy into plans.
    expect(TONES.map(toneExample).join(" ")).not.toMatch(/walk/i);
  });
});

describe("sanitizePlan", () => {
  const task = (n: number) => ({
    id: `t${n}`,
    source: "ai",
    text: `Task ${n}`,
    estimatedMinutes: 10,
    difficulty: "easy",
    reason: "r",
    extra: "junk",
  });

  it("keeps only the fields the app reads, within the app's counts", () => {
    const plan = sanitizePlan({
      milestones: [1, 2, 3, 4].map((n) => ({ id: `m${n}`, title: `M${n}`, description: "d", completedAt: null })),
      todaySuggestions: [1, 2, 3, 4].map(task),
      taskPool: [1, 2, 3, 4, 5, 6, 7].map(task),
      extra: { big: true },
    });
    expect(Object.keys(plan)).toEqual(["milestones", "todaySuggestions", "taskPool"]);
    expect(plan.milestones).toHaveLength(3);
    expect(plan.milestones[0]).toEqual({ title: "M1", description: "d" });
    expect(plan.todaySuggestions).toHaveLength(3);
    expect(plan.taskPool).toHaveLength(6);
    expect(plan.todaySuggestions[0]).toEqual({ text: "Task 1", estimatedMinutes: 10, difficulty: "easy", reason: "r" });
  });

  it("clips long strings and replaces non-strings, and copes with missing arrays", () => {
    const plan = sanitizePlan({
      milestones: [{ title: "x".repeat(500), description: 7 }],
      todaySuggestions: [{ text: "y".repeat(500), reason: null, difficulty: { a: 1 } }],
    });
    expect(plan.milestones[0]).toEqual({ title: "x".repeat(120), description: "" });
    expect(plan.todaySuggestions[0].text).toHaveLength(200);
    expect(plan.todaySuggestions[0].reason).toBe("");
    expect(plan.todaySuggestions[0].difficulty).toBe("");
    expect(plan.taskPool).toEqual([]);
    expect(sanitizePlan(null)).toEqual({ milestones: [], todaySuggestions: [], taskPool: [] });
  });
});
