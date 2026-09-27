// "Momentum" is an internal name only: no user-visible string in the app may
// say it (screens, components, coach messages, adaptation reasons).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

// The name on its own (so identifiers like MomentumProfile or
// completeMomentumOnboarding don't count). Lowercase "build momentum" is plain
// English, not the old product name.
const WORD = /(?<![A-Za-z0-9_])Momentum(?![A-Za-z0-9_])/;

/** Lines outside comments/imports whose string literals or JSX text say "Momentum". */
function momentumMentions(source: string): number[] {
  const hits: number[] = [];
  let inBlockComment = false;
  source.split("\n").forEach((raw, i) => {
    let line = raw;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) return;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    line = line.replace(/\/\*.*?\*\//g, "");
    const open = line.indexOf("/*");
    if (open !== -1) {
      inBlockComment = true;
      line = line.slice(0, open);
    }
    if (/^\s*(import|export \* from)\b/.test(line)) return;
    line = line.replace(/(^|[^:"'`])\/\/.*$/, "$1"); // line comments (not URLs)
    // Strings and template literals, plus JSX text between tags.
    const strings = line.match(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g) ?? [];
    const jsxText = line.match(/>[^<>{}]+</g) ?? [];
    const bareJsx = /^\s*[A-Za-z][^=(){};<>]*$/.test(line) && !/[=(){};]/.test(line) ? [line] : [];
    if ([...strings, ...jsxText, ...bareJsx].some((text) => WORD.test(text))) hits.push(i + 1);
  });
  return hits;
}

describe("no 'Momentum' in user-visible copy", () => {
  it("the scanner finds strings and JSX text but ignores identifiers and comments", () => {
    const sample = [
      'import { MomentumProfile } from "./momentum";',
      "// Momentum profile goes here",
      "/* Momentum",
      "   still a comment */",
      "const a = completeMomentumOnboarding(profile);",
      'const b = "Momentum is staying steady.";',
      "<Text>Update Momentum profile</Text>",
      "  Build Momentum today",
      "  and build momentum without a list.",
      'id: "progress-momentum",',
      'title="Your coach"',
      "throw new MomentumAiError(kind, `Momentum AI failed`);",
    ].join("\n");
    expect(momentumMentions(sample)).toEqual([6, 7, 8, 12]);
  });

  it("no screen or component says it", () => {
    const offenders: string[] = [];
    const files = [
      ...sourceFiles(join(ROOT, "app")),
      ...sourceFiles(join(ROOT, "components")),
      join(ROOT, "lib/daily-tasks/coach-messages.ts"),
      // Adaptation reasons shown on Today / in Settings.
      join(ROOT, "lib/daily-tasks/momentum.ts"),
      join(ROOT, "lib/daily-tasks/storage.ts"),
    ];
    for (const file of files) {
      for (const line of momentumMentions(readFileSync(file, "utf8"))) {
        offenders.push(`${file.slice(ROOT.length + 1)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
