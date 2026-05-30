import { describe, expect, it } from "vitest";

import { compareVersions, evaluateUpdate, parseVersion } from "../lib/daily-tasks/version";

describe("compareVersions", () => {
  it("orders versions segment-wise", () => {
    expect(compareVersions("1.0.1", "1.0.0")).toBe(1);
    expect(compareVersions("1.0.0", "1.0.1")).toBe(-1);
    expect(compareVersions("1.2.0", "1.2.0")).toBe(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBe(1);
  });

  it("handles uneven segment counts and build suffixes", () => {
    expect(compareVersions("1.1", "1.1.0")).toBe(0);
    expect(compareVersions("1.0.0+5", "1.0.0+2")).toBe(1);
    expect(compareVersions("1.0.1", "1.0")).toBe(1);
  });

  it("parses noisy input safely", () => {
    expect(parseVersion("1.2.x")).toEqual([1, 2, 0]);
  });
});

describe("evaluateUpdate", () => {
  const latest = { version: "1.1.0", storeUrl: "https://apps.apple.com/app/id1" };

  it("prompts when the latest version is newer", () => {
    const result = evaluateUpdate({ currentVersion: "1.0.0", latest });
    expect(result).toEqual({
      latestVersion: "1.1.0",
      currentVersion: "1.0.0",
      storeUrl: "https://apps.apple.com/app/id1",
    });
  });

  it("does not prompt when already on the latest (or newer) version", () => {
    expect(evaluateUpdate({ currentVersion: "1.1.0", latest })).toBeNull();
    expect(evaluateUpdate({ currentVersion: "1.2.0", latest })).toBeNull();
  });

  it("does not prompt when there is no release info", () => {
    expect(evaluateUpdate({ currentVersion: "1.0.0", latest: null })).toBeNull();
  });

  it("respects a dismissed version until a newer one ships", () => {
    expect(
      evaluateUpdate({ currentVersion: "1.0.0", latest, dismissedVersion: "1.1.0" }),
    ).toBeNull();
    // a newer release than the dismissed one prompts again
    expect(
      evaluateUpdate({
        currentVersion: "1.0.0",
        latest: { version: "1.2.0", storeUrl: null },
        dismissedVersion: "1.1.0",
      }),
    ).not.toBeNull();
  });
});
