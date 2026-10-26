// One free Break it down per app user id, ever (1.5, PR #102), end to end
// through the real handler and the real config. The same spec runs against
// both budgets: the Node server's in-memory one and the Worker's Limits
// Durable Object (SQL faked), so they can't drift apart.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createBudget, hashId, readConfig, secretsMatch } from "../server/config.mjs";
import { SECRET_HEADER, USER_HEADER, createHandler } from "../server/handler.mjs";
import { BREAK_DOWN_ROUTE, EVENING_ROUTE } from "../server/routes.mjs";

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
vi.mock("../server/providers/index.mjs", () => ({
  DEFAULT_PROVIDER_ID: "fake",
  getProvider: () => ({}),
}));

const DAY = 24 * 60 * 60_000;
const T0 = 20_000 * DAY + 1_000; // start of a UTC day (+1s)
const BODY = { task: "Clean the kitchen", goalTitle: null };
const STEPS = { steps: [{ text: "Clear the counter" }, { text: "Wipe it" }, { text: "Sweep" }] };
// Ids are RevenueCat anonymous ids: 32 hex characters.
const id = (c: string) => `$RCAnonymousID:${c.repeat(32)}`;
const asUser = (c: string) => ({ [USER_HEADER]: id(c) });

type Budget = {
  admit: (keys: string[]) => unknown;
  spend: (req: { keys: string[]; free: { key: string; cap: number; lifetime?: boolean }[] }) => unknown;
  refund: (req: { free: { key: string; cap: number; lifetime?: boolean }[] }) => unknown;
};

/** Minimal in-memory stand-in for ctx.storage.sql (the statements Limits uses). */
function fakeSql() {
  const rows = new Map<string, { day: number; n: number }>();
  const once = new Map<string, number>();
  const exec = (query: string, ...args: unknown[]) => {
    let result: unknown[] = [];
    if (query.startsWith("CREATE TABLE")) {
      // Nothing to do.
    } else if (query.startsWith("SELECT n FROM once_counts")) {
      const n = once.get(args[0] as string);
      result = n === undefined ? [] : [{ n }];
    } else if (query.startsWith("INSERT INTO once_counts")) {
      once.set(args[0] as string, (once.get(args[0] as string) ?? 0) + 1);
    } else if (query.startsWith("UPDATE once_counts SET n = n - 1")) {
      const n = once.get(args[0] as string);
      if (n !== undefined && n > 0) once.set(args[0] as string, n - 1);
    } else if (query.startsWith("DELETE FROM day_counts WHERE day < ?")) {
      for (const [k, row] of rows) if (row.day < (args[0] as number)) rows.delete(k);
    } else if (query.startsWith("SELECT n FROM day_counts")) {
      const row = rows.get(`${args[0]}|${args[1]}`);
      result = row ? [{ n: row.n }] : [];
    } else if (query.startsWith("INSERT INTO day_counts")) {
      const k = `${args[0]}|${args[1]}`;
      const row = rows.get(k);
      if (row) row.n += 1;
      else rows.set(k, { day: args[0] as number, n: 1 });
    } else {
      throw new Error(`unexpected SQL: ${query}`);
    }
    return { toArray: () => result };
  };
  return { exec };
}

const budgets: [string, (vars: Record<string, string>, clock: { t: number }) => Promise<Budget>][] = [
  ["Node server budget", async (vars, clock) => createBudget(readConfig(vars), { now: () => clock.t }) as Budget],
  [
    "Worker Limits object",
    async (vars, clock) => {
      vi.resetModules();
      const { Limits } = await import("../server/worker.mjs");
      const limits = new Limits({ storage: { sql: fakeSql() } }, vars);
      return {
        admit: (keys) => limits.admit(keys, clock.t),
        spend: (req) => limits.spend(req, clock.t),
        refund: (req) => limits.refund(req),
      };
    },
  ],
];

