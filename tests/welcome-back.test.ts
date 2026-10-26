// 1.5 D: coming back after a gap. The last open is read from the history, the
// welcome says Day N after 2+ days away until the first tick, the rollover
// card is named for the day the leftovers are from, and the "shown" event
// goes out once a day. Date keys are local, built from local constructors, so
// the suite reads the same in every time zone (incl. +14 and -11).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { toDateKey } from "../lib/daily-tasks/date";
import {
  WELCOME_BACK_SHOWN_KEY,
  claimWelcomeShown,
  lastOpenBefore,
  rolloverTitle,
  showsWelcomeBack,
  unfinishedFrom,
  welcomeBack,
  welcomeBackLine,
} from "../lib/daily-tasks/welcome-back";
import type { DayRecord, History } from "../lib/daily-tasks/types";

const store = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn(async (key: string) => data.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
    }),
  };
});
vi.mock("@react-native-async-storage/async-storage", () => ({ default: store }));

beforeEach(() => {
  store.data.clear();
  vi.clearAllMocks();
});

const record = (date: string, completed = 0): DayRecord => ({
  date,
  total: 3,
  completed,
  locked: false,
  lockSource: null,
  tasks: [],
  reflection: null,
  reflectionResult: null,
});
const historyOf = (...days: string[]): History => Object.fromEntries(days.map((day) => [day, record(day)]));
/** The date key `offset` days from a local date. */
const key = (y: number, m: number, d: number, offset = 0) => toDateKey(new Date(y, m - 1, d + offset));

describe("welcomeBack: 2+ days since the last open", () => {
  it("is null for a new install, for yesterday, and for the same day", () => {
    expect(welcomeBack({}, "2026-10-26")).toBeNull();
    expect(welcomeBack(historyOf("2026-10-25"), "2026-10-26")).toBeNull();
    expect(welcomeBack(historyOf("2026-10-26"), "2026-10-26")).toBeNull();
  });

  it("is on from exactly two days away, with the gap", () => {
    expect(welcomeBack(historyOf("2026-10-24"), "2026-10-26")).toEqual({ since: "2026-10-24", days: 2 });
    expect(welcomeBack(historyOf("2026-09-26"), "2026-10-26")).toEqual({ since: "2026-09-26", days: 30 });
  });

  it("reads the latest day before today, ignoring today and the future, and junk keys", () => {
    const history = { ...historyOf("2026-10-01", "2026-10-20", "2026-10-26", "2026-11-05"), draft: record("x") } as History;
    expect(lastOpenBefore(history, "2026-10-26")).toBe("2026-10-20");
    expect(welcomeBack(history, "2026-10-26")?.days).toBe(6);
  });

  it("counts whole calendar days across a month boundary, a year boundary and a leap day", () => {
    expect(welcomeBack(historyOf("2026-10-30"), "2026-11-02")?.days).toBe(3);
    expect(welcomeBack(historyOf("2026-12-30"), "2027-01-01")?.days).toBe(2);
    expect(welcomeBack(historyOf("2028-02-27"), "2028-03-01")?.days).toBe(3);
  });

  it("counts whole days across both DST changes (a 23 or 25 hour day is still one day)", () => {
    for (const [from, to, days] of [
      [key(2026, 3, 7), key(2026, 3, 9), 2], // US spring forward 8 Mar
      [key(2026, 3, 28), key(2026, 3, 30), 2], // EU spring forward 29 Mar
      [key(2026, 10, 31), key(2026, 11, 2), 2], // US fall back 1 Nov
      [key(2026, 10, 24), key(2026, 10, 26), 2], // EU fall back 25 Oct
      [key(2026, 11, 1), key(2026, 11, 8), 7],
    ] as const) {
      expect(welcomeBack(historyOf(from), to)?.days).toBe(days);
    }
  });
});

