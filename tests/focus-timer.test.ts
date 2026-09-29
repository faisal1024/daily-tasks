// Focus timer v2 (1.2, PR #70): the pure helpers (clamp, lengths in words and
// on chips, the clock face, the end time, the time's-up line) and the
// best-effort store for the last custom length.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FOCUS_TIMER_PRESETS,
  clampTimerMinutes,
  durationShort,
  durationWords,
  formatEndTime,
  formatRemaining,
  timesUpText,
} from "../lib/daily-tasks/focus-timer";
import {
  LAST_CUSTOM_TIMER_KEY,
  loadLastCustomTimer,
  saveLastCustomTimer,
} from "../lib/daily-tasks/focus-timer-storage";

// Hoisted above the imports by vitest.
const store = vi.hoisted(() => ({
  getItem: vi.fn<(key: string) => Promise<string | null>>(),
  setItem: vi.fn<(key: string, value: string) => Promise<void>>(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: store }));

describe("focus timer helpers", () => {
  it("presets are 5, 10 and 20 minutes", () => {
    expect([...FOCUS_TIMER_PRESETS]).toEqual([5, 10, 20]);
  });

  it("clampTimerMinutes keeps whole minutes within 1–180; non-finite is the minimum", () => {
    expect(clampTimerMinutes(0)).toBe(1);
    expect(clampTimerMinutes(-30)).toBe(1);
    expect(clampTimerMinutes(1)).toBe(1);
    expect(clampTimerMinutes(180)).toBe(180);
    expect(clampTimerMinutes(181)).toBe(180);
    expect(clampTimerMinutes(24 * 60)).toBe(180);
    expect(clampTimerMinutes(14.6)).toBe(15);
    expect(clampTimerMinutes(0.4)).toBe(1);
    expect(clampTimerMinutes(Number.NaN)).toBe(1);
    expect(clampTimerMinutes(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("durationWords: singular/plural minutes and hours, hours with minutes", () => {
    expect(durationWords(1)).toBe("1 minute");
    expect(durationWords(20)).toBe("20 minutes");
    expect(durationWords(59)).toBe("59 minutes");
    expect(durationWords(60)).toBe("1 hour");
    expect(durationWords(61)).toBe("1 hour 1 minute");
    expect(durationWords(75)).toBe("1 hour 15 minutes");
    expect(durationWords(120)).toBe("2 hours");
    expect(durationWords(180)).toBe("3 hours");
    expect(durationWords(0)).toBe("0 minutes");
  });

  it("durationShort: min under an hour, hr and hr + min above", () => {
    expect(durationShort(5)).toBe("5 min");
    expect(durationShort(45)).toBe("45 min");
    expect(durationShort(60)).toBe("1 hr");
    expect(durationShort(75)).toBe("1 hr 15 min");
    expect(durationShort(180)).toBe("3 hr");
  });

  it("formatRemaining: m:ss under an hour, h:mm:ss from an hour, rounding up partial seconds", () => {
    expect(formatRemaining(10 * 60_000)).toBe("10:00");
    expect(formatRemaining(10 * 60_000 - 500)).toBe("10:00");
    expect(formatRemaining(10 * 60_000 - 1000)).toBe("9:59");
    expect(formatRemaining(1)).toBe("0:01");
    expect(formatRemaining(0)).toBe("0:00");
    expect(formatRemaining(-5000)).toBe("0:00");
    expect(formatRemaining(59 * 60_000 + 59_500)).toBe("1:00:00");
    expect(formatRemaining(60 * 60_000)).toBe("1:00:00");
    expect(formatRemaining(75 * 60_000 + 5000)).toBe("1:15:05");
    expect(formatRemaining(180 * 60_000)).toBe("3:00:00");
  });

  it("timesUpText says the length in words, hours included", () => {
    expect(timesUpText(10)).toBe("That's 10 minutes. Keep going, or take a break.");
    expect(timesUpText(1)).toBe("That's 1 minute. Keep going, or take a break.");
    expect(timesUpText(90)).toBe("That's 1 hour 30 minutes. Keep going, or take a break.");
  });

  describe("formatEndTime", () => {
    afterEach(() => vi.restoreAllMocks());

    it("uses the device's locale and 12/24-hour setting (no forced locale)", () => {
      const spy = vi.spyOn(Date.prototype, "toLocaleTimeString").mockReturnValue("09:42");
      const at = new Date(2026, 8, 26, 9, 42);
      expect(formatEndTime(at)).toBe("09:42");
      expect(spy).toHaveBeenCalledWith(undefined, { hour: "numeric", minute: "2-digit" });
    });
  });
});

describe("focus timer storage (last custom length)", () => {
  beforeEach(() => {
    store.getItem.mockReset();
    store.setItem.mockReset();
  });

  it("loads a saved length from its key", async () => {
    store.getItem.mockResolvedValue("45");
    await expect(loadLastCustomTimer()).resolves.toBe(45);
    expect(store.getItem).toHaveBeenCalledWith(LAST_CUSTOM_TIMER_KEY);
  });

  it("null when nothing saved, out of range, not whole, or junk", async () => {
    for (const raw of [null, "0", "181", "12.5", "abc", ""]) {
      store.getItem.mockResolvedValue(raw);
      await expect(loadLastCustomTimer()).resolves.toBeNull();
    }
    for (const raw of ["1", "180"]) {
      store.getItem.mockResolvedValue(raw);
      await expect(loadLastCustomTimer()).resolves.toBe(Number(raw));
    }
  });

  it("a failed read is null, not a throw", async () => {
    store.getItem.mockRejectedValue(new Error("disk"));
    await expect(loadLastCustomTimer()).resolves.toBeNull();
  });

  it("saves the length as a string, and a failed write doesn't throw", async () => {
    store.setItem.mockResolvedValue(undefined);
    await saveLastCustomTimer(75);
    expect(store.setItem).toHaveBeenCalledWith(LAST_CUSTOM_TIMER_KEY, "75");
    store.setItem.mockRejectedValue(new Error("full"));
    await expect(saveLastCustomTimer(30)).resolves.toBeUndefined();
  });
});
