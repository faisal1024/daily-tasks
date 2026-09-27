// Shared transport for every Momentum AI proxy route: JSON POST with the shared
// secret, a timeout, and failures mapped to typed MomentumAiError kinds. Pure
// fetch (no React Native imports) so it's unit-tested.

import { MomentumAiError, kindForStatus } from "./ai-status";

/** Header the proxy checks when PROXY_SHARED_SECRET is set server-side. */
export const PROXY_SECRET_HEADER = "x-momentum-secret";

/**
 * Long enough to ride out a Render free-tier cold start (~30–60s) plus a model
 * response; short enough that a dead network doesn't hang the UI forever.
 */
export const AI_REQUEST_TIMEOUT_MS = 60_000;

/** Base URL of the proxy's /api/momentum/plan route (baked in at build time). */
export function getMomentumAiProxyUrl(): string | null {
  return process.env.EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL ?? null;
}

/**
 * Shared secret baked into the build (EAS env). It is extractable from the app
 * binary, so it only raises the bar for casual abuse; the proxy's rate limits
 * and daily caps are the real cost protection.
 */
export function getMomentumProxySecret(): string | null {
  const secret = process.env.EXPO_PUBLIC_MOMENTUM_PROXY_SECRET;
  return secret ? secret : null;
}

export type ProxyRoute = "plan" | "brain-dump" | "break-down" | "evening";

/**
 * URL for another route on the same proxy. The configured URL points at the
 * plan route (…/api/momentum/plan); sibling routes replace its last segment.
 * Returns null if no proxy is configured or the URL isn't a plan-route URL.
 */
export function proxyRouteUrl(planUrl: string | null, route: ProxyRoute): string | null {
  if (!planUrl) return null;
  // [^?]* keeps the match in the path: a query string that happens to contain
  // "/api/momentum/plan" must not count.
  const match = /^([^?]*\/api\/momentum)\/plan\/?(\?.*)?$/.exec(planUrl);
  if (!match) return route === "plan" ? planUrl : null;
  return `${match[1]}/${route}${match[2] ?? ""}`;
}

/**
 * POST `payload` to the proxy and return the parsed JSON object ({} when the
 * body isn't an object). Throws MomentumAiError with a kind for every failure.
 */
export async function postToProxy({
  url,
  payload,
  proxySecret = getMomentumProxySecret(),
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
  fetchImpl = fetch,
}: {
  url: string;
  payload: unknown;
  proxySecret?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (proxySecret) headers[PROXY_SECRET_HEADER] = proxySecret;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      let proxyError: unknown = null;
      try {
        proxyError = ((await response.json()) as { error?: unknown } | null)?.error;
      } catch {
        // Non-JSON error body (e.g. the host's own error page).
      }
      throw new MomentumAiError(
        kindForStatus(response.status, proxyError),
        `Momentum AI request failed with ${response.status}.`,
        response.status,
      );
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new MomentumAiError("invalid_response", "Momentum AI returned malformed JSON.");
    }
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch (error) {
    if (controller.signal.aborted) {
      throw new MomentumAiError("timeout", "Momentum AI request timed out.");
    }
    if (error instanceof MomentumAiError) throw error;
    throw new MomentumAiError(
      "network",
      error instanceof Error ? error.message : "Momentum AI network error.",
    );
  } finally {
    clearTimeout(timer);
  }
}
