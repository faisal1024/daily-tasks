// Phase 11a: free AI brain dumps (counted per install), the trial-ending
// reminder, and RevenueCat's trial end date.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

import {
  FREE_AI_DUMPS,
  claimFreeAiDump,
  freeAiDumpNotice,
  freeAiDumpsLeft,
  refundFreeAiDump,
} from "@/lib/daily-tasks/free-uses";
import { lapsedAt, trialEndsAt } from "@/lib/daily-tasks/purchases";
import { clearState } from "@/lib/daily-tasks/storage";
import { TRIAL_REMINDER_ID, syncTrialReminder, trialReminderAt } from "@/lib/daily-tasks/trial-reminder";

jest.mock("expo-notifications", () => ({
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const KEY = "daily-tasks/free-ai-dumps-used";

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe("free AI brain dumps", () => {
  it("allows three claims (2, 1, 0 left), then none", async () => {
    expect(FREE_AI_DUMPS).toBe(3);
    expect(await freeAiDumpsLeft()).toBe(3);
    expect(await claimFreeAiDump()).toBe(2);
    expect(await claimFreeAiDump()).toBe(1);
    expect(await claimFreeAiDump()).toBe(0);
    expect(await freeAiDumpsLeft()).toBe(0);
    expect(await claimFreeAiDump()).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBe("3");
  });

  it("gives one back on refund, and never goes below zero", async () => {
    await claimFreeAiDump();
    await claimFreeAiDump();
    await refundFreeAiDump();
    expect(await freeAiDumpsLeft()).toBe(2);
    await refundFreeAiDump();
    await refundFreeAiDump();
    expect(await AsyncStorage.getItem(KEY)).toBe("0");
    expect(await freeAiDumpsLeft()).toBe(3);
  });

  it("treats an unreadable stored count as used up (fail closed)", async () => {
    await AsyncStorage.setItem(KEY, "banana");
    expect(await freeAiDumpsLeft()).toBe(0);
    expect(await claimFreeAiDump()).toBeNull();
    await AsyncStorage.setItem(KEY, "-4");
    expect(await claimFreeAiDump()).toBeNull();
  });

  it("runs claims one at a time, so parallel claims never hand out more than three", async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => claimFreeAiDump()));
    expect(results).toEqual([2, 1, 0, null, null]);
    expect(await AsyncStorage.getItem(KEY)).toBe("3");
  });

  it("a refund queued behind a claim is applied after it", async () => {
    const claim = claimFreeAiDump();
    const refund = refundFreeAiDump();
    await Promise.all([claim, refund]);
    expect(await AsyncStorage.getItem(KEY)).toBe("0");
  });

  it("fails closed when storage can't be read or written, and refund never throws", async () => {
    // The storage mock's methods are jest.fns: fail the next calls only.
    const getItem = AsyncStorage.getItem as jest.Mock;
    getItem.mockRejectedValueOnce(new Error("disk"));
    expect(await freeAiDumpsLeft()).toBe(0);
    getItem.mockRejectedValueOnce(new Error("disk"));
    expect(await claimFreeAiDump()).toBeNull();
    getItem.mockRejectedValueOnce(new Error("disk"));
    await expect(refundFreeAiDump()).resolves.toBeUndefined();

    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("full"));
    expect(await claimFreeAiDump()).toBeNull();
    await AsyncStorage.setItem(KEY, "1");
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error("full"));
    await expect(refundFreeAiDump()).resolves.toBeUndefined();
    expect(await AsyncStorage.getItem(KEY)).toBe("1");
  });

  it("survives Reset all data (clearState), so a reset doesn't hand out more", async () => {
    await claimFreeAiDump();
    await claimFreeAiDump();
    await claimFreeAiDump();
    await clearState();
    expect(await claimFreeAiDump()).toBeNull();
  });

  it("says how many are left, and when that was the last one", () => {
    expect(freeAiDumpNotice(2)).toBe("Sorted by AI · 2 free sorts left.");
    expect(freeAiDumpNotice(1)).toBe("Sorted by AI · 1 free sort left.");
    expect(freeAiDumpNotice(0)).toBe(
      "That was your last free AI sort. Next time we'll use a simple split, or Plus keeps AI sorting on.",
    );
  });
});

describe("trialReminderAt", () => {
  const NOW = new Date(2026, 8, 27, 9, 0);
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();

  it("is 48 hours before the trial ends, during the day", () => {
    expect(trialReminderAt(at(4, 14, 30), NOW)).toEqual(new Date(2026, 9, 2, 14, 30));
    expect(trialReminderAt(at(4, 9), NOW)).toEqual(new Date(2026, 9, 2, 9));
    expect(trialReminderAt(at(4, 19, 59), NOW)).toEqual(new Date(2026, 9, 2, 19, 59));
  });

  it("moves a night-time reminder into 09:00–20:00", () => {
    expect(trialReminderAt(at(4, 3), NOW)).toEqual(new Date(2026, 9, 2, 9, 0, 0, 0));
    expect(trialReminderAt(at(4, 8, 59), NOW)).toEqual(new Date(2026, 9, 2, 9, 0, 0, 0));
    expect(trialReminderAt(at(4, 20), NOW)).toEqual(new Date(2026, 9, 2, 20, 0, 0, 0));
    expect(trialReminderAt(at(4, 20, 30), NOW)).toEqual(new Date(2026, 9, 2, 20, 0, 0, 0));
    expect(trialReminderAt(at(4, 23, 45), NOW)).toEqual(new Date(2026, 9, 2, 20, 0, 0, 0));
  });

  it("crosses a month boundary", () => {
    expect(trialReminderAt(at(1, 12), NOW)).toEqual(new Date(2026, 8, 29, 12));
  });

  it("is null when that moment has passed, or the date is missing or invalid", () => {
    const end = new Date(2026, 8, 29, 12).toISOString(); // reminder: today 12:00
    expect(trialReminderAt(end, NOW)).toEqual(new Date(2026, 8, 27, 12));
    expect(trialReminderAt(end, new Date(2026, 8, 27, 12))).toBeNull();
    expect(trialReminderAt(end, new Date(2026, 8, 27, 12, 0, 1))).toBeNull();
    expect(trialReminderAt(new Date(2026, 8, 28).toISOString(), NOW)).toBeNull();
    expect(trialReminderAt(null, NOW)).toBeNull();
    expect(trialReminderAt("", NOW)).toBeNull();
    expect(trialReminderAt("not a date", NOW)).toBeNull();
  });
});

