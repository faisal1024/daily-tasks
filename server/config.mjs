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
    entitlementMode:
      env.ENTITLEMENT_MODE === "enforce" || env.ENTITLEMENT_MODE === "log" ? env.ENTITLEMENT_MODE : "off",
    revenueCatSecretKey: env.REVENUECAT_SECRET_KEY ?? "",
    // Free users' AI brain dumps per day (the app gives 3 in total; this is
    // only a server-side ceiling).
    freeBrainDumpsPerDay: positiveInt(env.FREE_BRAIN_DUMPS_PER_DAY, 5),
  };
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
