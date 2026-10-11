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

describe("providers name the structured output per route", () => {
  afterEach(() => vi.unstubAllGlobals());

  function captureFetch(response: unknown) {
    const fetchMock = vi.fn(async (_url: string, _init: { body: string }) => response);
    vi.stubGlobal("fetch", fetchMock);
    return () => JSON.parse(fetchMock.mock.calls[0][1].body);
  }

  it("anthropic forces the route's tool and reads back only that tool's input", async () => {
    const steps = { steps: [{ text: "a" }, { text: "b" }] };
    const body = captureFetch({
      ok: true,
      json: async () => ({
        content: [
          // A different tool's output must not be mistaken for this route's.
          { type: "tool_use", name: PLAN_TOOL_NAME, input: SAMPLE_PLAN },
          { type: "tool_use", name: "emit_steps", input: steps },
        ],
      }),
    });
    const result = await getProvider("anthropic").generatePlan({
      ...callArgs,
      schema: { type: "object" },
      toolName: "emit_steps",
      toolDescription: "Return steps.",
    });
    expect(result).toEqual(steps);
    const sent = body();
    expect(sent.tools).toEqual([
      { name: "emit_steps", description: "Return steps.", input_schema: { type: "object" } },
    ]);
    expect(sent.tool_choice).toEqual({ type: "tool", name: "emit_steps" });
  });

  it("anthropic rejects a response that only called a different tool, naming the expected one", async () => {
    captureFetch({
      ok: true,
      json: async () => ({ content: [{ type: "tool_use", name: PLAN_TOOL_NAME, input: SAMPLE_PLAN }] }),
    });
    await expect(
      getProvider("anthropic").generatePlan({ ...callArgs, toolName: "emit_brain_dump", toolDescription: "d" }),
    ).rejects.toThrow(/emit_brain_dump/);
  });

  it("anthropic defaults to the plan tool when no tool name is given (backward compatible)", async () => {
    const body = captureFetch({
      ok: true,
      json: async () => ({ content: [{ type: "tool_use", name: PLAN_TOOL_NAME, input: SAMPLE_PLAN }] }),
    });
    await getProvider("anthropic").generatePlan(callArgs);
    const sent = body();
    expect(sent.tool_choice).toEqual({ type: "tool", name: PLAN_TOOL_NAME });
    expect(sent.tools[0].name).toBe(PLAN_TOOL_NAME);
    expect(typeof sent.tools[0].description).toBe("string");
  });

  it("openai names the json_schema format after the route's tool, defaulting to momentum_plan", async () => {
    const response = { ok: true, json: async () => ({ output_text: JSON.stringify({ steps: [] }) }) };
    let body = captureFetch(response);
    await getProvider("openai").generatePlan({ ...callArgs, toolName: "emit_brain_dump" });
    expect(body().text.format).toMatchObject({
      type: "json_schema",
      name: "emit_brain_dump",
      strict: true,
      schema: {},
    });
    vi.unstubAllGlobals();

    body = captureFetch(response);
    await getProvider("openai").generatePlan(callArgs);
    expect(body().text.format.name).toBe("momentum_plan");
  });

  it("anthropic: Haiku 5.5 is the default and gets no temperature; an older model still gets 0.4", async () => {
    const { acceptsTemperature } = await import("../server/providers/anthropic.mjs");
    const reply = { ok: true, json: async () => ({ content: [{ type: "tool_use", name: PLAN_TOOL_NAME, input: {} }] }) };
    const before = process.env.ANTHROPIC_MODEL;
    try {
      delete process.env.ANTHROPIC_MODEL;
      let body = captureFetch(reply);
      await getProvider("anthropic").generatePlan(callArgs);
      expect(body().model).toBe("claude-haiku-5-5");
      expect(body()).not.toHaveProperty("temperature");
      expect(body()).not.toHaveProperty("top_p");
      expect(body()).not.toHaveProperty("top_k");
      vi.unstubAllGlobals();

      process.env.ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
      body = captureFetch(reply);
      await getProvider("anthropic").generatePlan(callArgs);
      expect(body().temperature).toBe(0.4);
    } finally {
      if (before === undefined) delete process.env.ANTHROPIC_MODEL;
      else process.env.ANTHROPIC_MODEL = before;
    }
    for (const id of ["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-6", "claude-opus-4-6", "claude-3-5-haiku-20241022"]) {
      expect(acceptsTemperature(id)).toBe(true);
    }
    for (const id of ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-4-7", "claude-opus-4-8", "", undefined]) {
      expect(acceptsTemperature(id)).toBe(false);
    }
  });

  it("anthropic: a refusal or an answer cut off at the cap is an error that says which", async () => {
    captureFetch({ ok: true, json: async () => ({ stop_reason: "refusal", content: [] }) });
    await expect(getProvider("anthropic").generatePlan(callArgs)).rejects.toThrow(/refusal/);
    vi.unstubAllGlobals();
    captureFetch({ ok: true, json: async () => ({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: PLAN_TOOL_NAME, input: {} }] }) });
    await expect(getProvider("anthropic").generatePlan(callArgs)).rejects.toThrow(/max_tokens \(2200\)/);
  });

  it("a route's output cap reaches both providers; without one the defaults are unchanged", async () => {
    const anthropicReply = { ok: true, json: async () => ({ content: [{ type: "tool_use", name: "emit_nag_lines", input: {} }] }) };
    let body = captureFetch(anthropicReply);
    await getProvider("anthropic").generatePlan({ ...callArgs, toolName: "emit_nag_lines", toolDescription: "d", maxTokens: 1200 });
    expect(body().max_tokens).toBe(1200);
    body = captureFetch(anthropicReply);
    await getProvider("anthropic").generatePlan({ ...callArgs, toolName: "emit_nag_lines", toolDescription: "d" });
    expect(body().max_tokens).toBe(2200);

    const openaiReply = { ok: true, json: async () => ({ output_text: "{}" }) };
    body = captureFetch(openaiReply);
    await getProvider("openai").generatePlan({ ...callArgs, toolName: "emit_nag_lines", maxTokens: 1200 });
    expect(body().max_output_tokens).toBe(1200);
    body = captureFetch(openaiReply);
    await getProvider("openai").generatePlan({ ...callArgs, toolName: "emit_nag_lines" });
    expect(body()).not.toHaveProperty("max_output_tokens");
  });
});
