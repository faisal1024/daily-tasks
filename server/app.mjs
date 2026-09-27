// Momentum AI proxy — HTTP app, separated from process startup so it can be
// tested end-to-end without binding a real port or calling a real provider.
//
// `momentum-proxy.mjs` reads the environment and calls `createProxyServer`;
// tests build their own config + fake provider and do the same.

import http from "node:http";
import { Buffer } from "node:buffer";

import { clientIpFrom, createBudget, secretsMatch } from "./config.mjs";
import { createEntitlements } from "./entitlements.mjs";
import {
  BodyTooLargeError,
  SECRET_HEADER,
  USER_HEADER,
  createHandler,
} from "./handler.mjs";

export {
  BRAIN_DUMP_ROUTE,
  BREAK_DOWN_ROUTE,
  EVENING_ROUTE,
  PLAN_ROUTE,
  ROUTES,
} from "./routes.mjs";
export {
  DEBUG_IP_ROUTE,
  HEALTH_ROUTE,
  MAX_BODY_BYTES,
  SECRET_HEADER,
  USER_HEADER,
} from "./handler.mjs";
export {
  clientIpFrom,
  createRateLimiter,
  readConfig,
  secretsMatch,
} from "./config.mjs";

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
  res.setHeader(
    "Access-Control-Allow-Headers",
    `Content-Type, ${SECRET_HEADER}, ${USER_HEADER}`,
  );
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
export function createProxyServer({
  provider,
  config,
  logger = console,
  now,
  fetchImpl,
}) {
  const budget = createBudget(config, { now });
  const entitlements =
    config.entitlementMode && config.entitlementMode !== "off"
      ? createEntitlements({
          secretKey: config.revenueCatSecretKey,
          fetchImpl,
          now,
          logger,
        })
      : undefined;
  const handle = createHandler({
    provider,
    config,
    budget,
    entitlements,
    secretsMatch,
    logger,
    now,
  });

  const server = http.createServer(async (req, res) => {
    setCorsHeaders(res, config.corsOrigin);
    let result;
    try {
      result = await handle({
        method: req.method ?? "GET",
        path: req.url ?? "",
        headers: req.headers,
        clientIp: clientIpFrom(req, config.trustProxyHops),
        socketAddress: req.socket?.remoteAddress ?? null,
        readBody: async (maxBytes) => {
          const declared = Number(req.headers["content-length"]);
          if (Number.isFinite(declared) && declared > maxBytes)
            throw new BodyTooLargeError("Request body too large");
          return readJson(req, maxBytes);
        },
      });
    } catch (error) {
      logger.error(
        `[momentum-ai] unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      );
      result = { status: 500, body: { error: "Internal error" } };
    }
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
  return { server, limiter: budget.limiter };
}
