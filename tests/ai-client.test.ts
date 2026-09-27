// Shared proxy transport (postToProxy) and sibling-route URL derivation.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AI_REQUEST_TIMEOUT_MS,
  PROXY_SECRET_HEADER,
  PROXY_USER_HEADER,
  getMomentumAiProxyUrl,
  getMomentumProxySecret,
  postToProxy,
  proxyRouteUrl,
  requestSupporterGrant,
  setProxyGrandfathered,
  setProxyUserId,
  setProxyUserIdPending,
} from "../lib/daily-tasks/ai-client";
import { MomentumAiError } from "../lib/daily-tasks/ai-status";
import * as momentumAi from "../lib/daily-tasks/momentum-ai";

const PLAN_URL = "https://momentum.onrender.com/api/momentum/plan";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("proxyRouteUrl", () => {
  it("returns null when no proxy is configured", () => {
    expect(proxyRouteUrl(null, "brain-dump")).toBeNull();
    expect(proxyRouteUrl("", "break-down")).toBeNull();
    expect(proxyRouteUrl(null, "plan")).toBeNull();
  });

  it("swaps the plan segment for a sibling route", () => {
    expect(proxyRouteUrl(PLAN_URL, "brain-dump")).toBe(
      "https://momentum.onrender.com/api/momentum/brain-dump",
    );
    expect(proxyRouteUrl(PLAN_URL, "break-down")).toBe(
      "https://momentum.onrender.com/api/momentum/break-down",
    );
    expect(proxyRouteUrl(PLAN_URL, "plan")).toBe(PLAN_URL);
  });

  it("keeps a path prefix, port and http scheme", () => {
    expect(proxyRouteUrl("http://192.168.1.5:8787/v2/api/momentum/plan", "break-down")).toBe(
      "http://192.168.1.5:8787/v2/api/momentum/break-down",
    );
  });

  it("drops a trailing slash after plan", () => {
    expect(proxyRouteUrl(`${PLAN_URL}/`, "brain-dump")).toBe(
      "https://momentum.onrender.com/api/momentum/brain-dump",
    );
  });

  it("carries a query string over to the sibling route", () => {
    expect(proxyRouteUrl(`${PLAN_URL}?region=eu&v=2`, "brain-dump")).toBe(
      "https://momentum.onrender.com/api/momentum/brain-dump?region=eu&v=2",
    );
    expect(proxyRouteUrl(`${PLAN_URL}/?v=2`, "break-down")).toBe(
      "https://momentum.onrender.com/api/momentum/break-down?v=2",
    );
  });

  it("returns a non-plan URL unchanged for the plan route but null for helpers", () => {
    const custom = "https://example.com/custom-endpoint";
    expect(proxyRouteUrl(custom, "plan")).toBe(custom);
    expect(proxyRouteUrl(custom, "brain-dump")).toBeNull();
    expect(proxyRouteUrl(custom, "break-down")).toBeNull();
  });

  it("doesn't treat look-alike paths as the plan route", () => {
    for (const url of [
      "https://x.test/api/momentum/planner",
      "https://x.test/api/momentum/plans",
      "https://x.test/api/momentum",
      "https://x.test/api/momentum/brain-dump",
      "https://x.test/api/momentum/plan/extra",
      "https://x.test/",
    ]) {
      expect(proxyRouteUrl(url, "brain-dump"), url).toBeNull();
    }
  });

  // Regression (fixed in 0420e91): only the path may name the plan route.
  it("doesn't match /api/momentum/plan inside a query string", () => {
    expect(proxyRouteUrl("https://x.test/gateway?to=/api/momentum/plan", "brain-dump")).toBeNull();
  });
});

describe("proxy URL and secret from the build env", () => {
  it("reads the proxy URL, or null when unset", () => {
    vi.stubEnv("EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL", PLAN_URL);
    expect(getMomentumAiProxyUrl()).toBe(PLAN_URL);
    vi.stubEnv("EXPO_PUBLIC_MOMENTUM_AI_PROXY_URL", undefined);
    expect(getMomentumAiProxyUrl()).toBeNull();
  });

  it("treats an empty secret as unset", () => {
    vi.stubEnv("EXPO_PUBLIC_MOMENTUM_PROXY_SECRET", "");
    expect(getMomentumProxySecret()).toBeNull();
    vi.stubEnv("EXPO_PUBLIC_MOMENTUM_PROXY_SECRET", "abc");
    expect(getMomentumProxySecret()).toBe("abc");
  });

  it("momentum-ai re-exports the same helpers and constants (one source of truth)", () => {
    expect(momentumAi.getMomentumAiProxyUrl).toBe(getMomentumAiProxyUrl);
    expect(momentumAi.getMomentumProxySecret).toBe(getMomentumProxySecret);
    expect(momentumAi.PROXY_SECRET_HEADER).toBe(PROXY_SECRET_HEADER);
    expect(momentumAi.AI_REQUEST_TIMEOUT_MS).toBe(AI_REQUEST_TIMEOUT_MS);
    expect(PROXY_SECRET_HEADER).toBe("x-momentum-secret");
    expect(AI_REQUEST_TIMEOUT_MS).toBe(60_000);
  });
});

