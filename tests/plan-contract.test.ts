// Plan contract changes: the schema asks only for what the app reads, and the
// prompt carries a short example per suggestion tone.
import { describe, expect, it } from "vitest";

import { RESPONSE_SCHEMA, buildPrompt, generatedTaskSchema, toneExample } from "../server/providers/plan-contract.mjs";

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
