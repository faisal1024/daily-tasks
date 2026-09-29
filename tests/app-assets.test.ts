// App icon and image assets (Phase 7): sizes, alpha, and that app.config.ts
// only points at files that exist. Reads the PNG IHDR chunk directly.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");
const PNG_SIGNATURE = "89504e470d0a1a0a";

interface PngInfo {
  width: number;
  height: number;
  /** 2 = RGB, 6 = RGBA, 4 = grey + alpha, 0 = grey, 3 = palette. */
  colorType: number;
}

function readPngInfo(path: string): PngInfo {
  const buf = readFileSync(resolve(ROOT, path));
  if (buf.subarray(0, 8).toString("hex") !== PNG_SIGNATURE) throw new Error(`${path} is not a PNG`);
  if (buf.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error(`${path} has no IHDR`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

/** Colour types with an alpha channel (a palette PNG may carry tRNS; treated as alpha). */
function hasAlpha(path: string): boolean {
  const { colorType } = readPngInfo(path);
  if (colorType === 4 || colorType === 6) return true;
  if (colorType === 3) return readFileSync(resolve(ROOT, path)).includes(Buffer.from("tRNS"));
  return false;
}

const IMG = "assets/images";

describe("app assets", () => {
  it("icon.png is 1024×1024 with no alpha channel (App Store requirement)", () => {
    expect(readPngInfo(`${IMG}/icon.png`)).toEqual({ width: 1024, height: 1024, colorType: 2 });
    expect(hasAlpha(`${IMG}/icon.png`)).toBe(false);
  });

  it("splash icon is 1024×1024 with transparency; favicon is 48×48", () => {
    expect(readPngInfo(`${IMG}/splash-icon.png`)).toMatchObject({ width: 1024, height: 1024 });
    expect(hasAlpha(`${IMG}/splash-icon.png`)).toBe(true);
    expect(readPngInfo(`${IMG}/favicon.png`)).toMatchObject({ width: 48, height: 48 });
  });

  it("Android adaptive icon layers have the right sizes, with an opaque background", () => {
    expect(readPngInfo(`${IMG}/android-icon-background.png`)).toMatchObject({ width: 512, height: 512 });
    expect(hasAlpha(`${IMG}/android-icon-background.png`)).toBe(false);
    expect(readPngInfo(`${IMG}/android-icon-foreground.png`)).toMatchObject({ width: 512, height: 512 });
    expect(readPngInfo(`${IMG}/android-icon-monochrome.png`)).toMatchObject({ width: 432, height: 432 });
  });

  it("every image app.config.ts references exists", () => {
    const config = readFileSync(resolve(ROOT, "app.config.ts"), "utf8");
    const paths = [...config.matchAll(/["'](\.\/assets\/[^"']+\.png)["']/g)].map((m) => m[1]);
    // icon, adaptive foreground/background/monochrome, favicon, splash image.
    expect(paths.length).toBeGreaterThanOrEqual(6);
    for (const key of ["icon:", "foregroundImage:", "backgroundImage:", "monochromeImage:", "favicon:", "image:"]) {
      expect(config).toMatch(new RegExp(`${key}\\s*["']\\./assets/`));
    }
    const missing = paths.filter((path) => !existsSync(resolve(ROOT, path)));
    expect(missing).toEqual([]);
  });

  it("iOS entitlements keep the app group and nothing needing a new Apple capability", () => {
    const config = readFileSync(resolve(ROOT, "app.config.ts"), "utf8");
    expect(config).toContain('"com.apple.security.application-groups"');
    // Time Sensitive Notifications needs the capability on the App ID first.
    expect(config).not.toContain("usernotifications.time-sensitive");
  });
});
