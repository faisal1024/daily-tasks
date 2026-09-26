import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HEALTH_ROUTE,
  MAX_BODY_BYTES,
  PLAN_ROUTE,
  SECRET_HEADER,
  clientIpFrom,
  createProxyServer,
  createRateLimiter,
  readConfig,
  secretsMatch,
} from "../server/app.mjs";
import { isValidPlan } from "../server/providers/plan-contract.mjs";

const VALID_PAYLOAD = {
  profile: { goalTitle: "Run a 5K", timeAvailability: "30_min" },
  settings: { suggestionTone: "calm", adaptivePlanning: true, eveningReflection: true },
  recentPerformance: { completed: 3, total: 6, missed: 3, daysReviewed: 2, completionRate: 0.5 },
  recentReflection: null,
  recentReflectionResult: null,
  recentTasks: [],
};

const VALID_PLAN = {
  milestones: [{ id: "m1", title: "First mile", description: "", completedAt: null }],
  todaySuggestions: [
    { id: "t1", text: "Walk 20 minutes", estimatedMinutes: 20, difficulty: "easy", reason: "r", source: "ai" },
  ],
  taskPool: [],
};

type FakeProvider = {
  id: string;
  isConfigured: () => boolean;
  missingConfigMessage: () => string;
  describe: () => string;
  generatePlan: ReturnType<typeof vi.fn>;
};

function fakeProvider(overrides: Partial<FakeProvider> = {}): FakeProvider {
  return {
    id: "fake",
    isConfigured: () => true,
    missingConfigMessage: () => "FAKE_API_KEY is not configured",
    describe: () => "fake",
    generatePlan: vi.fn(async () => VALID_PLAN),
    ...overrides,
  };
}

const servers: Server[] = [];

