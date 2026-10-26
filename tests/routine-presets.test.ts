// 1.5 D: one-tap routine presets in the Routines sheet. Days are filled in,
// they show while there are fewer than three routines (so a free user's third
// tap meets the Plus gate), never one already made.
import { describe, expect, it } from "vitest";

import {
  FREE_ROUTINE_LIMIT,
  ROUTINE_PRESETS,
  ROUTINE_PRESETS_UNTIL,
  canCreateRoutine,
  cleanDays,
  cleanRoutineText,
  describeDays,
  presetsToOffer,
} from "../lib/daily-tasks/routines";

describe("ROUTINE_PRESETS", () => {
  it("are the six from the plan with their days", () => {
    expect(ROUTINE_PRESETS.map((p) => [p.text, [...p.days]])).toEqual([
      ["Stretch", [1, 2, 3, 4, 5]],
      ["Plan the week", [0]],
      ["Inbox to zero", [1, 2, 3, 4, 5]],
      ["Walk", [0, 1, 2, 3, 4, 5, 6]],
      ["Read 10 pages", [0, 1, 2, 3, 4, 5, 6]],
      ["Tidy desk", [5]],
    ]);
  });

  it("every preset survives the same cleaning as a typed routine (what one tap saves is what is shown)", () => {
    for (const preset of ROUTINE_PRESETS) {
      expect(cleanRoutineText(preset.text)).toBe(preset.text);
      expect(cleanDays([...preset.days])).toEqual([...preset.days]);
      expect(describeDays([...preset.days])).not.toBe("");
    }
  });
});

describe("presetsToOffer", () => {
  const made = (...texts: string[]) => texts.map((text) => ({ text }));

  it("offers all six with no routines, and hides one already made (case and spacing aside)", () => {
    expect(presetsToOffer([])).toHaveLength(6);
    expect(presetsToOffer(made("  walk  ")).map((p) => p.text)).not.toContain("Walk");
    expect(presetsToOffer(made("READ  10 pages")).map((p) => p.text)).not.toContain("Read 10 pages");
    expect(presetsToOffer(made("Walk after lunch")).map((p) => p.text)).toContain("Walk");
  });

  it("shows while there are fewer than three routines, none from three on", () => {
    expect(ROUTINE_PRESETS_UNTIL).toBe(FREE_ROUTINE_LIMIT + 1);
    expect(ROUTINE_PRESETS_UNTIL).toBe(3);
    expect(presetsToOffer(made("A", "B")).length).toBeGreaterThan(0);
    expect(presetsToOffer(made("A", "B", "C"))).toEqual([]);
    expect(presetsToOffer(made("A", "B", "C", "D", "E"))).toEqual([]);
  });

  it("the offer at two routines is exactly where free meets the limit", () => {
    expect(canCreateRoutine(2, false)).toBe(false);
    expect(canCreateRoutine(1, false)).toBe(true);
    expect(canCreateRoutine(2, true)).toBe(true);
  });
});
