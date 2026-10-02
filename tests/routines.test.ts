// Routines (1.3): weekday maths from the store's local day key, the "already
// on today" checks, the free limit, and normalising old or broken saves.
import { describe, expect, it } from "vitest";

import {
  canCreateRoutine,
  capVisibleChars,
  cleanRoutineText,
  describeDays,
  FREE_ROUTINE_LIMIT,
  MAX_ROUTINE_TEXT,
  MAX_ROUTINES,
  normalizeRoutines,
  routinesDueToday,
  weekdayOf,
  withRoutineAdded,
} from "../lib/daily-tasks/routines";
import { buildInitialState, normalizeState } from "../lib/daily-tasks/storage";
import type { Routine } from "../lib/daily-tasks/types";

const routine = (overrides: Partial<Routine> = {}): Routine => ({
  id: "r1",
  text: "Walk after lunch",
  days: [4], // Thursday
  paused: false,
  createdAt: "",
  ...overrides,
});

// 2026-10-01 is a Thursday (local weekday 4); the 4th is a Sunday (0).
const THU = "2026-10-01";
const FRI = "2026-10-02";
const SAT = "2026-10-03";
const SUN = "2026-10-04";

describe("routines: weekday of the store's day key", () => {
  it("reads the key as a local date, Sunday = 0", () => {
    expect([THU, FRI, SAT, SUN, "2026-10-05"].map(weekdayOf)).toEqual([4, 5, 6, 0, 1]);
  });

  it("uses the local weekday of a Date, even late in the evening or just after midnight", () => {
    // Local constructors: in every CI time zone these stay on the same local day.
    expect(weekdayOf(new Date(2026, 9, 1, 23, 59, 59))).toBe(4);
    expect(weekdayOf(new Date(2026, 9, 4, 0, 0, 1))).toBe(0);
  });

  it("is due only on its days: suggested Thursday, gone Friday, back the next Thursday", () => {
    const walk = routine({ days: [4] });
    expect(routinesDueToday([walk], [], THU)).toEqual([walk]);
    expect(routinesDueToday([walk], [], FRI)).toEqual([]);
    expect(routinesDueToday([walk], [], "2026-10-08")).toEqual([walk]);
  });

  it("a Sunday routine is due on Sunday (0), not on Saturday (6)", () => {
    const rest = routine({ days: [0] });
    expect(routinesDueToday([rest], [], SUN)).toEqual([rest]);
    expect(routinesDueToday([rest], [], SAT)).toEqual([]);
  });
});

describe("routines: what's suggested today", () => {
  it("skips paused routines", () => {
    expect(routinesDueToday([routine({ paused: true })], [], THU)).toEqual([]);
  });

  it("skips a routine already added today (same routineId), even if the task was renamed", () => {
    expect(routinesDueToday([routine()], [{ text: "Walk 10 mins", routineId: "r1" }], THU)).toEqual([]);
  });

  it("skips a routine whose words are already on today, ignoring case and extra spaces", () => {
    expect(routinesDueToday([routine()], [{ text: "  walk   AFTER lunch " }], THU)).toEqual([]);
  });

  it("still suggests it when today's tasks are different words from another routine", () => {
    const walk = routine();
    expect(routinesDueToday([walk], [{ text: "Read", routineId: "r2" }], THU)).toEqual([walk]);
  });
});

describe("routines: free limit", () => {
  it("free users create up to the limit; Plus is unlimited up to the ceiling", () => {
    expect(FREE_ROUTINE_LIMIT).toBe(2);
    expect(canCreateRoutine(1, false)).toBe(true);
    expect(canCreateRoutine(2, false)).toBe(false);
    // A lapsed Plus user with more than the limit can't add another.
    expect(canCreateRoutine(3, false)).toBe(false);
    expect(canCreateRoutine(10, true)).toBe(true);
    expect(canCreateRoutine(MAX_ROUTINES, true)).toBe(false);
  });
});