async function start(
  {
    provider = fakeProvider(),
    env = {},
    now,
  }: { provider?: FakeProvider; env?: Record<string, string>; now?: () => number } = {},
) {
  const config = readConfig({ RATE_LIMIT_PER_MIN: "1000", ...env });
  const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
  const server = createProxyServer({ provider, config, logger, now });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const post = (body: unknown = VALID_PAYLOAD, headers: Record<string, string> = {}) =>
    fetch(`${base}${PLAN_ROUTE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  return { base, post, provider, logger, server };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe("readConfig", () => {
  it("uses safe defaults when env is empty", () => {
    expect(readConfig({})).toMatchObject({
      port: 8787,
      sharedSecret: "",
      corsOrigin: "",
      rateLimitPerMinute: 30,
      dailyLimitPerClient: 200,
      globalDailyLimit: 5000,
      trustProxyHops: 1,
    });
  });

  it("parses numeric overrides and allows 0 to disable a limit", () => {
    const config = readConfig({ RATE_LIMIT_PER_MIN: "5", GLOBAL_DAILY_LIMIT: "0", TRUST_PROXY_HOPS: "2" });
    expect(config.rateLimitPerMinute).toBe(5);
    expect(config.globalDailyLimit).toBe(0);
    expect(config.trustProxyHops).toBe(2);
  });

  it("falls back to defaults for invalid numbers instead of disabling limits", () => {
    const config = readConfig({ RATE_LIMIT_PER_MIN: "abc", DAILY_LIMIT_PER_CLIENT: "-4", PORT: "1.5" });
    expect(config.rateLimitPerMinute).toBe(30);
    expect(config.dailyLimitPerClient).toBe(200);
    expect(config.port).toBe(8787);
  });
});

describe("secretsMatch", () => {
  it("matches only the exact secret", () => {
    expect(secretsMatch("s3cret", "s3cret")).toBe(true);
    expect(secretsMatch("s3creT", "s3cret")).toBe(false);
    expect(secretsMatch("s3cret-longer", "s3cret")).toBe(false);
    expect(secretsMatch("", "s3cret")).toBe(false);
  });

  it("never matches when there is no expected secret or the header is missing", () => {
    expect(secretsMatch(undefined, "s3cret")).toBe(false);
    expect(secretsMatch("anything", "")).toBe(false);
    expect(secretsMatch(["s3cret"], "s3cret")).toBe(false);
  });
});

describe("clientIpFrom", () => {
  const req = (xff?: string | string[], remote = "10.0.0.9") =>
    ({ headers: xff === undefined ? {} : { "x-forwarded-for": xff }, socket: { remoteAddress: remote } }) as never;

  it("uses the entry appended by the trusted proxy, not a client-supplied one", () => {
    // A client that sends its own X-Forwarded-For gets the real IP appended by Render.
    expect(clientIpFrom(req("6.6.6.6, 203.0.113.7"), 1)).toBe("203.0.113.7");
    expect(clientIpFrom(req("1.1.1.1, 2.2.2.2, 203.0.113.7"), 2)).toBe("2.2.2.2");
  });

  it("handles repeated headers delivered as an array", () => {
    expect(clientIpFrom(req(["6.6.6.6", "203.0.113.7"]), 1)).toBe("203.0.113.7");
  });

  it("falls back to the socket address when forwarding info is missing or too short", () => {
    expect(clientIpFrom(req(undefined), 1)).toBe("10.0.0.9");
    expect(clientIpFrom(req("203.0.113.7"), 2)).toBe("10.0.0.9");
    expect(clientIpFrom(req("203.0.113.7"), 0)).toBe("10.0.0.9");
  });
});

describe("createRateLimiter", () => {
  it("limits per client per minute and resets on the next window", () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 2, perDay: 0, globalPerDay: 0, now: () => t });
    expect(limiter.check("a")).toBe("ok");
    expect(limiter.check("a")).toBe("ok");
    expect(limiter.check("a")).toBe("minute");
    expect(limiter.check("b")).toBe("ok");
    t += 60_000;
    expect(limiter.check("a")).toBe("ok");
  });

  it("does not count rejected requests against the daily budget", () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 1, perDay: 2, globalPerDay: 0, now: () => t });
    expect(limiter.check("a")).toBe("ok");
    expect(limiter.check("a")).toBe("minute");
    expect(limiter.check("a")).toBe("minute");
    t += 60_000;
    expect(limiter.check("a")).toBe("ok");
    t += 60_000;
    expect(limiter.check("a")).toBe("day");
  });

  it("enforces a global daily cap across all clients and resets the next day", () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 0, perDay: 0, globalPerDay: 3, now: () => t });
    expect(["a", "b", "c"].map((c) => limiter.check(c))).toEqual(["ok", "ok", "ok"]);
    expect(limiter.check("brand-new-client")).toBe("global");
    t += 24 * 60 * 60_000;
    expect(limiter.check("brand-new-client")).toBe("ok");
  });

  it("drops old clients when windows roll over so memory stays bounded", () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 10, perDay: 10, globalPerDay: 0, now: () => t });
    for (let i = 0; i < 50; i++) limiter.check(`client-${i}`);
    expect(limiter.size().minute).toBe(50);
    t += 60_000;
    expect(limiter.size().minute).toBe(0);
    t += 24 * 60 * 60_000;
    expect(limiter.size().day).toBe(0);
  });
});

describe("isValidPlan", () => {
  it("requires at least one usable suggestion", () => {
    expect(isValidPlan(VALID_PLAN)).toBe(true);
    expect(isValidPlan({ ...VALID_PLAN, todaySuggestions: [] })).toBe(false);
    expect(isValidPlan({ ...VALID_PLAN, todaySuggestions: [{ text: "   " }, null] })).toBe(false);
    expect(isValidPlan({ ...VALID_PLAN, taskPool: undefined })).toBe(false);
    expect(isValidPlan(null)).toBe(false);
  });
});

describe("proxy server", () => {
  it("serves an unauthenticated health check", async () => {
    const { base } = await start({ env: { PROXY_SHARED_SECRET: "s3cret" } });
    const res = await fetch(`${base}${HEALTH_ROUTE}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, provider: "fake" });
  });

  it("answers CORS preflight and only sends an allow-origin when configured", async () => {
    const open = await start({ env: { CORS_ORIGIN: "*" } });
    const pre = await fetch(`${open.base}${PLAN_ROUTE}`, { method: "OPTIONS" });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("*");
    expect(pre.headers.get("access-control-allow-headers")).toContain(SECRET_HEADER);

    const closed = await start();
    const res = await fetch(`${closed.base}${PLAN_ROUTE}`, { method: "OPTIONS" });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("returns 404 for unknown routes and wrong methods", async () => {
    const { base } = await start();
    expect((await fetch(`${base}/nope`, { method: "POST" })).status).toBe(404);
    expect((await fetch(`${base}${PLAN_ROUTE}`)).status).toBe(404);
  });

  it("returns a plan and forwards the prompt pieces to the provider", async () => {
    const { post, provider } = await start();
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VALID_PLAN);
    expect(provider.generatePlan).toHaveBeenCalledTimes(1);
    const args = provider.generatePlan.mock.calls[0][0];
    expect(args.user).toContain("Run a 5K");
    expect(typeof args.system).toBe("string");
    expect(args.schema).toBeTruthy();
  });

  describe("shared secret", () => {
    it("rejects requests without the header or with a wrong one, before calling the provider", async () => {
      const { post, provider } = await start({ env: { PROXY_SHARED_SECRET: "s3cret" } });
      expect((await post()).status).toBe(401);
      expect((await post(VALID_PAYLOAD, { [SECRET_HEADER]: "wrong" })).status).toBe(401);
      expect(provider.generatePlan).not.toHaveBeenCalled();
    });

    it("accepts the correct secret", async () => {
      const { post } = await start({ env: { PROXY_SHARED_SECRET: "s3cret" } });
      expect((await post(VALID_PAYLOAD, { [SECRET_HEADER]: "s3cret" })).status).toBe(200);
    });

    it("does not require a header when no secret is configured (local dev)", async () => {
      const { post } = await start();
      expect((await post()).status).toBe(200);
    });

    it("does not let unauthorized requests consume the rate limit", async () => {
      const { post } = await start({ env: { PROXY_SHARED_SECRET: "s3cret", RATE_LIMIT_PER_MIN: "1" } });
      for (let i = 0; i < 3; i++) expect((await post()).status).toBe(401);
      expect((await post(VALID_PAYLOAD, { [SECRET_HEADER]: "s3cret" })).status).toBe(200);
    });
  });

  describe("request validation", () => {
    it("rejects malformed JSON with 400", async () => {
      const { post, provider } = await start();
      const res = await post("{not json");
      expect(res.status).toBe(400);
      expect(provider.generatePlan).not.toHaveBeenCalled();
    });

    it("rejects payloads missing required fields with the validation message", async () => {
      const { post } = await start();
      const res = await post({ ...VALID_PAYLOAD, recentPerformance: undefined });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Missing recent performance" });
    });

    it("rejects oversized bodies with 413 and keeps serving afterwards", async () => {
      const { post, base } = await start();
      const huge = { ...VALID_PAYLOAD, recentReflection: "x".repeat(MAX_BODY_BYTES + 10) };
      const res = await post(huge);
      expect(res.status).toBe(413);
      expect((await fetch(`${base}${HEALTH_ROUTE}`)).status).toBe(200);
    });

    it("measures the limit in bytes, not characters", async () => {
      const { post } = await start();
      // Each emoji is 4 bytes but 2 UTF-16 chars: under the char count, over the byte limit.
      const emojis = "🔥".repeat(Math.ceil(MAX_BODY_BYTES / 3.5));
      expect((await post({ ...VALID_PAYLOAD, recentReflection: emojis })).status).toBe(413);
    });
  });

  describe("provider failures", () => {
    it("returns 500 with a config message when the provider has no key", async () => {
      const { post } = await start({ provider: fakeProvider({ isConfigured: () => false }) });
      const res = await post();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: "FAKE_API_KEY is not configured" });
    });

    it("returns 502 when the provider throws, without leaking the error", async () => {
      const provider = fakeProvider({ generatePlan: vi.fn(async () => { throw new Error("upstream 529 overloaded"); }) });
      const { post, logger } = await start({ provider });
      const res = await post();
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "Momentum AI request failed" });
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("upstream 529 overloaded"));
    });

    it("returns 502 for an invalid plan and logs only its shape, not user content", async () => {
      const provider = fakeProvider({
        generatePlan: vi.fn(async () => ({ milestones: [], todaySuggestions: [], taskPool: [], note: "Walk my dog Rex" })),
      });
      const { post, logger } = await start({ provider });
      expect((await post()).status).toBe(502);
      const logged = logger.error.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("invalid plan");
      expect(logged).not.toContain("Rex");
    });
  });

  describe("rate limiting over HTTP", () => {
    it("returns 429 with Retry-After once a client exceeds the per-minute limit", async () => {
      const { post } = await start({ env: { RATE_LIMIT_PER_MIN: "2" } });
      expect((await post()).status).toBe(200);
      expect((await post()).status).toBe(200);
      const limited = await post();
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
    });

    it("keys the limit on the proxy-appended IP so spoofed headers can't bypass it", async () => {
      const { post } = await start({ env: { RATE_LIMIT_PER_MIN: "1", TRUST_PROXY_HOPS: "1" } });
      expect((await post(VALID_PAYLOAD, { "x-forwarded-for": "1.1.1.1, 203.0.113.7" })).status).toBe(200);
      expect((await post(VALID_PAYLOAD, { "x-forwarded-for": "9.9.9.9, 203.0.113.7" })).status).toBe(429);
      expect((await post(VALID_PAYLOAD, { "x-forwarded-for": "9.9.9.9, 198.51.100.4" })).status).toBe(200);
    });

    it("returns 503 once the global daily cap is reached, even for new clients", async () => {
      const t = 1_000;
      const { post, provider } = await start({ env: { GLOBAL_DAILY_LIMIT: "2" }, now: () => t });
      expect((await post(VALID_PAYLOAD, { "x-forwarded-for": "203.0.113.1" })).status).toBe(200);
      expect((await post(VALID_PAYLOAD, { "x-forwarded-for": "203.0.113.2" })).status).toBe(200);
      const res = await post(VALID_PAYLOAD, { "x-forwarded-for": "203.0.113.3" });
      expect(res.status).toBe(503);
      expect(provider.generatePlan).toHaveBeenCalledTimes(2);
    });
  });
});
