// The reminder scheduler (1.4, PR #89): a sync schedules its plan and then
// cancels only the pending notifications it owns (ids under "daily-tasks:")
// that are no longer in it, leaves the focus timer's end and the trial
// reminder alone, and counts them towards iOS's limit of 64.
import * as Notifications from "expo-notifications";

import type { PendingReminder, ReminderContext, ReminderPlan } from "@/lib/daily-tasks/reminder-plan";
import { TRIAL_REMINDER_ID } from "@/lib/daily-tasks/trial-reminder";
import { DEFAULT_NOTIFICATIONS } from "@/lib/daily-tasks/types";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  dismissNotificationAsync: jest.fn(async () => {}),
  dismissAllNotificationsAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(async () => null),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const mocked = Notifications as jest.Mocked<typeof Notifications> & {
  cancelAllScheduledNotificationsAsync: jest.Mock;
  dismissAllNotificationsAsync: jest.Mock;
};

type NotificationsModule = typeof import("@/lib/daily-tasks/notifications");
/** The app's state as the freshly loaded module sees it. */
let appState: { currentState: unknown };
/** A fresh module each test: the sync queue (and what it remembers) is module state. */
function load(): NotificationsModule {
  let mod: NotificationsModule | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh copy per test
    appState = require("react-native").AppState;
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh copy per test
    mod = require("@/lib/daily-tasks/notifications");
  });
  appState.currentState = "background";
  return mod!;
}

// Monday 12 October 2026, 09:05 local.
const NOW = new Date(2026, 9, 12, 9, 5);
const FOCUS_ID = "three-today:focus-timer";
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

interface Request {
  identifier: string;
  content: { title: string; body: string; data?: Record<string, unknown>; sound?: unknown; interruptionLevel?: unknown };
  trigger: { type: string; date: Date };
}

/**
 * A pending request as iOS reports it. expo-notifications schedules a one-off
 * date as a time interval (ios/EXNotifications/Notifications/Records.swift,
 * DateTriggerRecord), so it comes back as seconds counted from when it was
 * scheduled: its time can't be read from the trigger, only from its data.
 */
const asIosPending = (request: Request): object => ({
  identifier: request.identifier,
  content: { ...request.content, subtitle: null, sound: null },
  trigger: { type: "timeInterval", seconds: Math.max(1, Math.round((request.trigger.date.getTime() - NOW.getTime()) / 1000)), repeats: false },
});
/** The same request as if it had been scheduled for `date`. */
const at = (request: Request, date: Date): Request => ({
  ...request,
  content: { ...request.content, data: { ...request.content.data, fireAt: date.getTime() } },
  trigger: { type: "date", date },
});
/** The same on Android: a timestamp. */
const asAndroidPending = (request: Request): object => ({
  identifier: request.identifier,
  content: request.content,
  trigger: { type: "date", value: request.trigger.date.getTime() },
});

const pending = (requests: (string | object)[]) =>
  mocked.getAllScheduledNotificationsAsync.mockResolvedValue(
    requests.map((request) =>
      typeof request === "string" ? { identifier: request, content: { title: "old", body: "old" }, trigger: null } : request,
    ) as never,
  );
const presented = (items: { id: string; date?: number }[]) =>
  mocked.getPresentedNotificationsAsync.mockResolvedValue(
    items.map(({ id, date = NOW.getTime() / 1000 - 60 }) => ({ date, request: { identifier: id, content: {}, trigger: null } })) as never,
  );
const scheduledRequests = () => mocked.scheduleNotificationAsync.mock.calls.map(([request]) => request as unknown as Request);
const scheduledIds = () => scheduledRequests().map((request) => request.identifier);
const cancelledIds = () => mocked.cancelScheduledNotificationAsync.mock.calls.map(([id]) => id);
const dismissedIds = () => mocked.dismissNotificationAsync.mock.calls.map(([id]) => id);
type Calls = { mock: { invocationCallOrder: number[] } };
const firstOrder = (mock: Calls) => Math.min(...mock.mock.invocationCallOrder);
const lastOrder = (mock: Calls) => Math.max(...mock.mock.invocationCallOrder);