describe("syncTrialReminder", () => {
  const NOW = new Date(2026, 8, 27, 9, 0);
  const END = new Date(2026, 9, 4, 18, 30).toISOString();
  const REMIND = new Date(2026, 9, 2, 18, 30);

  it("cancels any old reminder first, then schedules one with a fixed id", async () => {
    const order: string[] = [];
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockImplementation(async () => {
      order.push("cancel");
    });
    (Notifications.scheduleNotificationAsync as jest.Mock).mockImplementation(async () => {
      order.push("schedule");
      return "id";
    });
    await syncTrialReminder(END, NOW);
    expect(order).toEqual(["cancel", "schedule"]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(TRIAL_REMINDER_ID);
    expect(TRIAL_REMINDER_ID).toBe("plus-trial-ending");
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: "plus-trial-ending",
      content: {
        title: "Your Plus trial ends in 2 days",
        body: expect.stringMatching(
          /^Your Plus trial ends .+\. After that it renews automatically\. To stop it, cancel in iPhone Settings › your name › Subscriptions at least a day before\.$/,
        ),
      },
      trigger: { type: "date", date: REMIND },
    });
  });

  it.each([
    ["no trial", null],
    ["a trial too short for the heads-up", new Date(2026, 8, 28).toISOString()],
  ])("only cancels with %s", async (_why, end) => {
    await syncTrialReminder(end, NOW);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith("plus-trial-ending");
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("never throws when notifications fail", async () => {
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockRejectedValueOnce(new Error("no"));
    await expect(syncTrialReminder(END, NOW)).resolves.toBeUndefined();
    (Notifications.scheduleNotificationAsync as jest.Mock).mockRejectedValueOnce(new Error("denied"));
    await expect(syncTrialReminder(END, NOW)).resolves.toBeUndefined();
  });
});

describe("trialEndsAt", () => {
  const info = (plus: object | undefined) => ({ entitlements: { active: plus ? { plus } : {} } }) as never;
  const TRIAL = { periodType: "TRIAL", expirationDate: "2026-10-04T12:00:00Z", willRenew: true };

  it("is the expiration date only on a TRIAL period that will renew", () => {
    expect(trialEndsAt(info(TRIAL))).toBe("2026-10-04T12:00:00Z");
    expect(trialEndsAt(info({ ...TRIAL, periodType: "NORMAL" }))).toBeNull();
    expect(trialEndsAt(info({ ...TRIAL, periodType: "INTRO" }))).toBeNull();
    expect(trialEndsAt(info({ ...TRIAL, expirationDate: null }))).toBeNull();
    expect(trialEndsAt(info(undefined))).toBeNull();
    expect(trialEndsAt(null)).toBeNull();
    expect(trialEndsAt(undefined)).toBeNull();
  });

  it("is null once the trial was cancelled, or when it's family shared", () => {
    expect(trialEndsAt(info({ ...TRIAL, willRenew: false }))).toBeNull();
    expect(trialEndsAt(info({ ...TRIAL, unsubscribeDetectedAt: "2026-09-28T00:00:00Z" }))).toBeNull();
    expect(trialEndsAt(info({ ...TRIAL, ownershipType: "FAMILY_SHARED" }))).toBeNull();
    expect(trialEndsAt(info({ ...TRIAL, ownershipType: "PURCHASED" }))).toBe("2026-10-04T12:00:00Z");
  });
});

describe("lapsedAt", () => {
  const NOW = Date.parse("2026-09-27T12:00:00Z");
  const info = (plus: object | undefined) => ({ entitlements: { all: plus ? { plus } : {}, active: {} } }) as never;
  const EXPIRED = { isActive: false, expirationDate: "2026-09-20T12:00:00Z", billingIssueDetectedAt: null };

  it("is the expiry of an inactive, expired Plus entitlement", () => {
    expect(lapsedAt(info(EXPIRED), NOW)).toBe("2026-09-20T12:00:00Z");
  });

  it("is null when Plus is active, never existed, is in a billing retry, or hasn't expired yet", () => {
    expect(lapsedAt(info({ ...EXPIRED, isActive: true }), NOW)).toBeNull();
    expect(lapsedAt(info(undefined), NOW)).toBeNull();
    expect(lapsedAt(null, NOW)).toBeNull();
    expect(lapsedAt(info({ ...EXPIRED, billingIssueDetectedAt: "2026-09-19T00:00:00Z" }), NOW)).toBeNull();
    expect(lapsedAt(info({ ...EXPIRED, expirationDate: "2026-09-28T12:00:00Z" }), NOW)).toBeNull();
    expect(lapsedAt(info({ ...EXPIRED, expirationDate: "2026-09-27T12:00:00Z" }), NOW)).toBeNull();
    expect(lapsedAt(info({ ...EXPIRED, expirationDate: null }), NOW)).toBeNull();
    expect(lapsedAt(info({ ...EXPIRED, expirationDate: "garbage" }), NOW)).toBeNull();
  });
});
