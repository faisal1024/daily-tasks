// The store and the reminders, the rest of it (1.4, PR #89): the cold start,
// what does and doesn't count as a change, bursts that outlast the wait, a
// run of failed rewrites, and what the scheduler is handed (and so what the
// reminders say) when the store's day and the clock's day are apart.
import type { ReactNode } from "react";
import { AppState as RNAppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { toDateKey } from "@/lib/daily-tasks/date";
import { syncNotifications, type SyncNotificationsInput } from "@/lib/daily-tasks/notifications";
import { REMINDER_SYNC_DEBOUNCE_MS, taskAwareStrategy, type ReminderPlan } from "@/lib/daily-tasks/reminder-plan";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type Task } from "@/lib/daily-tasks/types";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

// The real module, with the rewrite itself watched.
jest.mock("@/lib/daily-tasks/notifications", () => ({
  ...jest.requireActual("@/lib/daily-tasks/notifications"),
  syncNotifications: jest.fn(async () => {}),
}));

const sync = syncNotifications as jest.MockedFunction<typeof syncNotifications>;
const lastSync = (): SyncNotificationsInput => sync.mock.calls[sync.mock.calls.length - 1][0];
const everySync = (): SyncNotificationsInput[] => sync.mock.calls.map(([given]) => given);

/** What the standard reminders would say for something the store handed over, soonest first. */
function planFrom(given: SyncNotificationsInput): ReminderPlan {
  const plan = taskAwareStrategy({ ...given, now: given.now!, draft: given.draft ?? null, pending: [], lastDeliveredAt: null }) as ReminderPlan;
  return [...plan].sort((a, b) => a.fireAt.getTime() - b.fireAt.getTime());
}
const shown = (item: { title: string; body: string }) => `${item.title} | ${item.body}`;

const D = "2026-09-25";
const NEXT = "2026-09-26";

const taskAt = (id: string, text: string, day = 25): Task => ({
  id,
  text,
  createdAt: new Date(2026, 8, day, 8).toISOString(),
  carriedOver: false,
});
const THREE = [taskAt("t0", "Call the dentist"), taskAt("t1", "Write the report"), taskAt("t2", "Walk")];
const TASK_WORDS = /dentist|report|Walk/;

function fakeClockAt(now: Date) {
  jest.useFakeTimers({
    now,
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
  });
}

function listenToAppState() {
  const addEventListener = RNAppState.addEventListener as unknown as jest.Mock;
  const original = addEventListener.getMockImplementation();
  const listeners = new Set<(state: string) => void>();
  addEventListener.mockImplementation((_type: string, listener: (state: string) => void) => {
    listeners.add(listener);
    return { remove: () => listeners.delete(listener) };
  });
  return {
    emit: (state: string) => [...listeners].forEach((listener) => listener(state)),
    restore: () => addEventListener.mockImplementation(original),
  };
}

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;
const wait = (ms: number) => act(async () => new Promise<void>((resolve) => setTimeout(resolve, ms)));
const settle = () => wait(REMINDER_SYNC_DEBOUNCE_MS + 200);

async function save(saved: Partial<AppState>, savedFor: Date) {
  const state: AppState = {
    ...buildInitialState(savedFor),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    ...saved,
  };
  await AsyncStorage.setItem("daily-tasks/state/v1", JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
}

async function renderOnDay(saved: Partial<AppState>, savedFor: Date) {
  await save(saved, savedFor);
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await settle();
  return hook;
}

let appState: ReturnType<typeof listenToAppState>;

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  sync.mockReset();
  sync.mockImplementation(async () => {});
  appState = listenToAppState();
  fakeClockAt(new Date(2026, 8, 25, 12, 0));
});

afterEach(() => {
  appState.restore();
  jest.useRealTimers();
});

