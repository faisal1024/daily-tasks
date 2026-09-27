// Runtime-independent request logic (server/handler.mjs), driven directly with
// a fake provider / budget / entitlements — no HTTP server involved.
import { describe, expect, it, vi } from "vitest";

import {
  BodyTooLargeError,
  DEBUG_IP_ROUTE,
  GRANDFATHER_ROUTE,
  HEALTH_ROUTE,
  MAX_BODY_BYTES,
  SECRET_HEADER,
  USER_HEADER,
  createHandler,
  ipKey,
  userIdFrom,
} from "../server/handler.mjs";
import { hashId, secretsMatch } from "../server/config.mjs";
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

const RC = `$RCAnonymousID:${"0123456789abcdef".repeat(2)}`;
const IP = "ip:1.2.3.4";
// Limit counters hold a hash of the id, never the raw id.
const UKEY = `user:${hashId(RC)}`;

type Limit = "ok" | "minute" | "day" | "global" | "free";
type Ent = "plus" | "free" | "unknown";
type Spend = { keys: string[]; free: { key: string; cap: number }[] };

function setup({
  env = {},
  admit = () => "ok" as Limit,
  spend = () => "ok" as Limit,
  entitlement = "plus",
  result,
  configured = true,
  withEntitlements = true,
  clock = { t: 1_000_000 },
}: {
  env?: Record<string, unknown>;
  admit?: (keys: string[]) => Limit;
  spend?: (req: Spend) => Limit;
  entitlement?: Ent;
  result?: unknown;
  configured?: boolean;
  withEntitlements?: boolean;
  clock?: { t: number };
} = {}) {
  const config = {
    sharedSecret: "",
    secretMode: "enforce",
    entitlementMode: "off",
    requireUserId: false,
    freeBrainDumpsPerDay: 8,
    noIdDailyLimit: 250,
    grandfatherGrantsUntil: 0,
    debugClientIp: false,
    trustProxyHops: 0,
    ...env,
  };
  const order: string[] = [];
  const generatePlan = vi.fn(async (args: object): Promise<unknown> => {
    order.push("ai");
    if (result !== undefined) return result;
    return (args as { toolName: string }).toolName.includes("brain") ? DUMP_RESULT : PLAN_RESULT;
  });
  const provider = {
    id: "fake",
    isConfigured: () => configured,
    missingConfigMessage: () => "FAKE_API_KEY is not configured",
    generatePlan,
  };
  const budget = {
    admit: vi.fn((keys: string[]) => {
      order.push("admit");
      return admit(keys);
    }),
    spend: vi.fn((req: Spend) => {
      order.push("spend");
      return spend(req);
    }),
  };
  const entitlements = {
    check: vi.fn(async (_id: string, _opts?: { fresh?: boolean }) => {
      order.push("check");
      return entitlement;
    }),
    grantLifetime: vi.fn(async (_id: string) => true),
  };
  const logger = { error: vi.fn(), warn: vi.fn() };
  const handle = createHandler({
    provider,
    config,
    budget,
    entitlements: withEntitlements ? entitlements : undefined,
    secretsMatch,
    logger,
    now: () => clock.t,
  });
  const call = ({
    method = "POST",
    path = PLAN_ROUTE,
    headers = {},
    clientIp = "1.2.3.4",
    body = path.startsWith(BRAIN_DUMP_ROUTE) ? DUMP_PAYLOAD : PLAN_PAYLOAD,
    readBody,
  }: {
    method?: string;
    path?: string;
    headers?: Record<string, string | string[] | undefined>;
    clientIp?: string;
    body?: unknown;
    readBody?: (max: number) => Promise<unknown>;
  } = {}) =>
    handle({
      method,
      path,
      headers,
      clientIp,
      socketAddress: "10.0.0.1",
      readBody:
        readBody ??
        (async () => {
          order.push("body");
          return body;
        }),
    });
  const warned = (text: string) => logger.warn.mock.calls.filter((c) => String(c[0]).includes(text)).length;
  return { call, provider, generatePlan, budget, entitlements, logger, clock, order, warned };
}

