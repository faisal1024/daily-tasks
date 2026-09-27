// The proxy's request logic, independent of the runtime: the Node server
// (app.mjs) and the Cloudflare Worker (worker.mjs) both adapt their own
// request/response types to `handle()`, so auth, limits, entitlements,
// validation and output sanitising are identical on both hosts.

import { ROUTES } from "./routes.mjs";

export const HEALTH_ROUTE = "/health";
export const SECRET_HEADER = "x-momentum-secret";
/** Anonymous RevenueCat app user id, sent by paywall builds. */
export const USER_HEADER = "x-rc-user";
export const DEBUG_IP_ROUTE = "/debug/client-ip";
export const MAX_BODY_BYTES = 20_000;

export class BodyTooLargeError extends Error {}

const MINUTE_MS = 60_000;
// RevenueCat app user ids: anonymous "$RCAnonymousID:<hex>" or a custom id.
const USER_ID_PATTERN = /^[A-Za-z0-9$:_.-]{1,100}$/;

function summarizeForLog(value) {
  // Never log full AI output (it can echo user task titles); keep enough shape
  // to debug a malformed response.
  if (!value || typeof value !== "object") return String(value);
  return JSON.stringify(Object.keys(value));
}

/** The caller's RevenueCat id when it looks like one, else null. */
export function userIdFrom(headers) {
  const raw = headers[USER_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && USER_ID_PATTERN.test(value) ? value : null;
}

/**
 * @param {{
 *   provider: { id: string, isConfigured: () => boolean, missingConfigMessage: () => string, generatePlan: (args: object) => Promise<unknown> },
 *   config: object,
 *   limiter: { admit: (key: string) => unknown, record: (key: string) => unknown },
 *   freeLimiter?: { admit: (key: string) => unknown, record: (key: string) => unknown },
 *   entitlements?: { check: (userId: string | null) => Promise<"plus" | "free" | "unknown"> },
 *   secretsMatch: (provided: unknown, expected: string) => boolean | Promise<boolean>,
 *   logger?: { error: (...args: unknown[]) => void, warn?: (...args: unknown[]) => void },
 *   now?: () => number,
 * }} deps
 */
export function createHandler({
  provider,
  config,
  limiter,
  freeLimiter,
  entitlements,
  secretsMatch,
  logger = console,
  now = () => Date.now(),
}) {
  // SECRET_MODE=log / ENTITLEMENT_MODE=log: summarise at most once a minute
  // instead of a line per request (old builds would flood the logs).
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
  const notPlusLog = throttledLog("request(s) that would need Plus allowed (ENTITLEMENT_MODE=log)");
  const freeCapLog = throttledLog("free request(s) over the daily free cap allowed (ENTITLEMENT_MODE=log)");

  /**
   * @param {{ method: string, path: string, headers: Record<string, string | string[] | undefined>, clientIp: string, socketAddress?: string | null, readBody: (maxBytes: number) => Promise<unknown> }} req
   * @returns {Promise<{ status: number, body: unknown, headers?: Record<string, string>, tooLarge?: boolean }>}
   */
  return async function handle(req) {
    const { method, path, headers, clientIp } = req;

    if (method === "OPTIONS") return { status: 204, body: null };
    if (method === "GET" && path === HEALTH_ROUTE) {
      return { status: 200, body: { ok: true, provider: provider.id } };
    }

    const authorized =
      !config.sharedSecret || (await secretsMatch(headers[SECRET_HEADER], config.sharedSecret));
    if (!authorized && config.secretMode === "enforce") {
      return { status: 401, body: { error: "Unauthorized" } };
    }
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

    // Own-property lookup only, so names like "__proto__" can never resolve.
    const route =
      method === "POST" && Object.prototype.hasOwnProperty.call(ROUTES, path) ? ROUTES[path] : undefined;
    if (!route) return { status: 404, body: { error: "Not found" } };

    // Limits are per device network (IP) and, when the app says who it is,
    // per RevenueCat user too: one bad actor on a shared IP can't starve
    // others, and changing networks doesn't reset a user's budget.
    const userId = userIdFrom(headers);
    const keys = userId ? [`ip:${clientIp}`, `user:${userId}`] : [`ip:${clientIp}`];
    for (const key of keys) {
      const limit = await limiter.admit(key);
      if (limit === "global") {
        return { status: 503, body: { error: "Service is busy, try again later" }, headers: { "Retry-After": "3600" } };
      }
      if (limit !== "ok") {
        return {
          status: 429,
          body: { error: "Too many requests" },
          headers: { "Retry-After": limit === "minute" ? "60" : "3600" },
        };
      }
    }

    // Plus-only routes need the entitlement; brain dumps are open to free
    // users within a small daily allowance (the app's free tastes).
    const mode = config.entitlementMode;
    let freeKey = null;
    if (mode !== "off" && entitlements) {
      const status = await entitlements.check(userId);
      // "unknown" = RevenueCat unreachable: fail open, never lock out payers.
      if (status === "free") {
        if (route.plusOnly) {
          if (mode === "enforce") return { status: 402, body: { error: "Plus required" } };
          notPlusLog.note();
        } else if (freeLimiter) {
          freeKey = `free:${userId ?? `ip:${clientIp}`}`;
          const free = await freeLimiter.admit(freeKey);
          if (free !== "ok") {
            if (mode === "enforce") return { status: 402, body: { error: "Free limit reached" } };
            freeCapLog.note();
            freeKey = null;
          }
        }
      }
    }

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

    // Only requests that will actually call the AI spend the daily budgets.
    for (const key of keys) await limiter.record(key);
    if (freeKey && freeLimiter) await freeLimiter.record(freeKey);

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
      logger.error(
        `[momentum-ai] ${provider.id} proxy error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { status: 502, body: { error: "Momentum AI request failed" } };
    }
  };
}
