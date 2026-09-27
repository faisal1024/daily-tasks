// Server-side Plus check against RevenueCat, so the paid AI routes can't be
// used by simply calling the proxy. Off until ENTITLEMENT_MODE and a
// RevenueCat V1 secret key (sk_…) are set; answers are cached per user.

export const PLUS_ENTITLEMENT = "plus";
const REVENUECAT_ORIGIN = "https://api.revenuecat.com";
const SUBSCRIBERS_PATH = "/v1/subscribers/";

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

/** The lookup URL, or null if the id would change the path (e.g. ".."). */
export function subscriberUrl(userId) {
  const url = new URL(`${SUBSCRIBERS_PATH}${encodeURIComponent(userId)}`, REVENUECAT_ORIGIN);
  const expected = `${SUBSCRIBERS_PATH}${encodeURIComponent(userId)}`;
  return url.pathname === expected && url.origin === REVENUECAT_ORIGIN ? url.toString() : null;
}

/**
 * @param {{
 *   secretKey: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   plusCacheMs?: number,
 *   freeCacheMs?: number,
 *   pauseMs?: number,
 *   timeoutMs?: number,
 *   maxEntries?: number,
 *   logger?: { warn?: (...args: unknown[]) => void },
 * }} options
 */
export function createEntitlements({
  secretKey,
  fetchImpl = fetch,
  now = () => Date.now(),
  plusCacheMs = 60 * 60_000,
  freeCacheMs = 60_000,
  pauseMs = 30_000,
  timeoutMs = 3_000,
  maxEntries = 10_000,
  logger = console,
}) {
  /** @type {Map<string, { status: "plus" | "free", at: number }>} */
  const cache = new Map();
  // After RevenueCat fails (down, rate-limited), stop asking for a moment:
  // protects it from a flood and keeps requests from waiting on timeouts.
  let pausedUntil = -Infinity;
  let lastWarnAt = -Infinity;
  const warn = (message) => {
    const t = now();
    if (t - lastWarnAt >= 60_000) {
      logger.warn?.(`[momentum-ai] ${message}`);
      lastWarnAt = t;
    }
  };
  const remember = (userId, status) => {
    cache.delete(userId);
    if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(userId, { status, at: now() });
  };

  return {
    /**
     * "plus", "free", or "unknown" when RevenueCat can't answer right now.
     * `fresh`: don't trust a cached "free" (Plus routes, so someone who just
     * subscribed isn't refused on their very next request).
     */
    async check(userId, { fresh = false } = {}) {
      if (!userId || !secretKey) return "unknown";
      const hit = cache.get(userId);
      if (hit) {
        const ttl = hit.status === "plus" ? plusCacheMs : freeCacheMs;
        if (now() - hit.at < ttl && !(fresh && hit.status === "free")) return hit.status;
      }
      if (now() < pausedUntil) return "unknown";
      const url = subscriberUrl(userId);
      if (!url) return "free";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
          signal: controller.signal,
        });
        // 429 / 5xx: RevenueCat trouble, not an answer about this user.
        if (response.status === 429 || response.status >= 500) {
          pausedUntil = now() + pauseMs;
          warn(`RevenueCat unavailable (HTTP ${response.status}); allowing requests for ${pauseMs / 1000}s`);
          return "unknown";
        }
        // 401/403: our key is wrong. An operator mistake mustn't lock every
        // subscriber out, so allow, and say so loudly.
        if (response.status === 401 || response.status === 403) {
          warn(`RevenueCat rejected REVENUECAT_SECRET_KEY (HTTP ${response.status}); use a V1 secret key (sk_...). Allowing requests.`);
          return "unknown";
        }
        // Other 4xx: RevenueCat said no about this id. Never "allow".
        if (!response.ok) return "free";
        const status = hasActivePlus(await response.json(), now()) ? "plus" : "free";
        remember(userId, status);
        return status;
      } catch {
        pausedUntil = now() + pauseMs;
        warn("RevenueCat didn't answer in time; allowing requests for a moment");
        return "unknown";
      } finally {
        clearTimeout(timer);
      }
    },
    size: () => cache.size,
  };
}
