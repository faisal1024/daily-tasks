// Privacy copy guard: the app sends anonymous analytics (when on) and talks to
// RevenueCat / the AI proxy, so no screen may claim data never leaves the device.
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

const OVERCLAIMS = [
  /only (?:on|stored on|saved on|kept on) (?:this|your) (?:device|phone)/i,
  /stored only on/i,
  /never leaves? (?:this|your|the) (?:device|phone)/i,
  /no analytics/i,
  /no tracking/i,
];

describe("privacy copy", () => {
  it("no screen claims data stays only on the device or that there are no analytics", () => {
    const offenders: string[] = [];
    for (const file of [...sourceFiles(join(ROOT, "app")), ...sourceFiles(join(ROOT, "components"))]) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        // User-facing strings only: skip code comments.
        if (/^\s*(\/\/|\/?\*)/.test(line)) return;
        if (OVERCLAIMS.some((pattern) => pattern.test(line))) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("the Settings Data subtitle says where tasks are saved, without overclaiming", () => {
    const settings = readFileSync(join(ROOT, "app/(tabs)/settings.tsx"), "utf8");
    expect(settings).toContain(
      'subtitle="Your tasks and history are saved on this device, not in an account."',
    );
  });
});
