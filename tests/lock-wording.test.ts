// 1.5 A: the lock wording. "Lock" is the word now, so no user-facing text in
// the screens this release touched may still say a day is "set" to mean
// locked, or send people to Settings to unlock (Today's status line has its
// own Unlock). Comments and internal names are not user-facing and may keep
// the old words.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FILES = [
  "app/(tabs)/index.tsx",
  "app/(tabs)/settings.tsx",
  "components/daily-tasks/brain-dump-sheet.tsx",
  "components/daily-tasks/day-detail-card.tsx",
  "components/daily-tasks/ideas-sheet.tsx",
  "components/daily-tasks/status-line.tsx",
  "components/daily-tasks/first-run.tsx",
  "components/daily-tasks/first-days-cards.tsx",
  "lib/daily-tasks/today-view.ts",
  "lib/daily-tasks/routines.ts",
  // Not shown anywhere yet (no UI calls selectCoachMessage), kept consistent anyway.
  "lib/daily-tasks/coach-messages.ts",
];

/** Source with comments removed (line, block and JSX `{/* *\/}` comments). */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[\s;{(,])\/\/.*$/gm, "$1");
}

const OLD_WORDING: [string, RegExp][] = [
  ["Set today", /\bSet today\b/],
  ["Today is set", /\b(Today|Your day|The day) is set\b/i],
  ["Set the day / Setting the day", /\bSet(ting)? the day\b/],
  ["Set automatically", /\bSet automatically\b|\bset automatically\b/],
  ["Set them", /\bSet them\b/],
  ["A set day", /\b[Aa] set day\b/],
  ["a bare Set button", /text: "Set"/],
  ["unlock in Settings", /unlock(ed)?( it| today)? in Settings/i],
  ["pin icon for the lock action", /pin-outline/],
  ["the list / commitments are set", /\b(list|commitments) (is|are) set\b/i],
  ["set it / set them (the list)", /\bset (it|them)\b/i],
  ["Set the day phase", /phase: "Set/],
];

describe("lock wording (1.5)", () => {
  for (const file of FILES) {
    it(`${file} has no user-facing "set" meaning locked`, () => {
      const source = withoutComments(readFileSync(resolve(__dirname, "..", file), "utf8"));
      for (const [label, pattern] of OLD_WORDING) {
        expect(source.match(pattern), `${file} still says "${label}"`).toBeNull();
      }
    });
  }

  it("the new words are in place on the status line, Settings and the lock confirmation", () => {
    const read = (file: string) => withoutComments(readFileSync(resolve(__dirname, "..", file), "utf8"));
    expect(read("components/daily-tasks/status-line.tsx")).toContain("Lock today");
    expect(read("app/(tabs)/settings.tsx")).toContain("Lock the day automatically");
    expect(read("app/(tabs)/settings.tsx")).toContain("Locking the day");
    expect(read("app/(tabs)/index.tsx")).toContain('text: "Lock"');
    expect(read("lib/daily-tasks/today-view.ts")).toContain('title: "Lock today?"');
  });
});
