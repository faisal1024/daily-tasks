// Runtime-independent request logic (server/handler.mjs), driven directly with
// fake provider / limiters / entitlements — no HTTP server involved.
import { describe, expect, it, vi } from "vitest";

import {
  BodyTooLargeError,
  DEBUG_IP_ROUTE,
  HEALTH_ROUTE,
  MAX_BODY_BYTES,
  SECRET_HEADER,
  USER_HEADER,
  createHandler,
  userIdFrom,
} from "../server/handler.mjs";
import { secretsMatch } from "../server/config.mjs";
import { BRAIN_DUMP_ROUTE, BREAK_DOWN_ROUTE, EVENING_ROUTE, PLAN_ROUTE } from "../server/routes.mjs";

const PLAN_PAYLOAD = {
  profile: { goalTitle: "Run a 5K", timeAvailability: "30_min" },
  settings: { suggestionTone: "calm", adaptivePlanning: true, eveningReflection: true },
  recentPerformance: { completed: 3, total: 6, missed: 3, daysReviewed: 2, completionRate: 0.5 },
  recentReflection: null,
  recentReflectionResult: null,
  recentTasks: [],
};
const PLAN_RESULT = {
  milestones: [{ title: "First mile", description: "" }],
  todaySuggestions: [{ text: "Walk 20 minutes", estimatedMinutes: 20, difficulty: "easy", reason: "r" }],
  taskPool: [],
};
const DUMP_PAYLOAD = { text: "call mum\nfinish report", openSlots: 2, goalTitle: null };
const DUMP_RESULT = {
  picks: [{ text: "Finish the report", reason: "due", extra: "model junk" }],
  parked: [{ text: "Call mum" }],
};

type Status = "ok" | "minute" | "day" | "global";
type Ent = "plus" | "free" | "unknown";

function setup({
  env = {},
  admit = () => "ok" as Status,
  freeAdmit = () => "ok" as Status,
  entitlement,
  result,
  configured = true,
  withEntitlements = true,
  withFreeLimiter = true,
  clock = { t: 1_000_000 },
}: {
  env?: Record<string, unknown>;
  admit?: (key: string) => Status;
  freeAdmit?: (key: string) => Status;
  entitlement?: Ent;
  result?: unknown;
  configured?: boolean;
  withEntitlements?: boolean;
  withFreeLimiter?: boolean;
  clock?: { t: number };
} = {}) {
  const config = {
    sharedSecret: "",
    secretMode: "enforce",
    entitlementMode: "off",
    debugClientIp: false,
    trustProxyHops: 0,
    ...env,
  };
  const generatePlan = vi.fn(async (args: object): Promise<unknown> =>
    result !== undefined
      ? result
      : (args as { toolName: string }).toolName.includes("brain")
        ? DUMP_RESULT
        : PLAN_RESULT,
  );
  const provider = {
    id: "fake",
    isConfigured: () => configured,
    missingConfigMessage: () => "FAKE_API_KEY is not configured",
    generatePlan,
  };
  const limiter = { admit: vi.fn(admit), record: vi.fn() };
  const freeLimiter = { admit: vi.fn(freeAdmit), record: vi.fn() };
  const entitlements = { check: vi.fn(async (_id: string | null) => entitlement ?? "plus") };
  const logger = { error: vi.fn(), warn: vi.fn() };
  const handle = createHandler({
    provider,
    config,
    limiter,
    freeLimiter: withFreeLimiter ? freeLimiter : undefined,
    entitlements: withEntitlements ? entitlements : undefined,
    secretsMatch,
    logger,
    now: () => clock.t,
  });
  const call = ({
    method = "POST",
    path = PLAN_ROUTE,
    headers = {},
    body = path === BRAIN_DUMP_ROUTE ? DUMP_PAYLOAD : PLAN_PAYLOAD,
    readBody,
  }: {
    method?: string;
    path?: string;
    headers?: Record<string, string | string[] | undefined>;
    body?: unknown;
    readBody?: (max: number) => Promise<unknown>;
  } = {}) =>
    handle({
      method,
      path,
      headers,
      clientIp: "1.2.3.4",
      socketAddress: "10.0.0.1",
      readBody: readBody ?? (async () => body),
    });
  return { call, provider, generatePlan, limiter, freeLimiter, entitlements, logger, clock };
}

const RC = "$RCAnonymousID:abc123";

