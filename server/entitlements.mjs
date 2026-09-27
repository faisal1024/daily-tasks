// Server-side Plus check against RevenueCat, so the paid AI routes can't be
// used by simply calling the proxy. Off until ENTITLEMENT_MODE and a
// RevenueCat secret key are set; answers are cached per user.

export const PLUS_ENTITLEMENT = "plus";
const REVENUECAT_API = "https://api.revenuecat.com/v1/subscribers/";

/** Whether a RevenueCat subscriber JSON has an active Plus entitlement. */
export function hasActivePlus(subscriberJson, now = Date.now()) {
  const entitlement = subscriberJson?.subscriber?.entitlements?.[PLUS_ENTITLEMENT];
  if (!entitlement || typeof entitlement !== "object") return false;
  const expires = entitlement.expires_date;
  // null = lifetime / non-expiring.
  if (expires === null || expires === undefined) return true;
  const at = Date.parse(expires);
  // A grace period keeps access while Apple retries a failed renewal.
  const grace = entitlement.grace_period_expires_date ? Date.parse(entitlement.grace_period_expires_date) : NaN;
  return (Number.isFinite(at) && at > now) || (Number.isFinite(grace) && grace > now);
}

/**
 * @param {{
 *   secretKey: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   cacheMs?: number,
 *   timeoutMs?: number,
 *   maxEntries?: number,
 *   logger?: { warn?: (...args: unknown[]) => void },
 * }} options
 */
export function createEntitlements({
  secretKey,
  fetchImpl = fetch,
  now = () => Date.now(),
  cacheMs = 60 * 60_000,
  timeoutMs = 3_000,
  maxEntries = 10_000,
  logger = console,
}) {
  /** @type {Map<string, { status: "plus" | "free", at: number }>} */
  const cache = new Map();

  return {
    /** "plus", "free" (incl. no user id), or "unknown" when RevenueCat can't answer. */
    async check(userId) {
      if (!userId) return "free";
      if (!secretKey) return "unknown";
      const hit = cache.get(userId);
      // Free answers expire sooner: a new subscriber shouldn't wait an hour.
      const ttl = hit?.status === "plus" ? cacheMs : Math.min(cacheMs, 5 * 60_000);
      if (hit && now() - hit.at < ttl) return hit.status;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(`${REVENUECAT_API}${encodeURIComponent(userId)}`, {
          headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          logger.warn?.(`[momentum-ai] RevenueCat check failed: HTTP ${response.status}`);
          return "unknown";
        }
        const status = hasActivePlus(await response.json(), now()) ? "plus" : "free";
        if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
        cache.set(userId, { status, at: now() });
        return status;
      } catch {
        return "unknown";
      } finally {
        clearTimeout(timer);
      }
    },
    size: () => cache.size,
  };
}