describe("postToProxy", () => {
  const post = (fetchImpl: unknown, extra: Partial<Parameters<typeof postToProxy>[0]> = {}) =>
    postToProxy({
      url: "https://proxy.test/api/momentum/break-down",
      payload: { task: "Clean" },
      proxySecret: null,
      fetchImpl: fetchImpl as typeof fetch,
      ...extra,
    });

  it("POSTs JSON to the given URL and returns the parsed object", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ steps: [] }));
    await expect(post(fetchImpl)).resolves.toEqual({ steps: [] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://proxy.test/api/momentum/break-down");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ task: "Clean" }));
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends the secret header only when a secret is given", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({}));
    await post(fetchImpl, { proxySecret: "s3cret" });
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({
      "Content-Type": "application/json",
      [PROXY_SECRET_HEADER]: "s3cret",
    });
    await post(fetchImpl, { proxySecret: "" });
    expect(fetchImpl.mock.calls[1][1].headers).not.toHaveProperty(PROXY_SECRET_HEADER);
  });

  it("defaults the secret to the build env", async () => {
    vi.stubEnv("EXPO_PUBLIC_MOMENTUM_PROXY_SECRET", "from-env");
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({}));
    await postToProxy({ url: "https://p.test/x", payload: {}, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((fetchImpl.mock.calls[0][1].headers as Record<string, string>)[PROXY_SECRET_HEADER]).toBe(
      "from-env",
    );
  });

  it.each([
    [401, { error: "Unauthorized" }, "unauthorized"],
    [403, null, "unauthorized"],
    [429, { error: "Too many requests" }, "rate_limited"],
    [503, { error: "Service is busy, try again later" }, "busy"],
    [503, { error: "Down for maintenance" }, "unavailable"],
    [502, { error: "AI response did not include a valid break-down" }, "unavailable"],
    [500, { error: "OPENAI_API_KEY is not configured" }, "unavailable"],
    [400, { error: "Missing or too long task" }, "unavailable"],
  ])("maps HTTP %i to a typed error", async (status, body, kind) => {
    const fetchImpl = vi.fn(async () => jsonResponse(body, status));
    const error = await post(fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MomentumAiError);
    expect(error).toMatchObject({ kind, status });
  });

  it("handles a non-JSON error page from the host", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 503 }));
    await expect(post(fetchImpl)).rejects.toMatchObject({ kind: "unavailable", status: 503 });
  });

  it("classifies a malformed success body as an invalid response", async () => {
    const fetchImpl = vi.fn(async () => new Response("{nope", { status: 200 }));
    await expect(post(fetchImpl)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("returns {} for JSON that isn't an object", async () => {
    for (const body of [null, "text", 42, true]) {
      const fetchImpl = vi.fn(async () => jsonResponse(body));
      await expect(post(fetchImpl)).resolves.toEqual({});
    }
  });

  it("maps a thrown fetch to a network error keeping its message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Network request failed");
    });
    await expect(post(fetchImpl)).rejects.toMatchObject({
      kind: "network",
      message: "Network request failed",
    });
    const weird = vi.fn(async () => {
      throw "string thrown";
    });
    await expect(post(weird)).rejects.toMatchObject({ kind: "network" });
  });

  it("aborts after the timeout and reports it as a timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init.signal ?? undefined;
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    const pending = post(fetchImpl, { timeoutMs: 5_000 });
    const assertion = expect(pending).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(signal?.aborted).toBe(true);
  });

  it("uses the 60s default timeout", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        }),
    );
    let settled = false;
    const pending = post(fetchImpl).finally(() => {
      settled = true;
    });
    pending.catch(() => {});
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).rejects.toMatchObject({ kind: "timeout" });
  });

  it("clears its timer after success and after failure", async () => {
    vi.useFakeTimers();
    await post(vi.fn(async () => jsonResponse({})));
    expect(vi.getTimerCount()).toBe(0);
    await post(vi.fn(async () => jsonResponse({}, 429))).catch(() => {});
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("setProxyUserId", () => {
  afterEach(() => setProxyUserId(null));
  const headersOf = async (fetchImpl: ReturnType<typeof vi.fn>) => {
    await postToProxy({ url: "https://p.test/x", payload: {}, proxySecret: null, fetchImpl: fetchImpl as unknown as typeof fetch });
    return fetchImpl.mock.calls.at(-1)![1].headers as Record<string, string>;
  };

  it("sends the RevenueCat id as x-rc-user once set", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({}));
    expect(PROXY_USER_HEADER).toBe("x-rc-user");
    expect(await headersOf(fetchImpl)).not.toHaveProperty(PROXY_USER_HEADER);
    setProxyUserId("$RCAnonymousID:abc");
    expect((await headersOf(fetchImpl))[PROXY_USER_HEADER]).toBe("$RCAnonymousID:abc");
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["over 100 chars", "x".repeat(101)],
  ])("clears the header when the id is %s", async (_why, id) => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({}));
    setProxyUserId("someone");
    setProxyUserId(id);
    expect(await headersOf(fetchImpl)).not.toHaveProperty(PROXY_USER_HEADER);
  });

  it("accepts an id of exactly 100 chars", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({}));
    setProxyUserId("y".repeat(100));
    expect((await headersOf(fetchImpl))[PROXY_USER_HEADER]).toHaveLength(100);
  });
});

