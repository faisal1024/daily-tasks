// Cloudflare Worker entry (server/worker.mjs). The Workers runtime module and
// the provider registry are mocked; env.LIMITS is a fake Durable Object stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashId } from "../server/config.mjs";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));

const PLAN_RESULT = {
  milestones: [],
  todaySuggestions: [{ text: "Walk 20 minutes", estimatedMinutes: 20, difficulty: "easy", reason: "r" }],
  taskPool: [],
};
const provider = {
  id: "fake",
  isConfigured: () => true,
  missingConfigMessage: () => "FAKE_API_KEY is not configured",
  describe: () => "fake",
  generatePlan: vi.fn(async () => PLAN_RESULT),
};
vi.mock("../server/providers/index.mjs", () => ({
  DEFAULT_PROVIDER_ID: "fake",
  getProvider: () => provider,
}));

const RC = `$RCAnonymousID:${"e".repeat(32)}`;

const PLAN_PAYLOAD = {
  profile: { goalTitle: "Run a 5K" },
  settings: { suggestionTone: "calm", adaptivePlanning: true },
  recentPerformance: { completed: 1, total: 2, missed: 1, daysReviewed: 1 },
};

type Limit = "ok" | "minute" | "day" | "global" | "free";
type Spend = { keys: string[]; free: { key: string; cap: number }[] };

function fakeEnv(vars: Record<string, string> = {}, admit: (keys: string[]) => Limit = () => "ok") {
  const stub = {
    admit: vi.fn(async (keys: string[]) => admit(keys)),
    spend: vi.fn(async (_req: Spend) => "ok" as Limit),
  };
  const LIMITS = {
    idFromName: vi.fn((name: string) => `id:${name}`),
    get: vi.fn((_id: string) => stub),
  };
  return { env: { ...vars, LIMITS }, stub, LIMITS };
}

/** Minimal in-memory stand-in for ctx.storage.sql (the four statements Limits uses). */
function fakeSql() {
  const rows = new Map<string, { day: number; key: string; n: number }>();
  const statements: string[] = [];
  const exec = vi.fn((query: string, ...args: unknown[]) => {
    statements.push(query);
    let result: unknown[] = [];
    if (query.startsWith("CREATE TABLE")) {
      expect(query).toContain("day_counts");
    } else if (query.startsWith("DELETE FROM day_counts WHERE day < ?")) {
      for (const [id, row] of rows) if (row.day < (args[0] as number)) rows.delete(id);
    } else if (query.startsWith("SELECT n FROM day_counts")) {
      const row = rows.get(`${args[0]}|${args[1]}`);
      result = row ? [{ n: row.n }] : [];
    } else if (query.startsWith("INSERT INTO day_counts")) {
      const id = `${args[0]}|${args[1]}`;
      const row = rows.get(id);
      if (row) row.n += 1;
      else rows.set(id, { day: args[0] as number, key: args[1] as string, n: 1 });
    } else {
      throw new Error(`unexpected SQL: ${query}`);
    }
    return { toArray: () => result };
  });
  return { sql: { exec }, rows, statements };
}

// worker.mjs caches its setup per isolate, so load a fresh copy per test.
async function loadWorker() {
  vi.resetModules();
  return import("../server/worker.mjs");
}