describe("handler basics", () => {
  it("answers health with the entitlement mode, without auth, limits or checks", async () => {
    for (const mode of ["off", "log", "enforce"]) {
      const t = setup({ env: { sharedSecret: "s", entitlementMode: mode } });
      expect(await t.call({ method: "GET", path: HEALTH_ROUTE })).toEqual({
        status: 200,
        body: { ok: true, provider: "fake", entitlements: mode },
      });
      expect(t.budget.admit).not.toHaveBeenCalled();
    }
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
    expect(t.budget.admit).not.toHaveBeenCalled();
    expect((await t.call({ headers: { [SECRET_HEADER]: "s3cret" } })).status).toBe(200);
  });

  it("lets unauthorized requests through in log mode and logs at most once a minute", async () => {
    const t = setup({ env: { sharedSecret: "s3cret", secretMode: "log" } });
    expect((await t.call()).status).toBe(200);
    expect((await t.call()).status).toBe(200);
    expect(t.warned("1 request(s) without a valid secret")).toBe(1);
    t.clock.t += 60_000;
    await t.call();
    expect(t.warned("2 request(s) without a valid secret")).toBe(1);
  });

  it.each([
    ["an unknown path", "POST", "/api/momentum/nope"],
    ["__proto__", "POST", "/__proto__"],
    ["__proto__ with a query", "POST", "/__proto__?x=1"],
    ["constructor", "POST", "constructor"],
    ["GET on a real route", "GET", PLAN_ROUTE],
  ])("returns 404 for %s", async (_why, method, path) => {
    const t = setup();
    expect(await t.call({ method, path })).toEqual({ status: 404, body: { error: "Not found" } });
    expect(t.budget.admit).not.toHaveBeenCalled();
  });

  it("routes on the path only, ignoring a query string", async () => {
    const t = setup();
    expect((await t.call({ path: `${PLAN_ROUTE}?utm=x` })).status).toBe(200);
    expect((await t.call({ method: "GET", path: `${HEALTH_ROUTE}?probe=1` })).status).toBe(200);
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

describe("userIdFrom (strict RevenueCat anonymous ids)", () => {
  it.each([
    [RC, RC],
    [[RC, "other"], RC],
    [RC.toUpperCase(), null],
    [`${RC}0`, null],
    ["$RCAnonymousID:abc123", null],
    ["custom_user-1.x", null],
    ["..", null],
    [".", null],
    ["../../v1/apps", null],
    ["", null],
    [undefined, null],
  ])("%j → %j", (raw, expected) => {
    expect(userIdFrom({ [USER_HEADER]: raw as string })).toBe(expected);
  });
});

describe("ipKey", () => {
  it.each([
    ["1.2.3.4", "ip:1.2.3.4"],
    ["unknown", "ip:unknown"],
    ["::ffff:1.2.3.4", "ip:::ffff:1.2.3.4"],
    ["2001:db8:85a3:1:2:3:4:5", "ip6:2001:db8:85a3:1::/64"],
    ["2001:DB8:85A3:0001:ffff::1", "ip6:2001:db8:85a3:1::/64"],
    ["2001:db8::1", "ip6:2001:db8:0:0::/64"],
    ["fe80::1%eth0", "ip6:fe80:0:0:0::/64"],
    ["::1", "ip6:0:0:0:0::/64"],
  ])("%s → %s", (ip, key) => {
    expect(ipKey(ip)).toBe(key);
  });

  it("puts every address in one IPv6 /64 under the same key", () => {
    expect(ipKey("2001:db8:1:2:aaaa::1")).toBe(ipKey("2001:db8:1:2:bbbb:cccc:dddd:eeee"));
    expect(ipKey("2001:db8:1:2::1")).not.toBe(ipKey("2001:db8:1:3::1"));
  });
});

describe("limits", () => {
  it("admits and spends by IP only without a valid user id", async () => {
    const t = setup();
    await t.call({ headers: { [USER_HEADER]: "bad id!" } });
    expect(t.budget.admit).toHaveBeenCalledWith([IP]);
    expect(t.budget.spend).toHaveBeenCalledWith({ keys: [IP], free: [] });
  });

  it("admits and spends by IP and user with a valid id", async () => {
    const t = setup();
    await t.call({ headers: { [USER_HEADER]: RC } });
    expect(t.budget.admit).toHaveBeenCalledWith([IP, UKEY]);
    expect(t.budget.spend).toHaveBeenCalledWith({ keys: [IP, UKEY], free: [] });
  });

  it("keys IPv6 clients by their /64", async () => {
    const t = setup();
    await t.call({ clientIp: "2001:db8:1:2:3:4:5:6" });
    expect(t.budget.admit).toHaveBeenCalledWith(["ip6:2001:db8:1:2::/64"]);
  });

  it.each([
    ["minute", 429, "Too many requests", "60"],
    ["day", 429, "Too many requests", "3600"],
    ["global", 503, "Service is busy, try again later", "3600"],
  ] as const)("maps admit %s to %i with Retry-After %s, before the body is read", async (limit, status, error, retry) => {
    const t = setup({ admit: () => limit });
    expect(await t.call()).toEqual({ status, body: { error }, headers: { "Retry-After": retry } });
    expect(t.order).toEqual(["admit"]);
  });

  it.each([
    ["day", 429],
    ["global", 503],
  ] as const)("maps spend %s to %i without calling the AI", async (limit, status) => {
    const t = setup({ spend: () => limit });
    expect((await t.call()).status).toBe(status);
    expect(t.generatePlan).not.toHaveBeenCalled();
  });

  it("runs admit → body → validate → check → spend → AI in that order", async () => {
    const t = setup({ env: { entitlementMode: "enforce" } });
    await t.call({ headers: { [USER_HEADER]: RC } });
    expect(t.order).toEqual(["admit", "body", "check", "spend", "ai"]);
  });
});

describe("entitlements", () => {
  const enforce = { entitlementMode: "enforce" };
  const withId = { [USER_HEADER]: RC };

  it("never checks when the mode is off", async () => {
    const t = setup({ entitlement: "free" });
    expect((await t.call({ headers: withId })).status).toBe(200);
    expect(t.entitlements.check).not.toHaveBeenCalled();
  });

  it("asks for a fresh answer on Plus routes only", async () => {
    const t = setup({ env: enforce });
    await t.call({ headers: withId });
    await t.call({ path: BRAIN_DUMP_ROUTE, headers: withId });
    expect(t.entitlements.check.mock.calls[0]).toEqual([RC, { fresh: true }]);
    expect(t.entitlements.check.mock.calls[1][0]).toBe(RC);
    expect(t.entitlements.check.mock.calls[1][1]?.fresh).toBeFalsy();
  });

  it("never checks junk bodies (validation comes first)", async () => {
    const t = setup({ env: enforce });
    expect((await t.call({ headers: withId, body: { profile: {} } })).status).toBe(400);
    expect(t.entitlements.check).not.toHaveBeenCalled();
  });

  it("allows requests with no id until ids are required, within the shared no-id ceiling, and logs them", async () => {
    const t = setup({ env: { ...enforce, noIdDailyLimit: 7 }, entitlement: "free" });
    expect((await t.call()).status).toBe(200);
    expect((await t.call({ headers: { [USER_HEADER]: ".." } })).status).toBe(200);
    expect(t.entitlements.check).not.toHaveBeenCalled();
    expect(t.budget.spend).toHaveBeenCalledWith({ keys: [IP], free: [{ key: "noid:all", cap: 7 }] });
    expect(t.warned("without an app user id")).toBe(1);
  });

  it("enforce: 402 once the shared no-id ceiling is spent; log mode spends without it", async () => {
    const overCap = (req: Spend) => (req.free.some((f) => f.key === "noid:all") ? "free" : "ok");
    const enforced = setup({ env: enforce, spend: overCap });
    expect(await enforced.call()).toEqual({ status: 402, body: { error: "Free limit reached" } });
    const logged = setup({ env: { entitlementMode: "log" }, spend: overCap });
    expect((await logged.call()).status).toBe(200);
    expect(logged.budget.spend.mock.calls[1][0]).toEqual({ keys: [IP], free: [] });
  });

  it("no-id requests spend no ceiling when the mode is off", async () => {
    const t = setup();
    await t.call();
    expect(t.budget.spend).toHaveBeenCalledWith({ keys: [IP], free: [] });
  });

  it("treats no id as free once ENTITLEMENT_REQUIRE_ID is on", async () => {
    const t = setup({ env: { ...enforce, requireUserId: true }, entitlement: "plus" });
    expect(await t.call()).toEqual({ status: 402, body: { error: "Plus required" } });
    expect(t.entitlements.check).not.toHaveBeenCalled();
    expect((await t.call({ path: BRAIN_DUMP_ROUTE })).status).toBe(200);
    // No id: only the per-network free cap applies.
    expect(t.budget.spend).toHaveBeenLastCalledWith({ keys: [IP], free: [{ key: `free:${IP}`, cap: 24 }] });
  });

  it("fails open (and logs) when RevenueCat can't answer", async () => {
    const t = setup({ env: enforce, entitlement: "unknown" });
    expect((await t.call({ headers: withId })).status).toBe(200);
    expect((await t.call({ path: BRAIN_DUMP_ROUTE, headers: withId })).status).toBe(200);
    expect(t.budget.spend.mock.calls.every((c) => c[0].free.length === 0)).toBe(true);
    expect(t.warned("RevenueCat couldn't answer")).toBe(1);
  });

  it.each([PLAN_ROUTE, BREAK_DOWN_ROUTE, EVENING_ROUTE])("enforce: 402 Plus required for a free id on %s", async (path) => {
    const t = setup({ env: enforce, entitlement: "free" });
    const body = {
      [PLAN_ROUTE]: PLAN_PAYLOAD,
      [BREAK_DOWN_ROUTE]: { task: "Clean the kitchen", goalTitle: null },
      [EVENING_ROUTE]: { result: "good", tasks: [] },
    }[path];
    expect(await t.call({ path, headers: withId, body })).toEqual({ status: 402, body: { error: "Plus required" } });
    expect(t.budget.spend).not.toHaveBeenCalled();
    expect(t.generatePlan).not.toHaveBeenCalled();
  });

  it("log mode lets a free id use a Plus route and logs once a minute", async () => {
    const t = setup({ env: { entitlementMode: "log" }, entitlement: "free" });
    expect((await t.call({ headers: withId })).status).toBe(200);
    expect((await t.call({ headers: withId })).status).toBe(200);
    expect(t.warned("without Plus on a Plus route")).toBe(1);
  });

  it("serves Plus users without any free caps", async () => {
    const t = setup({ env: enforce, entitlement: "plus" });
    expect((await t.call({ path: BRAIN_DUMP_ROUTE, headers: withId })).status).toBe(200);
    expect(t.budget.spend).toHaveBeenCalledWith({ keys: [IP, UKEY], free: [] });
  });

  it("gives free brain dumps a per-user cap and a looser per-network cap", async () => {
    const t = setup({ env: { ...enforce, freeBrainDumpsPerDay: 4 }, entitlement: "free" });
    expect((await t.call({ path: BRAIN_DUMP_ROUTE, headers: withId })).status).toBe(200);
    expect(t.budget.spend).toHaveBeenCalledWith({
      keys: [IP, UKEY],
      free: [
        { key: `free:${UKEY}`, cap: 4 },
        { key: `free:${IP}`, cap: 12 },
      ],
    });
  });

  it("enforce: 402 Free limit reached when the free cap is spent", async () => {
    const t = setup({ env: enforce, entitlement: "free", spend: (req) => (req.free.length ? "free" : "ok") });
    expect(await t.call({ path: BRAIN_DUMP_ROUTE, headers: withId })).toEqual({
      status: 402,
      body: { error: "Free limit reached" },
    });
    expect(t.budget.spend).toHaveBeenCalledTimes(1);
    expect(t.generatePlan).not.toHaveBeenCalled();
  });

  it("log mode: over the free cap spends again without free caps and logs", async () => {
    const t = setup({ env: { entitlementMode: "log" }, entitlement: "free", spend: (req) => (req.free.length ? "free" : "ok") });
    expect((await t.call({ path: BRAIN_DUMP_ROUTE, headers: withId })).status).toBe(200);
    expect(t.budget.spend).toHaveBeenCalledTimes(2);
    expect(t.budget.spend.mock.calls[1][0]).toEqual({ keys: [IP, UKEY], free: [] });
    expect(t.warned("over the daily free cap")).toBe(1);
  });

  it("log mode: a daily limit on the re-spend still answers 429", async () => {
    const t = setup({ env: { entitlementMode: "log" }, entitlement: "free", spend: (req) => (req.free.length ? "free" : "day") });
    expect((await t.call({ path: BRAIN_DUMP_ROUTE, headers: withId })).status).toBe(429);
    expect(t.generatePlan).not.toHaveBeenCalled();
  });
});

describe("body, validation, provider and result", () => {
  it("returns 500 with the provider's message when it isn't configured (after admit, before the body)", async () => {
    const t = setup({ configured: false });
    expect(await t.call()).toEqual({ status: 500, body: { error: "FAKE_API_KEY is not configured" } });
    expect(t.order).toEqual(["admit"]);
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
    expect(t.budget.spend).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const t = setup();
    expect(await t.call({ readBody: async () => JSON.parse("{nope") })).toEqual({
      status: 400,
      body: { error: "Invalid request body" },
    });
  });

  it("returns the validation message with 400 before any budget is spent", async () => {
    const t = setup();
    expect(await t.call({ body: { profile: {} } })).toEqual({ status: 400, body: { error: "Missing profile" } });
    expect(t.budget.spend).not.toHaveBeenCalled();
    expect(t.generatePlan).not.toHaveBeenCalled();
  });

  it("returns 502 for an invalid result and logs only its keys", async () => {
    const t = setup({ result: { secretTaskTitle: "Call my doctor about the rash" } });
    expect(await t.call()).toEqual({ status: 502, body: { error: "AI response did not include a valid plan" } });
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

  it.each([
    "Your credit balance is too low to access the Anthropic API",
    "You have reached your specified API usage limits",
    "insufficient_quota",
    "Billing hard limit reached",
  ])("answers 503 busy when the provider is out of credit: %s", async (message) => {
    const t = setup();
    t.generatePlan.mockRejectedValue(new Error(message));
    expect(await t.call()).toEqual({
      status: 503,
      body: { error: "Service is busy, try again later" },
      headers: { "Retry-After": "3600" },
    });
  });

  it("returns sanitised brain dumps and plans, never raw model output", async () => {
    const t = setup();
    const dump = await t.call({ path: BRAIN_DUMP_ROUTE });
    expect(JSON.stringify(dump.body)).not.toContain("model junk");
    const planT = setup({
      result: { ...PLAN_RESULT, extra: "x", milestones: [{ id: "m1", title: "T", description: "D", completedAt: null }] },
    });
    const plan = await planT.call();
    expect(plan.status).toBe(200);
    expect(plan.body).toEqual({ ...PLAN_RESULT, milestones: [{ title: "T", description: "D" }] });
  });
});

describe("supporter grant route", () => {
  const OPEN = { sharedSecret: "s3cret", grandfatherGrantsUntil: 2_000_000 };
  const auth = { [SECRET_HEADER]: "s3cret", [USER_HEADER]: RC };
  const grant = (t: ReturnType<typeof setup>, headers: Record<string, string> = auth) =>
    t.call({ path: GRANDFATHER_ROUTE, headers, body: {} });

  it("grants lifetime Plus while the window is open", async () => {
    const t = setup({ env: OPEN });
    expect(await grant(t)).toEqual({ status: 200, body: { granted: true } });
    expect(t.entitlements.grantLifetime).toHaveBeenCalledWith(RC);
    expect(t.budget.admit).toHaveBeenCalledWith([IP]);
    expect(t.budget.spend).toHaveBeenCalledWith({ keys: [], free: [{ key: `grant:${IP}`, cap: 3 }] });
    expect(t.generatePlan).not.toHaveBeenCalled();
  });

  it("works with the entitlement check off (grants come first)", async () => {
    const t = setup({ env: { ...OPEN, entitlementMode: "off" } });
    expect((await grant(t)).status).toBe(200);
  });

  it("needs a configured secret, even in SECRET_MODE=log", async () => {
    const noSecret = setup({ env: { grandfatherGrantsUntil: 2_000_000 } });
    expect(await grant(noSecret, { [USER_HEADER]: RC })).toEqual({ status: 401, body: { error: "Unauthorized" } });
    const logMode = setup({ env: { ...OPEN, secretMode: "log" } });
    expect((await grant(logMode, { [SECRET_HEADER]: "wrong", [USER_HEADER]: RC })).status).toBe(401);
    expect((await grant(logMode, { [USER_HEADER]: RC })).status).toBe(401);
    expect(logMode.entitlements.grantLifetime).not.toHaveBeenCalled();
  });

  it("answers 403 Closed outside the window", async () => {
    const closed = setup({ env: { sharedSecret: "s3cret", grandfatherGrantsUntil: 0 } });
    expect(await grant(closed)).toEqual({ status: 403, body: { error: "Closed" } });
    const past = setup({ env: { sharedSecret: "s3cret", grandfatherGrantsUntil: 1_000_000 }, clock: { t: 1_000_000 } });
    expect((await grant(past)).status).toBe(403);
    expect(past.budget.admit).not.toHaveBeenCalled();
  });

  it("answers 400 without a valid id or without grant support", async () => {
    const t = setup({ env: OPEN });
    expect(await grant(t, { [SECRET_HEADER]: "s3cret", [USER_HEADER]: ".." })).toEqual({
      status: 400,
      body: { error: "Missing user" },
    });
    const noEnt = setup({ env: OPEN, withEntitlements: false });
    expect((await grant(noEnt)).status).toBe(400);
  });

  it("caps claims per network per day", async () => {
    const t = setup({ env: OPEN, spend: () => "free" });
    expect(await grant(t)).toEqual({ status: 429, body: { error: "Too many requests" }, headers: { "Retry-After": "3600" } });
    expect(t.entitlements.grantLifetime).not.toHaveBeenCalled();
    const minute = setup({ env: OPEN, admit: () => "minute" });
    expect((await grant(minute)).status).toBe(429);
  });

  it("answers 503 busy when RevenueCat refuses", async () => {
    const t = setup({ env: OPEN });
    t.entitlements.grantLifetime.mockResolvedValue(false);
    expect((await grant(t)).status).toBe(503);
  });

  it("is POST only", async () => {
    const t = setup({ env: OPEN });
    expect((await t.call({ method: "GET", path: GRANDFATHER_ROUTE, headers: auth })).status).toBe(404);
  });
});
