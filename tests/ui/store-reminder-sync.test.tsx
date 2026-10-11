// The store and the reminders (1.4, PR #89): what it hands the scheduler,
// and when. A burst of changes settles into one rewrite, leaving the app runs
// a waiting one at once, unmounting drops it, and coming to the front always
// rewrites (which reminder is "next" depends on the time).
import type { ReactNode } from "react";
import { AppState as RNAppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { toDateKey } from "@/lib/daily-tasks/date";
import { syncNotifications, type SyncNotificationsInput } from "@/lib/daily-tasks/notifications";
import { REMINDER_SYNC_DEBOUNCE_MS } from "@/lib/daily-tasks/reminder-plan";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState, type Task } from "@/lib/daily-tasks/types";

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

const D = "2026-09-25";
const NEXT = "2026-09-26";

// Local times, not UTC literals: day keys are local.
const taskAt = (id: string, text: string, day = 25): Task => ({
  id,
  text,
  createdAt: new Date(2026, 8, day, 8).toISOString(),
  carriedOver: false,
});
const THREE = [taskAt("t0", "Call the dentist"), taskAt("t1", "Write the report"), taskAt("t2", "Walk")];

/** Fake only the clock; real timers keep RNTL's waits and the debounce working. */
function fakeClockAt(now: Date) {
  jest.useFakeTimers({
    now,
    doNotFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "setImmediate",
      "clearImmediate",
      "queueMicrotask",
      "nextTick",
    ],
  });
}

/** Capture AppState listeners (see store.test.tsx for why not spyOn/restore). */
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

/** Long enough for a waiting rewrite to run. */
const settle = () => act(async () => new Promise<void>((resolve) => setTimeout(resolve, REMINDER_SYNC_DEBOUNCE_MS + 200)));

/** A saved state the app could have written, opened and left until the first rewrites are done. */
async function renderOnDay(saved: Partial<AppState>, savedFor: Date) {
  const state: AppState = {
    ...buildInitialState(savedFor),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    ...saved,
  };
  await AsyncStorage.setItem("daily-tasks/state/v1", JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await settle();
  return hook;
}

let appState: ReturnType<typeof listenToAppState>;

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  sync.mockClear();
  appState = listenToAppState();
  // Midday, so no test runs into midnight or the lock time by accident.
  fakeClockAt(new Date(2026, 8, 25, 12, 0));
});

afterEach(() => {
  appState.restore();
  jest.useRealTimers();
});