describe("the welcome on Today", () => {
  const welcome = { since: "2026-10-24", days: 2 };

  it("shows until the first tick, then hides; never in first run or without a gap", () => {
    expect(showsWelcomeBack({ welcome, completedCount: 0, firstRun: false })).toBe(true);
    expect(showsWelcomeBack({ welcome, completedCount: 1, firstRun: false })).toBe(false);
    expect(showsWelcomeBack({ welcome, completedCount: 0, firstRun: true })).toBe(false);
    expect(showsWelcomeBack({ welcome: null, completedCount: 0, firstRun: false })).toBe(false);
  });

  it("says Day N from the Day chip's count, never below 1", () => {
    expect(welcomeBackLine(12)).toBe("Welcome back. Day 12 is still yours.");
    expect(welcomeBackLine(0)).toBe("Welcome back. Day 1 is still yours.");
    expect(welcomeBackLine(7.9)).toBe("Welcome back. Day 7 is still yours.");
  });
});

describe("rollover titles: yesterday / weekday / last week / earlier", () => {
  it("names the day the leftovers are from", () => {
    // Monday 26 Oct 2026.
    const today = "2026-10-26";
    expect(unfinishedFrom("2026-10-25", today)).toBe("yesterday");
    expect(unfinishedFrom("2026-10-24", today)).toBe("Saturday");
    expect(unfinishedFrom("2026-10-23", today)).toBe("Friday");
    expect(unfinishedFrom("2026-10-20", today)).toBe("Tuesday"); // 6 days
    expect(unfinishedFrom("2026-10-19", today)).toBe("last week"); // 7 days
    expect(unfinishedFrom("2026-09-01", today)).toBe("last week");
  });

  it("is 'earlier' for a source on or after today (a clock that moved), never 'yesterday'", () => {
    expect(unfinishedFrom("2026-10-26", "2026-10-26")).toBe("earlier");
    expect(unfinishedFrom("2026-10-27", "2026-10-26")).toBe("earlier");
    expect(unfinishedFrom("garbage", "2026-10-26")).toBe("earlier");
  });

  it("uses the right weekday across month and year boundaries", () => {
    expect(unfinishedFrom("2026-10-30", "2026-11-02")).toBe("Friday");
    expect(unfinishedFrom("2026-10-31", "2026-11-03")).toBe("Saturday");
    expect(unfinishedFrom("2026-12-30", "2027-01-02")).toBe("Wednesday");
    expect(unfinishedFrom("2027-02-27", "2027-03-01")).toBe("Saturday");
    expect(unfinishedFrom("2026-10-31", "2026-11-01")).toBe("yesterday");
  });

  it("keeps the weekday and the day count through DST changes", () => {
    // US clocks go back on Sun 1 Nov 2026: the Saturday before is 'Saturday', not shifted.
    expect(unfinishedFrom("2026-10-31", "2026-11-02")).toBe("Saturday");
    expect(unfinishedFrom("2026-03-07", "2026-03-09")).toBe("Saturday");
    expect(unfinishedFrom("2026-03-08", "2026-03-09")).toBe("yesterday");
    expect(unfinishedFrom("2026-03-01", "2026-03-08")).toBe("last week");
    expect(unfinishedFrom("2026-10-25", "2026-11-01")).toBe("last week");
    expect(unfinishedFrom("2026-10-26", "2026-11-01")).toBe("Monday");
  });

  it("titles the card 'Unfinished from …', or 'Also from …' beside a draft", () => {
    expect(rolloverTitle("2026-10-25", "2026-10-26", false)).toBe("Unfinished from yesterday");
    expect(rolloverTitle("2026-10-25", "2026-10-26", true)).toBe("Also from yesterday");
    expect(rolloverTitle("2026-10-21", "2026-10-26", false)).toBe("Unfinished from Wednesday");
    expect(rolloverTitle("2026-10-21", "2026-10-26", true)).toBe("Also from Wednesday");
    expect(rolloverTitle("2026-10-10", "2026-10-26", false)).toBe("Unfinished from last week");
  });
});

describe("welcome_back_shown goes out once a day", () => {
  it("claims the first time today, not again, and again the next day", async () => {
    expect(await claimWelcomeShown("2026-10-26")).toBe(true);
    expect(await claimWelcomeShown("2026-10-26")).toBe(false);
    expect(store.data.get(WELCOME_BACK_SHOWN_KEY)).toBe("2026-10-26");
    expect(await claimWelcomeShown("2026-10-27")).toBe(true);
  });

  it("stays quiet when storage can't be read", async () => {
    store.getItem.mockRejectedValueOnce(new Error("disk"));
    expect(await claimWelcomeShown("2026-10-26")).toBe(false);
  });
});
