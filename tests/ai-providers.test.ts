import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PROVIDER_ID,
  PROVIDER_IDS,
  getProvider,
} from "../server/providers/index.mjs";
import { PLAN_TOOL_NAME } from "../server/providers/plan-contract.mjs";

const SAMPLE_PLAN = {
  milestones: [{ id: "m1", title: "Start", description: "", completedAt: null }],
  todaySuggestions: [
    { id: "t1", text: "Walk", estimatedMinutes: 10, difficulty: "easy", reason: "r", source: "ai" },
  ],
  taskPool: [
    { id: "t1", text: "Walk", estimatedMinutes: 10, difficulty: "easy", reason: "r", source: "ai" },
  ],
};

function mockFetch(response: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

const callArgs = { system: "s", user: "u", schema: {} };

const REQUIRED_METHODS = [
  "isConfigured",
  "missingConfigMessage",
  "describe",
  "generatePlan",
] as const;

describe("AI provider registry", () => {
  it("registers the known providers", () => {
    expect(PROVIDER_IDS).toContain("openai");
    expect(PROVIDER_IDS).toContain("anthropic");
  });

  it("defaults to openai", () => {
    expect(getProvider().id).toBe(DEFAULT_PROVIDER_ID);
    expect(getProvider().id).toBe("openai");
  });

  it("resolves providers case-insensitively", () => {
    expect(getProvider("anthropic").id).toBe("anthropic");
    expect(getProvider("ANTHROPIC").id).toBe("anthropic");
  });

  it("throws a helpful error for an unknown provider", () => {
    expect(() => getProvider("gemini")).toThrowError(/Unknown MOMENTUM_AI_PROVIDER/);
    expect(() => getProvider("gemini")).toThrowError(/openai, anthropic/);
  });

  it("every provider implements the common interface", () => {
    for (const id of PROVIDER_IDS) {
      const provider = getProvider(id);
      expect(provider.id).toBe(id);
      for (const method of REQUIRED_METHODS) {
        expect(typeof provider[method]).toBe("function");
      }
      // describe() must work without any API key configured.
      expect(typeof provider.describe()).toBe("string");
      expect(typeof provider.isConfigured()).toBe("boolean");
    }
  });
});

describe("openai generatePlan", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses structured output_text into a plan", async () => {
    mockFetch({ ok: true, json: async () => ({ output_text: JSON.stringify(SAMPLE_PLAN) }) });
    const plan = await getProvider("openai").generatePlan(callArgs);
    expect(plan).toEqual(SAMPLE_PLAN);
  });

  it("throws when no structured output is present", async () => {
    mockFetch({ ok: true, json: async () => ({ output: [] }) });
    await expect(getProvider("openai").generatePlan(callArgs)).rejects.toThrow();
  });

  it("throws with the status on a non-ok response", async () => {
    mockFetch({ ok: false, status: 500, json: async () => ({ error: { message: "boom" } }) });
    await expect(getProvider("openai").generatePlan(callArgs)).rejects.toThrow(/500/);
  });
});

describe("anthropic generatePlan", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses the forced tool_use input into a plan", async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        content: [{ type: "tool_use", name: PLAN_TOOL_NAME, input: SAMPLE_PLAN }],
      }),
    });
    const plan = await getProvider("anthropic").generatePlan(callArgs);
    expect(plan).toEqual(SAMPLE_PLAN);
  });

  it("throws when the response has no tool call", async () => {
    mockFetch({ ok: true, json: async () => ({ content: [{ type: "text", text: "hi" }] }) });
    await expect(getProvider("anthropic").generatePlan(callArgs)).rejects.toThrow();
  });
});
