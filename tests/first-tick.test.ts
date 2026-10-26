// 1.5 D: "One down. That's the whole trick." once ever, on the first tick of
// an install, never for someone who has ticked before.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  FIRST_TICK_KEY,
  FIRST_TICK_TOAST,
  claimFirstTick,
  isFirstTickEver,
  tickedBefore,
} from "../lib/daily-tasks/first-tick";
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

const day = (date: string, completed: number): DayRecord => ({
  date,
  total: 3,
  completed,
  locked: false,
  lockSource: null,
  tasks: [],
  reflection: null,
  reflectionResult: null,
});
const TODAY = "2026-10-26";

describe("is this the first tick ever?", () => {
  it("yes on a new install: nothing ticked today, nothing in the history", () => {
    expect(isFirstTickEver({ history: {}, today: TODAY, completedBefore: 0 })).toBe(true);
    expect(isFirstTickEver({ history: { [TODAY]: day(TODAY, 0) }, today: TODAY, completedBefore: 0 })).toBe(true);
  });

  it("no when something was already ticked today (a second tick)", () => {
    expect(isFirstTickEver({ history: { [TODAY]: day(TODAY, 1) }, today: TODAY, completedBefore: 1 })).toBe(false);
  });

  it("no for someone with a past tick, however long ago, and yes if past days had none", () => {
    const old: History = { "2026-01-02": day("2026-01-02", 1) };
    expect(isFirstTickEver({ history: old, today: TODAY, completedBefore: 0 })).toBe(false);
    expect(tickedBefore({ "2026-10-25": day("2026-10-25", 0) }, TODAY)).toBe(false);
    expect(isFirstTickEver({ history: { "2026-10-25": day("2026-10-25", 0) }, today: TODAY, completedBefore: 0 })).toBe(true);
  });

  it("a record for today or later doesn't count as 'before'", () => {
    expect(tickedBefore({ [TODAY]: day(TODAY, 2), "2026-10-27": day("2026-10-27", 3) }, TODAY)).toBe(false);
  });
});

describe("the toast is claimed once per install", () => {
  it("says the line, first claim wins, never again (also after undo and redo)", async () => {
    expect(FIRST_TICK_TOAST).toBe("One down. That's the whole trick.");
    expect(await claimFirstTick()).toBe(true);
    expect(store.data.has(FIRST_TICK_KEY)).toBe(true);
    expect(await claimFirstTick()).toBe(false);
    expect(await claimFirstTick()).toBe(false);
  });

  it("stays quiet when storage can't be read or written", async () => {
    store.getItem.mockRejectedValueOnce(new Error("disk"));
    expect(await claimFirstTick()).toBe(false);
    store.setItem.mockRejectedValueOnce(new Error("full"));
    expect(await claimFirstTick()).toBe(false);
  });
});
