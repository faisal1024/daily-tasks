import { describe, expect, it } from "vitest";

import { themeColors } from "../theme.config";

// WCAG 2.x relative luminance / contrast ratio.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

  it("computes contrast the WCAG way (sanity check)", () => {
    expect(contrast("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    // The old light muted color failed AA on the light background.
    expect(contrast("#79748F", "#FBFAFF")).toBeLessThan(4.5);
  });
});
