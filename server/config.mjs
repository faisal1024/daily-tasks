// Portable pieces of the proxy (no Node server APIs): config, the secret
// check and the rate limiter. Used by the Node server (app.mjs) and the
// Cloudflare Worker (worker.mjs).

import { createHash, timingSafeEqual } from "node:crypto";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Build the proxy config from an env-like object. Invalid or missing numeric
 * values fall back to safe defaults rather than disabling a limit. A limit of 0
 * means "no limit" for that dimension.
 */
export function readConfig(env = {}) {
  return {
    port: positiveInt(env.PORT, 8787),
    providerName: env.MOMENTUM_AI_PROVIDER || undefined,
    sharedSecret: env.PROXY_SHARED_SECRET ?? "",
    // "enforce" rejects requests without the secret; "log" lets them through
    // (and logs them) so a secret can be rolled out before old builds age out.
    secretMode: env.SECRET_MODE === "log" ? "log" : "enforce",
    corsOrigin: env.CORS_ORIGIN ?? "",
    // Temporary aid to verify TRUST_PROXY_HOPS on a new host; see docs.
    debugClientIp: env.DEBUG_CLIENT_IP === "1",
    rateLimitPerMinute: positiveInt(env.RATE_LIMIT_PER_MIN, 30),
    dailyLimitPerClient: positiveInt(env.DAILY_LIMIT_PER_CLIENT, 200),
    globalDailyLimit: positiveInt(env.GLOBAL_DAILY_LIMIT, 5_000),
    // How many reverse proxies sit in front of us. The client IP is the entry
    // that many positions from the right of X-Forwarded-For, which a client can't
    // spoof by prepending values. Defaults to 0 (trust nothing) so a server with
    // no proxy in front can't be fooled; render.yaml sets 1.
    trustProxyHops: positiveInt(env.TRUST_PROXY_HOPS, 0),
    // Server-side Plus check (RevenueCat). "off" until the paywall is live;
    // "log" counts would-be denials; "enforce" answers 402.
    // Without a key there's nothing to check against: stays "off" (and the
    // startup code warns), rather than silently enforcing nothing.
    entitlementMode:
      (env.ENTITLEMENT_MODE === "enforce" || env.ENTITLEMENT_MODE === "log") && env.REVENUECAT_SECRET_KEY
        ? env.ENTITLEMENT_MODE
        : "off",
    entitlementMisconfigured:
      (env.ENTITLEMENT_MODE === "enforce" || env.ENTITLEMENT_MODE === "log") && !env.REVENUECAT_SECRET_KEY,
    revenueCatSecretKey: env.REVENUECAT_SECRET_KEY ?? "",
    // "1" once every supported build sends the app user id: requests without
    // one are then treated as free. Until then (old builds, grandfathered
    // early supporters) they're allowed and counted.
    requireUserId: env.ENTITLEMENT_REQUIRE_ID === "1",
    // Server-side ceiling on a free user's AI brain dumps per day (the app
    // gives 1 first-run sort + 3 to try; a retry after a timeout also counts).
    freeBrainDumpsPerDay: positiveInt(env.FREE_BRAIN_DUMPS_PER_DAY, 8),
    // Requests without an app user id (old builds; supporters before their
    // grant) share this daily ceiling, so they can't use the whole budget.
    noIdDailyLimit: positiveInt(env.NO_ID_DAILY_LIMIT, 250),
    // Early supporters can claim lifetime Plus until this date (ISO, e.g.
    // 2026-12-31). Unset or past = closed.
    grandfatherGrantsUntil: Date.parse(env.GRANDFATHER_GRANTS_UNTIL ?? "") || 0,
  };
}