describe("proxy user id: pending lookup and grandfathered installs", () => {
  const ID = "$RCAnonymousID:0123456789abcdef0123456789abcdef";
  afterEach(async () => {
    setProxyUserId(null);
    setProxyGrandfathered(false);
    // Settle any pending lookup a test left behind.
    const done = Promise.resolve();
    setProxyUserIdPending(done);
    await done;
    await Promise.resolve();
  });
  const send = async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({}));
    await postToProxy({ url: "https://p.test/x", payload: {}, proxySecret: null, fetchImpl: fetchImpl as unknown as typeof fetch });
    return fetchImpl.mock.calls[0][1].headers as Record<string, string>;
  };

  it("waits for a pending id lookup and sends the id it produced", async () => {
    let resolveId!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveId = () => {
        setProxyUserId(ID);
        resolve();
      };
    });
    setProxyUserIdPending(pending);
    const sent = send();
    resolveId();
    expect((await sent)[PROXY_USER_HEADER]).toBe(ID);
  });

  it("gives up after 1s and sends no id, clearing its wait timer either way", async () => {
    vi.useFakeTimers();
    setProxyUserIdPending(new Promise(() => {}));
    const sent = send();
    await vi.advanceTimersByTimeAsync(999);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await sent).not.toHaveProperty(PROXY_USER_HEADER);
    // Only the (cleared) request timer would remain; the id wait timer is gone.
    expect(vi.getTimerCount()).toBe(0);

    // Resolved lookup: the 1s timer is cleared immediately, not left running.
    const done = Promise.resolve();
    setProxyUserIdPending(done);
    setProxyUserId(null);
    const again = send();
    await vi.advanceTimersByTimeAsync(0);
    await again;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("doesn't wait when an id is already known", async () => {
    vi.useFakeTimers();
    setProxyUserId(ID);
    setProxyUserIdPending(new Promise(() => {}));
    const headers = await send();
    expect(headers[PROXY_USER_HEADER]).toBe(ID);
  });

  it("grandfathered installs send no id and don't wait for one", async () => {
    vi.useFakeTimers();
    setProxyGrandfathered(true);
    setProxyUserIdPending(new Promise(() => {}));
    expect(await send()).not.toHaveProperty(PROXY_USER_HEADER);
    setProxyUserId(ID);
    expect(await send()).not.toHaveProperty(PROXY_USER_HEADER);
    setProxyGrandfathered(false);
    expect((await send())[PROXY_USER_HEADER]).toBe(ID);
  });
});

describe("requestSupporterGrant", () => {
  const ID = "$RCAnonymousID:0123456789abcdef0123456789abcdef";
  const PLAN = "https://momentum.onrender.com/api/momentum/plan";
  afterEach(() => {
    setProxyUserId(null);
    setProxyGrandfathered(false);
  });
  const grant = (fetchImpl: unknown, extra: Record<string, unknown> = {}) =>
    requestSupporterGrant({ planUrl: PLAN, proxySecret: "s3cret", fetchImpl: fetchImpl as typeof fetch, ...extra });

  it("POSTs to the grandfather route with the secret and the id, even when grandfathered", async () => {
    setProxyUserId(ID);
    setProxyGrandfathered(true);
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({ granted: true }));
    expect(await grant(fetchImpl)).toBe("granted");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://momentum.onrender.com/api/momentum/grandfather");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ [PROXY_SECRET_HEADER]: "s3cret", [PROXY_USER_HEADER]: ID });
  });

  it.each([
    [403, "closed"],
    [401, "retry"],
    [429, "retry"],
    [503, "retry"],
  ])("maps HTTP %i to %s", async (status, expected) => {
    setProxyUserId(ID);
    expect(await grant(vi.fn(async () => jsonResponse({}, status)))).toBe(expected);
  });

  it("retries later on a network error", async () => {
    setProxyUserId(ID);
    expect(await grant(vi.fn(async () => Promise.reject(new Error("offline"))))).toBe("retry");
  });

  it("retries later without a proxy URL, an id, or a secret (without calling out)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    expect(await grant(fetchImpl)).toBe("retry"); // no id
    setProxyUserId(ID);
    expect(await grant(fetchImpl, { planUrl: null })).toBe("retry");
    expect(await grant(fetchImpl, { proxySecret: null })).toBe("retry");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("waits for a pending id lookup first", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => jsonResponse({}));
    const pending = Promise.resolve().then(() => setProxyUserId(ID));
    setProxyUserIdPending(pending);
    expect(await grant(fetchImpl)).toBe("granted");
    expect((fetchImpl.mock.calls[0][1].headers as Record<string, string>)[PROXY_USER_HEADER]).toBe(ID);
  });
});
