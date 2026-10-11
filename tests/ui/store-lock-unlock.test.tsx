// Lock and unlock on the real store (1.4, PR #87): an unlock made in Settings
// holds for the rest of that day against every auto-set path (launch,
// foreground, the minute tick, a task change, a relaunch) and ends at
// rollover; a set day's tasks can't change through any reducer action, while
// ticking, steps, timers and widget taps keep working.
import type { ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { applyRollover, syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState as DailyState, Routine, Task } from "@/lib/daily-tasks/types";
import type { WidgetToggle } from "@/lib/daily-tasks/widget-snapshot";

let mockQueue: { raw: string | null; processedSeq: number } = { raw: null, processedSeq: 0 };
jest.mock("@/lib/daily-tasks/widget-bridge", () => ({
  invalidateFocusSession: jest.fn(),
  readFocusCommands: jest.fn(() => ({ raw: null, processedSeq: 0 })),
  markFocusCommandsProcessed: jest.fn(),
  readFocusStartRequest: jest.fn(() => ({ raw: null, handledId: null })),
  markFocusStartRequestHandled: jest.fn(),
  focusSessionJson: jest.fn((session: object, rev: number) => JSON.stringify({ v: 1, rev, ...session })),
  writeWidgetSnapshot: jest.fn(),
  writeFocusSession: jest.fn(),
  invalidateWidgetSnapshot: jest.fn(),
  readWidgetToggles: jest.fn(() => mockQueue),
  markWidgetTogglesProcessed: jest.fn((seq: number) => {
    mockQueue = { ...mockQueue, processedSeq: seq };
  }),
}));
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallBuild: false, paywallEnabled: false, entitlementActive: false, entitlementKnown: true }),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

