// Server-side Plus check (server/entitlements.mjs), the new config fields, and
// the Node server with ENTITLEMENT_MODE=enforce against a fake RevenueCat.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as app from "../server/app.mjs";
import * as config from "../server/config.mjs";
import { PLUS_ENTITLEMENT, createEntitlements, hasActivePlus, subscriberUrl } from "../server/entitlements.mjs";

const NOW = Date.parse("2026-09-27T12:00:00Z");
const FUTURE = "2026-10-27T12:00:00Z";
const PAST = "2026-09-01T12:00:00Z";

function subscriber(entitlement: unknown) {
  return { subscriber: { entitlements: entitlement === undefined ? {} : { [PLUS_ENTITLEMENT]: entitlement } } };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("hasActivePlus", () => {
  it.each([
    ["null expiry (lifetime)", { expires_date: null }, true],
    ["missing expiry", {}, true],
    ["future expiry", { expires_date: FUTURE }, true],
    ["past expiry", { expires_date: PAST }, false],
    ["past expiry within grace", { expires_date: PAST, grace_period_expires_date: FUTURE }, true],
    ["past expiry and past grace", { expires_date: PAST, grace_period_expires_date: PAST }, false],
    ["unparseable expiry", { expires_date: "soon" }, false],
    ["no plus entitlement", undefined, false],
    ["entitlement not an object", "yes", false],
  ])("%s → %s", (_why, entitlement, expected) => {
    expect(hasActivePlus(subscriber(entitlement), NOW)).toBe(expected);
  });

  it("is false for malformed JSON", () => {
    expect(hasActivePlus(null, NOW)).toBe(false);
    expect(hasActivePlus({}, NOW)).toBe(false);
    expect(hasActivePlus({ subscriber: {} }, NOW)).toBe(false);
  });
});

const ID = `$RCAnonymousID:${"a".repeat(32)}`;

describe("subscriberUrl", () => {
  it("encodes the id into the subscribers path", () => {
    expect(subscriberUrl(ID)).toBe(`https://api.revenuecat.com/v1/subscribers/%24RCAnonymousID%3A${"a".repeat(32)}`);
    expect(subscriberUrl("a/b?c#d")).toBe("https://api.revenuecat.com/v1/subscribers/a%2Fb%3Fc%23d");
  });

  it.each(["..", ".", "%2e%2e"])("refuses %j, which would change the path", (id) => {
    // "%2e%2e" is encoded to "%252e%252e", so it stays inside the path.
    if (id === "%2e%2e") expect(subscriberUrl(id)).toContain("/v1/subscribers/%252e%252e");
    else expect(subscriberUrl(id)).toBeNull();
  });
});

describe("createEntitlements", () => {
  function make(fetchImpl: ReturnType<typeof vi.fn>, extra: Record<string, unknown> = {}) {
    const clock = { t: NOW };
    const logger = { warn: vi.fn() };
    const ent = createEntitlements({
      secretKey: "sk_test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => clock.t,
      logger,
      ...extra,
    });
    return { ent, clock, logger };
  }
  const plus = () => vi.fn(async (_url: string, _init?: RequestInit) => json(subscriber({ expires_date: FUTURE })));
  const free = () => vi.fn(async (_url: string, _init?: RequestInit) => json(subscriber(undefined)));
  const status = (code: number) => vi.fn(async (_url: string, _init?: RequestInit) => json({}, code));

  it("answers unknown with no id or no key, without calling RevenueCat", async () => {
    const f = plus();
    expect(await make(f).ent.check("")).toBe("unknown");
    const noKey = createEntitlements({ secretKey: "", fetchImpl: f as unknown as typeof fetch });
    expect(await noKey.check(ID)).toBe("unknown");
    expect(f).not.toHaveBeenCalled();
  });

  it("never sends '.' or '..' to RevenueCat", async () => {
    const f = plus();
    const { ent } = make(f);
    expect(await ent.check("..")).toBe("free");
    expect(await ent.check(".")).toBe("free");
    expect(f).not.toHaveBeenCalled();
  });

  it("calls the subscriber endpoint with a Bearer key and a timeout signal", async () => {
    const f = plus();
    const { ent } = make(f);
    expect(await ent.check(ID)).toBe("plus");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(subscriberUrl(ID));
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("caches plus for an hour, even for fresh checks", async () => {
    const f = plus();
    const { ent, clock } = make(f);
    await ent.check(ID);
    clock.t += 59 * 60_000;
    expect(await ent.check(ID, { fresh: true })).toBe("plus");
    expect(f).toHaveBeenCalledTimes(1);
    clock.t += 2 * 60_000;
    await ent.check(ID);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("caches free for a minute, but not for fresh checks", async () => {
    const f = free();
    const { ent, clock } = make(f);
    expect(await ent.check(ID)).toBe("free");
    clock.t += 30_000;
    expect(await ent.check(ID)).toBe("free");
    expect(f).toHaveBeenCalledTimes(1);
    await ent.check(ID, { fresh: true });
    expect(f).toHaveBeenCalledTimes(2);
    clock.t += 61_000;
    await ent.check(ID);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("sees a new subscriber on the next fresh check", async () => {
    const f = free();
    const { ent } = make(f);
    expect(await ent.check(ID)).toBe("free");
    f.mockImplementation(async () => json(subscriber({ expires_date: FUTURE })));
    expect(await ent.check(ID, { fresh: true })).toBe("plus");
  });

  it.each([429, 500, 503])("HTTP %i → unknown, then pauses lookups for 30s", async (code) => {
    const f = status(code);
    const { ent, clock, logger } = make(f);
    expect(await ent.check(ID)).toBe("unknown");
    expect(await ent.check(`$RCAnonymousID:${"b".repeat(32)}`)).toBe("unknown");
    expect(f).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toContain(`HTTP ${code}`);
    expect(ent.size()).toBe(0);
    clock.t += 30_000;
    await ent.check(ID);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("serves cached answers while paused", async () => {
    const f = plus();
    const { ent } = make(f);
    await ent.check(ID);
    f.mockImplementation(async () => json({}, 503));
    await ent.check(`$RCAnonymousID:${"b".repeat(32)}`); // outage starts
    expect(await ent.check(ID)).toBe("plus");
  });

  it.each([401, 403])("HTTP %i → unknown with a key warning, not paused", async (code) => {
    const f = status(code);
    const { ent, logger } = make(f);
    expect(await ent.check(ID)).toBe("unknown");
    expect(logger.warn.mock.calls[0][0]).toContain("REVENUECAT_SECRET_KEY");
    await ent.check(ID);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it.each([400, 404])("other 4xx (%i) → free, not cached", async (code) => {
    const f = status(code);
    const { ent } = make(f);
    expect(await ent.check(ID)).toBe("free");
    expect(ent.size()).toBe(0);
    await ent.check(ID);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("fetch throwing → unknown and paused", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => Promise.reject(new Error("offline")));
    const { ent } = make(f);
    expect(await ent.check(ID)).toBe("unknown");
    expect(await ent.check(ID)).toBe("unknown");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("a slow RevenueCat times out to unknown", async () => {
    const hang = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const { ent } = make(hang, { timeoutMs: 5 });
    expect(await ent.check(ID)).toBe("unknown");
  });

  it("warns at most once a minute during an outage", async () => {
    const f = status(503);
    const { ent, clock, logger } = make(f, { pauseMs: 1 });
    await ent.check(ID);
    clock.t += 10;
    await ent.check(ID);
    expect(f).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    clock.t += 60_000;
    await ent.check(ID);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently stored entry when full; a re-store moves it to newest", async () => {
    const f = free();
    const { ent, clock } = make(f, { maxEntries: 2 });
    await ent.check("a");
    await ent.check("b");
    clock.t += 61_000; // both free answers expire
    await ent.check("a"); // re-stored: a is now newest
    await ent.check("c"); // evicts b
    expect(ent.size()).toBe(2);
    const calls = f.mock.calls.length;
    await ent.check("a");
    expect(f.mock.calls.length).toBe(calls); // a still cached
    await ent.check("b");
    expect(f.mock.calls.length).toBe(calls + 1); // b was evicted
  });
});

describe("grantLifetime", () => {
  const make = (fetchImpl: ReturnType<typeof vi.fn>, secretKey = "sk_test") => {
    const logger = { warn: vi.fn() };
    const ent = createEntitlements({ secretKey, fetchImpl: fetchImpl as unknown as typeof fetch, now: () => NOW, logger });
    return { ent, logger };
  };

  it("POSTs a lifetime promotional Plus with the Bearer key, then answers plus from cache", async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => json({}));
    const { ent } = make(f);
    expect(await ent.grantLifetime(ID)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${subscriberUrl(ID)}/entitlements/plus/promotional`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ duration: "lifetime" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
    expect(await ent.check(ID, { fresh: true })).toBe("plus");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("answers false (and warns) when RevenueCat refuses, and false when fetch throws", async () => {
    const refused = make(vi.fn(async () => json({}, 400)));
    expect(await refused.ent.grantLifetime(ID)).toBe(false);
    expect(refused.logger.warn.mock.calls[0][0]).toContain("HTTP 400");
    expect(refused.ent.size()).toBe(0);
    const offline = make(vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await offline.ent.grantLifetime(ID)).toBe(false);
  });

  it("answers false without an id, a key, or a safe URL, without calling RevenueCat", async () => {
    const f = vi.fn(async () => json({}));
    expect(await make(f).ent.grantLifetime("")).toBe(false);
    expect(await make(f, "").ent.grantLifetime(ID)).toBe(false);
    expect(await make(f).ent.grantLifetime("..")).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("readConfig entitlement fields", () => {
  it("reads NO_ID_DAILY_LIMIT and GRANDFATHER_GRANTS_UNTIL", () => {
    expect(config.readConfig({})).toMatchObject({ noIdDailyLimit: 250, grandfatherGrantsUntil: 0 });
    expect(config.readConfig({ NO_ID_DAILY_LIMIT: "10" }).noIdDailyLimit).toBe(10);
    expect(config.readConfig({ GRANDFATHER_GRANTS_UNTIL: "2026-12-31" }).grandfatherGrantsUntil).toBe(
      Date.parse("2026-12-31"),
    );
    expect(config.readConfig({ GRANDFATHER_GRANTS_UNTIL: "soon" }).grandfatherGrantsUntil).toBe(0);
  });

  it("hashId is a stable 24-char hex hash that never contains the id", () => {
    const h = config.hashId(ID);
    expect(h).toMatch(/^[0-9a-f]{24}$/);
    expect(config.hashId(ID)).toBe(h);
    expect(config.hashId(`${ID}x`)).not.toBe(h);
    expect(h).not.toContain("aaaa");
  });

  it("defaults to off, no key, ids not required, 8 free brain dumps", () => {
    expect(config.readConfig({})).toMatchObject({
      entitlementMode: "off",
      entitlementMisconfigured: false,
      revenueCatSecretKey: "",
      requireUserId: false,
      freeBrainDumpsPerDay: 8,
    });
  });

  it.each([
    ["enforce", "sk_x", "enforce", false],
    ["log", "sk_x", "log", false],
    ["enforce", "", "off", true],
    ["log", undefined, "off", true],
    ["off", "sk_x", "off", false],
    ["ENFORCE", "sk_x", "off", false],
  ])("ENTITLEMENT_MODE=%s with key %j → %s (misconfigured %s)", (mode, key, expected, misconfigured) => {
    const env: Record<string, string> = { ENTITLEMENT_MODE: mode };
    if (key !== undefined) env.REVENUECAT_SECRET_KEY = key;
    const c = config.readConfig(env);
    expect(c.entitlementMode).toBe(expected);
    expect(c.entitlementMisconfigured).toBe(misconfigured);
  });

  it("reads ENTITLEMENT_REQUIRE_ID, FREE_BRAIN_DUMPS_PER_DAY and the key", () => {
    expect(config.readConfig({ ENTITLEMENT_REQUIRE_ID: "1" }).requireUserId).toBe(true);
    expect(config.readConfig({ ENTITLEMENT_REQUIRE_ID: "true" }).requireUserId).toBe(false);
    const c = config.readConfig({ FREE_BRAIN_DUMPS_PER_DAY: "3", REVENUECAT_SECRET_KEY: "sk_x" });
    expect(c.freeBrainDumpsPerDay).toBe(3);
    expect(c.revenueCatSecretKey).toBe("sk_x");
    expect(config.readConfig({ FREE_BRAIN_DUMPS_PER_DAY: "0" }).freeBrainDumpsPerDay).toBe(0);
    expect(config.readConfig({ FREE_BRAIN_DUMPS_PER_DAY: "-1" }).freeBrainDumpsPerDay).toBe(8);
  });

  it("app.mjs still re-exports the config helpers", () => {
    expect(app.readConfig).toBe(config.readConfig);
    expect(app.secretsMatch).toBe(config.secretsMatch);
    expect(app.createRateLimiter).toBe(config.createRateLimiter);
    expect(app.clientIpFrom).toBe(config.clientIpFrom);
  });
});

describe("createBudget (Node)", () => {
  const cfg = (env: Record<string, string> = {}) =>
    config.readConfig({ RATE_LIMIT_PER_MIN: "2", DAILY_LIMIT_PER_CLIENT: "3", GLOBAL_DAILY_LIMIT: "100", ...env });

  it("admits per key per minute and reports the first limit hit", () => {
    const budget = config.createBudget(cfg());
    expect(budget.admit(["ip:a", "user:u"])).toBe("ok");
    expect(budget.admit(["ip:a", "user:u"])).toBe("ok");
    expect(budget.admit(["ip:a", "user:u"])).toBe("minute");
    expect(budget.admit(["ip:b", "user:v"])).toBe("ok");
  });

  it("spends daily budgets and admit then reports the day limit", () => {
    const clock = { t: NOW };
    const budget = config.createBudget(cfg(), { now: () => clock.t });
    for (let i = 0; i < 3; i++) {
      clock.t += 60_000;
      expect(budget.admit(["ip:a"])).toBe("ok");
      expect(budget.spend({ keys: ["ip:a"], free: [] })).toBe("ok");
    }
    clock.t += 60_000;
    expect(budget.admit(["ip:a"])).toBe("day");
    expect(budget.limiter.size().global).toBe(3);
  });

  it("enforces free caps per key and never spends when a free cap is hit", () => {
    const budget = config.createBudget(cfg({ RATE_LIMIT_PER_MIN: "0" }));
    const req = { keys: ["ip:a"], free: [{ key: "free:user:u", cap: 1 }, { key: "free:ip:a", cap: 3 }] };
    expect(budget.spend(req)).toBe("ok");
    expect(budget.spend(req)).toBe("free");
    expect(budget.limiter.size().global).toBe(1);
    // Another user on the same network still has their own allowance.
    expect(budget.spend({ keys: ["ip:a"], free: [{ key: "free:user:v", cap: 1 }, { key: "free:ip:a", cap: 3 }] })).toBe("ok");
  });

  it("treats a free cap of 0 as no free AI, never unlimited", () => {
    const budget = config.createBudget(cfg());
    expect(budget.spend({ keys: ["ip:a"], free: [{ key: "free:ip:a", cap: 0 }] })).toBe("free");
    expect(budget.limiter.size().global).toBe(0);
  });
});

describe("Node server with ENTITLEMENT_MODE=enforce", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
  });

  const PLAN_PAYLOAD = {
    profile: { goalTitle: "Run a 5K" },
    settings: { suggestionTone: "calm", adaptivePlanning: true },
    recentPerformance: { completed: 1, total: 2, missed: 1, daysReviewed: 1 },
  };
  const PLAN_RESULT = {
    milestones: [],
    todaySuggestions: [{ text: "Walk 20 minutes", estimatedMinutes: 20, difficulty: "easy", reason: "r" }],
    taskPool: [],
  };

  const PLUS_USER = `$RCAnonymousID:${"c".repeat(32)}`;
  const FREE_USER = `$RCAnonymousID:${"d".repeat(32)}`;

  async function start(env: Record<string, string> = {}) {
    const rc = vi.fn(async (url: string) =>
      json(url.endsWith(PLUS_USER.slice(-32)) ? subscriber({ expires_date: null }) : subscriber(undefined)),
    );
    const provider = {
      id: "fake",
      isConfigured: () => true,
      missingConfigMessage: () => "",
      describe: () => "fake",
      generatePlan: vi.fn(async () => PLAN_RESULT),
    };
    const cfg = app.readConfig({
      RATE_LIMIT_PER_MIN: "1000",
      ENTITLEMENT_MODE: "enforce",
      REVENUECAT_SECRET_KEY: "sk_test",
      ...env,
    });
    const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
    const { server } = app.createProxyServer({
      provider,
      config: cfg,
      logger,
      fetchImpl: rc as unknown as typeof fetch,
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const post = (user?: string) =>
      fetch(`${base}${app.PLAN_ROUTE}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(user ? { [app.USER_HEADER]: user } : {}) },
        body: JSON.stringify(PLAN_PAYLOAD),
      });
    return { base, post, provider, rc };
  }

  it("answers 402 to a free user and 200 to a Plus user on the plan route", async () => {
    const { post, provider, rc } = await start();
    const denied = await post(FREE_USER);
    expect(denied.status).toBe(402);
    expect(await denied.json()).toEqual({ error: "Plus required" });
    expect(provider.generatePlan).not.toHaveBeenCalled();
    const ok = await post(PLUS_USER);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(PLAN_RESULT);
    expect(rc).toHaveBeenCalledTimes(2);
  });

  it("allows requests without an id until ids are required", async () => {
    const open = await start();
    expect((await open.post()).status).toBe(200);
    expect((await open.post("not-an-rc-id")).status).toBe(200);
    expect(open.rc).not.toHaveBeenCalled();
    const strict = await start({ ENTITLEMENT_REQUIRE_ID: "1" });
    expect((await strict.post()).status).toBe(402);
    expect(strict.rc).not.toHaveBeenCalled();
  });

  it("grants a supporter lifetime Plus over HTTP with the check off", async () => {
    const { base, rc, post } = await start({
      ENTITLEMENT_MODE: "off",
      PROXY_SHARED_SECRET: "s3cret",
      GRANDFATHER_GRANTS_UNTIL: "2999-12-31",
    });
    const res = await fetch(`${base}/api/momentum/grandfather`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [app.SECRET_HEADER]: "s3cret", [app.USER_HEADER]: FREE_USER },
      body: "{}",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ granted: true });
    expect(String(rc.mock.calls[0][0])).toContain("/entitlements/plus/promotional");
    // A request without the secret is still refused (secret enforced by default).
    expect((await post(FREE_USER)).status).toBe(401);
    expect(rc).toHaveBeenCalledTimes(1);
  });

  it("reports the entitlement mode on /health", async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}${app.HEALTH_ROUTE}`)).json()).toMatchObject({ entitlements: "enforce" });
  });

  it("answers 500 Internal error when the handler throws", async () => {
    const provider = {
      id: "fake",
      isConfigured: () => {
        throw new Error("boom");
      },
      missingConfigMessage: () => "",
      describe: () => "fake",
      generatePlan: vi.fn(),
    };
    const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
    const { server } = app.createProxyServer({ provider, config: app.readConfig({}), logger });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}${app.PLAN_ROUTE}`, { method: "POST", body: "{}" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal error" });
    expect(logger.error.mock.calls[0][0]).toContain("boom");
  });

  it("allows the x-rc-user header in CORS preflight", async () => {
    const { base } = await start();
    const res = await fetch(`${base}${app.PLAN_ROUTE}`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("x-rc-user");
    expect(res.headers.get("access-control-allow-headers")).toContain(app.SECRET_HEADER);
  });
});
