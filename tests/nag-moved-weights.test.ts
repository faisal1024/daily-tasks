// 1.5 C, Nag mode: a task moved to another day more often is named in more of
// the day's built-in lines (weight 1 + times moved, at most 3). With nothing
// moved the output is exactly what it was before.
import { describe, expect, it } from "vitest";

import { NAG_LEVELS, NAG_PERSONAS, builtInNagLines, weightedTurns } from "../lib/daily-tasks/nag";
import { nagTaskWeights, planNagDay } from "../lib/daily-tasks/nag-plan";
import { DEFAULT_NOTIFICATIONS, type NotificationConfig } from "../lib/daily-tasks/types";

const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };
const OPEN = [
  { id: "t0", text: "Call the dentist" },
  { id: "t1", text: "Write the report" },
  { id: "t2", text: "Walk the dog" },
];
const at = (hour: number) => new Date(2026, 9, 12, hour);

describe("weightedTurns", () => {
  it("equal weights are the plain rotation", () => {
    expect(weightedTurns([1])).toEqual([0]);
    expect(weightedTurns([1, 1, 1])).toEqual([0, 1, 2]);
    expect(weightedTurns([2, 2])).toEqual([0, 1, 0, 1]);
    expect(weightedTurns([3, 3, 3]).length).toBe(9);
    expect(new Set(weightedTurns([1, 1, 1, 1]))).toEqual(new Set([0, 1, 2, 3]));
  });

  it("each task appears as often as its weight, spread out (the documented [3,1,1] case)", () => {
    expect(weightedTurns([3, 1, 1])).toEqual([0, 1, 0, 2, 0]);
    for (const weights of [[2, 1], [1, 2, 3], [3, 3, 1], [1, 3]]) {
      const order = weightedTurns(weights);
      weights.forEach((weight, index) => expect(order.filter((turn) => turn === index)).toHaveLength(weight));
    }
  });

  it("clamps odd weights to 1..3 and treats junk as 1", () => {
    expect(weightedTurns([0, 5, Number.NaN, -3, Infinity]).length).toBe(1 + 3 + 1 + 1 + 1);
    expect(weightedTurns([])).toEqual([]);
  });
});

describe("nagTaskWeights", () => {
  it("is 1 plus the times moved, at most 3", () => {
    expect(nagTaskWeights(OPEN, { t0: 1, t1: 2, t2: 9 })).toEqual([2, 3, 3]);
    expect(nagTaskWeights(OPEN, { t0: 1 })).toEqual([2, 1, 1]);
  });

  it("is all 1s with nothing moved or junk counts", () => {
    expect(nagTaskWeights(OPEN)).toEqual([1, 1, 1]);
    expect(nagTaskWeights(OPEN, {})).toEqual([1, 1, 1]);
    expect(nagTaskWeights(OPEN, { t0: 0, t1: -4, t2: Number.NaN })).toEqual([1, 1, 1]);
    expect(nagTaskWeights(OPEN, { other: 5 })).toEqual([1, 1, 1]);
    expect(nagTaskWeights(OPEN, { t0: "3" as unknown as number })).toEqual([1, 1, 1]);
  });
});

describe("builtInNagLines with weights", () => {
  const COMBOS = NAG_PERSONAS.flatMap((persona) => NAG_LEVELS.map((level) => [persona, level] as const));
  const tasks = OPEN.map(({ text }) => ({ text }));

  it("identical output to before when every weight is 1, or there are none", () => {
    for (const [persona, level] of COMBOS) {
      for (const count of [4, 7, 12, 16]) {
        for (const seed of ["a", "2026-10-12|salt", 7]) {
          const base = builtInNagLines({ persona, level, tasks, count, seed });
          const ones = builtInNagLines({ persona, level, tasks, count, seed, weights: [1, 1, 1] });
          const empty = builtInNagLines({ persona, level, tasks, count, seed, weights: [] });
          expect(ones, `${persona}/${level}/${count}/${seed}`).toEqual(base);
          expect(empty).toEqual(base);
        }
      }
    }
  });

  it("only the task a line names changes: the same templates, steps and count", () => {
    const strip = (lines: ReturnType<typeof builtInNagLines>) => lines.map((line) => [line.step, line.taskIndex === null]);
    for (const [persona, level] of COMBOS) {
      const base = builtInNagLines({ persona, level, tasks, count: 10, seed: "s" });
      const weighted = builtInNagLines({ persona, level, tasks, count: 10, seed: "s", weights: [3, 1, 1] });
      expect(strip(weighted)).toEqual(strip(base));
    }
  });

  it("names the moved task more often than the others over many days", () => {
    const share = (weights?: number[]) => {
      let named = 0;
      let moved = 0;
      for (const [persona, level] of COMBOS) {
        for (const seed of ["a", "b", "c", "d", "e", "f"]) {
          const lines = builtInNagLines({ persona, level, tasks, count: 12, seed, ...(weights ? { weights } : {}) });
          for (const line of lines) {
            if (line.taskIndex === null) continue;
            named += 1;
            if (line.taskIndex === 0) moved += 1;
          }
        }
      }
      return moved / named;
    };
    const even = share();
    const favoured = share([3, 1, 1]);
    expect(even).toBeGreaterThan(0.25);
    expect(even).toBeLessThan(0.42);
    expect(favoured).toBeGreaterThan(0.5);
    expect(favoured).toBeGreaterThan(even + 0.15);
  });

  it("every task is still named at least once in a long day", () => {
    const lines = builtInNagLines({ persona: "mom", level: "firm", tasks, count: 16, seed: "x", weights: [3, 1, 1] });
    const named = new Set(lines.map((line) => line.taskIndex).filter((index) => index !== null));
    expect(named).toEqual(new Set([0, 1, 2]));
  });
});

describe("planNagDay with moved counts", () => {
  const plan = (moved?: Record<string, number>) =>
    planNagDay({ previous: null, now: at(8), dayKey: "2026-10-12", settings: NAG_ON, open: OPEN, salt: "salt-a", ...(moved ? { moved } : {}) });

  it("with nothing moved the record is the same as before the field existed", () => {
    const before = plan();
    expect(plan({})).toEqual(before);
    expect(plan({ t0: 0, t1: 0 })).toEqual(before);
    expect(plan({ unknown: 4 })).toEqual(before);
  });

  it("moved tasks get more of the day's lines; times and step counts do not change", () => {
    const before = plan();
    const after = plan({ t1: 2 });
    expect(after.slots.map((slot) => [slot.id, slot.fireAtMs, slot.step])).toEqual(before.slots.map((slot) => [slot.id, slot.fireAtMs, slot.step]));
    expect(after.total).toBe(before.total);
    const named = (record: typeof before) => record.slots.filter((slot) => slot.taskId === "t1").length;
    expect(named(after)).toBeGreaterThanOrEqual(named(before));
  });

  it("the weights point at the right task by id", () => {
    let more = 0;
    for (const salt of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const base = planNagDay({ previous: null, now: at(8), dayKey: "2026-10-12", settings: NAG_ON, open: OPEN, salt });
      const heavy = planNagDay({ previous: null, now: at(8), dayKey: "2026-10-12", settings: NAG_ON, open: OPEN, salt, moved: { t2: 5 } });
      const count = (record: typeof base) => record.slots.filter((slot) => slot.taskId === "t2").length;
      if (count(heavy) > count(base)) more += 1;
      expect(count(heavy)).toBeGreaterThanOrEqual(count(base));
    }
    expect(more).toBeGreaterThan(0);
  });
});
