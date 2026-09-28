import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { GRADIENT_DARK, GRADIENT_LIGHT } from "../components/daily-tasks/gradient-stops";
import { themeColors } from "../theme.config";

// WCAG 2.x relative luminance / contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

type RGBA = [number, number, number, number];

// "#fff", "#RRGGBB", "rgba(r,g,b,a)" -> [r, g, b, a] with channels 0-255.
function parseColor(css: string): RGBA {
  const rgba = css.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = "1"] = rgba[1].split(",").map((p) => p.trim());
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  const hex = css.length === 4 ? `#${[...css.slice(1)].map((c) => c + c).join("")}` : css;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1) as RGBA;
}

// Composite a (possibly translucent) colour over an opaque one -> "#RRGGBB".
function over(top: string, bottom: string): string {
  const [tr, tg, tb, a] = parseColor(top);
  const [br, bg, bb] = parseColor(bottom);
  return `#${[tr * a + br * (1 - a), tg * a + bg * (1 - a), tb * a + bb * (1 - a)]
    .map((c) => Math.round(c).toString(16).padStart(2, "0"))
    .join("")}`;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("theme contrast", () => {
  it.each(["light", "dark"] as const)(
    "muted text meets WCAG AA (4.5:1) on the %s background and surface",
    (scheme) => {
      const muted = themeColors.muted[scheme];
      expect(contrast(muted, themeColors.background[scheme])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(muted, themeColors.surface[scheme])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(["light", "dark"] as const)("onPrimary meets WCAG AA (4.5:1) on the %s primary", (scheme) => {
    expect(contrast(themeColors.onPrimary[scheme], themeColors.primary[scheme])).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["light", "dark"] as const)("onError meets WCAG AA (4.5:1) on the %s error", (scheme) => {
    expect(contrast(themeColors.onError[scheme], themeColors.error[scheme])).toBeGreaterThanOrEqual(4.5);
  });

  // Settings' "Reset all data" uses the error color as text.
  it.each(["light", "dark"] as const)(
    "error as text meets WCAG AA (4.5:1) on the %s background and surface",
    (scheme) => {
      const error = themeColors.error[scheme];
      expect(contrast(error, themeColors.background[scheme])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(error, themeColors.surface[scheme])).toBeGreaterThanOrEqual(4.5);
    },
  );

  describe("done card (text on the indigo gradient)", () => {
    const source = readFileSync(join(__dirname, "../components/daily-tasks/done-card.tsx"), "utf8");
    const textColors = [...source.matchAll(/\bcolor[=:]\s*\{?\s*"([^"]+)"/g)].map((m) => m[1]);
    const chip = source.match(/backgroundColor:\s*"([^"]+)"[\s\S]*?testID="pull-one-more"/)?.[1];
    const stops = [...GRADIENT_LIGHT, ...GRADIENT_DARK];

    it("finds the card's literal text colours and chip fill in the source", () => {
      expect(textColors.length).toBeGreaterThanOrEqual(4);
      expect(chip).toBeDefined();
    });

    it.each(stops)("every text colour meets WCAG AA (4.5:1) on gradient stop %s", (stop) => {
      for (const color of textColors) {
        expect(contrast(over(color, stop), stop), `${color} on ${stop}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it.each(stops)("the pull-one-more label meets WCAG AA on its chip over stop %s", (stop) => {
      const fill = over(chip!, stop);
      for (const color of textColors) {
        expect(contrast(over(color, fill), fill), `${color} on ${chip} over ${stop}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it("computes contrast the WCAG way (sanity check)", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    // The old light muted color failed AA on the light background.
    expect(contrast("#79748F", "#FBFAFF")).toBeLessThan(4.5);
    // The old white-tint chip under white text failed AA on the light gradient.
    const oldChip = over("rgba(255,255,255,0.18)", GRADIENT_LIGHT[2]);
    expect(contrast("#FFFFFF", oldChip)).toBeLessThan(4.5);
  });
});
