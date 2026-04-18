import { describe, expect, it } from "vitest";

import {
  computeDayStreak,
  computePerfectStreak,
  monthlyStats,
} from "../lib/daily-tasks/streaks";
import type { History } from "../lib/daily-tasks/types";

function buildHistory(entries: Record<string, [number, number]>): History {
  const out: History = {};
  for (const [date, [completed, total]] of Object.entries(entries)) {
    out[date] = { date, completed, total };
  }
  return out;
}

describe("computeDayStreak", () => {
  it("returns 0 when there's no history", () => {
    expect(computeDayStreak({}, "2026-04-18")).toBe(0);
  });

  it("counts consecutive days with at least one completion ending today", () => {
    const history = buildHistory({
      "2026-04-15": [1, 3],
      "2026-04-16": [2, 3],
      "2026-04-17": [3, 3],
      "2026-04-18": [1, 3],
    });
    expect(computeDayStreak(history, "2026-04-18")).toBe(4);
  });

  it("does not break the streak when today has no completions yet", () => {
    const history = buildHistory({
      "2026-04-16": [1, 3],
      "2026-04-17": [2, 3],
      "2026-04-18": [0, 3],
    });
    expect(computeDayStreak(history, "2026-04-18")).toBe(2);
  });

  it("breaks on a missing day", () => {
    const history = buildHistory({
      "2026-04-14": [1, 3],
      "2026-04-15": [1, 3],
      "2026-04-17": [1, 3],
      "2026-04-18": [1, 3],
    });
    expect(computeDayStreak(history, "2026-04-18")).toBe(2);
  });

  it("breaks on a zero-completion day", () => {
    const history = buildHistory({
      "2026-04-14": [1, 3],
      "2026-04-15": [0, 3],
      "2026-04-16": [1, 3],
      "2026-04-17": [1, 3],
      "2026-04-18": [1, 3],
    });
    expect(computeDayStreak(history, "2026-04-18")).toBe(3);
  });
});

describe("computePerfectStreak", () => {
  it("only counts days with all 3 tasks completed", () => {
    const history = buildHistory({
      "2026-04-15": [3, 3],
      "2026-04-16": [3, 3],
      "2026-04-17": [2, 3],
      "2026-04-18": [3, 3],
    });
    expect(computePerfectStreak(history, "2026-04-18")).toBe(1);
  });

  it("requires total === 3, not just completed === total", () => {
    const history = buildHistory({
      "2026-04-17": [2, 2],
      "2026-04-18": [3, 3],
    });
    expect(computePerfectStreak(history, "2026-04-18")).toBe(1);
  });
});

describe("monthlyStats", () => {
  it("counts active and perfect days within a month", () => {
    const history = buildHistory({
      "2026-04-01": [1, 3],
      "2026-04-02": [3, 3],
      "2026-04-03": [0, 3],
      "2026-04-04": [3, 3],
      "2026-03-31": [3, 3],
      "2026-05-01": [3, 3],
    });
    const stats = monthlyStats(history, 2026, 3);
    expect(stats.activeDays).toBe(3);
    expect(stats.perfectDays).toBe(2);
  });
});