/** `count` owned reminders a minute apart, latest first. */
const bigPlan = (count: number): ReminderPlan =>
  Array.from({ length: count }, (_, i) => ({
    id: `daily-tasks:test:${String(i).padStart(3, "0")}`,
    fireAt: minutes(i + 1),
    title: "A small nudge",
    body: `Body ${i}`,
  })).reverse();

const TASKS = [
  { id: "t0", text: "Call the dentist", done: true },
  { id: "t1", text: "Walk", done: false },
];
const input = (overrides: Partial<Parameters<NotificationsModule["syncNotifications"]>[0]> = {}) => ({
  now: NOW,
  today: "2026-10-12",
  settings: DEFAULT_NOTIFICATIONS,
  permissionState: "granted" as const,
  tasks: TASKS,
  locked: false,
  yesterdayOpen: [],
  ...overrides,
});

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mocked.scheduleNotificationAsync.mockImplementation(async () => "id");
  mocked.cancelScheduledNotificationAsync.mockImplementation(async () => {});
  mocked.dismissNotificationAsync.mockImplementation(async () => {});
  pending([]);
  presented([]);
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("a reminder sync and the notifications it doesn't own", () => {
  it("schedules the plan, then cancels only its own stale reminders: the focus timer and the trial reminder survive", async () => {
    const { syncNotifications, FOCUS_TIMER_NOTIFICATION_ID } = load();
    expect(FOCUS_TIMER_NOTIFICATION_ID).toBe(FOCUS_ID);
    expect(TRIAL_REMINDER_ID).toBe("plus-trial-ending");
    pending([
      // In the new plan too: replaced by scheduling the same id, never cancelled.
      "daily-tasks:2026-10-12:progress:1000",
      FOCUS_ID,
      // No longer in the plan.
      "daily-tasks:2026-10-11:evening:2200",
      "daily-tasks:2026-10-12:morning:0900",
      TRIAL_REMINDER_ID,
      "someone-elses",
      // Close, but not the prefix.
      "daily-tasks",
      "x-daily-tasks:2026-10-12:progress:1000",
    ]);

    await syncNotifications(input());

    expect(cancelledIds().sort()).toEqual(["daily-tasks:2026-10-11:evening:2200", "daily-tasks:2026-10-12:morning:0900"]);
    // Schedule first, cancel after: there is never a moment with nothing pending.
    expect(lastOrder(mocked.scheduleNotificationAsync)).toBeLessThan(firstOrder(mocked.cancelScheduledNotificationAsync));
    expect(mocked.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(mocked.dismissAllNotificationsAsync).not.toHaveBeenCalled();
    expect(mocked.dismissNotificationAsync).not.toHaveBeenCalled();
    // Everything it schedules is its own, one per id, with the task in the next one.
    const ids = scheduledIds();
    expect(ids).toHaveLength(16);
    expect(new Set(ids).size).toBe(16);
    expect(ids.every((id) => id.startsWith("daily-tasks:"))).toBe(true);
    const [next] = scheduledRequests();
    expect(next.identifier).toBe("daily-tasks:2026-10-12:progress:1000");
    expect(next.trigger).toEqual({ type: "date", date: new Date(2026, 9, 12, 10, 0) });
    expect(`${next.content.title} | ${next.content.body}`).toMatch(/One to go: Walk|Just one left: Walk\./);
    // The task's id, the reminder's kind and its own time ride along; never the words.
    expect(next.content.data).toEqual({ taskId: "t1", kind: "progress", fireAt: next.trigger.date.getTime() });
    expect(Object.keys(next.content).sort()).toEqual(["body", "data", "title"]);
    for (const request of scheduledRequests()) {
      expect(JSON.stringify(request.content.data)).not.toMatch(/dentist|Walk/);
    }
  });

  it("with reminders off, still cancels only its own", async () => {
    const { syncNotifications, cancelAllNotifications } = load();
    pending(["daily-tasks:2026-10-12:progress:1000", FOCUS_ID, TRIAL_REMINDER_ID]);
    await syncNotifications(input({ settings: { ...DEFAULT_NOTIFICATIONS, enabled: false } }));
    await cancelAllNotifications();
    expect(new Set(cancelledIds())).toEqual(new Set(["daily-tasks:2026-10-12:progress:1000"]));
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("counts the ones that aren't its own towards 64, and keeps the soonest that fit", async () => {
    const { applyReminderPlan, syncNotifications } = load();
    const others = [FOCUS_ID, TRIAL_REMINDER_ID, "other:1", "other:2", "other:3"];
    // 40 stale reminders of its own are replaced, so they don't count.
    pending([...others, ...Array.from({ length: 40 }, (_, i) => `daily-tasks:old:${i}`)]);

    await applyReminderPlan(bigPlan(80), NOW);

    expect(cancelledIds()).toHaveLength(40);
    expect(cancelledIds().every((id) => id.startsWith("daily-tasks:old:"))).toBe(true);
    // 64 - 5 others = 59, the soonest first.
    expect(scheduledIds()).toEqual(Array.from({ length: 59 }, (_, i) => `daily-tasks:test:${String(i).padStart(3, "0")}`));
    // Old and new together (5 + 40 + 59) would not fit under 64, so here
    // the old ones go first: iOS would silently drop some of the new.
    expect(lastOrder(mocked.cancelScheduledNotificationAsync)).toBeLessThan(firstOrder(mocked.scheduleNotificationAsync));

    // Only the focus timer and the trial reminder pending (or nothing): two stay free.
    for (const ids of [[FOCUS_ID, TRIAL_REMINDER_ID], [FOCUS_ID], []]) {
      mocked.scheduleNotificationAsync.mockClear();
      pending(ids);
      await syncNotifications(input({ tasks: [], strategy: () => bigPlan(80) }));
      expect(scheduledIds()).toHaveLength(62);
      expect(scheduledIds()[61]).toBe("daily-tasks:test:061");
    }

    // 63 others: room for one.
    mocked.scheduleNotificationAsync.mockClear();
    pending(Array.from({ length: 63 }, (_, i) => `other:${i}`));
    await applyReminderPlan(bigPlan(80), NOW);
    expect(scheduledIds()).toEqual(["daily-tasks:test:000"]);
  });

  it("a plan can't schedule or replace an id outside the prefix", async () => {
    const { applyReminderPlan } = load();
    pending([FOCUS_ID]);
    await applyReminderPlan(
      [
        { id: FOCUS_ID, fireAt: minutes(1), title: "x", body: "x" },
        { id: TRIAL_REMINDER_ID, fireAt: minutes(1), title: "x", body: "x" },
        { id: "daily-tasks:ok", fireAt: minutes(1), title: "x", body: "x" },
      ],
      NOW,
    );
    expect(scheduledIds()).toEqual(["daily-tasks:ok"]);
    expect(cancelledIds()).toEqual([]);
  });
});

describe("what is already pending", () => {
  it.each([
    ["iOS (a time interval: the time is in its data)", asIosPending],
    ["Android (a timestamp)", asAndroidPending],
  ])("a reminder that already says the same at the same time is left alone: %s", async (_label, asPending) => {
    const { syncNotifications } = load();
    await syncNotifications(input());
    const first = scheduledRequests();
    expect(first).toHaveLength(16);

    // The same sync again, with those now pending: nothing to do.
    mocked.scheduleNotificationAsync.mockClear();
    pending([...first.map(asPending), FOCUS_ID]);
    await syncNotifications(input());
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mocked.cancelScheduledNotificationAsync).not.toHaveBeenCalled();

    // One whose words, and one whose time, no longer match: only those are rewritten.
    const reworded = asPending({ ...first[2], content: { ...first[2].content, body: "Something older" } });
    const retimed = asPending(at(first[4], minutes(3)));
    // One from before reminders carried their time (or one whose data was lost).
    const untimed = { ...asPending(first[6]), content: { ...first[6].content, data: { kind: "evening" } }, trigger: null };
    pending(first.map((request, i) => (i === 2 ? reworded : i === 4 ? retimed : i === 6 ? untimed : asPending(request))));
    await syncNotifications(input());
    expect(scheduledIds()).toEqual([first[2].identifier, first[4].identifier, first[6].identifier]);
    expect(scheduledRequests()[0]).toEqual(first[2]);
    expect(mocked.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it("reads a pending trigger's time, or null when it can't be told", () => {
    const { pendingFireAt } = load();
    const at = new Date(2026, 9, 12, 14, 0, 0);
    expect(pendingFireAt({ type: "date", value: at.getTime() })).toEqual(at);
    expect(pendingFireAt({ type: "date", value: at })).toEqual(at);
    expect(
      pendingFireAt({ type: "calendar", repeats: false, dateComponents: { year: 2026, month: 10, day: 12, hour: 14, minute: 0, second: 0 } }),
    ).toEqual(at);
    expect(pendingFireAt({ type: "calendar", dateComponents: { year: 2026, month: 10, day: 12, hour: 14, minute: 0 } })).toEqual(at);
    for (const unknown of [
      null,
      undefined,
      "soon",
      {},
      { type: "timeInterval", seconds: 60 },
      { type: "calendar", dateComponents: { hour: 8, minute: 0 } },
      { type: "date", value: "tomorrow" },
      { type: "date", value: Number.NaN },
    ]) {
      expect(pendingFireAt(unknown)).toBeNull();
    }
  });

  it("hands the strategy what is pending (its own, soonest first) and when one last went off", async () => {
    const { syncNotifications } = load();
    const seen: Pick<ReminderContext, "pending" | "lastDeliveredAt">[] = [];
    const keep = (extra: ReminderPlan = []) =>
      jest.fn(async (context: ReminderContext) => {
        seen.push({ pending: context.pending, lastDeliveredAt: context.lastDeliveredAt });
        // Keep whatever random times were already chosen; add any new ones.
        const kept = context.pending
          .filter((item: PendingReminder) => item.fireAt)
          .map((item) => ({ id: item.id, fireAt: item.fireAt as Date, title: item.title, body: item.body }));
        return [...kept, ...extra];
      });

    // Nothing pending, nothing delivered.
    await syncNotifications(input({ strategy: keep([{ id: "daily-tasks:nag:a", fireAt: minutes(2), title: "Nag", body: "a" }]) }));
    expect(seen[0]).toEqual({ pending: [], lastDeliveredAt: null });
    const [a] = scheduledRequests();

    // Three minutes on, "a" is no longer pending: it went off at its time.
    mocked.scheduleNotificationAsync.mockClear();
    const later = { id: "daily-tasks:nag:c", fireAt: minutes(50), title: "Nag", body: "c" };
    const sooner = { id: "daily-tasks:nag:b", fireAt: minutes(20), title: "Nag", body: "b" };
    pending([FOCUS_ID]);
    await syncNotifications(input({ now: minutes(3), strategy: keep([later, sooner]) }));
    expect(seen[1]).toEqual({ pending: [], lastDeliveredAt: a.trigger.date });
    const [b, c] = scheduledRequests();
    expect([b.identifier, c.identifier]).toEqual(["daily-tasks:nag:b", "daily-tasks:nag:c"]);

    // Next sync: both are pending and kept as they are (no re-roll, nothing rescheduled).
    mocked.scheduleNotificationAsync.mockClear();
    pending([asIosPending(c), FOCUS_ID, asIosPending(b)]);
    await syncNotifications(input({ now: minutes(4), strategy: keep() }));
    expect(seen[2].pending).toEqual([
      { id: "daily-tasks:nag:b", fireAt: minutes(20), title: "Nag", body: "b", data: { fireAt: minutes(20).getTime() } },
      { id: "daily-tasks:nag:c", fireAt: minutes(50), title: "Nag", body: "c", data: { fireAt: minutes(50).getTime() } },
    ]);
    expect(seen[2].lastDeliveredAt).toEqual(a.trigger.date);
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mocked.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it("one still in Notification Center counts as the last delivery (iOS reports seconds)", async () => {
    const { syncNotifications } = load();
    const strategy = jest.fn(async (_context: ReminderContext) => [] as ReminderPlan);
    const wentOff = minutes(-25);
    presented([
      { id: "daily-tasks:2026-10-12:progress:0800", date: minutes(-65).getTime() / 1000 },
      { id: "daily-tasks:2026-10-12:progress:0900", date: wentOff.getTime() / 1000 },
      // Not ours: ignored.
      { id: FOCUS_ID, date: minutes(-1).getTime() / 1000 },
    ]);
    await syncNotifications(input({ strategy }));
    expect(strategy.mock.calls[0][0].lastDeliveredAt).toEqual(wentOff);
    // Android reports milliseconds.
    presented([{ id: "daily-tasks:x", date: minutes(-5).getTime() }]);
    await syncNotifications(input({ strategy }));
    expect(strategy.mock.calls[1][0].lastDeliveredAt).toEqual(minutes(-5));
  });
});

describe("a plan item's extras", () => {
  it("data, kind, interruption level and sound are passed on; silent and plain without them", async () => {
    const { applyReminderPlan } = load();
    await applyReminderPlan(
      [
        {
          id: "daily-tasks:nag:1",
          fireAt: minutes(5),
          title: "Nag\nmode",
          body: "Line one\tline two",
          data: { taskId: "t1" },
          kind: "nag",
          interruptionLevel: "timeSensitive",
          sound: true,
        },
        { id: "daily-tasks:nag:2", fireAt: minutes(6), title: "Plain", body: "Plain", sound: "chime.wav" },
        { id: "daily-tasks:nag:3", fireAt: minutes(7), title: "Bare", body: "Bare" },
      ],
      NOW,
    );
    expect(scheduledRequests().map((request) => request.content)).toEqual([
      // Cleaned on the way in, whichever strategy wrote it.
      { title: "Nag mode", body: "Line one line two", data: { taskId: "t1", kind: "nag", fireAt: minutes(5).getTime() }, sound: true, interruptionLevel: "timeSensitive" },
      // Its own time always rides along: iOS doesn't report a pending one's date back.
      { title: "Plain", body: "Plain", data: { fireAt: minutes(6).getTime() }, sound: "chime.wav" },
      { title: "Bare", body: "Bare", data: { fireAt: minutes(7).getTime() } },
    ]);
  });

  it("waits for an async strategy; one that fails changes nothing and the next sync still runs", async () => {
    const { syncNotifications } = load();
    pending(["daily-tasks:old"]);
    await expect(
      syncNotifications(
        input({
          strategy: async () => {
            throw new Error("offline");
          },
        }),
      ),
    ).rejects.toThrow("offline");
    expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mocked.cancelScheduledNotificationAsync).not.toHaveBeenCalled();

    await syncNotifications(
      input({
        strategy: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [{ id: "daily-tasks:slow", fireAt: minutes(5), title: "Slow", body: "Slow" }];
        },
      }),
    );
    expect(scheduledIds()).toEqual(["daily-tasks:slow"]);
    expect(cancelledIds()).toEqual(["daily-tasks:old"]);
  });
});

describe("when the system says no", () => {
  it("one rejected schedule doesn't stop the rest, and the log has ids only", async () => {
    const { syncNotifications } = load();
    const failing = "daily-tasks:2026-10-12:progress:1200";
    mocked.scheduleNotificationAsync.mockImplementation(async (request) => {
      if ((request as unknown as Request).identifier === failing) throw new Error("nope");
      return "id";
    });
    pending(["daily-tasks:2026-10-11:evening:2200"]);

    await expect(syncNotifications(input())).resolves.toBeUndefined();

    expect(mocked.scheduleNotificationAsync).toHaveBeenCalledTimes(16);
    // The stale one is still cancelled afterwards; the failed one wasn't pending, so nothing to remove.
    expect(cancelledIds()).toEqual(["daily-tasks:2026-10-11:evening:2200"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(failing);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/Walk|dentist/);
  });

  it("a rejected replacement removes the out-of-date one it was meant to replace", async () => {
    const { syncNotifications } = load();
    const failing = "daily-tasks:2026-10-12:progress:1200";
    mocked.scheduleNotificationAsync.mockImplementation(async (request) => {
      if ((request as unknown as Request).identifier === failing) throw new Error("nope");
      return "id";
    });
    // Pending with older words (say, a task's name from before names were hidden).
    pending([failing]);
    await syncNotifications(input({ settings: { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true } }));
    expect(cancelledIds()).toEqual([failing]);
    expect(scheduledIds()).toHaveLength(16);
  });

  it("one rejected cancel doesn't stop the others or fail the sync", async () => {
    const { syncNotifications, cancelAllNotifications } = load();
    mocked.cancelScheduledNotificationAsync.mockImplementation(async (id) => {
      if (id === "daily-tasks:old:1") throw new Error("nope");
    });
    pending(["daily-tasks:old:0", "daily-tasks:old:1", "daily-tasks:old:2", FOCUS_ID]);
    await expect(syncNotifications(input())).resolves.toBeUndefined();
    expect(cancelledIds().sort()).toEqual(["daily-tasks:old:0", "daily-tasks:old:1", "daily-tasks:old:2"]);
    expect(scheduledIds()).toHaveLength(16);
    expect(String(warn.mock.calls[0][0])).toContain("daily-tasks:old:1");

    mocked.cancelScheduledNotificationAsync.mockClear();
    await expect(cancelAllNotifications()).resolves.toBeUndefined();
    expect(cancelledIds()).toHaveLength(3);
  });
});

describe("reminders that already went off", () => {
  const delivered = [
    { id: "daily-tasks:2026-10-12:progress:0800" },
    { id: FOCUS_ID },
    { id: TRIAL_REMINDER_ID },
    { id: "daily-tasks:2026-10-11:evening:2200" },
  ];
  const ours = ["daily-tasks:2026-10-12:progress:0800", "daily-tasks:2026-10-11:evening:2200"];

  it("are left in Notification Center while the app is in the background", async () => {
    const { syncNotifications } = load();
    presented(delivered);
    await syncNotifications(input());
    await syncNotifications(input());
    expect(mocked.dismissNotificationAsync).not.toHaveBeenCalled();
  });

  it("are cleared when the app is in front: only its own, never the focus timer's or the trial's", async () => {
    const { syncNotifications } = load();
    appState.currentState = "active";
    presented(delivered);
    await syncNotifications(input());
    expect(dismissedIds()).toEqual(ours);
    expect(mocked.dismissAllNotificationsAsync).not.toHaveBeenCalled();
  });

  it("are cleared when Hide task names is turned on, even in the background (they show names)", async () => {
    const { syncNotifications } = load();
    presented(delivered);
    await syncNotifications(input());
    expect(mocked.dismissNotificationAsync).not.toHaveBeenCalled();
    await syncNotifications(input({ settings: { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true } }));
    expect(dismissedIds()).toEqual(ours);
    // Already on: not again.
    mocked.dismissNotificationAsync.mockClear();
    await syncNotifications(input({ settings: { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true } }));
    expect(mocked.dismissNotificationAsync).not.toHaveBeenCalled();
    // Off, then on again: again.
    await syncNotifications(input());
    await syncNotifications(input({ settings: { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true } }));
    expect(dismissedIds()).toEqual(ours);
  });

  it("a failed dismiss, or no way to list them, never fails the sync", async () => {
    const { syncNotifications, applyReminderPlan } = load();
    appState.currentState = "active";
    presented(delivered);
    mocked.dismissNotificationAsync.mockRejectedValueOnce(new Error("gone"));
    await expect(syncNotifications(input())).resolves.toBeUndefined();
    expect(dismissedIds()).toEqual(ours);

    mocked.dismissNotificationAsync.mockClear();
    mocked.getPresentedNotificationsAsync.mockRejectedValue(new Error("unavailable"));
    await expect(syncNotifications(input())).resolves.toBeUndefined();
    expect(mocked.dismissNotificationAsync).not.toHaveBeenCalled();

    // Applying a plan directly clears them only when asked.
    presented(delivered);
    await applyReminderPlan([], NOW);
    expect(mocked.dismissNotificationAsync).not.toHaveBeenCalled();
    await applyReminderPlan([], NOW, { dismissDelivered: true });
    expect(dismissedIds()).toEqual(ours);
  });
});