describe.each(budgets)("free Break it down: %s", (_name, makeBudget) => {
  const clock = { t: T0 };
  beforeEach(() => {
    clock.t = T0;
  });

  async function setup(vars: Record<string, string> = {}, who: Record<string, "plus" | "free"> = {}) {
    const env = {
      ENTITLEMENT_MODE: "enforce",
      REVENUECAT_SECRET_KEY: "sk_test",
      RATE_LIMIT_PER_MIN: "0",
      ...vars,
    };
    const config = readConfig(env);
    const budget = await makeBudget(env, clock);
    const spent: { keys: string[]; free: { key: string; cap: number; lifetime?: boolean }[] }[] = [];
    const generatePlan = vi.fn(async (): Promise<unknown> => STEPS);
    const check = vi.fn(async (userId: string) => who[userId] ?? "free");
    const handle = createHandler({
      provider: { id: "fake", isConfigured: () => true, missingConfigMessage: () => "", generatePlan },
      config,
      budget: {
        admit: (keys) => budget.admit(keys),
        spend: (req) => {
          spent.push(req);
          return budget.spend(req);
        },
        refund: (req) => budget.refund(req),
      },
      entitlements: { check, grantLifetime: async () => true },
      secretsMatch,
      logger: { error: vi.fn(), warn: vi.fn() },
      now: () => clock.t,
    } as Parameters<typeof createHandler>[0]);
    const call = (headers: Record<string, string> = {}, opts: { ip?: string; path?: string; body?: unknown } = {}) =>
      handle({
        method: "POST",
        path: opts.path ?? BREAK_DOWN_ROUTE,
        headers,
        clientIp: opts.ip ?? "203.0.113.7",
        readBody: async () => opts.body ?? BODY,
      });
    return { call, generatePlan, check, spent };
  }

  it("gives a free id one break-down ever: the next is 402, tomorrow and next week too", async () => {
    const t = await setup();
    expect((await t.call(asUser("a"))).status).toBe(200);
    expect(await t.call(asUser("a"))).toEqual({ status: 402, body: { error: "Free limit reached" } });
    clock.t += DAY + 5_000;
    expect((await t.call(asUser("a"))).status).toBe(402);
    clock.t += 7 * DAY;
    expect((await t.call(asUser("a"))).status).toBe(402);
    expect(t.generatePlan).toHaveBeenCalledTimes(1);
  });

  it("is per id: another id on the same network still gets its own try", async () => {
    const t = await setup();
    expect((await t.call(asUser("a"))).status).toBe(200);
    expect((await t.call(asUser("b"))).status).toBe(200);
    expect((await t.call(asUser("b"))).status).toBe(402);
    expect(t.generatePlan).toHaveBeenCalledTimes(2);
  });

  it("caps free tries per network per day (a reinstall gets a new id), then resets the next day", async () => {
    const t = await setup({ FREE_BREAK_DOWNS_PER_NETWORK_PER_DAY: "3" });
    for (const c of ["a", "b", "c"]) expect((await t.call(asUser(c))).status).toBe(200);
    expect(await t.call(asUser("d"))).toEqual({ status: 402, body: { error: "Free limit reached" } });
    // Another network is not held up by the first one's ceiling.
    expect((await t.call(asUser("e"), { ip: "198.51.100.9" })).status).toBe(200);
    // The refused id kept its lifetime try: tomorrow it can still use it.
    clock.t += DAY + 5_000;
    expect((await t.call(asUser("d"))).status).toBe(200);
    expect((await t.call(asUser("a"))).status).toBe(402);
  });

  it("gives the try back when the AI call throws or returns junk, so the user can retry", async () => {
    const t = await setup();
    t.generatePlan.mockRejectedValueOnce(new Error("provider down"));
    expect((await t.call(asUser("a"))).status).toBe(502);
    t.generatePlan.mockResolvedValueOnce({ nonsense: true });
    expect((await t.call(asUser("a"))).status).toBe(502);
    expect((await t.call(asUser("a"))).status).toBe(200);
    expect((await t.call(asUser("a"))).status).toBe(402);
    expect(t.generatePlan).toHaveBeenCalledTimes(3);
  });

  it("log mode: a free id past its try is still served (and nothing is refunded for it)", async () => {
    const t = await setup({ ENTITLEMENT_MODE: "log" });
    expect((await t.call(asUser("a"))).status).toBe(200);
    expect((await t.call(asUser("a"))).status).toBe(200);
    expect((await t.call(asUser("a"))).status).toBe(200);
    // A failure past the try must not hand out a try it never spent.
    t.generatePlan.mockRejectedValueOnce(new Error("down"));
    expect((await t.call(asUser("a"))).status).toBe(502);
    expect(t.generatePlan).toHaveBeenCalledTimes(4);
  });

  it("a request without an app user id never gets a free try", async () => {
    const t = await setup({ ENTITLEMENT_REQUIRE_ID: "1" });
    expect(await t.call({})).toEqual({ status: 402, body: { error: "Plus required" } });
    // An unusable id counts as no id.
    expect((await t.call({ [USER_HEADER]: ".." })).status).toBe(402);
    expect(t.generatePlan).not.toHaveBeenCalled();
    expect(t.spent).toEqual([]);

    // While ids are optional, no-id requests share the old ceiling and never spend a once: key.
    const lenient = await setup();
    expect((await lenient.call({})).status).toBe(200);
    expect(lenient.spent.flatMap((s) => s.free.map((f) => f.key))).toEqual(["noid:all"]);
  });

  it.each([
    ["FREE_BREAK_DOWNS_PER_CLIENT", "0"],
    ["FREE_BREAK_DOWNS_PER_NETWORK_PER_DAY", "0"],
  ])("%s=%s turns the free try off (402 Plus required, no AI call)", async (name, value) => {
    const t = await setup({ [name]: value });
    expect(await t.call(asUser("a"))).toEqual({ status: 402, body: { error: "Plus required" } });
    expect(t.generatePlan).not.toHaveBeenCalled();
    expect(t.spent).toEqual([]);
  });

  it("raising FREE_BREAK_DOWNS_PER_CLIENT gives that many tries per id", async () => {
    const t = await setup({ FREE_BREAK_DOWNS_PER_CLIENT: "2" });
    expect((await t.call(asUser("a"))).status).toBe(200);
    expect((await t.call(asUser("a"))).status).toBe(200);
    expect((await t.call(asUser("a"))).status).toBe(402);
  });

  it("still needs the shared secret: no secret, no free try, no RevenueCat lookup", async () => {
    const t = await setup({ PROXY_SHARED_SECRET: "s3cret" });
    expect(await t.call(asUser("a"))).toEqual({ status: 401, body: { error: "Unauthorized" } });
    expect(t.check).not.toHaveBeenCalled();
    expect(t.spent).toEqual([]);
    expect((await t.call({ ...asUser("a"), [SECRET_HEADER]: "wrong" })).status).toBe(401);
    // The refused calls used nothing up.
    expect((await t.call({ ...asUser("a"), [SECRET_HEADER]: "s3cret" })).status).toBe(200);
  });

  it("only break-down has a free try; Plus ids never spend it", async () => {
    const t = await setup({}, { [id("f")]: "plus" });
    const evening = { result: "good", tasks: [] };
    expect((await t.call(asUser("a"), { path: EVENING_ROUTE, body: evening })).status).toBe(402);
    for (let i = 0; i < 3; i += 1) expect((await t.call(asUser("f"))).status).toBe(200);
    expect(t.spent.every((s) => s.free.length === 0)).toBe(true);
  });

  it("keeps only a hash of the id in the counters", async () => {
    const t = await setup();
    await t.call(asUser("a"));
    const keys = t.spent.flatMap((s) => [...s.keys, ...s.free.map((f) => f.key)]);
    expect(keys).toContain(`once:break-down:user:${hashId(id("a"))}`);
    expect(keys.join(" ")).not.toContain(id("a"));
  });
});
