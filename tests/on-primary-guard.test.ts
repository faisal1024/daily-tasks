import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Regression guard: content drawn on a `colors.primary` fill must use
// `colors.onPrimary`. White fails AA on the dark-scheme indigo and
// `colors.background` is not a contrast token. This is a source heuristic, not
// a renderer: for each line that fills with colors.primary it looks at the next
// few lines (until another fill starts) for a hard-coded white/background colour.
// A colour ternary that also routes to colors.onPrimary (e.g. task-row's
// delete-vs-bookmark swipe action) is treated as handled.

const ROOT = join(__dirname, "..");
const WINDOW = 15;
const FILL = /backgroundColor:\s*[^,}\n]*\bcolors\.primary\b/;
const NEW_FILL = /style=\{\{[^}]*backgroundColor|^\s*backgroundColor:/;
const BAD = /\bcolor[=:]\s*\{?[^\n]*?("#fff(?:fff)?"|"white"|\bcolors\.background\b)/i;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

function findOffenders(source: string): number[] {
  const lines = source.split("\n");
  const hits: number[] = [];
  lines.forEach((line, i) => {
    if (!FILL.test(line)) return;
    for (let j = i + 1; j < Math.min(lines.length, i + WINDOW); j += 1) {
      if (NEW_FILL.test(lines[j])) break;
      if (BAD.test(lines[j]) && !lines[j].includes("colors.onPrimary")) hits.push(j + 1);
    }
  });
  return hits;
}

describe("onPrimary guard", () => {
  it("flags white and background-coloured content on a primary fill", () => {
    const pill = (color: string) =>
      `<View style={{ backgroundColor: colors.primary }}>\n  <Text style={{ color: ${color} }}>Go</Text>\n</View>`;
    expect(findOffenders(pill('"#fff"'))).toEqual([2]);
    expect(findOffenders(pill("colors.background"))).toEqual([2]);
    expect(findOffenders(pill('flag ? colors.muted : "#fff"'))).toEqual([2]);
    expect(findOffenders(pill("colors.onPrimary"))).toEqual([]);
  });

  it("finds no hard-coded white or background colour on primary fills in app/ and components/", () => {
    const offenders = ["app", "components"]
      .flatMap((dir) => tsxFiles(join(ROOT, dir)))
      .flatMap((file) =>
        findOffenders(readFileSync(file, "utf8")).map((line) => `${relative(ROOT, file)}:${line}`),
      );
    expect(offenders).toEqual([]);
  });
});
