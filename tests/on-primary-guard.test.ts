import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// Regression guard: content drawn on a `colors.primary` / `colors.error` fill
// must use `colors.onPrimary` / `colors.onError`. White fails AA on the
// dark-scheme indigo and error, and `colors.background` is not a contrast token.
// This is a source heuristic, not a renderer: for each line that fills with one
// of those colours it looks at the next few lines (until another fill starts)
// for a hard-coded white/background colour. A colour ternary that also routes to
// the matching on-token is treated as handled. (task-row's swipe actions pick
// fill/onFill in a variable; tests/ui/phase10-today.test.tsx renders those.)

const ROOT = join(__dirname, "..");
const WINDOW = 15;
const FILLS = [
  { fill: /backgroundColor:\s*[^,}\n]*\bcolors\.primary\b/, on: "colors.onPrimary" },
  { fill: /backgroundColor:\s*[^,}\n]*\bcolors\.error\b/, on: "colors.onError" },
];
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
    const match = FILLS.find(({ fill }) => fill.test(line));
    if (!match) return;
    for (let j = i + 1; j < Math.min(lines.length, i + WINDOW); j += 1) {
      if (NEW_FILL.test(lines[j])) break;
      if (BAD.test(lines[j]) && !lines[j].includes(match.on)) hits.push(j + 1);
    }
  });
  return hits;
}

describe("on-token guard", () => {
  it("flags white and background-coloured content on a primary fill", () => {
    const pill = (color: string) =>
      `<View style={{ backgroundColor: colors.primary }}>\n  <Text style={{ color: ${color} }}>Go</Text>\n</View>`;
    expect(findOffenders(pill('"#fff"'))).toEqual([2]);
    expect(findOffenders(pill("colors.background"))).toEqual([2]);
    expect(findOffenders(pill('flag ? colors.muted : "#fff"'))).toEqual([2]);
    expect(findOffenders(pill("colors.onPrimary"))).toEqual([]);
  });

  it("flags white on an error fill unless it uses onError", () => {
    const pill = (color: string) =>
      `<View style={{ backgroundColor: colors.error }}>\n  <Text style={{ color: ${color} }}>Delete</Text>\n</View>`;
    expect(findOffenders(pill('"#fff"'))).toEqual([2]);
    // Routing to the wrong on-token doesn't count as handled.
    expect(findOffenders(pill('flag ? colors.onPrimary : "#fff"'))).toEqual([2]);
    expect(findOffenders(pill('flag ? colors.onError : "#fff"'))).toEqual([]);
  });

  it("finds no hard-coded white or background colour on primary or error fills in app/ and components/", () => {
    const offenders = ["app", "components"]
      .flatMap((dir) => tsxFiles(join(ROOT, dir)))
      .flatMap((file) =>
        findOffenders(readFileSync(file, "utf8")).map((line) => `${relative(ROOT, file)}:${line}`),
      );
    expect(offenders).toEqual([]);
  });
});
