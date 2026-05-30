import { describe, expect, it } from "vitest";

import {
  compareVersions,
  evaluateUpdate,
  parseItunesLookup,
  parseManifest,
  parseVersion,
  sanitizeStoreUrl,
} from "../lib/daily-tasks/version";

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

describe("sanitizeStoreUrl", () => {
  it("accepts only absolute https URLs", () => {
    expect(sanitizeStoreUrl("https://apps.apple.com/app/id1")).toBe(
      "https://apps.apple.com/app/id1",
    );
  });

  it("rejects dangerous or non-https values", () => {
    expect(sanitizeStoreUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeStoreUrl("file:///etc/passwd")).toBeNull();
    expect(sanitizeStoreUrl("http://apps.apple.com")).toBeNull();
    expect(sanitizeStoreUrl("myapp://deeplink")).toBeNull();
    expect(sanitizeStoreUrl("https://has space.com")).toBeNull();
    expect(sanitizeStoreUrl(123)).toBeNull();
    expect(sanitizeStoreUrl(null)).toBeNull();
  });
});

describe("parseItunesLookup", () => {
  it("extracts version + sanitized storeUrl from a lookup response", () => {
    const data = {
      resultCount: 1,
      results: [{ version: "2.0.0", trackViewUrl: "https://apps.apple.com/app/id1" }],
    };
    expect(parseItunesLookup(data)).toEqual({
      version: "2.0.0",
      storeUrl: "https://apps.apple.com/app/id1",
    });
  });

  it("nulls an unsafe trackViewUrl and returns null on empty results", () => {
    expect(
      parseItunesLookup({ results: [{ version: "2.0.0", trackViewUrl: "javascript:x" }] }),
    ).toEqual({ version: "2.0.0", storeUrl: null });
    expect(parseItunesLookup({ results: [] })).toBeNull();
    expect(parseItunesLookup({})).toBeNull();
    expect(parseItunesLookup(null)).toBeNull();
  });
});

describe("parseManifest", () => {
  it("reads a { version, storeUrl } manifest and sanitizes the url", () => {
    expect(parseManifest({ version: "3.1.0", storeUrl: "https://play.google.com/x" })).toEqual({
      version: "3.1.0",
      storeUrl: "https://play.google.com/x",
    });
    expect(parseManifest({ version: "3.1.0", storeUrl: "ftp://nope" })).toEqual({
      version: "3.1.0",
      storeUrl: null,
    });
    expect(parseManifest({ storeUrl: "https://x.com" })).toBeNull();
  });
});