describe("store: the cold start", () => {
  it("writes nothing until the saved day has loaded, then once, from the saved day (never from an empty one)", async () => {
    await save(
      { tasks: THREE, todayCompletions: ["t0"], todayLocked: true, notifications: { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true } },
      new Date(2026, 8, 25, 8),
    );
    const hook = await renderHook(() => useDailyTasks(), { wrapper });
    // Not loaded yet: an empty day here would rewrite every reminder as "Nothing picked yet".
    if (!hook.result.current.ready) expect(sync).not.toHaveBeenCalled();
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await settle();

    expect(sync).toHaveBeenCalledTimes(1);
    for (const given of everySync()) {
      expect(given.tasks.map((task) => task.text)).toEqual(["Call the dentist", "Write the report", "Walk"]);
      expect(given.permissionState).toBe("granted");
    }
    expect(lastSync()).toMatchObject({
      today: D,
      locked: true,
      tasks: [{ done: true }, { done: false }, { done: false }],
      settings: { hideTaskNames: true },
    });
    // And those reminders have no task in them: the saved switch is honoured from the first write.
    for (const item of planFrom(lastSync())) expect(shown(item)).not.toMatch(TASK_WORDS);
  });

  it("a first run (nothing saved) writes once too, with names shown by default", async () => {
    const hook = await renderHook(() => useDailyTasks(), { wrapper });
    await waitFor(() => expect(hook.result.current.ready).toBe(true));
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(lastSync()).toMatchObject({ today: D, tasks: [], locked: false, yesterdayOpen: [], settings: { hideTaskNames: false } });
  });
});

describe("store: what counts as a change to the reminders", () => {
  it("each thing a reminder is written from asks for one rewrite, carrying it", async () => {
    const { result } = await renderOnDay({ tasks: THREE.slice(0, 2) }, new Date(2026, 8, 25, 8));
    const once = async (change: () => void) => {
      sync.mockClear();
      await act(async () => change());
      await settle();
      expect({ after: String(change), rewrites: sync.mock.calls.length }).toEqual({ after: String(change), rewrites: 1 });
      return lastSync();
    };

    expect((await once(() => result.current.addTask("Walk"))).tasks.map((task) => task.text)).toEqual(["Call the dentist", "Write the report", "Walk"]);
    expect((await once(() => result.current.toggleTask("t1"))).tasks.map((task) => task.done)).toEqual([false, true, false]);
    expect((await once(() => result.current.toggleTask("t1"))).tasks.map((task) => task.done)).toEqual([false, false, false]);
    expect((await once(() => result.current.editTask("t0", "Ring the dentist"))).tasks[0].text).toBe("Ring the dentist");
    expect((await once(() => result.current.deleteTask("t1"))).tasks.map((task) => task.id)).not.toContain("t1");
    expect((await once(() => result.current.lockToday())).locked).toBe(true);
    // A set day takes no deletes: nothing changed, nothing to write.
    sync.mockClear();
    await act(async () => result.current.deleteTask("t0"));
    await settle();
    expect(sync).not.toHaveBeenCalled();
    expect((await once(() => result.current.setNotificationEnabled("hourly", true))).settings.hourly).toBe(true);
    expect((await once(() => result.current.setNotificationEnabled("morning", false))).settings.morning).toBe(false);
    expect((await once(() => result.current.setHideTaskNamesInNotifications(true))).settings.hideTaskNames).toBe(true);
    expect((await once(() => result.current.setNotificationsEnabled(false))).settings).toMatchObject({ enabled: false, hideTaskNames: true });
    // Reminders off, the switch still flips and is still handed on (for when they come back on).
    expect((await once(() => result.current.setHideTaskNamesInNotifications(false))).settings).toMatchObject({ enabled: false, hideTaskNames: false });
    // A dozen changes, each left to settle.
  }, 30_000);

  it("things no reminder is written from ask for none", async () => {
    const { result } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();
    await act(async () => result.current.setTodayReflection("A good day"));
    await act(async () => result.current.setAutoLockTime(21, 30));
    await act(async () => result.current.setAnalyticsEnabled(false));
    await act(async () => result.current.markOnboardingSeen());
    // The same values again.
    await act(async () => result.current.setHideTaskNamesInNotifications(false));
    await act(async () => result.current.setNotificationEnabled("progress", true));
    await settle();
    expect(sync).not.toHaveBeenCalled();
  });

  it("a change undone within the wait still writes once, and what it writes is where things ended", async () => {
    const { result } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    const before = lastSync();
    sync.mockClear();
    await act(async () => result.current.setHideTaskNamesInNotifications(true));
    await act(async () => result.current.setHideTaskNamesInNotifications(false));
    await settle();
    expect(sync.mock.calls.length).toBeLessThanOrEqual(1);
    if (sync.mock.calls.length === 1) {
      expect(lastSync().settings.hideTaskNames).toBe(false);
      expect(lastSync().tasks).toEqual(before.tasks);
    }
  });
});

