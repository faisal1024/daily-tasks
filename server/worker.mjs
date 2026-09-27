// Cloudflare Worker entry for the AI proxy: same routes, validation, limits
// and entitlement check as the Node server (both use handler.mjs), with the
// limits kept in one Durable Object so they hold across Cloudflare's many
// isolates. Deploy: see docs/momentum-ai-proxy.md ("Cloudflare Workers").

// Provided by the Workers runtime (not an npm package).
// eslint-disable-next-line import/no-unresolved
import { DurableObject } from "cloudflare:workers";

import { readConfig, secretsMatch } from "./config.mjs";
import { createEntitlements } from "./entitlements.mjs";
import { BodyTooLargeError, SECRET_HEADER, USER_HEADER, createHandler } from "./handler.mjs";
import { DEFAULT_PROVIDER_ID, getProvider } from "./providers/index.mjs";

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const GLOBAL_KEY = "global";

/**
 * All limit counters, in a single instance ("global"): the traffic is small,
 * and one place means one consistent count. Per-minute counts live in memory
 * (losing them on eviction only resets a minute); daily counts are stored in
 * the object's SQLite storage so they survive eviction and deploys.
 * Two calls per request: admit() before the work, spend() right before the AI.
 */
export class Limits extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.config = readConfig(env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS day_counts (day INTEGER NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, key))");
    this.minute = { start: -1, counts: new Map() };
    this.lastCleanDay = -1;
  }

  today(now) {
    const day = Math.floor(now / DAY_MS);
    if (day !== this.lastCleanDay) {
      // Yesterday's rows are no longer needed.
      this.sql.exec("DELETE FROM day_counts WHERE day < ?", day);
      this.lastCleanDay = day;
    }
    return day;
  }

  count(day, key) {
    const row = this.sql.exec("SELECT n FROM day_counts WHERE day = ? AND key = ?", day, key).toArray()[0];
    return row ? Number(row.n) : 0;
  }

  add(day, key) {
    this.sql.exec(
      "INSERT INTO day_counts (day, key, n) VALUES (?, ?, 1) ON CONFLICT (day, key) DO UPDATE SET n = n + 1",
      day,
      key,
    );
  }

  /** Count this minute and check (without spending) the daily caps. */
  admit(keys, now = Date.now()) {
    const { rateLimitPerMinute, dailyLimitPerClient, globalDailyLimit } = this.config;
    const day = this.today(now);
    if (globalDailyLimit > 0 && this.count(day, GLOBAL_KEY) >= globalDailyLimit) return "global";
    const minuteStart = now - (now % MINUTE_MS);
    if (minuteStart !== this.minute.start) this.minute = { start: minuteStart, counts: new Map() };
    for (const key of keys) {
      const used = this.minute.counts.get(key) ?? 0;
      if (rateLimitPerMinute > 0 && used >= rateLimitPerMinute) return "minute";
      if (dailyLimitPerClient > 0 && this.count(day, key) >= dailyLimitPerClient) return "day";
    }
    for (const key of keys) this.minute.counts.set(key, (this.minute.counts.get(key) ?? 0) + 1);
    return "ok";
  }

  /** Re-check every cap and spend one unit, atomically (one object, one thread). */
  spend({ keys, free }, now = Date.now()) {
    const { dailyLimitPerClient, globalDailyLimit } = this.config;
    const day = this.today(now);
    if (globalDailyLimit > 0 && this.count(day, GLOBAL_KEY) >= globalDailyLimit) return "global";
    for (const key of keys) {
      if (dailyLimitPerClient > 0 && this.count(day, key) >= dailyLimitPerClient) return "day";
    }
    for (const { key, cap } of free) {
      // 0 means "no free AI", never "unlimited".
      if (this.count(day, key) >= cap) return "free";
    }
    this.add(day, GLOBAL_KEY);
    for (const key of keys) this.add(day, key);
    for (const { key } of free) this.add(day, key);
    return "ok";
  }
}

// Per-isolate: config and the entitlement cache (a miss just asks again).
let state = null;
function setup(env) {
  if (state) return state;
  const config = readConfig(env);
  if (config.entitlementMisconfigured) {
    console.warn("[momentum-ai] ENTITLEMENT_MODE is set but REVENUECAT_SECRET_KEY isn't: the Plus check stays off.");
  }
  const provider = getProvider(config.providerName ?? DEFAULT_PROVIDER_ID);
  const limits = () => env.LIMITS.get(env.LIMITS.idFromName("global"));
  const entitlements =
    config.entitlementMode !== "off" ? createEntitlements({ secretKey: config.revenueCatSecretKey }) : undefined;
  const handle = createHandler({
    provider,
    config,
    budget: {
      admit: (keys) => limits().admit(keys),
      spend: (req) => limits().spend(req),
    },
    entitlements,
    secretsMatch,
  });
  state = { config, handle };
  return state;
}

function corsHeaders(config) {
  const headers = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": `Content-Type, ${SECRET_HEADER}, ${USER_HEADER}`,
  };
  if (config.corsOrigin) headers["Access-Control-Allow-Origin"] = config.corsOrigin;
  return headers;
}

/** Read the body, stopping as soon as it passes maxBytes (no buffering first). */
export async function readLimitedJson(request, maxBytes) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError("Request body too large");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError("Request body too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  return JSON.parse(text || "{}");
}

export default {
  async fetch(request, env) {
    let config = { corsOrigin: "" };
    try {
      const ready = setup(env);
      config = ready.config;
      const url = new URL(request.url);
      const headers = Object.fromEntries([...request.headers].map(([key, value]) => [key.toLowerCase(), value]));
      const result = await ready.handle({
        method: request.method,
        path: url.pathname,
        headers,
        // Cloudflare sets this to the real client address; it can't be spoofed.
        clientIp: request.headers.get("cf-connecting-ip") ?? "unknown",
        readBody: (maxBytes) => readLimitedJson(request, maxBytes),
      });
      const responseHeaders = { ...corsHeaders(config), ...(result.headers ?? {}) };
      delete responseHeaders.Connection; // hop-by-hop; Workers manage connections
      if (result.status === 204) return new Response(null, { status: 204, headers: responseHeaders });
      return Response.json(result.body, { status: result.status, headers: responseHeaders });
    } catch (error) {
      // e.g. the limits object is being reset during a deploy: a clean JSON
      // "busy" (the app retries later) instead of Cloudflare's HTML error page.
      console.error(`[momentum-ai] worker error: ${error instanceof Error ? error.message : String(error)}`);
      return Response.json(
        { error: "Service is busy, try again later" },
        { status: 503, headers: { ...corsHeaders(config), "Retry-After": "60" } },
      );
    }
  },
};
