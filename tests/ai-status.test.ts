import { describe, expect, it } from "vitest";

import {
  FOREGROUND_RETRY_COOLDOWN_MS,
  MomentumAiError,
  aiFailureMessage,
  classifyAiFailure,
  isAiFailureKind,
  isFreshAiPlan,
  kindForStatus,
  planAfterAiFailure,
  restorePlanStatus,
  shouldRetryAiOnForeground,
  suggestionsHint,
  type AiFailureKind,
} from "../lib/daily-tasks/ai-status";
import { nextAiPlanFetchKey } from "../lib/daily-tasks/momentum-ai";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import type { MomentumPlan } from "../lib/daily-tasks/types";

const ALL_KINDS: AiFailureKind[] = [
  "timeout",
  "rate_limited",
  "busy",
  "unauthorized",
  "network",
  "unavailable",
  "invalid_response",
  "needs_plus",
];

function plan(overrides: Partial<MomentumPlan> = {}): MomentumPlan {
  return {
    id: "p1",
    goalTitle: "Run a 5K",
    generatedAt: new Date(2026, 8, 26, 9, 0).toISOString(),
    provider: "ai",
    milestones: [],
    taskPool: [],
    todaySuggestions: [],
    promptSummary: "",
    version: 1,
    ...overrides,
  };
}

describe("failure classification", () => {
  it("maps proxy statuses to kinds", () => {
    expect(kindForStatus(401)).toBe("unauthorized");
    expect(kindForStatus(403)).toBe("unauthorized");
    expect(kindForStatus(429)).toBe("rate_limited");
    // The proxy's Plus check said no.
    expect(kindForStatus(402)).toBe("needs_plus");
    expect(kindForStatus(402, "Free limit reached")).toBe("needs_plus");
    expect(kindForStatus(503, "Service is busy, try again later")).toBe("busy");
    expect(kindForStatus(503)).toBe("unavailable");
    expect(kindForStatus(503, "Bad gateway")).toBe("unavailable");
    expect(kindForStatus(500)).toBe("unavailable");
    expect(kindForStatus(400)).toBe("unavailable");
  });

  it("uses the error's own kind and treats anything else as a network problem", () => {
    expect(classifyAiFailure(new MomentumAiError("busy", "x"))).toBe("busy");
    expect(classifyAiFailure(new Error("boom"))).toBe("network");
    expect(classifyAiFailure("string")).toBe("network");
    expect(classifyAiFailure(undefined)).toBe("network");
  });

  it("recognizes only known kinds (old builds stored raw error strings)", () => {
    for (const kind of ALL_KINDS) expect(isAiFailureKind(kind)).toBe(true);
    expect(isAiFailureKind("Momentum AI returned an invalid daily plan.")).toBe(false);
    expect(isAiFailureKind(null)).toBe(false);
  });
});