// Thursday 1 Oct 2026 (local weekday 4). Every time below is local: day keys
// and the auto-set time are local, and CI runs in several time zones.
const D = "2026-10-01";
const NEXT = "2026-10-02";
const at = (day: 1 | 2, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const NOON = { enabled: true, hour: 12, minute: 0 };
const KEY = "daily-tasks/state/v1";

const task = (id: string, text: string): Task => ({
  id,
  text,
  createdAt: at(1, 8).toISOString(),
  carriedOver: false,
});
const WALK_ROUTINE: Routine = {
  id: "r1",
  text: "Walk after lunch",
  days: [4],
  paused: false,
  createdAt: "2026-09-30T08:00:00.000Z",
};

/** Fake only the clock; real timers keep RNTL's async waits working. */
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
let appStateListeners = new Set<(state: string) => void>();
let restoreAppState: () => void = () => {};
const foreground = () => act(async () => [...appStateListeners].forEach((listener) => listener("active")));

/**
 * The store's once-a-minute check, run now. Timers are real here, so the test
 * calls the newest 60-second interval the store registered (each re-run of
 * that effect clears the one before it).
 */
let intervals: jest.SpyInstance;
const minuteTick = () =>
  act(async () => {
    const minute = intervals.mock.calls.filter((call) => call[1] === 60_000);
    expect(minute.length).toBeGreaterThan(0);
    (minute[minute.length - 1][0] as () => void)();
  });

async function flush(times = 6) {
  for (let i = 0; i < times; i++) await act(async () => {});
}

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;

async function launch() {
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  await flush();
  return hook;
}

/** Save a state the app could have written for D (history mirrors the list), then launch. */
async function renderStore(saved: Partial<DailyState> = {}) {
  const state: DailyState = {
    ...buildInitialState(at(1, 8)),
    hasSeenOnboarding: true,
    autoLock: NOON,
    tasks: [task("t0", "Walk"), task("t1", "Read")],
    ...saved,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
  return launch();
}

async function savedState(): Promise<DailyState | null> {
  return JSON.parse((await AsyncStorage.getItem(KEY)) ?? "null");
}

const SET = { todayLocked: true, todayLockSource: "manual" as const, todayLockedAt: at(1, 9).toISOString() };

beforeEach(async () => {
  __resetStorageForTests();
  mockQueue = { raw: null, processedSeq: 0 };
  await AsyncStorage.clear();
  const addEventListener = AppState.addEventListener as unknown as jest.Mock;
  const original = addEventListener.getMockImplementation();
  appStateListeners = new Set();
  addEventListener.mockImplementation((_type: string, listener: (state: string) => void) => {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  });
  restoreAppState = () => addEventListener.mockImplementation(original);
  intervals = jest.spyOn(globalThis, "setInterval");
});

afterEach(() => {
  intervals.mockRestore();
  restoreAppState();
  jest.useRealTimers();
});

describe("store: an unlock holds for the rest of the day (1.4)", () => {
  it("stays unlocked after the auto-set time through launch, foreground, the minute tick, task changes and a relaunch; the next day auto-sets again", async () => {
    fakeClockAt(at(1, 12, 30));
    const first = await renderStore();
    // Launched after noon with tasks from the morning: auto-set.
    await waitFor(() => expect(first.result.current.state.todayLocked).toBe(true));
    expect(first.result.current.state.todayLockSource).toBe("auto");

    await act(async () => first.result.current.unlockToday());
    await flush();
    const unlocked = (hook: typeof first, why: string) => {
      const { state } = hook.result.current;
      expect({ why, locked: state.todayLocked, source: state.todayLockSource, lockedAt: state.todayLockedAt }).toEqual({
        why,
        locked: false,
        source: null,
        lockedAt: null,
      });
      expect(state.manualUnlockDate).toBe(D);
      expect(state.history[D]?.locked).toBe(false);
    };
    unlocked(first, "right after the unlock (the launch effect re-ran)");

    await foreground();
    await flush();
    unlocked(first, "back to the foreground");

    jest.setSystemTime(at(1, 12, 31));
    await minuteTick();
    await flush();
    unlocked(first, "the minute tick");

    // The point of unlocking: the three can change again, and stay open.
    await act(async () => first.result.current.addTask("Stretch"));
    await flush();
    unlocked(first, "after adding a task");
    await act(async () => first.result.current.editTask("t0", "Walk far"));
    await flush();
    unlocked(first, "after editing a task");
    expect(first.result.current.state.tasks.map((t) => t.text)).toEqual(["Walk far", "Read", "Stretch"]);

    // Quit and reopen later the same day: the unlock was saved with the state.
    await waitFor(async () => {
      const saved = await savedState();
      expect(saved?.manualUnlockDate).toBe(D);
      expect(saved?.todayLocked).toBe(false);
      expect(saved?.tasks).toHaveLength(3);
    });
    await first.unmount();
    jest.setSystemTime(at(1, 15, 0));
    const second = await launch();
    unlocked(second, "relaunched the same afternoon");
    await foreground();
    await minuteTick();
    await flush();
    unlocked(second, "relaunched, then foreground and a minute tick");

    // The next morning is a new day: yesterday's unlock is gone...
    jest.setSystemTime(at(2, 9, 0));
    await foreground();
    await waitFor(() => expect(second.result.current.today).toBe(NEXT));
    expect(second.result.current.state.manualUnlockDate).toBeNull();
    expect(second.result.current.state.todayLocked).toBe(false);
    await act(async () => second.result.current.addTask("Plan the week"));
    await minuteTick();
    expect(second.result.current.state.todayLocked).toBe(false);

    // ...and its auto-set happens at noon as usual.
    jest.setSystemTime(at(2, 12, 0));
    await minuteTick();
    await waitFor(() => expect(second.result.current.state.todayLocked).toBe(true));
    expect(second.result.current.state.todayLockSource).toBe("auto");
    expect(second.result.current.state.todayLockedAt).toBe(at(2, 12).toISOString());
  });

  it("unlock, Set today by hand, and unlock again all work on the same day", async () => {
    fakeClockAt(at(1, 12, 30));
    const { result } = await renderStore();
    await waitFor(() => expect(result.current.state.todayLockSource).toBe("auto"));

    await act(async () => result.current.unlockToday());
    expect(result.current.state.todayLocked).toBe(false);

    // A manual Set isn't held back by the earlier unlock.
    jest.setSystemTime(at(1, 12, 40));
    await act(async () => result.current.lockToday());
    expect(result.current.state).toMatchObject({
      todayLocked: true,
      todayLockSource: "manual",
      todayLockedAt: at(1, 12, 40).toISOString(),
    });
    expect(result.current.state.history[D]).toMatchObject({ locked: true, lockSource: "manual" });
    await act(async () => result.current.deleteTask("t1"));
    expect(result.current.state.tasks).toHaveLength(2);

    await act(async () => result.current.unlockToday());
    await flush();
    await foreground();
    await minuteTick();
    expect(result.current.state).toMatchObject({
      todayLocked: false,
      todayLockSource: null,
      todayLockedAt: null,
      manualUnlockDate: D,
    });
    expect(result.current.state.history[D]?.locked).toBe(false);
    // Open again: the list changes.
    await act(async () => result.current.deleteTask("t1"));
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["Walk"]);

    // And once more round.
    await act(async () => result.current.lockToday());
    expect(result.current.state.todayLockSource).toBe("manual");
    await act(async () => result.current.unlockToday());
    await flush();
    expect(result.current.state.todayLocked).toBe(false);
  });

  it("a relaunch the next day clears the unlock (saved too), and the new day auto-sets and can be unlocked itself", async () => {
    fakeClockAt(at(1, 12, 30));
    // Both done, so nothing is left over to carry into the next day.
    const first = await renderStore({ todayCompletions: ["t0", "t1"] });
    await waitFor(() => expect(first.result.current.state.todayLocked).toBe(true));
    await act(async () => first.result.current.unlockToday());
    await waitFor(async () => expect((await savedState())?.manualUnlockDate).toBe(D));
    await first.unmount();

    jest.setSystemTime(at(2, 9, 0));
    const { result } = await launch();
    expect(result.current.today).toBe(NEXT);
    expect(result.current.state.manualUnlockDate).toBeNull();
    expect(result.current.state.todayLocked).toBe(false);
    await act(async () => result.current.addTask("Plan the week"));
    await waitFor(async () => {
      const saved = await savedState();
      expect(saved?.lastOpenedDate).toBe(NEXT);
      expect(saved?.manualUnlockDate).toBeNull();
    });

    jest.setSystemTime(at(2, 12, 5));
    await foreground();
    await waitFor(() => expect(result.current.state.todayLocked).toBe(true));
    expect(result.current.state.todayLockSource).toBe("auto");

    await act(async () => result.current.unlockToday());
    await flush();
    await foreground();
    expect(result.current.state.todayLocked).toBe(false);
    expect(result.current.state.manualUnlockDate).toBe(NEXT);
  });
});

describe("store: a set day keeps its three (1.4)", () => {
  // Two tasks, so there's room: only the lock is in the way. Auto-set is off
  // here (the day is set by hand), so nothing depends on the clock.
  const parked = [{ id: "p1", text: "Buy shoes", parkedAt: at(1, 8).toISOString() }];

  /** A set day saved with yesterday's leftover on its card, a saved item, a due routine and a draft. */
  function setDay(): Partial<DailyState> {
    const yesterday: DailyState = syncTodayHistory(
      {
        ...buildInitialState(new Date(2026, 8, 30, 8)),
        tasks: [{ id: "y0", text: "Call the bank", createdAt: new Date(2026, 8, 30, 8).toISOString(), carriedOver: false }],
      },
      "2026-09-30",
    );
    const rolled = applyRollover(yesterday, D);
    return {
      history: rolled.history,
      pendingRollover: rolled.pendingRollover,
      lastOpenedDate: D,
      autoLock: { ...NOON, enabled: false },
      ...SET,
      parkedTasks: parked,
      routines: [WALK_ROUTINE],
      tomorrowDraft: { forDate: D, tasks: ["Call mum", "Stretch"], note: "", because: "", source: "local" },
    };
  }

  type Store = ReturnType<typeof useDailyTasks>;
  const REFUSED: [string, (store: Store) => void][] = [
    ["notToday", (s) => s.notToday("t1")],
    ["addTask", (s) => s.addTask("Stretch")],
    ["addTasks", (s) => s.addTasks(["Stretch", "Hydrate"])],
    ["editTask", (s) => s.editTask("t0", "Walk far")],
    ["deleteTask", (s) => s.deleteTask("t0")],
    ["addParkedTask", (s) => s.addParkedTask("p1")],
    ["addRoutineToToday", (s) => expect(s.addRoutineToToday("r1", "today")).toBe(false)],
    ["resolveRollover", (s) => s.resolveRollover(["y0"])],
  ];

  it.each(REFUSED)("%s changes no tasks", async (_name, run) => {
    fakeClockAt(at(1, 10, 0));
    const { result } = await renderStore(setDay());
    // Yesterday's card has no room on a set day: it settled at launch (its
    // task stays in history), so resolveRollover has nothing to carry.
    expect(result.current.state.pendingRollover).toBeNull();
    expect(result.current.state.history["2026-09-30"]?.tasks.map((t) => t.text)).toEqual(["Call the bank"]);
    const before = result.current.state;

    await act(async () => run(result.current));

    const after = result.current.state;
    // The same array: not rebuilt, reordered or reworded.
    expect(after.tasks).toBe(before.tasks);
    expect(after.tasks.map((t) => t.text)).toEqual(["Walk", "Read"]);
    expect(after.todayCompletions).toEqual([]);
    expect(after.history[D]).toMatchObject({ total: 2, completed: 0, locked: true });
    expect(after.todayLocked).toBe(true);
    // Nothing moved in or out of Saved for later either.
    expect(after.parkedTasks).toEqual(parked);
  });

  it("applyTomorrowDraft adds nothing and parks the picks (and the rest) instead of losing them", async () => {
    fakeClockAt(at(1, 10, 0));
    const { result } = await renderStore(setDay());
    const before = result.current.state.tasks;

    await act(async () => result.current.applyTomorrowDraft(["Call mum"], ["Call mum", "Stretch"]));

    expect(result.current.state.tasks).toBe(before);
    expect(result.current.state.parkedTasks.map((p) => p.text).sort()).toEqual(["Buy shoes", "Call mum", "Stretch"]);
    expect(result.current.state.tomorrowDraft).toBeNull();
    expect(result.current.state.todayLocked).toBe(true);
  });

  it("ticking, steps, timers and widget taps still work, and none of them unlock the day", async () => {
    fakeClockAt(at(1, 10, 0));
    const { result } = await renderStore(setDay());
    const stillSet = () =>
      expect(result.current.state).toMatchObject({ todayLocked: true, todayLockSource: "manual", manualUnlockDate: null });

    // Tick and untick.
    await act(async () => result.current.toggleTask("t0"));
    expect(result.current.state.todayCompletions).toEqual(["t0"]);
    expect(result.current.state.history[D]).toMatchObject({ completed: 1, locked: true });
    await act(async () => result.current.toggleTask("t0"));
    expect(result.current.state.todayCompletions).toEqual([]);
    stillSet();

    // Break-down steps: add, tick, clear.
    await act(async () => result.current.setTaskSteps("t1", ["Open the book", "Read a page"]));
    const steps = result.current.state.tasks[1].steps ?? [];
    expect(steps.map((s) => s.text)).toEqual(["Open the book", "Read a page"]);
    await act(async () => result.current.toggleTaskStep("t1", steps[0].id));
    expect(result.current.state.tasks[1].steps?.map((s) => s.done)).toEqual([true, false]);
    await act(async () => result.current.clearTaskSteps("t1"));
    expect(result.current.state.tasks[1].steps ?? []).toEqual([]);
    stillSet();

    // A timer: start, pause, resume, five more minutes, stop.
    await act(async () => result.current.startFocusSession("t0", { kind: "timer", minutes: 10, source: "row" }));
    expect(result.current.state.focusSession).toMatchObject({ taskId: "t0", status: "running" });
    let changed = false;
    await act(async () => {
      changed = result.current.pauseFocusSession();
    });
    expect(changed).toBe(true);
    expect(result.current.state.focusSession?.status).toBe("paused");
    await act(async () => {
      changed = result.current.resumeFocusSession();
    });
    expect(changed).toBe(true);
    const endAt = result.current.state.focusSession?.endAt ?? 0;
    await act(async () => result.current.extendFocusSession());
    expect(result.current.state.focusSession?.endAt).toBe(endAt + 5 * 60_000);
    await act(async () => result.current.stopFocusSession("stopped"));
    expect(result.current.state.focusSession).toBeNull();
    stillSet();

    // Widget taps made while the app was away: a tick and an untick.
    await act(async () => result.current.toggleTask("t1"));
    const taps: WidgetToggle[] = [
      { seq: 1, id: "t0", date: D, done: true },
      { seq: 2, id: "t1", date: D, done: false },
    ];
    mockQueue = { raw: JSON.stringify(taps), processedSeq: 0 };
    await foreground();
    await waitFor(() => expect(result.current.state.todayCompletions).toEqual(["t0"]));
    stillSet();
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["Walk", "Read"]);
  });
});