/** A short one-way hash for limit keys, so stored counters never hold raw ids. */
export function hashId(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

/** Constant-time comparison that also hides the expected secret's length. */
export function secretsMatch(provided, expected) {
  if (typeof provided !== "string" || typeof expected !== "string" || !expected) {
    return false;
  }
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Resolve the caller's IP without trusting client-supplied forwarding entries. */
export function clientIpFrom(req, trustProxyHops) {
  const header = req.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (trustProxyHops > 0 && typeof raw === "string") {
    const hops = raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (hops.length >= trustProxyHops) {
      return hops[hops.length - trustProxyHops];
    }
  }
  return req.socket?.remoteAddress || "unknown";
}

/**
 * Fixed-window limiter with two steps so cheap bad requests can't burn the AI
 * budget:
 *   admit(client)  — every authorized request: counts toward the per-minute
 *                    limit and checks (without spending) the daily/global caps.
 *   record(client) — only right before calling the AI: spends the per-client
 *                    daily and global daily budget.
 * Windows are UTC-aligned and roll over by replacing the maps, so memory never
 * grows past one window of clients.
 */
export function createRateLimiter({
  perMinute,
  perDay,
  globalPerDay,
  now = () => Date.now(),
}) {
  let minuteStart = -1;
  let dayStart = -1;
  let minuteCounts = new Map();
  let dayCounts = new Map();
  let globalCount = 0;

  function roll() {
    const t = now();
    const currentMinute = t - (t % MINUTE_MS);
    const currentDay = t - (t % DAY_MS);
    if (currentMinute !== minuteStart) {
      minuteStart = currentMinute;
      minuteCounts = new Map();
    }
    if (currentDay !== dayStart) {
      dayStart = currentDay;
      dayCounts = new Map();
      globalCount = 0;
    }
  }

  return {
    /** "ok" (and counts the minute hit), or the name of the limit already exceeded. */
    admit(client) {
      roll();
      if (globalPerDay > 0 && globalCount >= globalPerDay) return "global";
      const minute = minuteCounts.get(client) ?? 0;
      if (perMinute > 0 && minute >= perMinute) return "minute";
      if (perDay > 0 && (dayCounts.get(client) ?? 0) >= perDay) return "day";
      minuteCounts.set(client, minute + 1);
      return "ok";
    },
    /** The status admit() would give, without counting anything. */
    peek(client) {
      roll();
      if (globalPerDay > 0 && globalCount >= globalPerDay) return "global";
      if (perMinute > 0 && (minuteCounts.get(client) ?? 0) >= perMinute) return "minute";
      if (perDay > 0 && (dayCounts.get(client) ?? 0) >= perDay) return "day";
      return "ok";
    },
    /** Just the daily and global caps (for the final check before spending). */
    peekDay(client) {
      roll();
      if (globalPerDay > 0 && globalCount >= globalPerDay) return "global";
      if (perDay > 0 && (dayCounts.get(client) ?? 0) >= perDay) return "day";
      return "ok";
    },
    /** Spend one unit of the client's daily and the global daily budget. */
    record(client) {
      roll();
      dayCounts.set(client, (dayCounts.get(client) ?? 0) + 1);
      globalCount += 1;
    },
    /** For tests/diagnostics: how many clients are tracked in each window. */
    size() {
      roll();
      return { minute: minuteCounts.size, day: dayCounts.size, global: globalCount };
    },
  };
}

/**
 * The handler's budget (see handler.mjs) on top of in-memory limiters, for the
 * single-process Node server: admit() counts the minute and checks the daily
 * caps; spend() checks the free caps and spends one unit of each.
 */
export function createBudget(config, { now } = {}) {
  const limiter = createRateLimiter({
    perMinute: config.rateLimitPerMinute,
    perDay: config.dailyLimitPerClient,
    globalPerDay: config.globalDailyLimit,
    now,
  });
  // Free allowances: one counter map per cap value (user vs network).
  const freeLimiters = new Map();
  const freeLimiter = (cap) => {
    if (!freeLimiters.has(cap)) freeLimiters.set(cap, createRateLimiter({ perMinute: 0, perDay: cap, globalPerDay: 0, now }));
    return freeLimiters.get(cap);
  };
  return {
    limiter,
    admit(keys) {
      // Check every key before counting any (a refusal costs no minute).
      for (const key of keys) {
        const result = limiter.peek(key);
        if (result !== "ok") return result;
      }
      for (const key of keys) limiter.admit(key);
      return "ok";
    },
    spend({ keys, free }) {
      // Re-check the caps: other requests may have spent since admit().
      for (const key of keys) {
        const result = limiter.peekDay(key);
        if (result !== "ok") return result;
      }
      for (const { key, cap } of free) {
        // 0 means "no free AI", never "unlimited".
        if (cap <= 0 || freeLimiter(cap).admit(key) !== "ok") return "free";
      }
      for (const key of keys) limiter.record(key);
      for (const { key, cap } of free) freeLimiter(cap).record(key);
      return "ok";
    },
  };
}
