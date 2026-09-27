// Weekly review (Phase 6): headline, counts, and the Plus patterns.
import { describe, expect, it } from "vitest";

import { addDays } from "../lib/daily-tasks/date";
import type { DayRecord, DayTaskRecord, History, RolloverOutcome } from "../lib/daily-tasks/types";
import {
  bestWeekday,
  buildWeeklyReview,
  comparisonText,
  hasInsights,
  stuckTasks,
} from "../lib/daily-tasks/weekly-review";

// A Saturday.
const TODAY = "2026-09-26";

function day(date: string, total: number, completed: number, tasks: DayTaskRecord[] = []): DayRecord {
  return {
    date,
    total,
    completed,
    locked: false,
    lockSource: null,
    tasks,
    reflection: null,
    reflectionResult: null,
  };
}

/** History with `total`/`completed` for each of the given days back from today. */
function history(entries: [daysAgo: number, total: number, completed: number][]): History {
  const out: History = {};
  for (const [ago, total, completed] of entries) {
    const date = addDays(TODAY, -ago);
    out[date] = day(date, total, completed);
  }
  return out;
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

function carried(text: string, outcome: RolloverOutcome = "carried"): DayTaskRecord {
  return { id: text, text, completed: false, carriedOver: false, rolloverOutcome: outcome };
}

describe("buildWeeklyReview: headline and counts", () => {
  it("never counts today's unfinished tasks against the week (the morning after a perfect week)", () => {
    const review = buildWeeklyReview(
      history([[0, 3, 0], ...range(1, 7).map((ago): [number, number, number] => [ago, 3, 3])]),
      TODAY,
    );
    expect(review.completed).toBe(18);
    expect(review.perfectDays).toBe(6);
    expect(review.headline).toBe("What a week: 6 perfect days.");
    // Today is still shown in the bars.
    expect(review.days[6]).toMatchObject({ date: TODAY, isToday: true, total: 3, completed: 0 });
  });

  it("welcomes a first-week user who has planned today, and a brand-new user with nothing yet", () => {
    const planned = buildWeeklyReview(history([[0, 3, 0]]), TODAY);
    expect(planned.firstWeek).toBe(true);
    expect(planned.headline).toBe("Your week starts with today's three.");
    expect(buildWeeklyReview({}, TODAY).headline).toBe("Your first week starts here.");
  });

  it("calls a week with nothing done after earlier use a quiet one", () => {
    const review = buildWeeklyReview(history([[10, 3, 2]]), TODAY);
    expect(review.firstWeek).toBe(false);
    expect(review.headline).toBe("A quiet week. One small task tomorrow is plenty.");
  });

  it("notices a week that's up by 3+ tasks on last week", () => {
    const review = buildWeeklyReview(
      history([
        [1, 3, 3],
        [2, 3, 3],
        [8, 3, 1],
        [9, 3, 1],
        [10, 3, 1],
      ]),
      TODAY,
    );
    expect(review.previousCompleted).toBe(3);
    expect(review.headline).toBe("Up from last week. That's real momentum.");
    expect(comparisonText(review)).toBe("You finished 6 tasks, up from 3 last week.");
  });
});

describe("comparisonText", () => {
  it("needs 3+ tracked days last week, calls ±1 the same, and words a lighter week kindly", () => {
    expect(comparisonText(buildWeeklyReview(history([[1, 3, 3], [8, 3, 1], [9, 3, 1]]), TODAY))).toBeNull();
    expect(
      comparisonText(buildWeeklyReview(history([[1, 3, 3], [8, 3, 1], [9, 3, 1], [10, 3, 0]]), TODAY)),
    ).toBe("About the same as last week. Steady is good.");
    expect(
      comparisonText(buildWeeklyReview(history([[1, 3, 1], [8, 3, 3], [9, 3, 3], [10, 3, 3]]), TODAY)),
    ).toBe("Lighter than last week. You still finished 1 task. Lighter weeks happen.");
  });
});

describe("bestWeekday", () => {
  const everyDay = (completed: (ago: number) => number) =>
    history(range(1, 28).map((ago): [number, number, number] => [ago, 3, completed(ago)]));

  it("names a weekday that clearly goes best over the last four weeks", () => {
    // Mondays (5, 12, 19, 26 days before this Saturday) are perfect; the rest 1 of 3.
    const mondays = new Set([5, 12, 19, 26]);
    expect(bestWeekday(everyDay((ago) => (mondays.has(ago) ? 3 : 1)), TODAY)).toBe("Monday");
  });

  it("stays quiet with under a week of tracked days, or when every weekday goes the same", () => {
    expect(bestWeekday(history(range(1, 6).map((ago): [number, number, number] => [ago, 3, ago === 5 ? 3 : 0])), TODAY)).toBeNull();
    expect(bestWeekday(everyDay(() => 2), TODAY)).toBeNull();
  });

  it("leaves today out", () => {
    const h = everyDay(() => 1);
    h[TODAY] = day(TODAY, 3, 3);
    expect(bestWeekday(h, TODAY)).toBeNull();
  });
});

describe("stuckTasks", () => {
  it("counts carried tasks (ignoring case and spacing), 2+ times, top 3", () => {
    const h: History = {};
    const put = (ago: number, tasks: DayTaskRecord[]) => {
      const date = addDays(TODAY, -ago);
      h[date] = day(date, tasks.length, 0, tasks);
    };
    put(1, [carried("Call  Mum "), carried("File taxes"), carried("Gym"), carried("Read")]);
    put(2, [carried("call mum"), carried("file taxes"), carried("gym"), carried("Read")]);
    put(3, [carried("CALL MUM"), carried("File taxes"), carried("Gym", "dropped"), carried("Once")]);
    put(4, [carried("Gym", "unresolved")]);
    // Outside the 14-day window.
    put(20, [carried("Once"), carried("Once")]);

    const lower = (list: { text: string; times: number }[]) =>
      list.map((t) => ({ text: t.text.toLowerCase(), times: t.times }));
    // Shown with the wording first seen (trimmed).
    expect(lower(stuckTasks(h, TODAY))).toEqual([
      { text: "call mum", times: 3 },
      { text: "file taxes", times: 3 },
      { text: "gym", times: 2 },
    ]);
    expect(lower(stuckTasks(h, TODAY, 10))).toEqual([
      { text: "call mum", times: 3 },
      { text: "file taxes", times: 3 },
      { text: "gym", times: 2 },
      { text: "read", times: 2 },
    ]);
  });
});

describe("hasInsights", () => {
  it("is false with nothing to compare, no best day and nothing stuck", () => {
    expect(hasInsights(buildWeeklyReview(history([[0, 3, 1]]), TODAY))).toBe(false);
    expect(
      hasInsights(buildWeeklyReview(history([[1, 3, 3], [8, 3, 1], [9, 3, 1], [10, 3, 1]]), TODAY)),
    ).toBe(true);
  });
});
