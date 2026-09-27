// The proxy's request logic, independent of the runtime: the Node server
// (app.mjs) and the Cloudflare Worker (worker.mjs) both adapt their own
// request/response types to `handle()`, so auth, limits, entitlements,
// validation and output sanitising are identical on both hosts.

import { hashId } from "./config.mjs";
import { ROUTES } from "./routes.mjs";

export const HEALTH_ROUTE = "/health";
export const SECRET_HEADER = "x-momentum-secret";
/** Anonymous RevenueCat app user id, sent by paywall builds. */
export const USER_HEADER = "x-rc-user";
export const DEBUG_IP_ROUTE = "/debug/client-ip";
/** One-off: an early supporter's install claims lifetime Plus (window only). */
export const GRANDFATHER_ROUTE = "/api/momentum/grandfather";
const GRANTS_PER_NETWORK_PER_DAY = 3;
export const MAX_BODY_BYTES = 20_000;

export class BodyTooLargeError extends Error {}

const MINUTE_MS = 60_000;
// Only RevenueCat's own anonymous ids (the app never logs users in). Anything
// else, e.g. "..", is treated as no id at all, so it can't steer the lookup.
const USER_ID_PATTERN = /^\$RCAnonymousID:[0-9a-f]{32}$/;
// The AI provider refused for billing/quota: that's "busy for today", not a bug.
const PROVIDER_QUOTA_PATTERN = /credit balance|usage limit|quota|billing/i;

function summarizeForLog(value) {
  // Never log full AI output (it can echo user task titles); keep enough shape
  // to debug a malformed response.
  if (!value || typeof value !== "object") return String(value);
  return JSON.stringify(Object.keys(value));
}

