// Cloudflare Worker entry (server/worker.mjs). The Workers runtime module and
// the provider registry are mocked; env.LIMITS is a fake Durable Object stub.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const PLAN_PAYLOAD = {
  profile: { goalTitle: "Run a 5K" },
  settings: { suggestionTone: "calm", adaptivePlanning: true },
  recentPerformance: { completed: 1, total: 2, missed: 1, daysReviewed: 1 },
};

type Limit = "ok" | "minute" | "day" | "global";

function fakeEnv(vars: Record<string, string> = {}, admit: (key: string) => Limit = () => "ok") {
  const stub = {
    admit: vi.fn(async (key: string) => admit(key)),
    record: vi.fn(async (_key: string) => {}),
    admitFree: vi.fn(async (_key: string) => "ok" as Limit),
    recordFree: vi.fn(async (_key: string) => {}),
  };
  const LIMITS = {
    idFromName: vi.fn((name: string) => `id:${name}`),
    get: vi.fn((_id: string) => stub),
  };
  return { env: { ...vars, LIMITS }, stub, LIMITS };
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
    expect(await res.json()).toEqual({ ok: true, provider: "fake" });
  });

  it("answers OPTIONS with an empty 204 and no allow-origin when CORS_ORIGIN is unset", async () => {
    const { default: worker } = await loadWorker();
    const res = await worker.fetch(request("/api/momentum/plan", { method: "OPTIONS" }), fakeEnv().env);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
  });

  it("serves a plan through the global Limits object keyed by cf-connecting-ip and user", async () => {
    const { default: worker } = await loadWorker();
    const { env, stub, LIMITS } = fakeEnv();
    const res = await worker.fetch(
      request("/api/momentum/plan", { headers: { "X-RC-User": "$RCAnonymousID:abc" } }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PLAN_RESULT);
    expect(LIMITS.idFromName).toHaveBeenCalledWith("global");
    expect(stub.admit.mock.calls.map((c) => c[0])).toEqual(["ip:203.0.113.7", "user:$RCAnonymousID:abc"]);
    expect(stub.record.mock.calls.map((c) => c[0])).toEqual(["ip:203.0.113.7", "user:$RCAnonymousID:abc"]);
  });

  it("uses 'unknown' as the client when cf-connecting-ip is missing", async () => {
    const { default: worker } = await loadWorker();
    const { env, stub } = fakeEnv();
    const req = new Request("https://ai.example.workers.dev/api/momentum/plan", {
      method: "POST",
      body: JSON.stringify(PLAN_PAYLOAD),
    });
    await worker.fetch(req, env);
    expect(stub.admit).toHaveBeenCalledWith("ip:unknown");
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
    const res = await worker.fetch(request("/api/momentum/plan", { headers: { "x-rc-user": "free-user" } }), env);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "Plus required" });
    expect(String((rc.mock.calls[0] as unknown[])[0])).toContain("/subscribers/free-user");
  });

  it("answers 413 for a declared or actual body over the limit", async () => {
    const { default: worker } = await loadWorker();
    const { env, stub } = fakeEnv();
    const big = JSON.stringify({ ...PLAN_PAYLOAD, pad: "x".repeat(25_000) });
    const res = await worker.fetch(request("/api/momentum/plan", { body: big }), env);
    expect(res.status).toBe(413);
    expect(res.headers.get("connection")).toBe("close");
    expect(await res.json()).toEqual({ error: "Request body too large" });
    expect(stub.record).not.toHaveBeenCalled();
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

describe("Limits durable object", () => {
  it("applies the configured per-minute, daily and free limits", async () => {
    const { Limits } = await loadWorker();
    const limits = new Limits({}, { RATE_LIMIT_PER_MIN: "2", DAILY_LIMIT_PER_CLIENT: "1", FREE_BRAIN_DUMPS_PER_DAY: "1" });
    expect(limits.admit("ip:a")).toBe("ok");
    limits.record("ip:a");
    expect(limits.admit("ip:a")).toBe("day");
    expect(limits.admit("ip:b")).toBe("ok");
    expect(limits.admit("ip:b")).toBe("ok");
    expect(limits.admit("ip:b")).toBe("minute");

    expect(limits.admitFree("free:u")).toBe("ok");
    limits.recordFree("free:u");
    expect(limits.admitFree("free:u")).toBe("day");
    // Free and regular budgets are separate counters.
    expect(limits.admitFree("free:other")).toBe("ok");
  });

  it("keeps a global daily cap across clients", async () => {
    const { Limits } = await loadWorker();
    const limits = new Limits({}, { GLOBAL_DAILY_LIMIT: "1" });
    limits.record("ip:a");
    expect(limits.admit("ip:b")).toBe("global");
    // The free limiter has no global cap.
    expect(limits.admitFree("free:x")).toBe("ok");
  });
});
