// Cloudflare Worker entry for the AI proxy: same routes, validation, limits
// and entitlement check as the Node server (both use handler.mjs), with the
// rate limits kept in one Durable Object so they hold across Cloudflare's
// many isolates. Deploy: see docs/momentum-ai-proxy.md ("Cloudflare Workers").

// Provided by the Workers runtime (not an npm package).
// eslint-disable-next-line import/no-unresolved
import { DurableObject } from "cloudflare:workers";

import { createRateLimiter, readConfig, secretsMatch } from "./config.mjs";
import { createEntitlements } from "./entitlements.mjs";
import { BodyTooLargeError, SECRET_HEADER, USER_HEADER, createHandler } from "./handler.mjs";
import { DEFAULT_PROVIDER_ID, getProvider } from "./providers/index.mjs";

/**
 * All limit counters live in a single instance ("global"): the traffic is
 * small, and one place means one consistent count. Counters are in memory;
 * if Cloudflare evicts the object the counts restart, which only ever makes
 * limits more lenient for a moment (the Anthropic spend cap is the backstop).
 */
export class Limits extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const config = readConfig(env);
    this.limiter = createRateLimiter({
      perMinute: config.rateLimitPerMinute,
      perDay: config.dailyLimitPerClient,
      globalPerDay: config.globalDailyLimit,
    });
    this.free = createRateLimiter({ perMinute: 0, perDay: config.freeBrainDumpsPerDay, globalPerDay: 0 });
  }
  admit(key) {
    return this.limiter.admit(key);
  }
  record(key) {
    this.limiter.record(key);
  }
  admitFree(key) {
    return this.free.admit(key);
  }
  recordFree(key) {
    this.free.record(key);
  }
}

// Per-isolate caches: config and entitlement answers (a miss just asks again).
let state = null;
function setup(env) {
  if (state) return state;
  const config = readConfig(env);
  const provider = getProvider(config.providerName ?? DEFAULT_PROVIDER_ID);
  const limits = () => env.LIMITS.get(env.LIMITS.idFromName("global"));
  const entitlements =
    config.entitlementMode !== "off"
      ? createEntitlements({ secretKey: config.revenueCatSecretKey })
      : undefined;
  const handle = createHandler({
    provider,
    config,
    limiter: { admit: (key) => limits().admit(key), record: (key) => limits().record(key) },
    freeLimiter: { admit: (key) => limits().admitFree(key), record: (key) => limits().recordFree(key) },
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

async function readBody(request, maxBytes) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLargeError("Request body too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new BodyTooLargeError("Request body too large");
  return JSON.parse(text || "{}");
}

export default {
  async fetch(request, env) {
    const { config, handle } = setup(env);
    const url = new URL(request.url);
    const headers = Object.fromEntries([...request.headers].map(([key, value]) => [key.toLowerCase(), value]));
    const result = await handle({
      method: request.method,
      path: url.pathname,
      headers,
      // Cloudflare sets this to the real client address; it can't be spoofed.
      clientIp: request.headers.get("cf-connecting-ip") ?? "unknown",
      readBody: (maxBytes) => readBody(request, maxBytes),
    });
    const responseHeaders = { ...corsHeaders(config), ...(result.headers ?? {}) };
    if (result.status === 204) return new Response(null, { status: 204, headers: responseHeaders });
    return Response.json(result.body, { status: result.status, headers: responseHeaders });
  },
};