describe("aiFailureMessage", () => {
  it("has friendly copy for every kind and never leaks technical wording", () => {
    for (const kind of ALL_KINDS) {
      const message = aiFailureMessage(kind);
      expect(message).toBeTruthy();
      expect(message).not.toMatch(/\d{3}|error|failed|proxy|AI request|momentum ai/i);
    }
  });

  it("gives specific guidance for limits, the spend cap and old builds", () => {
    expect(aiFailureMessage("rate_limited")).toContain("later");
    expect(aiFailureMessage("busy")).toContain("today");
    expect(aiFailureMessage("unauthorized")).toContain("latest version");
    expect(aiFailureMessage("needs_plus")).toBe(
      "We couldn't confirm your Plus subscription. Try Restore purchases in Settings.",
    );
  });

  it("never blames the user or promises a one-minute wait for rate limits", () => {
    const message = aiFailureMessage("rate_limited") ?? "";
    expect(message).not.toMatch(/you've|minute/i);
  });

  it("only promises starter ideas when the AI ideas aren't still on screen", () => {
    expect(aiFailureMessage("busy", { showingAiIdeas: true })).toContain("Your ideas below still work");
    expect(aiFailureMessage("busy", { showingAiIdeas: true })).not.toMatch(/starter/i);
    expect(aiFailureMessage("busy")).toMatch(/starter/i);
  });

  it("in Settings, points at the Tasks tab instead of ideas that aren't on screen", () => {
    const kept = aiFailureMessage("busy", { surface: "settings", showingAiIdeas: true }) ?? "";
    const starters = aiFailureMessage("busy", { surface: "settings" }) ?? "";
    for (const message of [kept, starters]) {
      expect(message).toContain("Tasks tab");
      expect(message).not.toMatch(/below|these/i);
    }
    expect(kept).not.toMatch(/starter/i);
    expect(starters).toMatch(/starter/i);
  });

  it("says nothing when there is no failure", () => {
    expect(aiFailureMessage(null)).toBeNull();
  });
});

describe("restorePlanStatus", () => {
  it("never restores a stuck 'loading' (the app was killed mid-request)", () => {
    expect(restorePlanStatus("loading", true)).toBe("ready");
    expect(restorePlanStatus("loading", false)).toBe("idle");
  });

  it("keeps ready/error and derives a status for anything else", () => {
    expect(restorePlanStatus("ready", true)).toBe("ready");
    expect(restorePlanStatus("error", true, "timeout")).toBe("error");
    expect(restorePlanStatus(undefined, true)).toBe("ready");
    expect(restorePlanStatus("garbage", false)).toBe("idle");
  });

  it("doesn't restore an error without a known kind (it would show nothing and never retry)", () => {
    expect(restorePlanStatus("error", true, "Momentum AI returned an invalid daily plan.")).toBe("ready");
    expect(restorePlanStatus("error", false, null)).toBe("idle");
  });

  it("is applied when loading persisted state", () => {
    const saved = {
      ...buildInitialState(new Date(2026, 8, 26)),
      momentumPlan: plan(),
      momentumPlanStatus: "loading",
      momentumPlanError: "Momentum AI returned an invalid daily plan.",
    };
    const restored = normalizeState(JSON.parse(JSON.stringify(saved)));
    expect(restored?.momentumPlanStatus).toBe("ready");
    // Legacy raw error strings are dropped rather than shown to users.
    expect(restored?.momentumPlanError).toBeNull();
  });

  it("keeps a valid saved failure kind", () => {
    const saved = {
      ...buildInitialState(),
      momentumPlanStatus: "error",
      momentumPlanError: "busy",
    };
    expect(normalizeState(saved)?.momentumPlanError).toBe("busy");
  });
});

describe("planAfterAiFailure", () => {
  it("keeps the ideas already showing instead of swapping in generic ones", () => {
    const current = plan();
    let built = false;
    expect(
      planAfterAiFailure(current, () => ((built = true), plan({ provider: "template" }))),
    ).toBe(current);
    expect(built).toBe(false);
  });

  it("falls back only when there is no plan at all", () => {
    const fallback = plan({ provider: "template" });
    expect(planAfterAiFailure(null, () => fallback)).toBe(fallback);
    expect(planAfterAiFailure(null, () => null)).toBeNull();
  });
});

describe("shouldRetryAiOnForeground", () => {
  const base = { status: "error" as const, lastFailureAt: 0, now: FOREGROUND_RETRY_COOLDOWN_MS };

  it("retries transient failures once the cooldown has passed", () => {
    for (const kind of ["timeout", "network", "unavailable", "invalid_response"] as const) {
      expect(shouldRetryAiOnForeground({ ...base, failureKind: kind })).toBe(true);
    }
  });

  it("does not retry limits, the spend cap, or auth failures", () => {
    for (const kind of ["rate_limited", "busy", "unauthorized", "needs_plus"] as const) {
      expect(shouldRetryAiOnForeground({ ...base, failureKind: kind })).toBe(false);
    }
  });

  it("respects the cooldown so app switching doesn't spam requests", () => {
    expect(
      shouldRetryAiOnForeground({
        ...base,
        failureKind: "timeout",
        now: FOREGROUND_RETRY_COOLDOWN_MS - 1,
      }),
    ).toBe(false);
  });

  it("only retries from the error state, and retries if the failure time is unknown", () => {
    expect(shouldRetryAiOnForeground({ ...base, status: "ready", failureKind: "timeout" })).toBe(
      false,
    );
    expect(shouldRetryAiOnForeground({ ...base, status: "loading", failureKind: "timeout" })).toBe(
      false,
    );
    expect(shouldRetryAiOnForeground({ ...base, failureKind: null })).toBe(false);
    expect(
      shouldRetryAiOnForeground({ ...base, failureKind: "timeout", lastFailureAt: null }),
    ).toBe(true);
  });
});

describe("isFreshAiPlan", () => {
  const today = "2026-09-26";

  it("is true for today's AI plan for the current goal", () => {
    expect(isFreshAiPlan(plan(), "Run a 5K", today)).toBe(true);
  });

  it("is false for template plans, other goals, other days, or bad dates", () => {
    expect(isFreshAiPlan(plan({ provider: "template" }), "Run a 5K", today)).toBe(false);
    expect(isFreshAiPlan(plan(), "Learn guitar", today)).toBe(false);
    expect(isFreshAiPlan(plan(), null, today)).toBe(false);
    expect(
      isFreshAiPlan(
        plan({ generatedAt: new Date(2026, 8, 25, 23, 59).toISOString() }),
        "Run a 5K",
        today,
      ),
    ).toBe(false);
    expect(isFreshAiPlan(plan({ generatedAt: "not a date" }), "Run a 5K", today)).toBe(false);
    expect(isFreshAiPlan(null, "Run a 5K", today)).toBe(false);
  });

  it("uses the local calendar day, not the UTC day", () => {
    // Just after local midnight: may still be the previous UTC day in the Americas.
    const justAfterMidnight = new Date(2026, 8, 26, 0, 5).toISOString();
    expect(isFreshAiPlan(plan({ generatedAt: justAfterMidnight }), "Run a 5K", today)).toBe(true);
  });
});

describe("nextAiPlanFetchKey with a restored plan", () => {
  const base = {
    ready: true,
    proxyUrl: "https://proxy/api",
    profileComplete: true,
    status: "ready" as const,
    today: "2026-09-26",
    goalTitle: "Run a 5K",
    lastFetchedKey: null as string | null,
  };

  it("skips the fetch when today's AI plan for this goal is already in hand", () => {
    expect(nextAiPlanFetchKey({ ...base, hasFreshAiPlan: true })).toBeNull();
    expect(nextAiPlanFetchKey({ ...base, hasFreshAiPlan: false })).toBe("2026-09-26:Run a 5K");
  });
});

describe("suggestionsHint", () => {
  it("says how many slots are open today", () => {
    expect(suggestionsHint(1)).toBe("Room for one more today.");
    expect(suggestionsHint(2)).toBe("Room for two more today.");
    expect(suggestionsHint(3)).toBe("Room for three more today.");
    expect(suggestionsHint(0)).not.toMatch(/Room/);
    // The sheet has no text field, so the hint must not point "below".
    for (const n of [1, 2, 3]) expect(suggestionsHint(n)).not.toMatch(/below/);
  });
});
