import { describe, expect, it } from "vitest";

import {
  addDays,
  fromDateKey,
  greetingFor,
  greetingText,
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
    expect(greetingFor(new Date(2026, 0, 1, 22))).toBe("night");
    expect(greetingFor(new Date(2026, 0, 1, 3))).toBe("night");
  });

  it("greetingText maps to readable strings", () => {
    expect(greetingText("morning")).toMatch(/morning/i);
    expect(greetingText("night")).toMatch(/night/i);
  });
});
