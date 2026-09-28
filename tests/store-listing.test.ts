// Phase 12 launch: the App Store listing (store.config.json, used by EAS
// Metadata) stays within Apple's field limits, matches the human-readable copy
// in docs/app-store-listing.md, and the app config carries the new name/version.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import appConfig from "../app.config";

const ROOT = resolve(__dirname, "..");
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

type StoreInfo = {
  title: string;
  subtitle: string;
  description: string;
  keywords: string[];
  releaseNotes?: string;
  promoText: string;
};

function listingInfo(): StoreInfo {
  const store = JSON.parse(read("store.config.json"));
  return store.apple.info["en-US"];
}

/** The fenced block under "## Description" in the listing doc. */
function docDescription(): string {
  const doc = read("docs/app-store-listing.md");
  const match = doc.match(/^## Description\s*\n+```[^\n]*\n([\s\S]*?)\n```/m);
  if (!match) throw new Error("No fenced ## Description block in docs/app-store-listing.md");
  return match[1];
}

describe("store.config.json", () => {
  it("is valid JSON with the en-US listing", () => {
    expect(() => JSON.parse(read("store.config.json"))).not.toThrow();
    const info = listingInfo();
    for (const key of ["title", "subtitle", "description", "promoText"] as const) {
      expect(typeof info[key]).toBe("string");
      expect(info[key].trim().length).toBeGreaterThan(0);
    }
    expect(Array.isArray(info.keywords)).toBe(true);
  });

  it("stays within App Store Connect field limits", () => {
    const info = listingInfo();
    expect(info.title.length).toBeLessThanOrEqual(30);
    expect(info.subtitle.length).toBeLessThanOrEqual(30);
    expect(info.keywords.join(",").length).toBeLessThanOrEqual(100);
    expect(info.description.length).toBeLessThanOrEqual(4000);
    expect(info.promoText.length).toBeLessThanOrEqual(170);
    // What's New is only written once the supporter deadline is filled in.
    if (info.releaseNotes !== undefined) {
      expect(info.releaseNotes.length).toBeLessThanOrEqual(4000);
      expect(info.releaseNotes).not.toContain("<date>");
    }
  });

  it("description matches the ## Description block in docs/app-store-listing.md", () => {
    expect(listingInfo().description).toBe(docDescription());
  });
});

describe("app.config.ts", () => {
  it("ships as Three Today 1.2.0", () => {
    expect(appConfig.name).toBe("Three Today");
    expect(appConfig.version).toBe("1.2.0");
  });
});
