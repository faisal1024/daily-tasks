// The focus session's end notification (1.2, per session since 1.3):
// scheduled only with permission, with the 5 more minutes / Done category
// (a starter's: Keep going / Mark done),
// cancel wins over an earlier schedule, never shown in-app, and never touched
// by the reminder syncs.
import * as Notifications from "expo-notifications";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  dismissNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;

type NotificationsModule = typeof import("@/lib/daily-tasks/notifications");
// A fresh module each test: the handler is set once per module, and the
// schedule/cancel queue is module state.
function load(): NotificationsModule {
  let mod: NotificationsModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh copy per test
    mod = require("@/lib/daily-tasks/notifications");
  });
  return mod!;
}

const AT = new Date(2026, 8, 26, 9, 10);
const INPUT = {
  sessionId: "s1",
  taskId: "t0",
  kind: "timer" as const,
  at: AT,
  title: "Walk",
  body: "Time's up. 5 more minutes, or mark it done?",
};

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getPermissionsAsync.mockResolvedValue({ status: "granted", granted: true } as never);
});

describe("focus timer notification", () => {
  it("schedules one with the check-in's copy, the default sound, its category and session, at the end time", async () => {
    const { scheduleFocusSessionNotification, FOCUS_TIMER_NOTIFICATION_ID, FOCUS_CATEGORY_ID } = load();
    await scheduleFocusSessionNotification(INPUT);
    // Extend on the left, Done on the right (as everywhere else).
    expect(mocked.setNotificationCategoryAsync).toHaveBeenCalledWith(FOCUS_CATEGORY_ID, [
      { identifier: "focus-extend", buttonTitle: "5 more minutes", options: { opensAppToForeground: true } },
      { identifier: "focus-done", buttonTitle: "Mark done", options: { opensAppToForeground: true } },
    ]);
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: FOCUS_TIMER_NOTIFICATION_ID,
      content: {
        title: "Walk",
        body: "Time's up. 5 more minutes, or mark it done?",
        sound: true,
        categoryIdentifier: FOCUS_CATEGORY_ID,
        data: { focusSessionId: "s1", taskId: "t0" },
      },
      trigger: { type: "date", date: AT },
    });
    // One that already went off (before an extend) is cleared first.
    expect(mocked.dismissNotificationAsync).toHaveBeenCalledWith(FOCUS_TIMER_NOTIFICATION_ID);
  });

  // R1 (1.3 polish): a starter's notification had the timer's "5 more
  // minutes"; it has its own category now, Keep going / Mark done.
  it("gives a starter's notification the Keep going / Mark done category", async () => {
    const { scheduleFocusSessionNotification, FOCUS_STARTER_CATEGORY_ID } = load();
    await scheduleFocusSessionNotification({ ...INPUT, kind: "starter", body: "5 minutes in. Keep going?" });
    expect(FOCUS_STARTER_CATEGORY_ID).toBe("three-today:focus-starter");
    expect(mocked.setNotificationCategoryAsync).toHaveBeenCalledWith(FOCUS_STARTER_CATEGORY_ID, [
      { identifier: "focus-keep-going", buttonTitle: "Keep going", options: { opensAppToForeground: true } },
      { identifier: "focus-done", buttonTitle: "Mark done", options: { opensAppToForeground: true } },
    ]);
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          title: "Walk",
          body: "5 minutes in. Keep going?",
          categoryIdentifier: FOCUS_STARTER_CATEGORY_ID,
        }),
      }),
    );
  });

  it("is skipped without permission, and never asks for it", async () => {
    mocked.getPermissionsAsync.mockResolvedValue({ status: "undetermined", granted: false, canAskAgain: true } as never);
    const { scheduleFocusSessionNotification } = load();
    await scheduleFocusSessionNotification(INPUT);
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("a cancel queued right after a schedule wins: nothing is left scheduled", async () => {
    const { scheduleFocusSessionNotification, cancelFocusTimerNotification, FOCUS_TIMER_NOTIFICATION_ID } = load();
    const scheduled = scheduleFocusSessionNotification(INPUT);
    const cancelled = cancelFocusTimerNotification();
    await Promise.all([scheduled, cancelled]);
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith(FOCUS_TIMER_NOTIFICATION_ID);
  });

  it("cancel also clears one that already went off (errors swallowed)", async () => {
    mocked.dismissNotificationAsync.mockRejectedValueOnce(new Error("none"));
    const { cancelFocusTimerNotification, FOCUS_TIMER_NOTIFICATION_ID } = load();
    await expect(cancelFocusTimerNotification()).resolves.toBeUndefined();
    expect(mocked.dismissNotificationAsync).toHaveBeenCalledWith(FOCUS_TIMER_NOTIFICATION_ID);
  });

  it("the handler hides only the focus notification in-app, and plays only its sound", async () => {
    const { scheduleFocusSessionNotification, FOCUS_TIMER_NOTIFICATION_ID } = load();
    await scheduleFocusSessionNotification(INPUT);
    const handler = mocked.setNotificationHandler.mock.calls[0][0]!;
    const handle = (identifier: string) =>
      handler.handleNotification({ request: { identifier } } as Notifications.Notification);
    await expect(handle(FOCUS_TIMER_NOTIFICATION_ID)).resolves.toMatchObject({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: true,
    });
    await expect(handle("daily-tasks:2026-09-26:nudge:0900")).resolves.toMatchObject({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
    });
  });

  it("the reminders' cancel-all leaves the focus notification alone", async () => {
    const { cancelAllNotifications, FOCUS_TIMER_NOTIFICATION_ID } = load();
    mocked.getAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: FOCUS_TIMER_NOTIFICATION_ID },
      { identifier: "daily-tasks:2026-09-26:nudge:0900" },
    ] as never);
    await cancelAllNotifications();
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith("daily-tasks:2026-09-26:nudge:0900");
  });
});

