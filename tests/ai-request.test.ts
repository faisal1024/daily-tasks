import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AI_REQUEST_TIMEOUT_MS,
  PROXY_SECRET_HEADER,
  getMomentumProxySecret,
  requestMomentumAiPlan,
} from "../lib/daily-tasks/momentum-ai";
import { MomentumAiError } from "../lib/daily-tasks/ai-status";
import { validateGeneratedTasks } from "../lib/daily-tasks/momentum";
import type { MomentumProfile } from "../lib/daily-tasks/types";
import { DEFAULT_MOMENTUM_PROFILE, DEFAULT_MOMENTUM_SETTINGS } from "../lib/daily-tasks/types";

const PROFILE: MomentumProfile = {
  name: "Alex Private",
  goalTitle: "Run a 5K",
  goalSource: "custom",
  timeAvailability: "30_min",
  experienceLevel: "beginner",
  struggleType: "consistency",
  motivation: null,
  preferredTime: "morning",
  cadence: "daily",
  onboardingCompletedAt: "2026-09-01T08:00:00.000Z",
};

const NOW = new Date("2026-09-26T12:00:00.000Z");

const task = (text: string, minutes = 15) => ({
  id: text,
  text,
  estimatedMinutes: minutes,
  difficulty: "easy",
  reason: "because",
  source: "ai",
});

