// Focus mode's end-of-timer notification (1.2): scheduled only with
// permission, cancel wins over an earlier schedule, never shown in-app, and
// never touched by the reminder syncs.
import * as Notifications from "expo-notifications";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  dismissNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getPermissionsAsync.mockResolvedValue({ status: "granted", granted: true } as never);
});

describe("focus timer notification", () => {
  it("schedules one with the screen's copy, the default sound, at the end time", async () => {
    const { scheduleFocusTimerNotification, FOCUS_TIMER_NOTIFICATION_ID } = load();
    await scheduleFocusTimerNotification(AT, 10);
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: FOCUS_TIMER_NOTIFICATION_ID,
      content: { title: "Three Today", body: "That's 10 minutes. Keep going, or take a break.", sound: true },
      trigger: { type: "date", date: AT },
    });
  });

  it("is skipped without permission, and never asks for it", async () => {
    mocked.getPermissionsAsync.mockResolvedValue({ status: "undetermined", granted: false, canAskAgain: true } as never);
    const { scheduleFocusTimerNotification } = load();
    await scheduleFocusTimerNotification(AT, 10);
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("a cancel queued right after a schedule wins: nothing is left scheduled", async () => {
    const { scheduleFocusTimerNotification, cancelFocusTimerNotification, FOCUS_TIMER_NOTIFICATION_ID } = load();
    const scheduled = scheduleFocusTimerNotification(AT, 25);
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

  it("the handler hides only the focus notification in-app", async () => {
    const { scheduleFocusTimerNotification, FOCUS_TIMER_NOTIFICATION_ID } = load();
    await scheduleFocusTimerNotification(AT, 10);
    const handler = mocked.setNotificationHandler.mock.calls[0][0]!;
    const handle = (identifier: string) =>
      handler.handleNotification({ request: { identifier } } as Notifications.Notification);
    await expect(handle(FOCUS_TIMER_NOTIFICATION_ID)).resolves.toMatchObject({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
    });
    await expect(handle("daily-tasks:2026-09-26:nudge:0900")).resolves.toMatchObject({
      shouldShowBanner: true,
      shouldShowList: true,
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
