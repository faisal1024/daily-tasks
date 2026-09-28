// The AI helper routes (/brain-dump, /break-down) over real HTTP with a fake
// provider, plus the pure contracts they're built from. The plan route's own
// behaviour is covered in proxy-server.test.ts; here we check it's unchanged
// by the route table and that every route shares auth, limits and budgets.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BRAIN_DUMP_ROUTE,
  BREAK_DOWN_ROUTE,
  PLAN_ROUTE,
  ROUTES,
  SECRET_HEADER,
  createProxyServer,
  readConfig,
} from "../server/app.mjs";
import { COACH_NOTE_ROUTE, EVENING_ROUTE } from "../server/routes.mjs";
import {
  BRAIN_DUMP_SCHEMA,
  BRAIN_DUMP_SYSTEM_PROMPT,
  BRAIN_DUMP_TOOL_DESCRIPTION,
  BRAIN_DUMP_TOOL_NAME,
  BREAK_DOWN_SCHEMA,
  BREAK_DOWN_SYSTEM_PROMPT,
  BREAK_DOWN_TOOL_DESCRIPTION,
  BREAK_DOWN_TOOL_NAME,
  MAX_BRAIN_DUMP_CHARS,
  MAX_ECHO_TEXT,
  MAX_PARKED,
  MAX_STEPS,
  MAX_STEP_TEXT,
  MAX_TASK_CHARS,
  MAX_TASK_TEXT,
  MIN_STEPS,
  buildBrainDumpPrompt,
  buildBreakDownPrompt,
  fromDump,
  isValidBrainDump,
  isValidBreakDown,
  sanitizeBrainDump,
  sanitizeBreakDown,
  validateBrainDumpPayload,
  validateBreakDownPayload,
} from "../server/providers/helpers-contract.mjs";
import { MAX_PARKED as APP_MAX_PARKED } from "../lib/daily-tasks/ai-helpers";
import {
  PLAN_TOOL_DESCRIPTION,
  PLAN_TOOL_NAME,
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  sanitizePlan,
} from "../server/providers/plan-contract.mjs";

const PLAN_PAYLOAD = {
  profile: { goalTitle: "Run a 5K", timeAvailability: "30_min" },
  settings: { suggestionTone: "calm", adaptivePlanning: true, eveningReflection: true },
  recentPerformance: { completed: 3, total: 6, missed: 3, daysReviewed: 2, completionRate: 0.5 },
  recentReflection: null,
  recentReflectionResult: null,
  recentTasks: [],
};
const PLAN_RESULT = {
  milestones: [{ id: "m1", title: "First mile", description: "", completedAt: null }],
  todaySuggestions: [
    { id: "t1", text: "Walk 20 minutes", estimatedMinutes: 20, difficulty: "easy", reason: "r", source: "ai" },
  ],
  taskPool: [],
};
const DUMP_PAYLOAD = { text: "call mum\nfinish report\nbuy shoes", openSlots: 2, goalTitle: "Run a 5K" };
const DUMP_RESULT = {
  picks: [
    { text: "Finish the report", reason: "due" },
    { text: "Call mum", reason: "quick" },
  ],
  parked: [{ text: "Buy running shoes" }],
};
const BREAK_PAYLOAD = { task: "Clean the kitchen", goalTitle: null };
const BREAK_RESULT = { steps: [{ text: "Clear the counter" }, { text: "Load the dishwasher" }, { text: "Wipe surfaces" }] };

const PAYLOAD_FOR: Record<string, unknown> = {
  [PLAN_ROUTE]: PLAN_PAYLOAD,
  [BRAIN_DUMP_ROUTE]: DUMP_PAYLOAD,
  [BREAK_DOWN_ROUTE]: BREAK_PAYLOAD,
};

type GenerateArgs = {
  system: string;
  user: string;
  schema: unknown;
  toolName: string;
  toolDescription: string;
};

function fakeProvider(generate?: (args: GenerateArgs) => Promise<unknown>) {
  return {
    id: "fake",
    isConfigured: () => true,
    missingConfigMessage: () => "FAKE_API_KEY is not configured",
    describe: () => "fake",
    // By default answer each route with a valid result for the tool it asked for.
    generatePlan: vi.fn(async (raw: object) => {
      const args = raw as GenerateArgs;
      if (generate) return generate(args);
      if (args.toolName === BRAIN_DUMP_TOOL_NAME) return DUMP_RESULT;
      if (args.toolName === BREAK_DOWN_TOOL_NAME) return BREAK_RESULT;
      return PLAN_RESULT;
    }),
  };
}

const servers: Server[] = [];

