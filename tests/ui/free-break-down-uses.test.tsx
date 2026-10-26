// The free Break it down try, counted per install (1.5, PR #102): its own key,
// one claim ever, a refund only for a failure, fail-closed on bad storage, and
// untouched by "Reset all data".
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  FREE_BREAK_DOWNS,
  claimFreeBreakDown,
  freeBreakDownBadge,
  freeBreakDownsLeft,
  refundFreeBreakDown,
  spendFreeBreakDowns,
} from "@/lib/daily-tasks/free-uses";
import { clearState } from "@/lib/daily-tasks/storage";

const KEY = "daily-tasks/free-break-downs-used";

beforeEach(async () => {
  await AsyncStorage.clear();
});
afterEach(() => {
  jest.clearAllMocks();
});

describe("free Break it down try", () => {
  it("is one claim ever: 1 left, then 0 left, then no more", async () => {
    expect(FREE_BREAK_DOWNS).toBe(1);
    expect(await freeBreakDownsLeft()).toBe(1);
    expect(await claimFreeBreakDown()).toBe(0);
    expect(await freeBreakDownsLeft()).toBe(0);
    expect(await claimFreeBreakDown()).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBe("1");
  });

  it("parallel claims hand out one try, not two", async () => {
    const results = await Promise.all([claimFreeBreakDown(), claimFreeBreakDown(), claimFreeBreakDown()]);
    expect(results).toEqual([0, null, null]);
  });

  it("a refund gives it back once and never goes below zero", async () => {
    await claimFreeBreakDown();
    await refundFreeBreakDown();
    expect(await freeBreakDownsLeft()).toBe(1);
    await refundFreeBreakDown();
    expect(await AsyncStorage.getItem(KEY)).toBe("0");
    expect(await claimFreeBreakDown()).toBe(0);
  });

  it("spend marks it used even if nothing was claimed here (the server said 402), and a refund after it is the caller's choice", async () => {
    await spendFreeBreakDowns();
    expect(await freeBreakDownsLeft()).toBe(0);
    expect(await claimFreeBreakDown()).toBeNull();
    // Spending twice is the same as once.
    await spendFreeBreakDowns();
    expect(await AsyncStorage.getItem(KEY)).toBe("1");
  });

  it("an unreadable or negative stored count counts as used (fail closed), and a refund can't undo it", async () => {
    for (const bad of ["banana", "-3", "1.5x"]) {
      await AsyncStorage.setItem(KEY, bad);
      expect(await freeBreakDownsLeft()).toBe(0);
      expect(await claimFreeBreakDown()).toBeNull();
    }
  });

  it("fails closed when storage can't be read or written, and refund and spend never throw", async () => {
    const getItem = AsyncStorage.getItem as jest.Mock;
    getItem.mockRejectedValueOnce(new Error("disk"));
    expect(await freeBreakDownsLeft()).toBe(0);
    getItem.mockRejectedValueOnce(new Error("disk"));
    expect(await claimFreeBreakDown()).toBeNull();
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("full"));
    expect(await claimFreeBreakDown()).toBeNull();
    getItem.mockRejectedValueOnce(new Error("disk"));
    await expect(refundFreeBreakDown()).resolves.toBeUndefined();
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("full"));
    await expect(spendFreeBreakDowns()).resolves.toBeUndefined();
  });

  it("is its own count: the AI brain dump tries don't touch it, and Reset all data keeps it", async () => {
    await AsyncStorage.setItem("daily-tasks/free-ai-dumps-used", "3");
    expect(await freeBreakDownsLeft()).toBe(1);
    await claimFreeBreakDown();
    await clearState();
    expect(await freeBreakDownsLeft()).toBe(0);
    expect(await claimFreeBreakDown()).toBeNull();
  });

  it("the badge says '1 free try' while one is left, and nothing once it's used", () => {
    expect(freeBreakDownBadge(1)).toBe("1 free try");
    expect(freeBreakDownBadge(2)).toBe("2 free tries");
    expect(freeBreakDownBadge(0)).toBeNull();
    expect(freeBreakDownBadge(-1)).toBeNull();
  });
});