describe("handler basics", () => {
  it("answers health without auth, limits or entitlements", async () => {
    const t = setup({ env: { sharedSecret: "s" }, entitlement: "free" });
    expect(await t.call({ method: "GET", path: HEALTH_ROUTE })).toEqual({
      status: 200,
      body: { ok: true, provider: "fake" },
    });
    expect(t.limiter.admit).not.toHaveBeenCalled();
    expect(t.entitlements.check).not.toHaveBeenCalled();
  });

  it("answers OPTIONS with 204 and no body, even without the secret", async () => {
    const t = setup({ env: { sharedSecret: "s" } });
    expect(await t.call({ method: "OPTIONS" })).toEqual({ status: 204, body: null });
  });

  it("rejects a missing/wrong secret with 401 in enforce mode before spending anything", async () => {
    const t = setup({ env: { sharedSecret: "s3cret" } });
    expect(await t.call({ headers: { [SECRET_HEADER]: "nope" } })).toEqual({
      status: 401,
      body: { error: "Unauthorized" },
    });
    expect(await t.call()).toMatchObject({ status: 401 });
    expect(t.limiter.admit).not.toHaveBeenCalled();
    expect(t.generatePlan).not.toHaveBeenCalled();
    expect((await t.call({ headers: { [SECRET_HEADER]: "s3cret" } })).status).toBe(200);
  });

  it("lets unauthorized requests through in log mode and logs at most once a minute", async () => {
    const t = setup({ env: { sharedSecret: "s3cret", secretMode: "log" } });
    expect((await t.call()).status).toBe(200);
    expect((await t.call()).status).toBe(200);
    expect(t.logger.warn).toHaveBeenCalledTimes(1);
    expect(t.logger.warn.mock.calls[0][0]).toContain("1 request(s) without a valid secret");
    t.clock.t += 60_000;
    await t.call();
    expect(t.logger.warn).toHaveBeenCalledTimes(2);
    // The second line summarises both requests seen since the first line.
    expect(t.logger.warn.mock.calls[1][0]).toContain("2 request(s) without a valid secret");
  });

  it.each([
    ["an unknown path", "POST", "/api/momentum/nope"],
    ["__proto__", "POST", "/__proto__"],
    ["constructor", "POST", "constructor"],
    ["GET on a real route", "GET", PLAN_ROUTE],
  ])("returns 404 for %s", async (_why, method, path) => {
    const t = setup();
    expect(await t.call({ method, path })).toEqual({ status: 404, body: { error: "Not found" } });
    expect(t.limiter.admit).not.toHaveBeenCalled();
  });

  it("only serves the debug IP route with a secret, the flag, and auth", async () => {
    const on = setup({ env: { sharedSecret: "s", debugClientIp: true, trustProxyHops: 1 } });
    const res = await on.call({
      method: "GET",
      path: DEBUG_IP_ROUTE,
      headers: { [SECRET_HEADER]: "s", "x-forwarded-for": "9.9.9.9" },
    });
    expect(res).toEqual({
      status: 200,
      body: { resolvedClientIp: "1.2.3.4", forwardedFor: "9.9.9.9", socketAddress: "10.0.0.1", trustProxyHops: 1 },
    });
    const noSecret = setup({ env: { debugClientIp: true } });
    expect((await noSecret.call({ method: "GET", path: DEBUG_IP_ROUTE })).status).toBe(404);
  });
});

describe("userIdFrom", () => {
  it.each([
    [RC, RC],
    ["custom_user-1.x", "custom_user-1.x"],
    [[RC, "other"], RC],
    ["", null],
    ["has space", null],
    ["a/b", null],
    ["x".repeat(101), null],
    [undefined, null],
  ])("%j → %j", (raw, expected) => {
    expect(userIdFrom({ [USER_HEADER]: raw as string })).toBe(expected);
  });
});

describe("rate limits", () => {
  it("limits by IP only without a (valid) user id", async () => {
    const t = setup();
    await t.call();
    await t.call({ headers: { [USER_HEADER]: "bad id!" } });
    expect(t.limiter.admit.mock.calls.map((c) => c[0])).toEqual(["ip:1.2.3.4", "ip:1.2.3.4"]);
    expect(t.limiter.record.mock.calls.map((c) => c[0])).toEqual(["ip:1.2.3.4", "ip:1.2.3.4"]);
  });

  it("limits by IP and user when a valid id is sent", async () => {
    const t = setup();
    await t.call({ headers: { [USER_HEADER]: RC } });
    expect(t.limiter.admit.mock.calls.map((c) => c[0])).toEqual(["ip:1.2.3.4", `user:${RC}`]);
    expect(t.limiter.record.mock.calls.map((c) => c[0])).toEqual(["ip:1.2.3.4", `user:${RC}`]);
  });

  it.each([
    ["minute", 429, "Too many requests", "60"],
    ["day", 429, "Too many requests", "3600"],
    ["global", 503, "Service is busy, try again later", "3600"],
  ] as const)("maps %s to %i with Retry-After %s", async (limit, status, error, retry) => {
    const t = setup({ admit: () => limit });
    expect(await t.call()).toEqual({ status, body: { error }, headers: { "Retry-After": retry } });
    expect(t.generatePlan).not.toHaveBeenCalled();
    expect(t.limiter.record).not.toHaveBeenCalled();
  });

  it("rejects when only the per-user key is over its limit", async () => {
    const t = setup({ admit: (key) => (key.startsWith("user:") ? "day" : "ok") });
    expect((await t.call({ headers: { [USER_HEADER]: RC } })).status).toBe(429);
    expect(t.generatePlan).not.toHaveBeenCalled();
  });
});

