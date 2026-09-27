// Momentum AI proxy — HTTP app, separated from process startup so it can be
// tested end-to-end without binding a real port or calling a real provider.
//
// `momentum-proxy.mjs` reads the environment and calls `createProxyServer`;
// tests build their own config + fake provider and do the same.

import http from "node:http";
import { Buffer } from "node:buffer";
import { createHash, timingSafeEqual } from "node:crypto";

import { createEntitlements } from "./entitlements.mjs";
import {
  BodyTooLargeError,
  MAX_BODY_BYTES,
  SECRET_HEADER,
  USER_HEADER,
  createHandler,
} from "./handler.mjs";

export { BRAIN_DUMP_ROUTE, BREAK_DOWN_ROUTE, EVENING_ROUTE, PLAN_ROUTE, ROUTES } from "./routes.mjs";
export { DEBUG_IP_ROUTE, HEALTH_ROUTE, MAX_BODY_BYTES, SECRET_HEADER, USER_HEADER } from "./handler.mjs";

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

function readJson(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        settled = true;
        // Stop reading; the caller answers 413 and then destroys the socket so a
        // client can't keep streaming a huge body into a kept-alive connection.
        req.pause();
        reject(new BodyTooLargeError("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function setCorsHeaders(res, corsOrigin) {
  // No wildcard default: when CORS_ORIGIN is unset, no cross-origin header is sent.
  if (corsOrigin) {
    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", `Content-Type, ${SECRET_HEADER}, ${USER_HEADER}`);
}

/**
 * @param {{
 *   provider: { id: string, isConfigured: () => boolean, missingConfigMessage: () => string, generatePlan: (args: object) => Promise<unknown> },
 *   config: ReturnType<typeof readConfig>,
 *   logger?: { error: (...args: unknown[]) => void, warn?: (...args: unknown[]) => void },
 *   now?: () => number,
 *   fetchImpl?: typeof fetch,
 * }} options
 */
export function createProxyServer({ provider, config, logger = console, now, fetchImpl }) {
  const limiter = createRateLimiter({
    perMinute: config.rateLimitPerMinute,
    perDay: config.dailyLimitPerClient,
    globalPerDay: config.globalDailyLimit,
    now,
  });
  // Daily only: free brain dumps per user (or IP when the app sends no id).
  const freeLimiter = createRateLimiter({
    perMinute: 0,
    perDay: config.freeBrainDumpsPerDay ?? 5,
    globalPerDay: 0,
    now,
  });
  const entitlements =
    config.entitlementMode && config.entitlementMode !== "off"
      ? createEntitlements({ secretKey: config.revenueCatSecretKey, fetchImpl, now, logger })
      : undefined;
  const handle = createHandler({
    provider,
    config,
    limiter,
    freeLimiter,
    entitlements,
    secretsMatch,
    logger,
    now,
  });

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res, config.corsOrigin);
    const result = await handle({
      method: req.method ?? "GET",
      path: req.url ?? "",
      headers: req.headers,
      clientIp: clientIpFrom(req, config.trustProxyHops),
      socketAddress: req.socket?.remoteAddress ?? null,
      readBody: async (maxBytes) => {
        const declared = Number(req.headers["content-length"]);
        if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError("Request body too large");
        return readJson(req, maxBytes);
      },
    });
    if (result.status === 204) {
      res.writeHead(204);
      res.end();
      return;
    }
    sendJson(res, result.status, result.body, result.headers);
    // Stop a client streaming a huge body into a kept-alive connection.
    if (result.tooLarge) res.on("finish", () => req.destroy());
  });

  // Slowloris protection: bound how long a client may take to send a request.
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  return { server, limiter };
}
