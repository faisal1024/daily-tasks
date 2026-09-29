// The focus session's end notification (1.2, per session since 1.3):
// scheduled only with permission, with the Done / 5 more minutes category,
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
const INPUT = { sessionId: "s1", taskId: "t0", at: AT, body: 'Time\'s up on "Walk".' };

beforeEach(() => {
  jest.clearAllMocks();
  mocked.getPermissionsAsync.mockResolvedValue({ status: "granted", granted: true } as never);
});

describe("focus timer notification", () => {
  it("schedules one with the check-in's copy, the default sound, its category and session, at the end time", async () => {
    const { scheduleFocusSessionNotification, FOCUS_TIMER_NOTIFICATION_ID, FOCUS_CATEGORY_ID } = load();
    await scheduleFocusSessionNotification(INPUT);
    expect(mocked.setNotificationCategoryAsync).toHaveBeenCalledWith(FOCUS_CATEGORY_ID, [
      { identifier: "focus-done", buttonTitle: "Done", options: { opensAppToForeground: true } },
      { identifier: "focus-extend", buttonTitle: "5 more minutes", options: { opensAppToForeground: true } },
    ]);
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
      identifier: FOCUS_TIMER_NOTIFICATION_ID,
      content: {
        title: "Three Today",
        body: 'Time\'s up on "Walk".',
        sound: true,
        categoryIdentifier: FOCUS_CATEGORY_ID,
        data: { focusSessionId: "s1", taskId: "t0" },
      },
      trigger: { type: "date", date: AT },
    });
    // One that already went off (before an extend) is cleared first.
    expect(mocked.dismissNotificationAsync).toHaveBeenCalledWith(FOCUS_TIMER_NOTIFICATION_ID);
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