describe("entitlements", () => {
  it("never checks entitlements when the mode is off", async () => {
    const t = setup({ env: { entitlementMode: "off" }, entitlement: "free" });
    expect((await t.call({ headers: { [USER_HEADER]: RC } })).status).toBe(200);
    expect(t.entitlements.check).not.toHaveBeenCalled();
    expect(t.freeLimiter.admit).not.toHaveBeenCalled();
  });

  it("passes the parsed user id (or null) to the check", async () => {
    const t = setup({ env: { entitlementMode: "enforce" } });
    await t.call({ headers: { [USER_HEADER]: RC } });
    await t.call({ headers: { [USER_HEADER]: "bad id!" } });
    expect(t.entitlements.check.mock.calls).toEqual([[RC], [null]]);
  });

  it("log mode lets a free user use a Plus-only route and logs once a minute", async () => {
    const t = setup({ env: { entitlementMode: "log" }, entitlement: "free" });
    expect((await t.call()).status).toBe(200);
    expect((await t.call()).status).toBe(200);
    expect(t.generatePlan).toHaveBeenCalledTimes(2);
    const notes = t.logger.warn.mock.calls.filter((c) => String(c[0]).includes("would need Plus"));
    expect(notes).toHaveLength(1);
  });

  it("log mode lets a free brain dump over the cap through without spending the free budget", async () => {
    const t = setup({ env: { entitlementMode: "log" }, entitlement: "free", freeAdmit: () => "day" });
    expect((await t.call({ path: BRAIN_DUMP_ROUTE })).status).toBe(200);
    expect(t.freeLimiter.record).not.toHaveBeenCalled();
    expect(t.logger.warn.mock.calls.some((c) => String(c[0]).includes("over the daily free cap"))).toBe(true);
  });

  it.each([PLAN_ROUTE, BREAK_DOWN_ROUTE, EVENING_ROUTE])(
    "enforce mode answers 402 Plus required for a free user on %s",
    async (path) => {
      const t = setup({ env: { entitlementMode: "enforce" }, entitlement: "free" });
      expect(await t.call({ path, headers: { [USER_HEADER]: RC } })).toEqual({
        status: 402,
        body: { error: "Plus required" },
      });
      expect(t.generatePlan).not.toHaveBeenCalled();
      expect(t.limiter.record).not.toHaveBeenCalled();
    },
  );

  it("enforce mode serves Plus users on Plus-only routes", async () => {
    const t = setup({ env: { entitlementMode: "enforce" }, entitlement: "plus" });
    expect((await t.call({ headers: { [USER_HEADER]: RC } })).status).toBe(200);
    expect(t.freeLimiter.admit).not.toHaveBeenCalled();
  });

  it("enforce mode fails open when RevenueCat can't answer", async () => {
    const t = setup({ env: { entitlementMode: "enforce" }, entitlement: "unknown" });
    expect((await t.call({ headers: { [USER_HEADER]: RC } })).status).toBe(200);
    expect(t.freeLimiter.admit).not.toHaveBeenCalled();
  });

  it("enforce mode allows free brain dumps within the free limiter, then 402 Free limit reached", async () => {
    let used = 0;
    const t = setup({
      env: { entitlementMode: "enforce" },
      entitlement: "free",
      freeAdmit: () => (used < 2 ? "ok" : "day"),
    });
    t.freeLimiter.record.mockImplementation(() => {
      used += 1;
    });
    const dump = () => t.call({ path: BRAIN_DUMP_ROUTE, headers: { [USER_HEADER]: RC } });
    expect((await dump()).status).toBe(200);
    expect((await dump()).status).toBe(200);
    expect(await dump()).toEqual({ status: 402, body: { error: "Free limit reached" } });
    expect(t.freeLimiter.admit.mock.calls.every((c) => c[0] === `free:${RC}`)).toBe(true);
    expect(t.freeLimiter.record).toHaveBeenCalledTimes(2);
    expect(t.generatePlan).toHaveBeenCalledTimes(2);
  });

  it("keys the free allowance by IP when the app sends no user id", async () => {
    const t = setup({ env: { entitlementMode: "enforce" }, entitlement: "free" });
    await t.call({ path: BRAIN_DUMP_ROUTE });
    expect(t.freeLimiter.admit).toHaveBeenCalledWith("free:ip:1.2.3.4");
    expect(t.freeLimiter.record).toHaveBeenCalledWith("free:ip:1.2.3.4");
  });

  it("does not spend the free allowance when the dump is invalid", async () => {
    const t = setup({ env: { entitlementMode: "enforce" }, entitlement: "free" });
    expect((await t.call({ path: BRAIN_DUMP_ROUTE, body: { text: "" } })).status).toBe(400);
    expect(t.freeLimiter.record).not.toHaveBeenCalled();
    expect(t.limiter.record).not.toHaveBeenCalled();
  });

  it("does not touch the free limiter for Plus users on brain dumps", async () => {
    const t = setup({ env: { entitlementMode: "enforce" }, entitlement: "plus" });
    expect((await t.call({ path: BRAIN_DUMP_ROUTE })).status).toBe(200);
    expect(t.freeLimiter.admit).not.toHaveBeenCalled();
    expect(t.freeLimiter.record).not.toHaveBeenCalled();
  });
});

