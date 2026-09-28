// Today by time of day (1.2): the phase rule, the week summary, and the copy.
import { describe, expect, it } from "vitest";

import { addDays } from "../lib/daily-tasks/date";
import type { DayRecord, History } from "../lib/daily-tasks/types";
import {
  buildWeekSummary,
  doneCardTitle,
  smallWinsLine,
  todayPhase,
  weekRowLabel,
} from "../lib/daily-tasks/today-phase";

// A Saturday.
const TODAY = "2026-09-26";

function day(date: string, total: number, completed: number): DayRecord {
  return {
    date,
    total,
    completed,
    locked: false,
    lockSource: null,
    tasks: [],
    reflection: null,
    reflectionResult: null,
  };
}

function history(entries: [daysAgo: number, total: number, completed: number][]): History {
  const out: History = {};
  for (const [ago, total, completed] of entries) {
    const date = addDays(TODAY, -ago);
    out[date] = day(date, total, completed);
  }
  return out;
}

const phase = (taskCount: number, completedCount: number, hour: number, eveningEnabled = true) =>
  todayPhase({ taskCount, completedCount, hour, eveningEnabled });

describe("todayPhase", () => {
  it("is plan with no tasks, at any hour", () => {
    expect(phase(0, 0, 9)).toBe("plan");
    expect(phase(0, 0, 21)).toBe("plan");
  });

  it("is done once everything is ticked off, at any hour (even the morning, even with evening off)", () => {
    expect(phase(3, 3, 8)).toBe("done");
    expect(phase(1, 1, 14)).toBe("done");
    expect(phase(2, 2, 22, false)).toBe("done");
  });

  it("is evening from 17:00 with open tasks when the check-in is on", () => {
    expect(phase(3, 1, 16)).toBe("midday");
    expect(phase(3, 1, 17)).toBe("evening");
    expect(phase(3, 0, 23)).toBe("evening");
  });

  it("is morning before noon and midday from noon", () => {
    expect(phase(3, 0, 0)).toBe("morning");
    expect(phase(3, 2, 11)).toBe("morning");
    expect(phase(3, 2, 12)).toBe("midday");
  });

  it("falls back to midday after 17:00 when the evening check-in is off", () => {
    expect(phase(3, 1, 17, false)).toBe("midday");
    expect(phase(3, 1, 23, false)).toBe("midday");
  });
});

describe("buildWeekSummary", () => {
  it("is the seven days ending today, oldest first, filled when a plan was made", () => {
    const summary = buildWeekSummary(
      // 7 days ago is outside the window; 3 days ago planned nothing done still counts.
      history([
        [7, 3, 3],
        [6, 3, 2],
        [3, 2, 0],
        [1, 0, 0],
      ]),
      TODAY,
    );
    expect(summary.days.map((d) => d.date)).toEqual([
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
    ]);
    expect(summary.days.map((d) => d.letter)).toEqual(["S", "M", "T", "W", "T", "F", "S"]);
    expect(summary.days.map((d) => d.isToday)).toEqual([false, false, false, false, false, false, true]);
    expect(summary.days.map((d) => d.filled)).toEqual([true, false, false, true, false, false, false]);
    expect(summary.showedUpDays).toBe(2);
    expect(summary.tasksDone).toBe(2);
  });

  it("uses the live view of today over the stale history record", () => {
    const stale = history([
      [0, 0, 0],
      [2, 3, 3],
    ]);
    const summary = buildWeekSummary(stale, TODAY, { total: 3, completed: 2 });
    expect(summary.days[6]).toMatchObject({ date: TODAY, isToday: true, filled: true });
    expect(summary.showedUpDays).toBe(2);
    expect(summary.tasksDone).toBe(5);
    // Without `live`, today reads from history.
    expect(buildWeekSummary(stale, TODAY).days[6].filled).toBe(false);
  });
});

describe("Today copy", () => {
  it("doneCardTitle: 3 of 3 for a full day, All done otherwise", () => {
    expect(doneCardTitle(3)).toBe("3 of 3. Rest is part of it.");
    expect(doneCardTitle(2)).toBe("All done for now. Rest is part of it.");
    expect(doneCardTitle(1)).toBe("All done for now. Rest is part of it.");
  });

  it("smallWinsLine: positive counts, a first-day line, and a singular task", () => {
    expect(smallWinsLine({ showedUpDays: 5, tasksDone: 13 })).toBe("This week you showed up 5 days and finished 13 tasks.");
    expect(smallWinsLine({ showedUpDays: 1, tasksDone: 3 })).toBe("Your first finished day this week.");
    expect(smallWinsLine({ showedUpDays: 2, tasksDone: 1 })).toBe("This week you showed up 2 days and finished 1 task.");
  });

  it("weekRowLabel speaks the week, the day count and where it goes", () => {
    expect(weekRowLabel(4, 24)).toBe("This week: showed up 4 of the last 7 days. Day 24.");
  });
});
