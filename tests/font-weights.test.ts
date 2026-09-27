// Phase 10b: system fonts. SF Rounded (Fonts.rounded) has no weight of its
// own, so every style that uses it must say its fontWeight; and the bundled
// Fredoka/Nunito faces (BodyFont/DisplayFont) are gone for good.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

/** The innermost `{ ... }` around `index` (the style object literal). */
function enclosingObject(source: string, index: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = index; i >= 0; i--) {
    const ch = source[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** Style objects that use Fonts.rounded without a fontWeight, as "file:line". */
function roundedWithoutWeight(files: { path: string; source: string }[]): string[] {
  const misses: string[] = [];
  for (const { path, source } of files) {
    for (const match of source.matchAll(/fontFamily:\s*Fonts\.rounded\b/g)) {
      const object = enclosingObject(source, match.index ?? 0);
      if (!object || !/\bfontWeight\s*:/.test(object)) {
        const line = source.slice(0, match.index).split("\n").length;
        misses.push(`${path}:${line}`);
      }
    }
  }
  return misses;
}

const files = ["app", "components"]
  .flatMap((dir) => sourceFiles(resolve(ROOT, dir)))
  .map((path) => ({ path: relative(ROOT, path), source: readFileSync(path, "utf8") }));

describe("Fonts.rounded always comes with a fontWeight", () => {
  it("the scan finds the rounded titles (so it isn't passing vacuously)", () => {
    const uses = files.reduce(
      (n, f) => n + [...f.source.matchAll(/fontFamily:\s*Fonts\.rounded\b/g)].length,
      0,
    );
    expect(uses).toBeGreaterThanOrEqual(10);
  });

  it("flags a style without one, and passes one with it (nested values included)", () => {
    const sample = (style: string) => [{ path: "x.tsx", source: `<Text style={${style}} />` }];
    expect(roundedWithoutWeight(sample('{ fontFamily: Fonts.rounded, fontSize: 28 }'))).toEqual(["x.tsx:1"]);
    expect(
      roundedWithoutWeight(sample('{ fontFamily: Fonts.rounded, shadowOffset: { width: 0 }, fontWeight: "800" }')),
    ).toEqual([]);
    expect(
      roundedWithoutWeight(sample('[base, { fontFamily: Fonts.rounded }, { fontWeight: "700" }]')),
    ).toEqual(["x.tsx:1"]);
  });

  it("holds across app/ and components/", () => {
    expect(roundedWithoutWeight(files)).toEqual([]);
  });

  it("no source still uses the removed bundled fonts", () => {
    const stale = files
      .filter((f) => /\b(BodyFont|DisplayFont)\b|Fredoka|Nunito/.test(f.source))
      .map((f) => f.path);
    expect(stale).toEqual([]);
  });
});