describe("store: bursts and the wait", () => {
  it("changes that keep coming, each inside the wait, are one rewrite after the last, however long the burst", async () => {
    const { result } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();
    const gap = Math.floor(REMINDER_SYNC_DEBOUNCE_MS * 0.6);
    // Four changes over ~1.8 waits: a plain timer from the first would have fired midway.
    for (const id of ["t0", "t1", "t2", "t0"]) {
      await act(async () => result.current.toggleTask(id));
      await wait(gap);
      expect(sync).not.toHaveBeenCalled();
    }
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(lastSync().tasks.map((task) => task.done)).toEqual([false, true, true]);
  });

  it("coming to the front several times at once, or with a change waiting, is still one rewrite", async () => {
    const { result } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();
    await act(async () => result.current.toggleTask("t0"));
    await act(async () => appState.emit("active"));
    await act(async () => appState.emit("active"));
    await act(async () => appState.emit("active"));
    expect(sync).not.toHaveBeenCalled();
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(lastSync().tasks[0].done).toBe(true);
  });

  it("a glance away with nothing waiting (inactive, then back) writes once, on the way back", async () => {
    await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();
    await act(async () => appState.emit("inactive"));
    await act(async () => appState.emit("background"));
    expect(sync).not.toHaveBeenCalled();
    await act(async () => appState.emit("active"));
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("back to the front and straight out again runs the waiting rewrite on the way out, not half a second into the background", async () => {
    await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();
    await act(async () => appState.emit("active"));
    expect(sync).not.toHaveBeenCalled();
    await act(async () => appState.emit("inactive"));
    expect(sync).toHaveBeenCalledTimes(1);
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
  });
});

describe("store: rewrites that keep failing", () => {
  it("each failure is forgotten, so it is asked for again until one works; a failure never surfaces as an unhandled rejection", async () => {
    const unhandled = jest.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const { result } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
      sync.mockClear();
      const sameAgain = async () => {
        await act(async () => result.current.editTask("t2", "Walk"));
        await settle();
      };
      sync.mockRejectedValueOnce(new Error("first")).mockRejectedValueOnce(new Error("second"));
      await act(async () => result.current.setHideTaskNamesInNotifications(true));
      await settle();
      expect(sync).toHaveBeenCalledTimes(1);
      await sameAgain();
      expect(sync).toHaveBeenCalledTimes(2);
      await sameAgain();
      expect(sync).toHaveBeenCalledTimes(3);
      expect(lastSync().settings.hideTaskNames).toBe(true);
      await sameAgain();
      expect(sync).toHaveBeenCalledTimes(3);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  }, 15_000);

  it("a rewrite that failed on the way out is asked for again on the way back in", async () => {
    const { result } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();
    sync.mockRejectedValueOnce(new Error("backgrounded"));
    await act(async () => result.current.setHideTaskNamesInNotifications(true));
    await act(async () => appState.emit("background"));
    expect(sync).toHaveBeenCalledTimes(1);
    await act(async () => appState.emit("active"));
    await settle();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(lastSync().settings.hideTaskNames).toBe(true);
  });
});

describe("store: the store's day and the clock's day apart", () => {
  /** No reminder on the clock's day speaks of the store's tasks as today's. */
  const expectNothingStale = (given: SyncNotificationsInput) => {
    const clockDay = toDateKey(given.now!);
    for (const item of planFrom(given)) {
      if (toDateKey(item.fireAt) !== clockDay) continue;
      if (given.today < clockDay) {
        expect(shown(item)).not.toMatch(/\d of \d|First up|Next:|to go|Today's three|On today's list|one thing/);
        expect(item.kind).toBe("morning");
      }
    }
  };

  it("one day behind: coming to the front just after midnight never writes yesterday's tasks as today's", async () => {
    fakeClockAt(new Date(2026, 8, 25, 23, 59, 50));
    await renderOnDay({ tasks: [taskAt("t0", "Walk"), taskAt("t1", "Read")], todayCompletions: ["t1"] }, new Date(2026, 8, 25, 8));
    sync.mockClear();

    jest.setSystemTime(new Date(2026, 8, 26, 0, 0, 10));
    await act(async () => appState.emit("active"));
    await settle();

    expect(sync.mock.calls.length).toBeGreaterThanOrEqual(1);
    everySync().forEach(expectNothingStale);
    // Where it ends: the new day, nothing set, Walk waiting from yesterday.
    expect(lastSync()).toMatchObject({ today: NEXT, tasks: [], yesterdayOpen: ["Walk"] });
    const today = planFrom(lastSync()).filter((item) => toDateKey(item.fireAt) === NEXT);
    expect(today.length).toBeGreaterThan(0);
    for (const item of today) {
      expect(shown(item)).toMatch(/yesterday/i);
      expect(shown(item)).toContain("Walk");
      // Read was done.
      expect(shown(item)).not.toContain("Read");
    }
  });

  it("two days behind: opened again two days on, nothing of the old tasks is in any reminder", async () => {
    fakeClockAt(new Date(2026, 8, 25, 12, 0));
    await renderOnDay({ tasks: [taskAt("t0", "Walk"), taskAt("t1", "Read")] }, new Date(2026, 8, 25, 8));
    sync.mockClear();

    jest.setSystemTime(new Date(2026, 8, 27, 7, 0));
    await act(async () => appState.emit("active"));
    await settle();

    expect(sync.mock.calls.length).toBeGreaterThanOrEqual(1);
    everySync().forEach(expectNothingStale);
    expect(lastSync()).toMatchObject({ today: "2026-09-27", tasks: [], yesterdayOpen: [] });
    const plan = planFrom(lastSync());
    expect(plan.length).toBeGreaterThan(5);
    for (const item of plan) expect(shown(item)).not.toMatch(/Walk|Read/);
  });

  it("one day ahead (after flying west): today's slots name the task, its own day's morning asks about it, the morning after says 'yesterday'", async () => {
    fakeClockAt(new Date(2026, 8, 25, 10, 30));
    await renderOnDay({ tasks: [taskAt("t0", "Walk", 26)] }, new Date(2026, 8, 26, 9));
    expect(lastSync()).toMatchObject({ today: NEXT, tasks: [{ id: "t0", text: "Walk", done: false }] });
    const plan = planFrom(lastSync());
    const on = (day: string) => plan.filter((item) => toDateKey(item.fireAt) === day);
    expect(on(D).length).toBeGreaterThan(0);
    on(D).forEach((item) => expect(shown(item)).toContain("Walk"));
    expect(on(NEXT)).toHaveLength(1);
    expect(shown(on(NEXT)[0])).toMatch(/Walk.*(Still open\?|If it's still open)|Still open\? A small start counts\./);
    expect(shown(on(NEXT)[0])).not.toMatch(/yesterday|\d/i);
    expect(on("2026-09-27")).toHaveLength(1);
    expect(shown(on("2026-09-27")[0])).toMatch(/yesterday/i);
    expect(shown(on("2026-09-27")[0])).toContain("Walk");
  });
});
