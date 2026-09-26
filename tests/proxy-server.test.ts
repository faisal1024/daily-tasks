import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEBUG_IP_ROUTE,
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
    {
      id: "t1",
      text: "Walk 20 minutes",
      estimatedMinutes: 20,
      difficulty: "easy",
      reason: "r",
      source: "ai",
    },
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

async function start({
  provider = fakeProvider(),
  env = {},
  now,
}: { provider?: FakeProvider; env?: Record<string, string>; now?: () => number } = {}) {
  const config = readConfig({ RATE_LIMIT_PER_MIN: "1000", ...env });
  const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };
  const { server, limiter } = createProxyServer({ provider, config, logger, now });
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
  return { base, post, provider, logger, server, limiter, port };
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
      trustProxyHops: 0,
      secretMode: "enforce",
      debugClientIp: false,
    });
  });

  it("only enters log mode or debug mode when explicitly asked", () => {
    expect(readConfig({ SECRET_MODE: "log" }).secretMode).toBe("log");
    expect(readConfig({ SECRET_MODE: "LOG" }).secretMode).toBe("enforce");
    expect(readConfig({ SECRET_MODE: "off" }).secretMode).toBe("enforce");
    expect(readConfig({ DEBUG_CLIENT_IP: "1" }).debugClientIp).toBe(true);
    expect(readConfig({ DEBUG_CLIENT_IP: "true" }).debugClientIp).toBe(false);
  });

  it("parses numeric overrides and allows 0 to disable a limit", () => {
    const config = readConfig({
      RATE_LIMIT_PER_MIN: "5",
      GLOBAL_DAILY_LIMIT: "0",
      TRUST_PROXY_HOPS: "2",
    });
    expect(config.rateLimitPerMinute).toBe(5);
    expect(config.globalDailyLimit).toBe(0);
    expect(config.trustProxyHops).toBe(2);
  });

  it("falls back to defaults for invalid numbers instead of disabling limits", () => {
    const config = readConfig({
      RATE_LIMIT_PER_MIN: "abc",
      DAILY_LIMIT_PER_CLIENT: "-4",
      PORT: "1.5",
    });
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
    ({
      headers: xff === undefined ? {} : { "x-forwarded-for": xff },
      socket: { remoteAddress: remote },
    }) as never;

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
  const allow = (limiter: ReturnType<typeof createRateLimiter>, client: string) => {
    const result = limiter.admit(client);
    if (result === "ok") limiter.record(client);
    return result;
  };

  it("limits per client per minute and resets exactly at the window boundary", () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 2, perDay: 0, globalPerDay: 0, now: () => t });
    expect(allow(limiter, "a")).toBe("ok");
    expect(allow(limiter, "a")).toBe("ok");
    expect(allow(limiter, "a")).toBe("minute");
    expect(allow(limiter, "b")).toBe("ok");
    t = 59_999;
    expect(allow(limiter, "a")).toBe("minute");
    t = 60_000;
    expect(allow(limiter, "a")).toBe("ok");
  });

  it("admit alone never spends the daily or global budget", () => {
    const limiter = createRateLimiter({ perMinute: 0, perDay: 1, globalPerDay: 1, now: () => 0 });
    for (let i = 0; i < 10; i++) expect(limiter.admit("a")).toBe("ok");
    expect(limiter.size()).toMatchObject({ day: 0, global: 0 });
    limiter.record("a");
    expect(limiter.admit("a")).toBe("global");
  });

  it("does not count minute-rejected requests against the daily budget", () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 1, perDay: 2, globalPerDay: 0, now: () => t });
    expect(allow(limiter, "a")).toBe("ok");
    expect(allow(limiter, "a")).toBe("minute");
    expect(allow(limiter, "a")).toBe("minute");
    t += 60_000;
    expect(allow(limiter, "a")).toBe("ok");
    t += 60_000;
    expect(allow(limiter, "a")).toBe("day");
  });

  it("enforces a global daily cap across all clients and resets at the UTC day boundary", () => {
    const DAY = 24 * 60 * 60_000;
    let t = DAY - 1;
    const limiter = createRateLimiter({ perMinute: 0, perDay: 0, globalPerDay: 3, now: () => t });
    expect(["a", "b", "c"].map((c) => allow(limiter, c))).toEqual(["ok", "ok", "ok"]);
    expect(allow(limiter, "brand-new-client")).toBe("global");
    t = DAY;
    expect(allow(limiter, "brand-new-client")).toBe("ok");
  });

  it("uses one clock for both windows: a new minute doesn't reset the day", () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 5, perDay: 2, globalPerDay: 0, now: () => t });
    expect(allow(limiter, "a")).toBe("ok");
    t += 60_000;
    expect(allow(limiter, "a")).toBe("ok");
    t += 60_000;
    expect(allow(limiter, "a")).toBe("day");
  });

  it("drops old clients when windows roll over so memory stays bounded", () => {
    let t = 0;
    const limiter = createRateLimiter({ perMinute: 10, perDay: 10, globalPerDay: 0, now: () => t });
    for (let i = 0; i < 50; i++) allow(limiter, `client-${i}`);
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

  it("applies the same rules as the app, so the proxy never 200s a plan the app rejects", () => {
    const withTask = (task: object) => ({ ...VALID_PLAN, todaySuggestions: [task] });
    expect(isValidPlan(withTask({ text: "Walk", estimatedMinutes: 4 }))).toBe(false);
    expect(isValidPlan(withTask({ text: "Walk", estimatedMinutes: 61 }))).toBe(false);
    expect(isValidPlan(withTask({ text: "Walk", estimatedMinutes: 7.5 }))).toBe(false);
    expect(isValidPlan(withTask({ text: "Walk", estimatedMinutes: "10" }))).toBe(false);
    expect(isValidPlan(withTask({ text: "x".repeat(65), estimatedMinutes: 10 }))).toBe(false);
    expect(isValidPlan(withTask({ text: "Walk", estimatedMinutes: 5 }))).toBe(true);
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

    it("lets preflight through without the secret and still sends CORS headers on 401", async () => {
      const { base, post } = await start({
        env: { PROXY_SHARED_SECRET: "s3cret", CORS_ORIGIN: "*" },
      });
      expect((await fetch(`${base}${PLAN_ROUTE}`, { method: "OPTIONS" })).status).toBe(204);
      const denied = await post();
      expect(denied.status).toBe(401);
      expect(denied.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("in SECRET_MODE=log, allows requests without the secret and logs a summary", async () => {
      const { post, logger } = await start({
        env: { PROXY_SHARED_SECRET: "s3cret", SECRET_MODE: "log" },
      });
      expect((await post()).status).toBe(200);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("without a valid secret"));
      expect((await post(VALID_PAYLOAD, { [SECRET_HEADER]: "s3cret" })).status).toBe(200);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it("throttles log-mode warnings to one summary per minute", async () => {
      let t = 0;
      const { post, logger } = await start({
        env: { PROXY_SHARED_SECRET: "s3cret", SECRET_MODE: "log" },
        now: () => t,
      });
      for (let i = 0; i < 5; i++) await post();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      t = 60_000;
      await post();
      expect(logger.warn).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenLastCalledWith(expect.stringContaining("5 request(s)"));
    });

    it("hides unknown routes behind auth", async () => {
      const { base } = await start({ env: { PROXY_SHARED_SECRET: "s3cret" } });
      expect((await fetch(`${base}/nope`, { method: "POST" })).status).toBe(401);
    });

    it("does not require a header when no secret is configured (local dev)", async () => {
      const { post } = await start();
      expect((await post()).status).toBe(200);
    });

    it("does not let unauthorized requests consume the rate limit", async () => {
      const { post } = await start({
        env: { PROXY_SHARED_SECRET: "s3cret", RATE_LIMIT_PER_MIN: "1" },
      });
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

    it("rejects a declared oversized Content-Length before reading, and closes the connection", async () => {
      const { post } = await start();
      const res = await post({
        ...VALID_PAYLOAD,
        recentReflection: "x".repeat(MAX_BODY_BYTES + 10),
      });
      expect(res.status).toBe(413);
      expect(res.headers.get("connection")).toBe("close");
    });

    it("stops a chunked upload that grows past the limit and closes the connection", async () => {
      const { port } = await start();
      const net = await import("node:net");
      const response = await new Promise<string>((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        let data = "";
        socket.on("data", (chunk) => (data += chunk.toString()));
        socket.on("close", () => resolve(data));
        socket.on("error", (error: NodeJS.ErrnoException) =>
          error.code === "ECONNRESET" || error.code === "EPIPE" ? resolve(data) : reject(error),
        );
        socket.write(
          `POST ${PLAN_ROUTE} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n`,
        );
        const chunk = "a".repeat(8_000);
        // Keep streaming well past the limit; the server should cut us off.
        let sent = 0;
        const pump = setInterval(() => {
          if (socket.destroyed || sent > 50) {
            clearInterval(pump);
            return;
          }
          socket.write(`${chunk.length.toString(16)}\r\n${chunk}\r\n`);
          sent += 1;
        }, 1);
      });
      expect(response).toContain("413");
      expect(response.toLowerCase()).toContain("connection: close");
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
      const provider = fakeProvider({
        generatePlan: vi.fn(async () => {
          throw new Error("upstream 529 overloaded");
        }),
      });
      const { post, logger } = await start({ provider });
      const res = await post();
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: "Momentum AI request failed" });
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("upstream 529 overloaded"));
    });

    it("returns 502 for an invalid plan and logs only its shape, not user content", async () => {
      const provider = fakeProvider({
        generatePlan: vi.fn(async () => ({
          milestones: [],
          todaySuggestions: [],
          taskPool: [],
          note: "Walk my dog Rex",
        })),
      });
      const { post, logger } = await start({ provider });
      expect((await post()).status).toBe(502);
      const logged = logger.error.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("invalid plan");
      expect(logged).not.toContain("Rex");
    });
  });

  describe("budgets are only spent on requests that reach the AI", () => {
    it("400, 413 and missing-key 500 responses don't consume the daily or global budget", async () => {
      const { post, limiter } = await start({
        env: { GLOBAL_DAILY_LIMIT: "1", DAILY_LIMIT_PER_CLIENT: "1" },
      });
      expect((await post("{bad")).status).toBe(400);
      expect((await post({ ...VALID_PAYLOAD, profile: null })).status).toBe(400);
      expect(
        (await post({ ...VALID_PAYLOAD, recentReflection: "x".repeat(MAX_BODY_BYTES) })).status,
      ).toBe(413);
      expect(limiter.size()).toMatchObject({ day: 0, global: 0 });
      expect((await post()).status).toBe(200);
      expect(limiter.size().global).toBe(1);
    });

    it("counts a provider failure against the budget (the AI was actually called)", async () => {
      const provider = fakeProvider({
        generatePlan: vi.fn(async () => {
          throw new Error("boom");
        }),
      });
      const { post, limiter } = await start({ provider });
      expect((await post()).status).toBe(502);
      expect(limiter.size().global).toBe(1);
    });

    it("treats 0 as 'no limit' over HTTP", async () => {
      const { post } = await start({
        env: { RATE_LIMIT_PER_MIN: "0", DAILY_LIMIT_PER_CLIENT: "0", GLOBAL_DAILY_LIMIT: "0" },
      });
      for (let i = 0; i < 40; i++) expect((await post()).status).toBe(200);
    });
  });

  describe("client IP debug endpoint", () => {
    it("stays off without a configured secret, even when enabled", async () => {
      const { base } = await start({ env: { DEBUG_CLIENT_IP: "1" } });
      expect((await fetch(`${base}${DEBUG_IP_ROUTE}`)).status).toBe(404);
    });

    it("is off by default", async () => {
      const { base } = await start();
      expect((await fetch(`${base}${DEBUG_IP_ROUTE}`)).status).toBe(404);
    });

    it("when enabled, requires the secret even in log mode and reports what the proxy sees", async () => {
      const { base } = await start({
        env: {
          DEBUG_CLIENT_IP: "1",
          PROXY_SHARED_SECRET: "s3cret",
          SECRET_MODE: "log",
          TRUST_PROXY_HOPS: "1",
        },
      });
      expect((await fetch(`${base}${DEBUG_IP_ROUTE}`)).status).toBe(404);
      const res = await fetch(`${base}${DEBUG_IP_ROUTE}`, {
        headers: { [SECRET_HEADER]: "s3cret", "x-forwarded-for": "6.6.6.6, 203.0.113.7" },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        resolvedClientIp: "203.0.113.7",
        forwardedFor: "6.6.6.6, 203.0.113.7",
        trustProxyHops: 1,
      });
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

    it("ignores X-Forwarded-For entirely with the default of 0 trusted hops", async () => {
      const { post } = await start({ env: { RATE_LIMIT_PER_MIN: "1" } });
      expect((await post(VALID_PAYLOAD, { "x-forwarded-for": "203.0.113.1" })).status).toBe(200);
      expect((await post(VALID_PAYLOAD, { "x-forwarded-for": "203.0.113.2" })).status).toBe(429);
    });

    it("keys the limit on the proxy-appended IP so spoofed headers can't bypass it", async () => {
      const { post } = await start({ env: { RATE_LIMIT_PER_MIN: "1", TRUST_PROXY_HOPS: "1" } });
      expect(
        (await post(VALID_PAYLOAD, { "x-forwarded-for": "1.1.1.1, 203.0.113.7" })).status,
      ).toBe(200);
      expect(
        (await post(VALID_PAYLOAD, { "x-forwarded-for": "9.9.9.9, 203.0.113.7" })).status,
      ).toBe(429);
      expect(
        (await post(VALID_PAYLOAD, { "x-forwarded-for": "9.9.9.9, 198.51.100.4" })).status,
      ).toBe(200);
    });

    it("returns 503 once the global daily cap is reached, even for new clients", async () => {
      const t = 1_000;
      const { post, provider } = await start({
        env: { GLOBAL_DAILY_LIMIT: "2", TRUST_PROXY_HOPS: "1" },
        now: () => t,
      });
      expect((await post(VALID_PAYLOAD, { "x-forwarded-for": "203.0.113.1" })).status).toBe(200);
      expect((await post(VALID_PAYLOAD, { "x-forwarded-for": "203.0.113.2" })).status).toBe(200);
      const res = await post(VALID_PAYLOAD, { "x-forwarded-for": "203.0.113.3" });
      expect(res.status).toBe(503);
      expect(provider.generatePlan).toHaveBeenCalledTimes(2);
    });
  });
});