const PLAN = {
  milestones: [
    { id: "m1", title: "Run 1 mile", description: "Base", completedAt: null },
    { id: "m2", title: "Run 2 miles", description: "", completedAt: null },
  ],
  todaySuggestions: [task("Walk 20 minutes"), task("Stretch calves", 10), task("Lay out gear", 5)],
  taskPool: [task("Walk 20 minutes")],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function call(overrides: Partial<Parameters<typeof requestMomentumAiPlan>[0]> = {}) {
  return requestMomentumAiPlan({
    profile: PROFILE,
    history: {},
    settings: DEFAULT_MOMENTUM_SETTINGS,
    proxyUrl: "https://proxy.test/api/momentum/plan",
    proxySecret: null,
    now: NOW,
    fetchImpl: vi.fn(async () => jsonResponse(PLAN)) as unknown as typeof fetch,
    ...overrides,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("requestMomentumAiPlan: request", () => {
  it("refuses to run without a proxy URL or a complete profile", async () => {
    await expect(call({ proxyUrl: null })).rejects.toThrow(/proxy URL/);
    await expect(call({ profile: DEFAULT_MOMENTUM_PROFILE })).rejects.toThrow(/incomplete/);
  });

  it("POSTs JSON to the proxy and never sends the user's name", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PLAN));
    await call({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proxy.test/api/momentum/plan");
    expect(init.method).toBe("POST");
    const body = String(init.body);
    expect(JSON.parse(body).profile.goalTitle).toBe("Run a 5K");
    expect(body).not.toContain("Alex Private");
  });

  it("sends the shared secret header only when a secret is configured", async () => {
    const withSecret = vi.fn(async () => jsonResponse(PLAN));
    await call({ proxySecret: "s3cret", fetchImpl: withSecret as unknown as typeof fetch });
    const headers = (withSecret.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(headers[PROXY_SECRET_HEADER]).toBe("s3cret");

    const withoutSecret = vi.fn(async () => jsonResponse(PLAN));
    await call({ proxySecret: null, fetchImpl: withoutSecret as unknown as typeof fetch });
    const bare = (withoutSecret.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    expect(bare).not.toHaveProperty(PROXY_SECRET_HEADER);
  });

  it("reads the secret from the build-time env and treats an empty value as unset", () => {
    vi.stubEnv("EXPO_PUBLIC_MOMENTUM_PROXY_SECRET", "from-env");
    expect(getMomentumProxySecret()).toBe("from-env");
    vi.stubEnv("EXPO_PUBLIC_MOMENTUM_PROXY_SECRET", "");
    expect(getMomentumProxySecret()).toBeNull();
  });

  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [429, "rate_limited"],
    [503, "busy"],
    [500, "unavailable"],
    [502, "unavailable"],
  ])("classifies HTTP %i as %s", async (status, kind) => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "x" }, status));
    const error = await call({ fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(error).toBeInstanceOf(MomentumAiError);
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
  });

  it("classifies malformed JSON as an invalid response", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>oops", { status: 200 }));
    const error = await call({ fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(error.kind).toBe("invalid_response");
  });

  it("aborts and reports a timeout when the proxy hangs", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const pending = call({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const assertion = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS);
    await assertion;
  });

  it("waits long enough to survive a Render cold start (~50s)", async () => {
    expect(AI_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(55_000);
  });

  it("reports a timeout when the body stalls after headers arrive", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    }));
    const pending = call({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const assertion = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS);
    await assertion;
  });

  it("does not report a timeout for ordinary network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });
    const error = await call({ fetchImpl: fetchImpl as unknown as typeof fetch }).catch((e) => e);
    expect(error.kind).toBe("network");
    expect(error.message).toBe("Network request failed");
  });

  it("clears its timer after a successful response", async () => {
    vi.useFakeTimers();
    await call();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("requestMomentumAiPlan: response parsing", () => {
  const respond = (body: unknown) =>
    call({ fetchImpl: vi.fn(async () => jsonResponse(body)) as unknown as typeof fetch });

  it("builds an AI plan from a well-formed response", async () => {
    const plan = await respond(PLAN);
    expect(plan.provider).toBe("ai");
    expect(plan.goalTitle).toBe("Run a 5K");
    expect(plan.todaySuggestions.map((t) => t.text)).toEqual([
      "Walk 20 minutes",
      "Stretch calves",
      "Lay out gear",
    ]);
    expect(plan.milestones.map((m) => m.title)).toEqual(["Run 1 mile", "Run 2 miles"]);
    expect(plan.generatedAt).toBe(NOW.toISOString());
  });

  it("accepts fewer than three suggestions instead of failing the whole plan", async () => {
    const plan = await respond({ ...PLAN, todaySuggestions: [task("Walk 20 minutes")] });
    expect(plan.todaySuggestions).toHaveLength(1);
  });

  it("caps suggestions at three", async () => {
    const plan = await respond({
      ...PLAN,
      todaySuggestions: [task("A one"), task("B two"), task("C three"), task("D four")],
    });
    expect(plan.todaySuggestions).toHaveLength(3);
  });

  it("rejects a response with no usable suggestions", async () => {
    await expect(respond({ ...PLAN, todaySuggestions: [] })).rejects.toThrow("invalid daily plan");
    await expect(respond({ ...PLAN, todaySuggestions: "nope" })).rejects.toThrow(
      "invalid daily plan",
    );
    await expect(respond(null)).rejects.toThrow("invalid daily plan");
  });

  it("falls back to template milestones when the AI omits or garbles them", async () => {
    for (const milestones of [undefined, "bad", [], [{ title: "" }, null]]) {
      const plan = await respond({ ...PLAN, milestones });
      expect(plan.milestones.length).toBeGreaterThan(0);
      expect(plan.milestones.every((m) => typeof m.title === "string" && m.title.length > 0)).toBe(
        true,
      );
    }
  });

  it("never trusts completedAt from the AI (a hallucinated date would mark a milestone done)", async () => {
    const plan = await respond({
      ...PLAN,
      milestones: [{ id: "m1", title: "Run 1 mile", completedAt: "2026-01-01T00:00:00Z" }],
    });
    expect(plan.milestones[0].completedAt).toBeNull();
  });

  it("gives AI milestones stable positional ids so completion survives daily refreshes", async () => {
    const first = await respond({
      ...PLAN,
      milestones: [
        { id: "abc", title: "One" },
        { id: "xyz", title: "Two" },
      ],
    });
    const second = await respond({
      ...PLAN,
      milestones: [{ id: "q", title: "One (reworded)" }, { title: "Two" }],
    });
    expect(first.milestones.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(second.milestones.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("caps milestone title and description length", async () => {
    const plan = await respond({
      ...PLAN,
      milestones: [{ title: "T".repeat(500), description: "D".repeat(500) }],
    });
    expect(plan.milestones[0].title.length).toBe(80);
    expect(plan.milestones[0].description.length).toBe(200);
  });

  it("keeps task ids unique within each list even when the AI repeats or omits them", async () => {
    const plan = await respond({
      ...PLAN,
      todaySuggestions: [
        { ...task("Walk"), id: "dup" },
        { ...task("Stretch"), id: "dup" },
        { ...task("Hydrate"), id: undefined },
      ],
    });
    const ids = plan.todaySuggestions.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe("dup");
  });

  it("normalizes milestones: trims titles, fills ids, caps at three", async () => {
    const plan = await respond({
      ...PLAN,
      milestones: [
        { title: "  One  " },
        { id: "m2", title: "Two", description: 5 },
        { title: "Three" },
        { title: "Four" },
      ],
    });
    expect(plan.milestones).toEqual([
      { id: "m1", title: "One", description: "", completedAt: null },
      { id: "m2", title: "Two", description: "", completedAt: null },
      { id: "m3", title: "Three", description: "", completedAt: null },
    ]);
  });

  it("uses today's suggestions as the task pool when taskPool is missing", async () => {
    const plan = await respond({ ...PLAN, taskPool: undefined });
    expect(plan.taskPool.map((t) => t.text)).toEqual(plan.todaySuggestions.map((t) => t.text));
  });
});

describe("validateGeneratedTasks: untrusted input", () => {
  it("returns [] for non-arrays instead of throwing", () => {
    expect(validateGeneratedTasks(undefined)).toEqual([]);
    expect(validateGeneratedTasks(null)).toEqual([]);
    expect(validateGeneratedTasks({ text: "x" })).toEqual([]);
  });

  it("skips entries with missing or non-string text rather than crashing", () => {
    const result = validateGeneratedTasks([
      null,
      42,
      { estimatedMinutes: 10 },
      { text: 7, estimatedMinutes: 10 },
      task("Real task"),
    ]);
    expect(result.map((t) => t.text)).toEqual(["Real task"]);
  });

  it("rejects non-integer or out-of-range minutes", () => {
    expect(validateGeneratedTasks([{ ...task("A"), estimatedMinutes: "15" }])).toEqual([]);
    expect(validateGeneratedTasks([{ ...task("A"), estimatedMinutes: 4 }])).toEqual([]);
    expect(validateGeneratedTasks([{ ...task("A"), estimatedMinutes: 61 }])).toEqual([]);
    expect(validateGeneratedTasks([{ ...task("A"), estimatedMinutes: 7.5 }])).toEqual([]);
    expect(validateGeneratedTasks([task("A", 5), task("B", 60)])).toHaveLength(2);
  });

  it("trims text, de-duplicates case-insensitively, and fills safe defaults", () => {
    const result = validateGeneratedTasks([
      { text: "  Walk  ", estimatedMinutes: 10 },
      { text: "walk", estimatedMinutes: 10 },
    ]);
    expect(result).toEqual([
      {
        id: "task_1",
        text: "Walk",
        estimatedMinutes: 10,
        difficulty: "easy",
        reason: "",
        source: "ai",
      },
    ]);
  });

  it("caps reason length and replaces over-long ids", () => {
    const [result] = validateGeneratedTasks([
      { ...task("A"), id: "i".repeat(100), reason: "r".repeat(1000) },
    ]);
    expect(result.reason.length).toBe(200);
    expect(result.id).toBe("task_1");
  });

  it("uses the given prefix for generated ids", () => {
    expect(validateGeneratedTasks([{ text: "A", estimatedMinutes: 10 }], "ai_today")[0].id).toBe(
      "ai_today_1",
    );
  });

  it("keeps a template source but never trusts an unknown one", () => {
    expect(validateGeneratedTasks([{ ...task("A"), source: "template" }])[0].source).toBe(
      "template",
    );
    expect(validateGeneratedTasks([{ ...task("A"), source: "evil" }])[0].source).toBe("ai");
  });
});
