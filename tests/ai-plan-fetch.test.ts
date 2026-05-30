import { describe, expect, it } from "vitest";

import { nextAiPlanFetchKey } from "../lib/daily-tasks/momentum-ai";

const base = {
  ready: true,
  proxyUrl: "https://proxy/api",
  profileComplete: true,
  status: "ready" as const,
  today: "2026-05-30",
  goalTitle: "Run a 5K",
  lastFetchedKey: null as string | null,
};

describe("nextAiPlanFetchKey", () => {
  it("returns a day+goal key when everything is ready", () => {
    expect(nextAiPlanFetchKey(base)).toBe("2026-05-30:Run a 5K");
  });

  it("does not fetch without a proxy url (AI off by default)", () => {
    expect(nextAiPlanFetchKey({ ...base, proxyUrl: null })).toBeNull();
  });

  it("does not fetch when not ready, profile incomplete, or already loading", () => {
    expect(nextAiPlanFetchKey({ ...base, ready: false })).toBeNull();
    expect(nextAiPlanFetchKey({ ...base, profileComplete: false })).toBeNull();
    expect(nextAiPlanFetchKey({ ...base, status: "loading" })).toBeNull();
  });

  it("does not refetch the same day+goal", () => {
    expect(
      nextAiPlanFetchKey({ ...base, lastFetchedKey: "2026-05-30:Run a 5K" }),
    ).toBeNull();
  });

  it("refetches when the goal changes or the day rolls over", () => {
    expect(
      nextAiPlanFetchKey({ ...base, goalTitle: "Learn guitar", lastFetchedKey: "2026-05-30:Run a 5K" }),
    ).toBe("2026-05-30:Learn guitar");
    expect(
      nextAiPlanFetchKey({ ...base, today: "2026-05-31", lastFetchedKey: "2026-05-30:Run a 5K" }),
    ).toBe("2026-05-31:Run a 5K");
  });
});