describe("store: when the reminders are rewritten", () => {
  it("opening the app writes them from the day's tasks, in Today's order", async () => {
    await renderOnDay({ tasks: THREE, todayCompletions: ["t1"] }, new Date(2026, 8, 25, 8));
    expect(sync.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(lastSync()).toMatchObject({
      today: D,
      permissionState: "granted",
      // Each with its id, so a reminder that names one can say which (by id, never by text).
      tasks: [
        { id: "t0", text: "Call the dentist", done: false },
        { id: "t1", text: "Write the report", done: true },
        { id: "t2", text: "Walk", done: false },
      ],
      locked: false,
      yesterdayOpen: [],
    });
    expect(lastSync().settings.hideTaskNames).toBe(false);
    expect(lastSync().now).toEqual(new Date(2026, 8, 25, 12, 0));
  });

  it("a burst of changes costs one rewrite, with where the burst ended", async () => {
    const { result } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();

    await act(async () => result.current.toggleTask("t0"));
    await act(async () => result.current.toggleTask("t1"));
    await act(async () => result.current.toggleTask("t1"));
    await act(async () => result.current.editTask("t2", "Walk to the park"));
    // Nothing yet: the changes are still settling.
    expect(sync).not.toHaveBeenCalled();

    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(lastSync().tasks).toEqual([
      { id: "t0", text: "Call the dentist", done: true },
      { id: "t1", text: "Write the report", done: false },
      { id: "t2", text: "Walk to the park", done: false },
    ]);
  });

  it("leaving the app runs a waiting rewrite at once, and only once", async () => {
    const { result } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();

    // Nothing waiting: leaving writes nothing.
    await act(async () => appState.emit("background"));
    expect(sync).not.toHaveBeenCalled();

    await act(async () => result.current.toggleTask("t0"));
    expect(sync).not.toHaveBeenCalled();
    await act(async () => appState.emit("inactive"));
    expect(sync).toHaveBeenCalledTimes(1);
    expect(lastSync().tasks[0]).toEqual({ id: "t0", text: "Call the dentist", done: true });

    // Already run: neither the next step out nor the timer runs it again.
    await act(async () => appState.emit("background"));
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("unmounting drops a waiting rewrite", async () => {
    const { result, unmount } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();

    await act(async () => result.current.toggleTask("t0"));
    await unmount();
    await settle();
    expect(sync).not.toHaveBeenCalled();
  });

  it("coming to the front rewrites them even when nothing changed", async () => {
    await renderOnDay({ tasks: THREE, todayCompletions: ["t0"] }, new Date(2026, 8, 25, 8));
    const before = lastSync();
    sync.mockClear();

    // Two hours on: the 14:00 reminder is now the next one (the one with the count).
    jest.setSystemTime(new Date(2026, 8, 25, 14, 30));
    await act(async () => appState.emit("active"));
    await settle();

    expect(sync).toHaveBeenCalledTimes(1);
    const { now, ...context } = lastSync();
    const { now: _then, ...contextBefore } = before;
    expect(context).toEqual(contextBefore);
    expect(now).toEqual(new Date(2026, 8, 25, 14, 30));
  });

  it("the Hide task names switch rewrites them with names hidden", async () => {
    const { result } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();

    await act(async () => result.current.setHideTaskNamesInNotifications(true));
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(lastSync().settings).toMatchObject({ hideTaskNames: true, enabled: true });
    expect(result.current.state.notifications.hideTaskNames).toBe(true);

    // The same value again changes nothing.
    sync.mockClear();
    await act(async () => result.current.setHideTaskNamesInNotifications(true));
    await settle();
    expect(sync).not.toHaveBeenCalled();
  });
});

describe("store: a rewrite that fails", () => {
  it("is asked for again by the next change that leaves the same thing to write, instead of being taken as done", async () => {
    const { result } = await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    sync.mockClear();
    // Saving a task with the words it already has: the store updates, but
    // there is nothing new to write.
    const sameAgain = async () => {
      await act(async () => result.current.editTask("t2", "Walk"));
      await settle();
    };

    // Written already: nothing to do.
    await sameAgain();
    expect(sync).not.toHaveBeenCalled();

    // The switch is turned on, and that rewrite is rejected.
    sync.mockRejectedValueOnce(new Error("scheduler unavailable"));
    await act(async () => result.current.setHideTaskNamesInNotifications(true));
    await settle();
    expect(sync).toHaveBeenCalledTimes(1);

    // It was never written, so the same thing is asked for again.
    await sameAgain();
    expect(sync).toHaveBeenCalledTimes(2);
    expect(lastSync().settings.hideTaskNames).toBe(true);

    // That one worked: not again.
    await sameAgain();
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("what is handed to the scheduler carries no pending list of its own (the scheduler adds it)", async () => {
    await renderOnDay({ tasks: THREE }, new Date(2026, 8, 25, 8));
    expect(Object.keys(lastSync()).sort()).toEqual(
      // `plus` and `strategy` are for nag mode (Plus-only; see nag-mode-store.test.tsx).
      ["draft", "locked", "now", "permissionState", "plus", "settings", "strategy", "tasks", "today", "yesterdayOpen"].sort(),
    );
  });
});

describe("store: the reminders over a day change", () => {
  it("after midnight they are written for the new day, with yesterday's open task as 'from yesterday'", async () => {
    fakeClockAt(new Date(2026, 8, 25, 23, 59, 50));
    const { result } = await renderOnDay(
      { tasks: [taskAt("t0", "Walk"), taskAt("t1", "Read")], todayCompletions: ["t1"] },
      new Date(2026, 8, 25, 8),
    );
    expect(lastSync()).toMatchObject({ today: D, yesterdayOpen: [] });
    sync.mockClear();

    jest.setSystemTime(new Date(2026, 8, 26, 0, 0, 10));
    await act(async () => result.current.addTask("Stretch"));
    await settle();

    expect(result.current.state.pendingRollover?.sourceDate).toBe(D);
    expect(sync).toHaveBeenCalledTimes(1);
    expect(lastSync()).toMatchObject({
      today: NEXT,
      tasks: [expect.objectContaining({ text: "Stretch", done: false })],
      // Read was done; only Walk is still open.
      yesterdayOpen: ["Walk"],
    });
    expect(toDateKey(lastSync().now!)).toBe(NEXT);

    // Carried into today: no longer "from yesterday".
    sync.mockClear();
    await act(async () => result.current.resolveRollover(["t0"]));
    await settle();
    expect(lastSync().yesterdayOpen).toEqual([]);
    expect(lastSync().tasks.map((task) => task.text).sort()).toEqual(["Stretch", "Walk"]);
  });

  it("a card from an older day is not 'from yesterday'", async () => {
    // Saved on the 25th with Walk open; opened again on the 28th.
    fakeClockAt(new Date(2026, 8, 28, 9, 0));
    const { result } = await renderOnDay({ tasks: [taskAt("t0", "Walk")] }, new Date(2026, 8, 25, 8));
    expect(result.current.today).toBe("2026-09-28");
    expect(result.current.state.pendingRollover).toMatchObject({ sourceDate: D });
    expect(lastSync()).toMatchObject({ today: "2026-09-28", tasks: [], yesterdayOpen: [] });
  });

  // What it does today, written down: after flying west the store keeps its
  // day (the 26th) while the clock reads the 25th.
  it("after westward travel the reminders are written from the store's day at the clock's time", async () => {
    fakeClockAt(new Date(2026, 8, 25, 10, 0));
    const { result } = await renderOnDay({ tasks: [taskAt("t0", "Walk", 26)] }, new Date(2026, 8, 26, 9));
    expect(result.current.today).toBe(NEXT);
    expect(lastSync()).toMatchObject({ today: NEXT, tasks: [{ id: "t0", text: "Walk", done: false }], yesterdayOpen: [] });
    expect(toDateKey(lastSync().now!)).toBe(D);
  });
});