describe("focus notification responses (1.3)", () => {
  function response(actionIdentifier: string, overrides: { identifier?: string; data?: unknown; date?: number } = {}) {
    return {
      actionIdentifier,
      notification: {
        date: overrides.date ?? 1000,
        request: {
          identifier: overrides.identifier ?? "three-today:focus-timer",
          content: { data: "data" in overrides ? overrides.data : { focusSessionId: "s1", taskId: "t0" } },
        },
      },
    } as unknown as Notifications.NotificationResponse;
  }

  it("parses Done, 5 more minutes and a plain tap; anything else (another notification, no session) is null", () => {
    const { parseFocusResponse } = load();
    expect(parseFocusResponse(response("focus-done"))).toEqual({ action: "done", sessionId: "s1" });
    expect(parseFocusResponse(response("focus-extend"))).toEqual({ action: "extend", sessionId: "s1" });
    expect(parseFocusResponse(response("focus-keep-going"))).toEqual({ action: "keepGoing", sessionId: "s1" });
    expect(parseFocusResponse(response("expo.modules.notifications.actions.DEFAULT"))).toEqual({
      action: "open",
      sessionId: "s1",
    });
    expect(parseFocusResponse(response("focus-done", { identifier: "daily-tasks:2026-09-26:nudge:0900" }))).toBeNull();
    expect(parseFocusResponse(response("focus-done", { data: {} }))).toBeNull();
    expect(parseFocusResponse(null)).toBeNull();
  });

  it("hands over the tap that launched the app once, clears it, and ignores the same tap arriving again", () => {
    const launch = response("focus-done");
    mocked.getLastNotificationResponse.mockReturnValue(launch);
    const { subscribeFocusResponses } = load();
    const listener = jest.fn();
    const unsubscribe = subscribeFocusResponses(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ action: "done", sessionId: "s1" });
    expect(mocked.clearLastNotificationResponse).toHaveBeenCalledTimes(1);

    // The same tap also reaches the live listener: passed on only once.
    const live = mocked.addNotificationResponseReceivedListener.mock.calls[0][0];
    live(launch);
    expect(listener).toHaveBeenCalledTimes(1);
    // A new tap (a later notification) is passed on; other notifications aren't.
    live(response("focus-extend", { date: 2000 }));
    live(response("focus-done", { identifier: "daily-tasks:2026-09-26:nudge:0900", date: 3000 }));
    expect(listener.mock.calls).toEqual([
      [{ action: "done", sessionId: "s1" }],
      [{ action: "extend", sessionId: "s1" }],
    ]);

    unsubscribe();
    const subscription = mocked.addNotificationResponseReceivedListener.mock.results[0].value as { remove: jest.Mock };
    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });

  it("with no launch tap, nothing is handed over until one arrives", () => {
    mocked.getLastNotificationResponse.mockReturnValue(null);
    const { subscribeFocusResponses } = load();
    const listener = jest.fn();
    subscribeFocusResponses(listener);
    expect(listener).not.toHaveBeenCalled();
    expect(mocked.clearLastNotificationResponse).not.toHaveBeenCalled();
  });
});