function request(path: string, init: RequestInit & { headers?: Record<string, string> } = {}) {
  return new Request(`https://ai.example.workers.dev${path}`, {
    method: "POST",
    body: init.method === "GET" || init.method === "OPTIONS" ? undefined : JSON.stringify(PLAN_PAYLOAD),
    ...init,
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  provider.generatePlan.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("worker fetch", () => {
  it("answers health as JSON with CORS headers", async () => {
    const { default: worker } = await loadWorker();
    const { env } = fakeEnv({ CORS_ORIGIN: "https://app.example" });
    const res = await worker.fetch(request("/health", { method: "GET" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(res.headers.get("access-control-allow-headers")).toBe("Content-Type, x-momentum-secret, x-rc-user");
    expect(await res.json()).toEqual({ ok: true, provider: "fake", entitlements: "off" });
  });

  it("answers OPTIONS with an empty 204 and no allow-origin when CORS_ORIGIN is unset", async () => {
    const { default: worker } = await loadWorker();
    const res = await worker.fetch(request("/api/momentum/plan", { method: "OPTIONS" }), fakeEnv().env);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
  });

  it("serves a plan through the global Limits object keyed by cf-connecting-ip and user (2 calls)", async () => {
    const { default: worker } = await loadWorker();
    const { env, stub, LIMITS } = fakeEnv();
    const res = await worker.fetch(request("/api/momentum/plan", { headers: { "X-RC-User": RC } }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PLAN_RESULT);
    expect(LIMITS.idFromName).toHaveBeenCalledWith("global");
    expect(stub.admit).toHaveBeenCalledTimes(1);
    const userKey = `user:${hashId(RC)}`;
    expect(stub.admit).toHaveBeenCalledWith(["ip:203.0.113.7", userKey]);
    expect(stub.spend).toHaveBeenCalledWith({ keys: ["ip:203.0.113.7", userKey], free: [] });
  });

  it("answers a clean 503 JSON with CORS when the Limits object throws", async () => {
    const { default: worker } = await loadWorker();
    const { env, stub } = fakeEnv({ CORS_ORIGIN: "https://app.example" });
    stub.admit.mockRejectedValue(new Error("Durable Object reset because its code was updated"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await worker.fetch(request("/api/momentum/plan"), env);
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: "Temporarily unavailable" });
    expect(errors.mock.calls[0][0]).toContain("Durable Object reset");
    errors.mockRestore();
  });

  it("answers 503 JSON even when setup itself throws (no LIMITS binding)", async () => {
    const { default: worker } = await loadWorker();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await worker.fetch(request("/api/momentum/plan"), {});
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Temporarily unavailable" });
    errors.mockRestore();
  });

  it("uses 'unknown' as the client when cf-connecting-ip is missing", async () => {
    const { default: worker } = await loadWorker();
    const { env, stub } = fakeEnv();
    const req = new Request("https://ai.example.workers.dev/api/momentum/plan", {
      method: "POST",
      body: JSON.stringify(PLAN_PAYLOAD),
    });
    await worker.fetch(req, env);
    expect(stub.admit).toHaveBeenCalledWith(["ip:unknown"]);
  });

  it("maps a limit to 429 with Retry-After and CORS headers", async () => {
    const { default: worker } = await loadWorker();
    const { env } = fakeEnv({ CORS_ORIGIN: "*" }, () => "minute");
    const res = await worker.fetch(request("/api/momentum/plan"), env);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({ error: "Too many requests" });
    expect(provider.generatePlan).not.toHaveBeenCalled();
  });

  it("answers 402 for a free user when ENTITLEMENT_MODE=enforce", async () => {
    const rc = vi.fn(async () => Response.json({ subscriber: { entitlements: {} } }));
    vi.stubGlobal("fetch", rc);
    const { default: worker } = await loadWorker();
    const { env } = fakeEnv({ ENTITLEMENT_MODE: "enforce", REVENUECAT_SECRET_KEY: "sk_test" });
    const res = await worker.fetch(request("/api/momentum/plan", { headers: { "x-rc-user": RC } }), env);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Plus required" });
    expect(String((rc.mock.calls[0] as unknown[])[0])).toContain(`/subscribers/%24RCAnonymousID%3A`);
  });

  it("serves supporter grants with a RevenueCat key even while the check is off", async () => {
    const rc = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({}));
    vi.stubGlobal("fetch", rc);
    const { default: worker } = await loadWorker();
    const { env, stub } = fakeEnv({
      REVENUECAT_SECRET_KEY: "sk_test",
      PROXY_SHARED_SECRET: "s3cret",
      GRANDFATHER_GRANTS_UNTIL: "2999-12-31",
    });
    const res = await worker.fetch(
      request("/api/momentum/grandfather", { body: "{}", headers: { "x-rc-user": RC, "x-momentum-secret": "s3cret" } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ granted: true });
    expect(String(rc.mock.calls[0][0])).toMatch(/\/entitlements\/plus\/promotional$/);
    expect(stub.spend).toHaveBeenCalledWith({ keys: [], free: [{ key: "grant:ip:203.0.113.7", cap: 3 }] });
  });

  it("answers 413 for a declared or actual body over the limit", async () => {
    const { default: worker } = await loadWorker();
    const { env, stub } = fakeEnv();
    const big = JSON.stringify({ ...PLAN_PAYLOAD, pad: "x".repeat(25_000) });
    const res = await worker.fetch(request("/api/momentum/plan", { body: big }), env);
    expect(res.status).toBe(413);
    // Hop-by-hop: Workers manage connections themselves.
    expect(res.headers.get("connection")).toBeNull();
    expect(await res.json()).toEqual({ error: "Request body too large" });
    expect(stub.spend).not.toHaveBeenCalled();
  });

  it("answers 400 for invalid JSON", async () => {
    const { default: worker } = await loadWorker();
    const res = await worker.fetch(request("/api/momentum/plan", { body: "{nope" }), fakeEnv().env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid request body" });
  });

  it("answers 404 as JSON for unknown paths", async () => {
    const { default: worker } = await loadWorker();
    const res = await worker.fetch(request("/__proto__"), fakeEnv().env);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("enforces the shared secret from env", async () => {
    const { default: worker } = await loadWorker();
    const { env } = fakeEnv({ PROXY_SHARED_SECRET: "s3cret" });
    expect((await worker.fetch(request("/api/momentum/plan"), env)).status).toBe(401);
    const ok = await worker.fetch(request("/api/momentum/plan", { headers: { "x-momentum-secret": "s3cret" } }), env);
    expect(ok.status).toBe(200);
  });
});

describe("readLimitedJson", () => {
  const stream = (chunks: string[]) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    });
  const chunked = (chunks: string[]) =>
    new Request("https://x.test/", { method: "POST", body: stream(chunks), duplex: "half" } as RequestInit);

  it("parses a streamed body and an empty one", async () => {
    const { readLimitedJson } = await loadWorker();
    expect(await readLimitedJson(chunked(['{"a"', ":1}"]), 100)).toEqual({ a: 1 });
    expect(await readLimitedJson(new Request("https://x.test/", { method: "POST" }), 100)).toEqual({});
    expect(await readLimitedJson(chunked([""]), 100)).toEqual({});
  });

  it("stops a chunked body without Content-Length as soon as it passes the limit", async () => {
    const { readLimitedJson } = await loadWorker();
    const { BodyTooLargeError } = await import("../server/handler.mjs");
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        controller.enqueue(new Uint8Array(40));
      },
    });
    const req = new Request("https://x.test/", { method: "POST", body: endless, duplex: "half" } as RequestInit);
    expect(req.headers.get("content-length")).toBeNull();
    await expect(readLimitedJson(req, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(pulled).toBeLessThan(10);
  });

  it("rejects a declared Content-Length over the limit without reading", async () => {
    const { readLimitedJson } = await loadWorker();
    const { BodyTooLargeError } = await import("../server/handler.mjs");
    const req = new Request("https://x.test/", {
      method: "POST",
      body: "x".repeat(200),
      headers: { "content-length": "200" },
    });
    await expect(readLimitedJson(req, 100)).rejects.toBeInstanceOf(BodyTooLargeError);
    expect(req.bodyUsed).toBe(false);
  });

  it("throws a SyntaxError (→ 400) for invalid JSON", async () => {
    const { readLimitedJson } = await loadWorker();
    await expect(readLimitedJson(chunked(["{nope"]), 100)).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe("Limits durable object", () => {
  const DAY = 24 * 60 * 60_000;
  const T = 20_000 * DAY + 1_000; // start of a UTC day (+1s)
  const make = (env: Record<string, string>, store = fakeSql()) => ({
    store,
    create: async () => {
      const { Limits } = await loadWorker();
      return new Limits({ storage: { sql: store.sql } }, env);
    },
  });

  it("creates the day_counts table", async () => {
    const { store, create } = make({});
    await create();
    expect(store.statements[0]).toMatch(/^CREATE TABLE IF NOT EXISTS day_counts/);
  });

  it("counts each key per minute and checks all keys before counting any", async () => {
    const limits = await make({ RATE_LIMIT_PER_MIN: "2" }).create();
    expect(limits.admit(["ip:a", "user:u"], T)).toBe("ok");
    expect(limits.admit(["ip:a", "user:u"], T)).toBe("ok");
    expect(limits.admit(["ip:a", "user:u"], T)).toBe("minute");
    expect(limits.admit(["ip:b", "user:u"], T)).toBe("minute");
    // ip:b wasn't counted by the rejected request.
    expect(limits.admit(["ip:b"], T)).toBe("ok");
    expect(limits.admit(["ip:b"], T)).toBe("ok");
    expect(limits.admit(["ip:a"], T + 60_000)).toBe("ok");
  });

  it("spends daily units and admit/spend both report the day limit", async () => {
    const limits = await make({ RATE_LIMIT_PER_MIN: "0", DAILY_LIMIT_PER_CLIENT: "2" }).create();
    expect(limits.spend({ keys: ["ip:a"], free: [] }, T)).toBe("ok");
    expect(limits.spend({ keys: ["ip:a"], free: [] }, T)).toBe("ok");
    expect(limits.admit(["ip:a"], T)).toBe("day");
    expect(limits.spend({ keys: ["ip:a"], free: [] }, T)).toBe("day");
    expect(limits.spend({ keys: ["ip:b"], free: [] }, T)).toBe("ok");
  });

  it("keeps a global daily cap across clients", async () => {
    const limits = await make({ GLOBAL_DAILY_LIMIT: "1" }).create();
    expect(limits.spend({ keys: ["ip:a"], free: [] }, T)).toBe("ok");
    expect(limits.admit(["ip:b"], T)).toBe("global");
    expect(limits.spend({ keys: ["ip:b"], free: [] }, T)).toBe("global");
  });

  it("re-checks free caps atomically and spends nothing when one is hit", async () => {
    const { store, create } = make({ RATE_LIMIT_PER_MIN: "0" });
    const limits = await create();
    const req = (user: string) => ({ keys: ["ip:a"], free: [{ key: `free:user:${user}`, cap: 1 }, { key: "free:ip:a", cap: 2 }] });
    expect(limits.spend(req("u"), T)).toBe("ok");
    expect(limits.spend(req("u"), T)).toBe("free");
    expect(limits.spend(req("v"), T)).toBe("ok");
    // Per-network cap (2) now reached for a third user on the same network.
    expect(limits.spend(req("w"), T)).toBe("free");
    const counts = Object.fromEntries([...store.rows.values()].map((r) => [r.key, r.n]));
    expect(counts).toEqual({ global: 2, "ip:a": 2, "free:user:u": 1, "free:user:v": 1, "free:ip:a": 2 });
  });

  it("treats a free cap of 0 as no free AI", async () => {
    const limits = await make({}).create();
    expect(limits.spend({ keys: ["ip:a"], free: [{ key: "free:ip:a", cap: 0 }] }, T)).toBe("free");
  });

  it("keeps daily counts across a new instance with the same storage", async () => {
    const shared = fakeSql();
    const env = { RATE_LIMIT_PER_MIN: "0", DAILY_LIMIT_PER_CLIENT: "1" };
    const first = await make(env, shared).create();
    expect(first.spend({ keys: ["ip:a"], free: [] }, T)).toBe("ok");
    const second = await make(env, shared).create();
    expect(second.admit(["ip:a"], T)).toBe("day");
  });

  it("deletes older days' rows and starts fresh the next day", async () => {
    const { store, create } = make({ RATE_LIMIT_PER_MIN: "0", DAILY_LIMIT_PER_CLIENT: "1" });
    const limits = await create();
    limits.spend({ keys: ["ip:a"], free: [] }, T);
    expect(limits.admit(["ip:a"], T)).toBe("day");
    expect(limits.admit(["ip:a"], T + DAY)).toBe("ok");
    expect([...store.rows.values()].every((r) => r.day === Math.floor((T + DAY) / DAY))).toBe(true);
    expect(store.rows.size).toBe(0);
  });
});
