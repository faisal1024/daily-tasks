// Momentum AI proxy — provider-agnostic.
//
// The mobile app never holds an API key; it POSTs a minimal payload here and
// this server forwards it to whichever AI backend is configured. The provider
// is selected with one env var:
//
//   MOMENTUM_AI_PROVIDER=openai     (default)
//   MOMENTUM_AI_PROVIDER=anthropic
//
// Adding a provider does not touch this file — see server/providers/index.mjs.

import http from "node:http";

import {
  RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  buildPrompt,
  isValidPlan,
  validatePayload,
} from "./providers/plan-contract.mjs";
import { DEFAULT_PROVIDER_ID, getProvider } from "./providers/index.mjs";

const PORT = Number(process.env.PORT ?? 8787);
const PROVIDER_NAME = process.env.MOMENTUM_AI_PROVIDER ?? DEFAULT_PROVIDER_ID;
const ROUTE = "/api/momentum/plan";

let provider;
try {
  provider = getProvider(PROVIDER_NAME);
} catch (error) {
  console.error(`[momentum-ai] ${error.message}`);
  process.exit(1);
}

// Optional shared secret: when PROXY_SHARED_SECRET is set, requests must send a
// matching `x-momentum-secret` header. Left unset for local dev.
const SHARED_SECRET = process.env.PROXY_SHARED_SECRET ?? "";
// Simple in-memory fixed-window rate limit per client IP.
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN ?? 30);
const rateWindow = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const windowStart = now - (now % 60_000);
  const entry = rateWindow.get(ip);
  if (!entry || entry.windowStart !== windowStart) {
    rateWindow.set(ip, { windowStart, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_LIMIT;
}

const server = http.createServer(async (req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== ROUTE) {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (SHARED_SECRET && req.headers["x-momentum-secret"] !== SHARED_SECRET) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  const clientIp =
    (req.headers["x-forwarded-for"]?.toString().split(",")[0].trim()) ||
    req.socket.remoteAddress ||
    "unknown";
  if (isRateLimited(clientIp)) {
    sendJson(res, 429, { error: "Too many requests" });
    return;
  }

  if (!provider.isConfigured()) {
    sendJson(res, 500, { error: provider.missingConfigMessage() });
    return;
  }

  try {
    let payload;
    try {
      payload = await readJson(req);
    } catch {
      // Body too large or malformed JSON is a client error, not a provider one.
      sendJson(res, 400, { error: "Invalid request body" });
      return;
    }
    const validationError = validatePayload(payload);
    if (validationError) {
      sendJson(res, 400, { error: validationError });
      return;
    }

    const plan = await provider.generatePlan({
      system: SYSTEM_PROMPT,
      user: buildPrompt(payload),
      schema: RESPONSE_SCHEMA,
    });

    if (!isValidPlan(plan)) {
      console.error(`[momentum-ai] ${provider.id} returned an invalid plan`, plan);
      sendJson(res, 502, { error: "AI response did not include a valid plan" });
      return;
    }

    sendJson(res, 200, plan);
  } catch (error) {
    console.error(`[momentum-ai] ${provider.id} proxy error`, error);
    sendJson(res, 502, { error: "Momentum AI request failed" });
  }
});

server.listen(PORT, () => {
  console.log(
    `Momentum AI proxy listening on http://localhost:${PORT}${ROUTE} (provider: ${provider.describe()})`,
  );
});

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 20_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function setCorsHeaders(res) {
  // No wildcard default: set CORS_ORIGIN explicitly (e.g. "*" for local dev, or
  // the app's origin in production). When unset, no cross-origin header is sent.
  const origin = process.env.CORS_ORIGIN ?? "";
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-momentum-secret");
}
