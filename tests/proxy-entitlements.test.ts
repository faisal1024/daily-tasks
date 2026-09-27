// Server-side Plus check (server/entitlements.mjs), the new config fields, and
// the Node server with ENTITLEMENT_MODE=enforce against a fake RevenueCat.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as app from "../server/app.mjs";
import * as config from "../server/config.mjs";
import { PLUS_ENTITLEMENT, createEntitlements, hasActivePlus } from "../server/entitlements.mjs";

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
  const plus = () => vi.fn(async () => json(subscriber({ expires_date: FUTURE })));
  const free = () => vi.fn(async () => json(subscriber(undefined)));

  it("treats no user id as free without calling RevenueCat", async () => {
    const f = plus();
    const { ent } = make(f);
    expect(await ent.check(null)).toBe("free");
    expect(await ent.check("")).toBe("free");
    expect(f).not.toHaveBeenCalled();
  });

  it("answers unknown when no secret key is configured", async () => {
    const f = plus();
    const ent = createEntitlements({ secretKey: "", fetchImpl: f as unknown as typeof fetch });
    expect(await ent.check("u1")).toBe("unknown");
    expect(f).not.toHaveBeenCalled();
  });

  it("calls the subscriber endpoint with the encoded id and a Bearer key", async () => {
    const f = plus();
    const { ent } = make(f);
    expect(await ent.check("$RCAnonymousID:a/b")).toBe("plus");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.revenuecat.com/v1/subscribers/%24RCAnonymousID%3Aa%2Fb");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk_test");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("caches plus for an hour", async () => {
    const f = plus();
    const { ent, clock } = make(f);
    await ent.check("u1");
    clock.t += 59 * 60_000;
    expect(await ent.check("u1")).toBe("plus");
    expect(f).toHaveBeenCalledTimes(1);
    clock.t += 2 * 60_000;
    await ent.check("u1");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("caches free for only five minutes", async () => {
    const f = free();
    const { ent, clock } = make(f);
    expect(await ent.check("u1")).toBe("free");
    clock.t += 4 * 60_000;
    await ent.check("u1");
    expect(f).toHaveBeenCalledTimes(1);
    clock.t += 2 * 60_000;
    await ent.check("u1");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("answers unknown for a non-OK response, logs it, and doesn't cache it", async () => {
    const f = vi.fn(async () => json({}, 500));
    const { ent, logger } = make(f);
    expect(await ent.check("u1")).toBe("unknown");
    expect(await ent.check("u1")).toBe("unknown");
    expect(f).toHaveBeenCalledTimes(2);
    expect(ent.size()).toBe(0);
    expect(logger.warn.mock.calls[0][0]).toContain("HTTP 500");
  });

  it("answers unknown when fetch throws", async () => {
    const { ent } = make(vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await ent.check("u1")).toBe("unknown");
    expect(ent.size()).toBe(0);
  });

  it("answers unknown when RevenueCat is slower than the timeout", async () => {
    const hang = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const { ent } = make(hang, { timeoutMs: 5 });
    expect(await ent.check("u1")).toBe("unknown");
  });

  it("evicts the oldest entry when the cache is full", async () => {
    const f = plus();
    const { ent } = make(f, { maxEntries: 2 });
    await ent.check("a");
    await ent.check("b");
    await ent.check("c");
    expect(ent.size()).toBe(2);
    await ent.check("b");
    expect(f).toHaveBeenCalledTimes(3); // b still cached
    await ent.check("a");
    expect(f).toHaveBeenCalledTimes(4); // a was evicted
  });
});

describe("readConfig entitlement fields", () => {
  it("defaults to off, no key, 5 free brain dumps", () => {
    expect(config.readConfig({})).toMatchObject({
      entitlementMode: "off",
      revenueCatSecretKey: "",
      freeBrainDumpsPerDay: 5,
    });
  });

  it.each([
    ["enforce", "enforce"],
    ["log", "log"],
    ["off", "off"],
    ["ENFORCE", "off"],
    ["yes", "off"],
  ])("ENTITLEMENT_MODE=%s → %s", (raw, expected) => {
    expect(config.readConfig({ ENTITLEMENT_MODE: raw }).entitlementMode).toBe(expected);
  });

  it("reads FREE_BRAIN_DUMPS_PER_DAY and the RevenueCat key", () => {
    const c = config.readConfig({ FREE_BRAIN_DUMPS_PER_DAY: "3", REVENUECAT_SECRET_KEY: "sk_x" });
    expect(c.freeBrainDumpsPerDay).toBe(3);
    expect(c.revenueCatSecretKey).toBe("sk_x");
    expect(config.readConfig({ FREE_BRAIN_DUMPS_PER_DAY: "-1" }).freeBrainDumpsPerDay).toBe(5);
    expect(config.readConfig({ FREE_BRAIN_DUMPS_PER_DAY: "2.5" }).freeBrainDumpsPerDay).toBe(5);
  });

  it("app.mjs still re-exports the config helpers", () => {
    expect(app.readConfig).toBe(config.readConfig);
    expect(app.secretsMatch).toBe(config.secretsMatch);
    expect(app.createRateLimiter).toBe(config.createRateLimiter);
    expect(app.clientIpFrom).toBe(config.clientIpFrom);
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

  async function start() {
    const rc = vi.fn(async (url: string) =>
      json(url.endsWith("/plus-user") ? subscriber({ expires_date: null }) : subscriber(undefined)),
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
    const denied = await post("free-user");
    expect(denied.status).toBe(402);
    expect(await denied.json()).toEqual({ error: "Plus required" });
    expect(provider.generatePlan).not.toHaveBeenCalled();
    const ok = await post("plus-user");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual(PLAN_RESULT);
    expect(rc).toHaveBeenCalledTimes(2);
  });

  it("answers 402 without calling RevenueCat when no user id is sent", async () => {
    const { post, rc } = await start();
    expect((await post()).status).toBe(402);
    expect(rc).not.toHaveBeenCalled();
  });

  it("allows the x-rc-user header in CORS preflight", async () => {
    const { base } = await start();
    const res = await fetch(`${base}${app.PLAN_ROUTE}`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toContain("x-rc-user");
    expect(res.headers.get("access-control-allow-headers")).toContain(app.SECRET_HEADER);
  });
});