/** The caller's RevenueCat id when it's a real anonymous id, else null. */
export function userIdFrom(headers) {
  const raw = headers[USER_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && USER_ID_PATTERN.test(value) ? value : null;
}

/**
 * The limit key for an address. IPv6 clients control a whole /64, so they're
 * counted by that prefix (otherwise rotating addresses would dodge limits).
 */
export function ipKey(ip) {
  if (typeof ip !== "string" || !ip.includes(":") || ip.includes(".")) return `ip:${ip}`;
  const [head] = ip.split("%");
  const parts = head.split("::");
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts.length > 1 && parts[1] ? parts[1].split(":") : [];
  const full = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return `ip6:${full
    .slice(0, 4)
    .map((part) => (part || "0").toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * @typedef {{
 *   admit: (keys: string[]) => string | Promise<string>,
 *   spend: (req: { keys: string[], free: { key: string, cap: number }[] }) => string | Promise<string>,
 * }} Budget
 * admit: per-minute counting + a check (no spend) of the daily/global caps.
 * spend: atomically re-checks the caps (incl. free ones) and spends one unit;
 *        "ok" | "day" | "global" | "free". Called only right before the AI call.
 */

/**
 * @param {{
 *   provider: { id: string, isConfigured: () => boolean, missingConfigMessage: () => string, generatePlan: (args: object) => Promise<unknown> },
 *   config: object,
 *   budget: Budget,
 *   entitlements?: { check: (userId: string, options?: { fresh?: boolean }) => Promise<"plus" | "free" | "unknown"> },
 *   secretsMatch: (provided: unknown, expected: string) => boolean | Promise<boolean>,
 *   logger?: { error: (...args: unknown[]) => void, warn?: (...args: unknown[]) => void },
 *   now?: () => number,
 * }} deps
 */
export function createHandler({ provider, config, budget, entitlements, secretsMatch, logger = console, now = () => Date.now() }) {
  // Log-mode counters: summarised at most once a minute each, and kept apart
  // so the numbers watched before switching to "enforce" mean one thing each.
  const throttledLog = (label) => ({
    count: 0,
    lastLoggedAt: -Infinity,
    note() {
      this.count += 1;
      const t = now();
      if (t - this.lastLoggedAt >= MINUTE_MS) {
        logger.warn?.(`[momentum-ai] ${this.count} ${label}`);
        this.lastLoggedAt = t;
        this.count = 0;
      }
    },
  });
  const unauthorizedLog = throttledLog("request(s) without a valid secret allowed (SECRET_MODE=log)");
  const noIdLog = throttledLog("request(s) without an app user id (old build or grandfathered) allowed");
  const notPlusLog = throttledLog("request(s) from an id without Plus on a Plus route allowed (ENTITLEMENT_MODE=log)");
  const unknownLog = throttledLog("request(s) allowed because RevenueCat couldn't answer");
  const freeCapLog = throttledLog("free request(s) over the daily free cap allowed (ENTITLEMENT_MODE=log)");

  const busy = () => ({
    status: 503,
    body: { error: "Service is busy, try again later" },
    headers: { "Retry-After": "3600" },
  });
  const limited = (kind) =>
    kind === "global"
      ? busy()
      : { status: 429, body: { error: "Too many requests" }, headers: { "Retry-After": kind === "minute" ? "60" : "3600" } };

  /**
   * @param {{ method: string, path: string, headers: Record<string, string | string[] | undefined>, clientIp: string, socketAddress?: string | null, readBody: (maxBytes: number) => Promise<unknown> }} req
   * @returns {Promise<{ status: number, body: unknown, headers?: Record<string, string>, tooLarge?: boolean }>}
   */
  return async function handle(req) {
    const { method, headers, clientIp } = req;
    // Match on the path only (same on every host): "/api/momentum/plan?x" routes.
    const path = (req.path ?? "").split("?")[0];

    if (method === "OPTIONS") return { status: 204, body: null };
    if (method === "GET" && path === HEALTH_ROUTE) {
      return {
        status: 200,
        body: { ok: true, provider: provider.id, entitlements: config.entitlementMode === "off" ? "off" : config.entitlementMode },
      };
    }

    const authorized = !config.sharedSecret || (await secretsMatch(headers[SECRET_HEADER], config.sharedSecret));
    if (!authorized && config.secretMode === "enforce") return { status: 401, body: { error: "Unauthorized" } };
    if (!authorized) unauthorizedLog.note();

    // Never exposed without a configured secret, even when enabled.
    if (config.debugClientIp && config.sharedSecret && authorized && method === "GET" && path === DEBUG_IP_ROUTE) {
      return {
        status: 200,
        body: {
          resolvedClientIp: clientIp,
          forwardedFor: headers["x-forwarded-for"] ?? null,
          socketAddress: req.socketAddress ?? null,
          trustProxyHops: config.trustProxyHops,
        },
      };
    }

    if (method === "POST" && path === GRANDFATHER_ROUTE) {
      // Needs the real secret even in SECRET_MODE=log, an id, an open window,
      // and a working RevenueCat key; a few claims per network per day.
      if (!config.sharedSecret || !authorized) return { status: 401, body: { error: "Unauthorized" } };
      if (!(config.grandfatherGrantsUntil > now())) return { status: 403, body: { error: "Closed" } };
      const grantUserId = userIdFrom(headers);
      if (!grantUserId || !entitlements?.grantLifetime) return { status: 400, body: { error: "Missing user" } };
      const grantKey = ipKey(clientIp);
      const allowed = await budget.admit([grantKey]);
      if (allowed !== "ok") return limited(allowed);
      const claimed = await budget.spend({ keys: [], free: [{ key: `grant:${grantKey}`, cap: GRANTS_PER_NETWORK_PER_DAY }] });
      if (claimed !== "ok") return { status: 429, body: { error: "Too many requests" }, headers: { "Retry-After": "3600" } };
      const granted = await entitlements.grantLifetime(grantUserId);
      return granted ? { status: 200, body: { granted: true } } : busy();
    }

    // Own-property lookup only, so names like "__proto__" can never resolve.
    const route = method === "POST" && Object.prototype.hasOwnProperty.call(ROUTES, path) ? ROUTES[path] : undefined;
    if (!route) return { status: 404, body: { error: "Not found" } };

    // Limits are per network (IP, IPv6 by /64) and, when the app says who it
    // is, per RevenueCat user too.
    const userId = userIdFrom(headers);
    const ip = ipKey(clientIp);
    // Counters keep a hash, never the raw id.
    const userKey = userId ? `user:${hashId(userId)}` : null;
    const keys = userKey ? [ip, userKey] : [ip];
    const admitted = await budget.admit(keys);
    if (admitted !== "ok") return limited(admitted);

    if (!provider.isConfigured()) return { status: 500, body: { error: provider.missingConfigMessage() } };

    let payload;
    try {
      payload = await req.readBody(MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return { status: 413, body: { error: "Request body too large" }, headers: { Connection: "close" }, tooLarge: true };
      }
      return { status: 400, body: { error: "Invalid request body" } };
    }
    const validationError = route.validatePayload(payload);
    if (validationError) return { status: 400, body: { error: validationError } };

    // Plus check, after validation so junk bodies never reach RevenueCat.
    // Plus routes need the entitlement; brain dumps are open to free users
    // within a small daily allowance (per user and, looser, per network).
    const mode = config.entitlementMode;
    let free = [];
    if (mode !== "off" && entitlements) {
      if (!userId && !config.requireUserId) {
        // Old builds (and supporters before their grant) send no id: allowed,
        // within a shared daily ceiling, until ENTITLEMENT_REQUIRE_ID=1.
        noIdLog.note();
        free = [{ key: "noid:all", cap: config.noIdDailyLimit }];
      } else {
        const status = userId ? await entitlements.check(userId, { fresh: route.plusOnly === true }) : "free";
        if (status === "unknown") {
          // RevenueCat is down: never lock paying users out.
          unknownLog.note();
        } else if (status === "free") {
          if (route.plusOnly) {
            if (mode === "enforce") return { status: 402, body: { error: "Plus required" } };
            notPlusLog.note();
          } else {
            const cap = config.freeBrainDumpsPerDay;
            free = [
              ...(userKey ? [{ key: `free:${userKey}`, cap }] : []),
              // Looser per network: carriers put many phones behind one IP.
              { key: `free:${ip}`, cap: cap * 3 },
            ];
          }
        }
      }
    }

    // Spend one unit of every budget right before calling the AI.
    let spent = await budget.spend({ keys, free });
    if (spent === "free") {
      if (mode === "enforce") return { status: 402, body: { error: "Free limit reached" } };
      freeCapLog.note();
      spent = await budget.spend({ keys, free: [] });
    }
    if (spent !== "ok") return limited(spent);

    try {
      const result = await provider.generatePlan({
        system: route.system,
        user: route.buildPrompt(payload),
        schema: route.schema,
        toolName: route.toolName,
        toolDescription: route.toolDescription,
      });
      if (!route.isValidResult(result)) {
        logger.error(`[momentum-ai] ${provider.id} returned an invalid ${route.name}; keys=${summarizeForLog(result)}`);
        return { status: 502, body: { error: `AI response did not include a valid ${route.name}` } };
      }
      // Return only validated fields, never raw model output.
      return { status: 200, body: route.sanitizeResult ? route.sanitizeResult(result) : result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`[momentum-ai] ${provider.id} proxy error: ${message}`);
      // Out of AI credit: say "busy" so the app shows its calm for-today copy.
      if (PROVIDER_QUOTA_PATTERN.test(message)) return busy();
      return { status: 502, body: { error: "Momentum AI request failed" } };
    }
  };
}