describe("normalizeRoutines: old and broken saves", () => {
  it("non-arrays load as none", () => {
    for (const value of [undefined, null, "r1", 3, { id: "r1" }]) {
      expect(normalizeRoutines(value)).toEqual([]);
    }
  });

  it("drops broken items and keeps only whole weekdays 0-6, deduped and sorted", () => {
    const result = normalizeRoutines([
      null,
      "Walk",
      { text: "No id", days: [1] },
      { id: "", text: "Empty id", days: [1] },
      { id: "a", text: "   ", days: [1] },
      { id: "b", text: 42, days: [1] },
      { id: "c", text: "Only bad days", days: [7, -1, 1.5, "1", null] },
      { id: "d", text: "No days", days: [] },
      { id: "e", text: "Days not an array", days: "1,2" },
      { id: "ok", text: "  Stretch  ", days: [5, 7, 1, -1, 1.5, "3", 1, 0], paused: "yes", createdAt: 9 },
    ]);
    expect(result).toEqual([{ id: "ok", text: "Stretch", days: [0, 1, 5], paused: false, createdAt: "" }]);
  });

  it("keeps the first of a duplicate id", () => {
    const result = normalizeRoutines([
      { id: "r1", text: "First", days: [1] },
      { id: "r1", text: "Second", days: [2] },
    ]);
    expect(result.map((r) => r.text)).toEqual(["First"]);
  });

  it("a duplicate id after a broken first entry still keeps the valid one", () => {
    const result = normalizeRoutines([
      { id: "r1", text: "", days: [1] },
      { id: "r1", text: "Valid", days: [2] },
    ]);
    expect(result.map((r) => r.text)).toEqual(["Valid"]);
  });

  it("cuts overlong text by whole characters, never leaving half an emoji", () => {
    const text = `${"a".repeat(MAX_ROUTINE_TEXT - 1)}😀😀😀`;
    const [cut] = normalizeRoutines([{ id: "r1", text, days: [1] }]);
    expect(Array.from(cut.text)).toHaveLength(MAX_ROUTINE_TEXT);
    expect(cut.text.endsWith("a😀")).toBe(true);
    // No lone surrogate halves.
    expect(cut.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("keeps at most the ceiling", () => {
    const many = Array.from({ length: MAX_ROUTINES + 5 }, (_, i) => ({ id: `r${i}`, text: `R${i}`, days: [1] }));
    expect(normalizeRoutines(many)).toHaveLength(MAX_ROUTINES);
  });
});

describe("normalizeState: routines in a save", () => {
  const restore = (overrides: Record<string, unknown>) => {
    const state = normalizeState(JSON.parse(JSON.stringify({ ...buildInitialState(new Date(2026, 9, 1)), ...overrides })));
    if (!state) throw new Error("normalizeState returned null");
    return state;
  };

  it("a save from before routines loads with none", () => {
    const old: Record<string, unknown> = { ...buildInitialState(new Date(2026, 9, 1)) };
    delete old.routines;
    expect(normalizeState(JSON.parse(JSON.stringify(old)))?.routines).toEqual([]);
  });

  it("routines and a task's routineId survive save and reload", () => {
    const walk = routine({ createdAt: "2026-10-01T08:00:00.000Z" });
    const tasks = [
      { id: "t1", text: "Walk after lunch", createdAt: "2026-10-01T08:00:00.000Z", carriedOver: false, routineId: "r1" },
      { id: "t2", text: "Read", createdAt: "2026-10-01T08:00:00.000Z", carriedOver: false, routineId: 5 },
    ];
    const state = restore({ routines: [walk], tasks });
    expect(state.routines).toEqual([walk]);
    expect(state.tasks[0].routineId).toBe("r1");
    // A broken routineId is dropped, not kept as junk.
    expect(state.tasks[1]).not.toHaveProperty("routineId");
  });
});

describe("routines: the text cap counts visible characters", () => {
  const FAMILY = "👨‍👩‍👧"; // one visible character, five code points
  const FLAG = "🇬🇧"; // one visible character, two code points

  it("keeps a family emoji or a flag whole and counts it once", () => {
    const text = `${"a".repeat(MAX_ROUTINE_TEXT - 2)}${FAMILY}${FLAG}tail`;
    expect(cleanRoutineText(text)).toBe(`${"a".repeat(MAX_ROUTINE_TEXT - 2)}${FAMILY}${FLAG}`);
    expect(capVisibleChars(`${FAMILY}${FLAG}x`, 2)).toBe(`${FAMILY}${FLAG}`);
  });

  it("the text field's cap doesn't trim, so typing a space mid-word works", () => {
    expect(capVisibleChars("Walk ")).toBe("Walk ");
  });

  it("without Intl.Segmenter, falls back to code points (never half an emoji)", () => {
    const intl = Intl as unknown as { Segmenter?: unknown };
    const saved = intl.Segmenter;
    delete intl.Segmenter;
    try {
      expect(capVisibleChars("😀😀😀", 2)).toBe("😀😀");
    } finally {
      intl.Segmenter = saved;
    }
  });
});

describe("routines: describing days", () => {
  it("short names on screen, full names when spoken, preset labels either way", () => {
    expect(describeDays([1, 3, 5])).toBe("Mon, Wed, Fri");
    expect(describeDays([0, 1], { spoken: true })).toBe("Monday, Sunday");
    expect(describeDays([1, 2, 3, 4, 5], { spoken: true })).toBe("Weekdays");
  });
});

describe("withRoutineAdded", () => {
  const one = [routine()];
  it("adds under the limit, and refuses at it (null: no limit, Plus)", () => {
    expect(withRoutineAdded(one, routine({ id: "r2", text: "Read" }), 2)).toHaveLength(2);
    expect(withRoutineAdded([...one, routine({ id: "r2", text: "Read" })], routine({ id: "r3", text: "X" }), 2)).toBeNull();
    expect(withRoutineAdded([...one, routine({ id: "r2", text: "Read" })], routine({ id: "r3", text: "X" }), null)).toHaveLength(3);
  });

  it("refuses a taken id or the same words and days (a double-tapped Save)", () => {
    expect(withRoutineAdded(one, routine({ text: "Other" }), null)).toBeNull();
    expect(withRoutineAdded(one, routine({ id: "r2", text: " walk  AFTER lunch" }), null)).toBeNull();
    // Same words on other days is a different routine.
    expect(withRoutineAdded(one, routine({ id: "r2", days: [6] }), null)).toHaveLength(2);
  });
});