async function start({
  provider = fakeProvider(),
  env = {},
}: { provider?: ReturnType<typeof fakeProvider>; env?: Record<string, string> } = {}) {
  const config = readConfig({ RATE_LIMIT_PER_MIN: "1000", ...env });
  const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
  const { server } = createProxyServer({ provider, config, logger });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const post = (
    route: string,
    body: unknown = PAYLOAD_FOR[route],
    headers: Record<string, string> = {},
    method = "POST",
  ) =>
    fetch(`${base}${route}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
  return { base, post, provider, logger };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("route table", () => {
  it("exposes exactly the plan, brain-dump, break-down, evening and coach-note routes", () => {
    expect(PLAN_ROUTE).toBe("/api/momentum/plan");
    expect(BRAIN_DUMP_ROUTE).toBe("/api/momentum/brain-dump");
    expect(BREAK_DOWN_ROUTE).toBe("/api/momentum/break-down");
    expect(EVENING_ROUTE).toBe("/api/momentum/evening");
    expect(COACH_NOTE_ROUTE).toBe("/api/momentum/coach-note");
    expect(Object.keys(ROUTES).sort()).toEqual(
      [BRAIN_DUMP_ROUTE, BREAK_DOWN_ROUTE, COACH_NOTE_ROUTE, EVENING_ROUTE, PLAN_ROUTE].sort(),
    );
    expect(ROUTES[EVENING_ROUTE].name).toBe("evening");
  });

  it("pairs each route with its own tool name, schema, prompt and validators", () => {
    expect(ROUTES[PLAN_ROUTE]).toMatchObject({
      name: "plan",
      toolName: PLAN_TOOL_NAME,
      toolDescription: PLAN_TOOL_DESCRIPTION,
      schema: RESPONSE_SCHEMA,
      system: SYSTEM_PROMPT,
    });
    expect(ROUTES[BRAIN_DUMP_ROUTE]).toMatchObject({
      name: "brain-dump",
      toolName: BRAIN_DUMP_TOOL_NAME,
      schema: BRAIN_DUMP_SCHEMA,
      isValidResult: isValidBrainDump,
      validatePayload: validateBrainDumpPayload,
    });
    expect(ROUTES[BREAK_DOWN_ROUTE]).toMatchObject({
      name: "break-down",
      toolName: BREAK_DOWN_TOOL_NAME,
      schema: BREAK_DOWN_SCHEMA,
      isValidResult: isValidBreakDown,
      validatePayload: validateBreakDownPayload,
    });
    // Tool names must differ so Anthropic's forced tool_choice can't mix them up.
    expect(new Set([PLAN_TOOL_NAME, BRAIN_DUMP_TOOL_NAME, BREAK_DOWN_TOOL_NAME]).size).toBe(3);
  });
});

describe("helper routes over HTTP", () => {
  it("brain-dump: passes the brain-dump tool, schema and prompt to the provider and returns its result", async () => {
    const { post, provider } = await start();
    const res = await post(BRAIN_DUMP_ROUTE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DUMP_RESULT);
    expect(provider.generatePlan).toHaveBeenCalledTimes(1);
    const args = provider.generatePlan.mock.calls[0][0] as GenerateArgs;
    expect(args).toEqual({
      system: BRAIN_DUMP_SYSTEM_PROMPT,
      user: buildBrainDumpPrompt(DUMP_PAYLOAD),
      schema: BRAIN_DUMP_SCHEMA,
      toolName: BRAIN_DUMP_TOOL_NAME,
      toolDescription: BRAIN_DUMP_TOOL_DESCRIPTION,
    });
    expect(args.user).toContain("finish report");
    expect(args.user).toContain("at most 2 item(s)");
  });

  it("break-down: passes the steps tool, schema and prompt to the provider and returns its result", async () => {
    const { post, provider } = await start();
    const res = await post(BREAK_DOWN_ROUTE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(BREAK_RESULT);
    expect(provider.generatePlan.mock.calls[0][0]).toEqual({
      system: BREAK_DOWN_SYSTEM_PROMPT,
      user: buildBreakDownPrompt(BREAK_PAYLOAD),
      schema: BREAK_DOWN_SCHEMA,
      toolName: BREAK_DOWN_TOOL_NAME,
      toolDescription: BREAK_DOWN_TOOL_DESCRIPTION,
    });
  });

  it("plan route is backward compatible: same payload and result, plan tool and schema", async () => {
    const { post, provider } = await start();
    const res = await post(PLAN_ROUTE);
    expect(res.status).toBe(200);
    // The plan is sanitised now: ids/source/completedAt from the model are dropped.
    expect(await res.json()).toEqual(sanitizePlan(PLAN_RESULT));
    expect(provider.generatePlan.mock.calls[0][0]).toMatchObject({
      system: SYSTEM_PROMPT,
      schema: RESPONSE_SCHEMA,
      toolName: PLAN_TOOL_NAME,
      toolDescription: PLAN_TOOL_DESCRIPTION,
    });
  });

  it("returns 404 for unknown routes, GET on helper routes, and near-miss paths", async () => {
    const { post, provider } = await start();
    for (const route of [
      "/api/momentum/brain-dumps",
      "/api/momentum/break-down/",
      "/api/momentum/BREAK-DOWN",
      "/api/momentum",
      "/api/momentum/constructor",
      "/api/momentum/__proto__",
    ]) {
      const res = await post(route, BREAK_PAYLOAD);
      expect(res.status, route).toBe(404);
    }
    expect((await post(BRAIN_DUMP_ROUTE, undefined, {}, "GET")).status).toBe(404);
    expect((await post(BREAK_DOWN_ROUTE, undefined, {}, "PUT")).status).toBe(404);
    expect(provider.generatePlan).not.toHaveBeenCalled();
  });

  it("matches routes on the path only, ignoring a query string", async () => {
    const { post } = await start();
    expect((await post(`${BREAK_DOWN_ROUTE}?x=1`, BREAK_PAYLOAD)).status).toBe(200);
  });

  it("validates each route's payload with its own validator (a plan payload isn't a brain dump)", async () => {
    const { post, provider } = await start();
    const bad = await post(BRAIN_DUMP_ROUTE, PLAN_PAYLOAD);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Missing or too long text" });
    const bad2 = await post(BREAK_DOWN_ROUTE, DUMP_PAYLOAD);
    expect(bad2.status).toBe(400);
    expect(await bad2.json()).toEqual({ error: "Missing or too long task" });
    const bad3 = await post(PLAN_ROUTE, BREAK_PAYLOAD);
    expect(bad3.status).toBe(400);
    expect(provider.generatePlan).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...DUMP_PAYLOAD, openSlots: 0 }, "openSlots must be 1-3"],
    [{ ...DUMP_PAYLOAD, openSlots: 4 }, "openSlots must be 1-3"],
    [{ ...DUMP_PAYLOAD, openSlots: "2" }, "openSlots must be 1-3"],
    [{ ...DUMP_PAYLOAD, text: "   " }, "Missing or too long text"],
    [{ ...DUMP_PAYLOAD, text: "x".repeat(MAX_BRAIN_DUMP_CHARS + 1) }, "Missing or too long text"],
    [{ ...DUMP_PAYLOAD, goalTitle: 42 }, "Invalid goalTitle"],
    [[], "Missing or too long text"],
  ])("brain-dump rejects %j with 400", async (payload, error) => {
    const { post, provider } = await start();
    const res = await post(BRAIN_DUMP_ROUTE, payload);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(provider.generatePlan).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON on a helper route with 400", async () => {
    const { post } = await start();
    const res = await post(BREAK_DOWN_ROUTE, "{not json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request body" });
  });

  it("returns 502 naming the route when the provider's result is invalid, and logs only its shape", async () => {
    const provider = fakeProvider(async (args) =>
      args.toolName === BRAIN_DUMP_TOOL_NAME
        ? { picks: [], parked: [{ text: "secret user words" }] }
        : { steps: [{ text: "only one step with private words" }] },
    );
    const { post, logger } = await start({ provider });

    const dump = await post(BRAIN_DUMP_ROUTE);
    expect(dump.status).toBe(502);
    expect(await dump.json()).toEqual({ error: "AI response did not include a valid brain-dump" });

    const steps = await post(BREAK_DOWN_ROUTE);
    expect(steps.status).toBe(502);
    expect(await steps.json()).toEqual({ error: "AI response did not include a valid break-down" });

    const logged = logger.error.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("brain-dump");
    expect(logged).not.toContain("secret user words");
    expect(logged).not.toContain("private words");
  });

  it("does not validate a helper result with the plan validator (a plan isn't a brain dump)", async () => {
    const provider = fakeProvider(async () => PLAN_RESULT);
    const { post } = await start({ provider });
    expect((await post(BRAIN_DUMP_ROUTE)).status).toBe(502);
    expect((await post(BREAK_DOWN_ROUTE)).status).toBe(502);
    expect((await post(PLAN_ROUTE)).status).toBe(200);
  });

  it("returns only sanitized, validated fields from helper routes (never raw model output)", async () => {
    const provider = fakeProvider(async (args) =>
      args.toolName === BRAIN_DUMP_TOOL_NAME
        ? {
            picks: [
              { text: "  Finish report  ", reason: "due", secret: "leak" },
              { text: `Report ${"x".repeat(MAX_TASK_TEXT)}` },
              { text: 5 },
            ],
            parked: [{ text: "Buy shoes", reason: "drop me" }, "bare string"],
            debug: { prompt: "system prompt" },
          }
        : {
            steps: [
              { text: "Clear", extra: 1 },
              { text: "Wipe" },
              { text: "" },
              { text: `${"s".repeat(MAX_STEP_TEXT - 2)}🎉🎉🎉` },
            ],
            usage: { tokens: 99 },
          },
    );
    const { post } = await start({ provider });
    expect(await (await post(BRAIN_DUMP_ROUTE)).json()).toEqual({
      // Over-long items are shortened (never dropped); non-text items are.
      picks: [
        { text: "Finish report", reason: "due" },
        { text: `${`Report ${"x".repeat(MAX_TASK_TEXT)}`.slice(0, MAX_TASK_TEXT - 1)}…` },
      ],
      parked: [{ text: "Buy shoes" }],
    });
    expect(await (await post(BREAK_DOWN_ROUTE)).json()).toEqual({
      steps: [
        { text: "Clear" },
        { text: "Wipe" },
        // Counted by code points, so the emoji isn't cut in half.
        { text: `${"s".repeat(MAX_STEP_TEXT - 2)}🎉…` },
      ],
    });
  });

  it("keeps a brain-dump answer whole once any pick comes from the dump (rewrites are fine)", async () => {
    const provider = fakeProvider(async () => ({
      picks: [
        { text: "Finish the report", reason: "due" },
        { text: "Check in with yourself", reason: "invented" },
        { text: "Call Mum" },
      ],
      parked: [{ text: "Meditate for ten minutes" }, { text: "Buy running shoes" }],
    }));
    const { post } = await start({ provider });
    const res = await post(BRAIN_DUMP_ROUTE);
    expect(res.status).toBe(200);
    // Only a fully invented answer is rejected; per-item filtering dropped real
    // rewrites ("do my taxes" → "File tax return") and non-Latin text.
    expect(await res.json()).toEqual({
      picks: [
        { text: "Finish the report", reason: "due" },
        { text: "Check in with yourself", reason: "invented" },
        { text: "Call Mum" },
      ],
      parked: [{ text: "Meditate for ten minutes" }, { text: "Buy running shoes" }],
    });
  });

  it("returns 502 when every brain-dump pick is invented, so the app falls back", async () => {
    const provider = fakeProvider(async () => ({
      picks: [{ text: "Check in with yourself" }, { text: "Drink water" }],
      // A real parked item doesn't rescue a response with no real picks.
      parked: [{ text: "Buy shoes" }],
    }));
    const { post, logger } = await start({ provider });
    const res = await post(BRAIN_DUMP_ROUTE);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "AI response did not include a valid brain-dump" });
    expect(logger.error).toHaveBeenCalled();
  });

  it("passes the request payload to the brain-dump guard: unspaced-script dumps keep rewritten picks", async () => {
    const provider = fakeProvider(async (args) =>
      args.toolName === BRAIN_DUMP_TOOL_NAME
        ? {
            picks: [{ text: "お母さんに電話する" }],
            parked: [{ text: "レポートを仕上げる" }],
          }
        : BREAK_RESULT,
    );
    const { post } = await start({ provider });
    const res = await post(BRAIN_DUMP_ROUTE, {
      text: "母に電話\nレポート終わらせる",
      openSlots: 1,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      picks: [{ text: "お母さんに電話する" }],
      parked: [{ text: "レポートを仕上げる" }],
    });
  });

  it("brain-dump 502s when the model translates a Latin dump into another script (nothing shared)", async () => {
    const provider = fakeProvider(async () => ({
      picks: [{ text: "Позвонить маме" }],
      parked: [],
    }));
    const { post } = await start({ provider });
    expect(
      (
        await post(BRAIN_DUMP_ROUTE, {
          text: "phone mother tonight",
          openSlots: 1,
        })
      ).status,
    ).toBe(502);
  });

  it("the brain-dump word guard doesn't leak into other routes (payload is ignored there)", async () => {
    // Steps and plan items share no words with their payloads; still 200.
    const provider = fakeProvider(async (args) =>
      args.toolName === BREAK_DOWN_TOOL_NAME
        ? {
            steps: [
              { text: "Stand up" },
              { text: "Fill sink" },
              { text: "Rinse plates" },
            ],
          }
        : args.toolName === BRAIN_DUMP_TOOL_NAME
          ? DUMP_RESULT
          : PLAN_RESULT,
    );
    const { post } = await start({ provider });
    expect(
      (
        await post(BREAK_DOWN_ROUTE, {
          task: "Clean the kitchen",
          goalTitle: null,
        })
      ).status,
    ).toBe(200);
    expect((await post(PLAN_ROUTE)).status).toBe(200);
  });

  it("returns a generic 502 when the provider throws on a helper route", async () => {
    const provider = fakeProvider(async () => {
      throw new Error("upstream said: sk-live-secret");
    });
    const { post } = await start({ provider });
    const res = await post(BREAK_DOWN_ROUTE);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Momentum AI request failed" });
  });

  it("requires the shared secret on helper routes too", async () => {
    const { post, provider } = await start({ env: { PROXY_SHARED_SECRET: "s3cret" } });
    expect((await post(BRAIN_DUMP_ROUTE)).status).toBe(401);
    expect((await post(BREAK_DOWN_ROUTE, undefined, { [SECRET_HEADER]: "wrong" })).status).toBe(401);
    expect(provider.generatePlan).not.toHaveBeenCalled();
    expect((await post(BREAK_DOWN_ROUTE, undefined, { [SECRET_HEADER]: "s3cret" })).status).toBe(200);
  });

  it("returns 500 with the config message on helper routes when the provider has no key", async () => {
    const provider = { ...fakeProvider(), isConfigured: () => false };
    const { post } = await start({ provider });
    const res = await post(BRAIN_DUMP_ROUTE);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "FAKE_API_KEY is not configured" });
  });
});

describe("limits and budgets are shared across routes", () => {
  it("the per-minute limit counts requests to every route together", async () => {
    const { post } = await start({ env: { RATE_LIMIT_PER_MIN: "2" } });
    expect((await post(PLAN_ROUTE)).status).toBe(200);
    expect((await post(BRAIN_DUMP_ROUTE)).status).toBe(200);
    const third = await post(BREAK_DOWN_ROUTE);
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("60");
  });

  it("the per-client daily budget is spent by any route", async () => {
    const { post } = await start({ env: { DAILY_LIMIT_PER_CLIENT: "2" } });
    expect((await post(BREAK_DOWN_ROUTE)).status).toBe(200);
    expect((await post(BRAIN_DUMP_ROUTE)).status).toBe(200);
    const res = await post(PLAN_ROUTE);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3600");
  });

  it("the global daily cap is shared across routes", async () => {
    const { post } = await start({ env: { GLOBAL_DAILY_LIMIT: "1" } });
    expect((await post(BRAIN_DUMP_ROUTE)).status).toBe(200);
    expect((await post(BREAK_DOWN_ROUTE)).status).toBe(503);
    expect((await post(PLAN_ROUTE)).status).toBe(503);
  });

  it("invalid helper payloads don't spend the daily budget", async () => {
    const { post, provider } = await start({ env: { DAILY_LIMIT_PER_CLIENT: "1" } });
    for (let i = 0; i < 3; i++) {
      expect((await post(BRAIN_DUMP_ROUTE, { text: "", openSlots: 1 })).status).toBe(400);
      expect((await post(BREAK_DOWN_ROUTE, { task: "" })).status).toBe(400);
    }
    expect((await post(BREAK_DOWN_ROUTE)).status).toBe(200);
    expect(provider.generatePlan).toHaveBeenCalledTimes(1);
    expect((await post(BRAIN_DUMP_ROUTE)).status).toBe(429);
  });

  it("a 502 from a helper route still spends the budget (the AI was called)", async () => {
    const provider = fakeProvider(async () => ({ steps: [] }));
    const { post } = await start({ provider, env: { DAILY_LIMIT_PER_CLIENT: "1" } });
    expect((await post(BREAK_DOWN_ROUTE)).status).toBe(502);
    expect((await post(BREAK_DOWN_ROUTE)).status).toBe(429);
    expect(provider.generatePlan).toHaveBeenCalledTimes(1);
  });
});

describe("brain-dump contract", () => {
  it("accepts a valid payload at the limits", () => {
    expect(validateBrainDumpPayload(DUMP_PAYLOAD)).toBeNull();
    expect(validateBrainDumpPayload({ text: "x".repeat(MAX_BRAIN_DUMP_CHARS), openSlots: 1 })).toBeNull();
    expect(validateBrainDumpPayload({ text: "a", openSlots: 3, goalTitle: null })).toBeNull();
    expect(validateBrainDumpPayload({ text: "a", openSlots: 3, goalTitle: "g".repeat(120) })).toBeNull();
  });

  it("rejects bad payloads", () => {
    expect(validateBrainDumpPayload(null)).toBe("Invalid JSON payload");
    expect(validateBrainDumpPayload("text")).toBe("Invalid JSON payload");
    expect(validateBrainDumpPayload({ text: 5, openSlots: 1 })).toBe("Missing or too long text");
    expect(validateBrainDumpPayload({ text: "a", openSlots: 1.5 })).toBe("openSlots must be 1-3");
    expect(validateBrainDumpPayload({ text: "a" })).toBe("openSlots must be 1-3");
    expect(validateBrainDumpPayload({ text: "a", openSlots: 1, goalTitle: "g".repeat(121) })).toBe(
      "Invalid goalTitle",
    );
  });

  it("builds a prompt with the goal, slot count and the trimmed dump inside delimiters", () => {
    const prompt = buildBrainDumpPrompt({ text: "  call mum \n", openSlots: 1, goalTitle: "Run a 5K" });
    expect(prompt).toContain("The person's bigger goal: Run a 5K");
    expect(prompt).toContain("Pick at most 1 item(s) for today.");
    expect(prompt).toContain('"""\ncall mum\n"""');
    expect(buildBrainDumpPrompt({ text: "x", openSlots: 3, goalTitle: null })).toContain(
      "No specific goal set.",
    );
  });

  it("requires at least one usable pick and array-shaped picks and parked", () => {
    expect(isValidBrainDump(DUMP_RESULT)).toBe(true);
    expect(isValidBrainDump({ picks: [{ text: "Walk" }], parked: [] })).toBe(true);
    expect(isValidBrainDump({ picks: [], parked: [{ text: "Walk" }] })).toBe(false);
    expect(isValidBrainDump({ picks: [{ text: "   " }], parked: [] })).toBe(false);
    // Long picks are shortened by the sanitizer, not rejected...
    expect(isValidBrainDump({ picks: [{ text: "x".repeat(MAX_TASK_TEXT + 1) }], parked: [] })).toBe(true);
    expect(isValidBrainDump({ picks: [{ text: "x".repeat(MAX_ECHO_TEXT) }], parked: [] })).toBe(true);
    // ...but an echo of the input is unusable, so the client falls back.
    expect(isValidBrainDump({ picks: [{ text: "x".repeat(MAX_ECHO_TEXT + 1) }], parked: [] })).toBe(false);
    expect(isValidBrainDump({ picks: [{ text: "x".repeat(250) }], parked: [] })).toBe(false);
    expect(isValidBrainDump({ picks: [{ text: "Walk" }] })).toBe(false);
    expect(isValidBrainDump({ picks: "Walk", parked: [] })).toBe(false);
    expect(isValidBrainDump({ picks: ["Walk"], parked: [] })).toBe(false);
    expect(isValidBrainDump(null)).toBe(false);
    expect(isValidBrainDump("{}")).toBe(false);
  });

  it("fromDump: an item must share a meaningful word or a word prefix with the dump", () => {
    // Exact word, case-insensitive.
    expect(fromDump("Call MUM", "call mum tonight")).toBe(true);
    expect(fromDump("REPORT draft", "finish the Report")).toBe(true);
    // Four-letter stem: groceries / groc, emails / email.
    expect(fromDump("Buy groceries", "groc run after work")).toBe(true);
    expect(fromDump("Answer emails", "email Sam back")).toBe(true);
    // Stopwords and short words alone don't count as a match.
    expect(fromDump("Take the dog", "take the bins")).toBe(false);
    // An item with no meaningful words can't be judged: keep it.
    expect(fromDump("Do it", "do it today")).toBe(true);
    // Rewrites that keep a stem.
    expect(fromDump("File tax return", "do my taxes")).toBe(true);
    expect(fromDump("Go for a run", "running")).toBe(true);
    // Unspaced scripts (Chinese, Japanese, Thai…) can't be split into words: keep.
    expect(fromDump("买牛奶", "买牛奶 打电话给妈妈")).toBe(true);
    expect(fromDump("Check in with yourself", "call mum\nfinish report")).toBe(false);
    // Non-Latin text is matched by letters, not ASCII only.
    expect(fromDump("Позвонить маме", "позвонить маме вечером")).toBe(true);
    expect(fromDump("Купить молоко", "позвонить маме")).toBe(false);
    expect(fromDump("Ιατρός ραντεβού", "κλείσε ραντεβού")).toBe(true);
    // Nothing meaningful to compare against: keep the item.
    expect(fromDump("Anything at all", "")).toBe(true);
    expect(fromDump("Anything at all", "the a to")).toBe(true);
  });

  it("keeps every item when one pick is from the dump; rejects only fully invented answers", () => {
    const payload = { text: "finish report\nbuy groceries\ncall mum", openSlots: 3, goalTitle: null };
    const result = {
      picks: [{ text: "Finish the report" }, { text: "Journal for 5 minutes" }],
      parked: [{ text: "Groceries" }, { text: "Stretch" }, { text: "Call Mum" }],
    };
    expect(isValidBrainDump(result, payload)).toBe(true);
    // Sanitizing never drops items for not matching (it only trims and caps).
    expect(sanitizeBrainDump(result)).toEqual(result);
    // All picks invented: invalid, even though a parked item is real.
    expect(isValidBrainDump({ picks: [{ text: "Stretch" }], parked: [{ text: "Call mum" }] }, payload)).toBe(false);
  });

  it("fromDump: unspaced scripts (Japanese, Korean, Thai, Chinese) always pass", () => {
    expect(fromDump("お母さんに電話する", "母に電話")).toBe(true);
    expect(fromDump("牛乳を買う", "スーパーで牛乳")).toBe(true);
    expect(fromDump("엄마한테 전화하기", "엄마에게 전화")).toBe(true);
    expect(fromDump("โทรหาแม่", "ซื้อนม")).toBe(true);
    // Judged by the dump's script, so even an unrelated English item passes...
    expect(fromDump("Check in with yourself", "ซื้อนม")).toBe(true);
    // ...including a mostly-Latin dump with one unspaced word in it.
    expect(fromDump("Check in with yourself", "call mum, buy 牛乳")).toBe(true);
    // A Latin dump doesn't get the pass just because the item is unspaced:
    // a translated/invented item shares nothing with the dump.
    expect(fromDump("牛乳を買う", "buy milk")).toBe(false);
  });

  it("fromDump: words under 3 letters and stopwords never count, prefixes need 3+ letters", () => {
    // Two-letter words are ignored: "tv" alone leaves nothing to judge (keep)...
    expect(fromDump("Fix TV", "tv")).toBe(true);
    expect(fromDump("Repair TV", "tv")).toBe(true);
    // ...but they can't rescue an item when the dump has other meaningful words.
    expect(fromDump("Repair TV", "fix tv")).toBe(false);
    // Stopword-only overlap ("call") doesn't count; the other word decides.
    expect(fromDump("Call dad", "call mum")).toBe(false);
    // Three-letter prefix either way round.
    expect(fromDump("Book gym class", "gymnastics")).toBe(true);
    expect(fromDump("Gymnastics", "gym bag")).toBe(true);
    // Prefix must be at the start of the word, not inside it.
    expect(fromDump("Pay rent", "parent evening")).toBe(false);
    // Numbers count as words when they're 3+ characters.
    expect(fromDump("Pay 250 bill", "250 to landlord")).toBe(true);
    // Punctuation and newlines separate words.
    expect(fromDump("Email Sam", "sam's-email/rent")).toBe(true);
  });

  it("isValidBrainDump judges only the sanitized picks the response will contain", () => {
    const payload = { text: "finish report", openSlots: 3, goalTitle: null };
    // The only matching pick is an echo (dropped by the sanitizer): invalid.
    const echo = "finish report ".repeat(20);
    expect(
      isValidBrainDump(
        { picks: [{ text: echo }, { text: "Stretch" }], parked: [] },
        payload,
      ),
    ).toBe(false);
    // The only matching pick is the 4th (past the 3-pick cap): invalid.
    const fourth = {
      picks: [
        { text: "Meditate" },
        { text: "Stretch" },
        { text: "Journal" },
        { text: "Finish report" },
      ],
      parked: [],
    };
    expect(isValidBrainDump(fourth, payload)).toBe(false);
    // A matching pick among non-string junk still counts.
    expect(
      isValidBrainDump(
        { picks: [{ text: 5 }, null, { text: "Report" }], parked: [] },
        payload,
      ),
    ).toBe(true);
    // A pick whose only words are short/stopwords can't be judged, so it passes.
    expect(
      isValidBrainDump({ picks: [{ text: "Do it" }], parked: [] }, payload),
    ).toBe(true);
    // A dump of only short words/stopwords keeps any answer.
    expect(
      isValidBrainDump(
        { picks: [{ text: "Stretch" }], parked: [] },
        { text: "do it", openSlots: 1 },
      ),
    ).toBe(true);
    // No payload at all: shape checks only.
    expect(
      isValidBrainDump({ picks: [{ text: "Stretch" }], parked: [] }, undefined),
    ).toBe(true);
  });

  it("sanitizeBrainDump caps picks at 3 and parked at MAX_PARKED without filtering by word match", () => {
    const many = Array.from({ length: MAX_PARKED + 5 }, (_, i) => ({
      text: `Invented ${i}`,
    }));
    const out = sanitizeBrainDump({ picks: many, parked: many });
    expect(out.picks).toHaveLength(3);
    expect(out.parked).toHaveLength(MAX_PARKED);
    expect(out.parked[MAX_PARKED - 1]).toEqual({
      text: `Invented ${MAX_PARKED - 1}`,
    });
  });

  // Unreachable through the handler (it validates text first), but safe.
  it(
    "a payload without text is treated like no payload (nothing to compare)",
    () => {
      const result = { picks: [{ text: "Call mum" }], parked: [] };
      expect(isValidBrainDump(result, { openSlots: 1 })).toBe(true);
      expect(isValidBrainDump(result, { text: null, openSlots: 1 })).toBe(true);
    },
  );

  // A decomposed (NFD) dump, e.g. pasted from macOS file names, still matches.
  it("fromDump matches precomposed and decomposed accents", () => {
    expect(fromDump("Visit café", "cafe\u0301")).toBe(true);
  });

  it("drops echo items (over MAX_ECHO_TEXT) instead of shortening them into tasks", () => {
    const echo = "call mum and ".repeat(20);
    expect(echo.length).toBeGreaterThan(MAX_ECHO_TEXT);
    const dump = { picks: [{ text: "Call mum" }, { text: echo }], parked: [{ text: echo }, { text: "Buy shoes" }] };
    expect(isValidBrainDump(dump)).toBe(true);
    expect(sanitizeBrainDump(dump)).toEqual({ picks: [{ text: "Call mum" }], parked: [{ text: "Buy shoes" }] });

    const steps = { steps: [{ text: "Open the doc" }, { text: echo }, { text: "Write one line" }] };
    expect(isValidBreakDown(steps)).toBe(true);
    expect(sanitizeBreakDown(steps).steps).toEqual([{ text: "Open the doc" }, { text: "Write one line" }]);
  });

  it("schema caps picks at 3 and parked at MAX_PARKED", () => {
    expect(BRAIN_DUMP_SCHEMA.properties.picks.maxItems).toBe(3);
    expect(BRAIN_DUMP_SCHEMA.properties.picks.minItems).toBe(1);
    expect(BRAIN_DUMP_SCHEMA.properties.parked.maxItems).toBe(MAX_PARKED);
    expect(BRAIN_DUMP_SCHEMA.required).toEqual(["picks", "parked"]);
  });

  // The app keeps up to 20 parked items per dump; the server must not cut them.
  it("server parked cap matches the app's (20)", () => {
    expect(MAX_PARKED).toBe(APP_MAX_PARKED);
  });
});

describe("break-down contract", () => {
  it("validates the task payload", () => {
    expect(validateBreakDownPayload(BREAK_PAYLOAD)).toBeNull();
    expect(validateBreakDownPayload({ task: "x".repeat(MAX_TASK_CHARS) })).toBeNull();
    expect(validateBreakDownPayload({ task: "x".repeat(MAX_TASK_CHARS + 1) })).toBe(
      "Missing or too long task",
    );
    expect(validateBreakDownPayload({ task: "  " })).toBe("Missing or too long task");
    expect(validateBreakDownPayload({ task: "a", goalTitle: {} })).toBe("Invalid goalTitle");
    expect(validateBreakDownPayload(undefined)).toBe("Invalid JSON payload");
  });

  it("builds a prompt with the trimmed task and optional goal context", () => {
    expect(buildBreakDownPrompt({ task: "  Clean kitchen  ", goalTitle: null })).toBe(
      "Task to break down: Clean kitchen",
    );
    expect(buildBreakDownPrompt({ task: "Clean", goalTitle: "Tidy home" })).toBe(
      "Their bigger goal (context only): Tidy home\nTask to break down: Clean",
    );
  });

  it("accepts two or more usable steps and ignores unusable ones", () => {
    expect(isValidBreakDown(BREAK_RESULT)).toBe(true);
    expect(isValidBreakDown({ steps: [{ text: "a" }, { text: "b" }] })).toBe(true);
    expect(isValidBreakDown({ steps: [{ text: "a" }] })).toBe(false);
    expect(isValidBreakDown({ steps: [{ text: "a" }, { text: " " }, { text: 3 }, null] })).toBe(false);
    // Long steps count (the sanitizer shortens them); echoes don't.
    expect(
      isValidBreakDown({ steps: [{ text: "a" }, { text: "x".repeat(MAX_STEP_TEXT + 1) }] }),
    ).toBe(true);
    expect(
      isValidBreakDown({ steps: [{ text: "a" }, { text: "x".repeat(MAX_ECHO_TEXT + 1) }] }),
    ).toBe(false);
    expect(isValidBreakDown({ steps: "a, b" })).toBe(false);
    expect(isValidBreakDown(null)).toBe(false);
  });

  it("shortens a 70-character step to at most MAX_STEP_TEXT, ending with an ellipsis", () => {
    const long = "Open the laptop and write down every single thing that is due this week";
    expect(long.length).toBeGreaterThan(MAX_STEP_TEXT);
    const result = { steps: [{ text: long }, { text: "Pick one" }, { text: "Start it" }] };
    expect(isValidBreakDown(result)).toBe(true);
    const [first, ...rest] = sanitizeBreakDown(result).steps;
    expect(Array.from(first.text).length).toBeLessThanOrEqual(MAX_STEP_TEXT);
    expect(first.text.endsWith("…")).toBe(true);
    expect(long.startsWith(first.text.slice(0, -1))).toBe(true);
    expect(rest).toEqual([{ text: "Pick one" }, { text: "Start it" }]);
  });

  it("schema asks for 3 to 5 steps", () => {
    expect(BREAK_DOWN_SCHEMA.properties.steps.minItems).toBe(MIN_STEPS);
    expect(BREAK_DOWN_SCHEMA.properties.steps.maxItems).toBe(MAX_STEPS);
    expect(MIN_STEPS).toBe(3);
    expect(MAX_STEPS).toBe(5);
  });
});