describe("body, validation, provider and result", () => {
  it("returns 500 with the provider's message when it isn't configured", async () => {
    const t = setup({ configured: false });
    expect(await t.call()).toEqual({ status: 500, body: { error: "FAKE_API_KEY is not configured" } });
  });

  it("returns 413 with tooLarge and Connection: close for an oversized body", async () => {
    const t = setup();
    const readBody = vi.fn(async () => {
      throw new BodyTooLargeError("big");
    });
    expect(await t.call({ readBody })).toEqual({
      status: 413,
      body: { error: "Request body too large" },
      headers: { Connection: "close" },
      tooLarge: true,
    });
    expect(readBody).toHaveBeenCalledWith(MAX_BODY_BYTES);
    expect(t.limiter.record).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const t = setup();
    const res = await t.call({
      readBody: async () => JSON.parse("{nope"),
    });
    expect(res).toEqual({ status: 400, body: { error: "Invalid request body" } });
  });

  it("returns the validation message with 400 before any budget is spent", async () => {
    const t = setup();
    expect(await t.call({ body: { profile: {} } })).toEqual({ status: 400, body: { error: "Missing profile" } });
    expect(t.limiter.record).not.toHaveBeenCalled();
    expect(t.generatePlan).not.toHaveBeenCalled();
  });

  it("records budgets only right before calling the AI", async () => {
    const order: string[] = [];
    const t = setup();
    t.limiter.record.mockImplementation((key: string) => {
      order.push(`record ${key}`);
    });
    t.generatePlan.mockImplementation(async () => {
      order.push("ai");
      return PLAN_RESULT;
    });
    await t.call();
    expect(order).toEqual(["record ip:1.2.3.4", "ai"]);
  });

  it("returns 502 for an invalid result and logs only its keys", async () => {
    const t = setup({ result: { secretTaskTitle: "Call my doctor about the rash" } });
    expect(await t.call()).toEqual({
      status: 502,
      body: { error: "AI response did not include a valid plan" },
    });
    const line = String(t.logger.error.mock.calls[0][0]);
    expect(line).toContain('keys=["secretTaskTitle"]');
    expect(line).not.toContain("rash");
  });

  it("returns 502 when the provider throws", async () => {
    const t = setup();
    t.generatePlan.mockRejectedValue(new Error("upstream 529"));
    expect(await t.call()).toEqual({ status: 502, body: { error: "Momentum AI request failed" } });
    expect(t.logger.error.mock.calls[0][0]).toContain("upstream 529");
  });

  it("returns the sanitised result, never raw model output", async () => {
    const t = setup();
    const res = await t.call({ path: BRAIN_DUMP_ROUTE });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("model junk");
    expect(res.body).toMatchObject({ picks: [{ text: "Finish the report", reason: "due" }] });
  });

  it("passes the route's prompt, schema and tool to the provider", async () => {
    const t = setup();
    await t.call();
    const args = t.generatePlan.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(args.toolName).toBeTypeOf("string");
    expect(String(args.user)).toContain("Run a 5K");
    expect(args.schema).toBeTypeOf("object");
  });
});
