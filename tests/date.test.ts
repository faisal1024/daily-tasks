import { describe, expect, it } from "vitest";

import {
  addDays,
  fromDateKey,
  greetingFor,
  greetingText,
  storeDayFor,
  previousDay,
  toDateKey,
} from "../lib/daily-tasks/date";

describe("date helpers", () => {
  it("toDateKey pads month and day", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toDateKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("round-trips toDateKey/fromDateKey", () => {
    const d = new Date(2026, 3, 18);
    expect(toDateKey(fromDateKey(toDateKey(d)))).toBe("2026-04-18");
  });

  it("addDays handles month and year boundaries", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
  });

  it("greetingFor returns the right slot", () => {
    expect(greetingFor(new Date(2026, 0, 1, 7))).toBe("morning");
    expect(greetingFor(new Date(2026, 0, 1, 13))).toBe("afternoon");
    expect(greetingFor(new Date(2026, 0, 1, 18))).toBe("evening");
    // 9 pm to midnight is still evening; after midnight it's "night".
    expect(greetingFor(new Date(2026, 0, 1, 21))).toBe("evening");
    expect(greetingFor(new Date(2026, 0, 1, 23))).toBe("evening");
    expect(greetingFor(new Date(2026, 0, 1, 0))).toBe("night");
    expect(greetingFor(new Date(2026, 0, 1, 3))).toBe("night");
    expect(greetingFor(new Date(2026, 0, 1, 5))).toBe("morning");
  });

  it("greetingText maps to readable strings", () => {
    expect(greetingText("morning")).toMatch(/morning/i);
    expect(greetingText("evening")).toBe("Good evening");
    // After midnight a plain hello ("Good night" reads as a goodbye).
    expect(greetingText("night")).toBe("Hello");
  });
});

describe("storeDayFor", () => {
  it.each([
    ["the clock is ahead: follow it", "2026-09-25", "2026-09-26", "2026-09-26"],
    ["same day", "2026-09-25", "2026-09-25", "2026-09-25"],
    ["one day back (travel west): hold the tasks' day", "2026-09-26", "2026-09-25", "2026-09-26"],
    ["one day back across a month", "2026-10-01", "2026-09-30", "2026-10-01"],
    ["two days back (a wrong date fixed): follow the clock", "2026-09-26", "2026-09-24", "2026-09-24"],
  ])("%s", (_why, tasksDay, clockDay, expected) => {
    expect(storeDayFor(tasksDay, clockDay)).toBe(expected);
  });
});
