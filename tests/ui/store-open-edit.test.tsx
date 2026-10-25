// 1.4.1: an edit of a task's words open on Today when the day is set is saved, not
// dropped (the store's setDay): Set today, the minute tick and coming back to
// the app. An auto-set that is refused (a day unlocked in Settings) saves
// nothing. The Today row reports its open words through noteOpenEdit; the
// row's own reporting is in today-screen.test.tsx. All times are local.
import type { ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState as DailyState, Task } from "@/lib/daily-tasks/types";

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
const at = (day: 1 | 2, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const NOON = { enabled: true, hour: 12, minute: 0 };
const KEY = "daily-tasks/state/v1";

const task = (id: string, text: string): Task => ({
  id,
  text,
  createdAt: at(1, 8).toISOString(),
  carriedOver: false,
});

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


describe("store: an edit open when the day is set is saved (1.4.1)", () => {
  const open = async (hour: number, minute: number, saved: Partial<DailyState> = {}) => {
    fakeClockAt(at(1, hour, minute));
    return renderStore(saved);
  };
  const texts = (hook: Awaited<ReturnType<typeof launch>>) => hook.result.current.state.tasks.map((t) => t.text);

  it("Set today with words typed in a row: they are saved first, and the day is set with them (also in the day's history)", async () => {
    const { result } = await open(10, 0);
    await act(async () => result.current.noteOpenEdit("t0", "Walk far"));
    await act(async () => result.current.lockToday());
    expect(result.current.state).toMatchObject({ todayLocked: true, todayLockSource: "manual" });
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["Walk far", "Read"]);
    expect(result.current.state.history[D]?.tasks?.map((t) => t.text)).toEqual(["Walk far", "Read"]);
    await waitFor(async () => expect((await savedState())?.tasks.map((t) => t.text)).toEqual(["Walk far", "Read"]));
    // Once used, it isn't applied again.
    await act(async () => result.current.unlockToday());
    await act(async () => result.current.lockToday());
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["Walk far", "Read"]);
  });

  it("the minute tick that sets the day at its time saves the open words", async () => {
    const hook = await open(11, 59);
    await act(async () => hook.result.current.noteOpenEdit("t1", "Read two chapters"));
    jest.setSystemTime(at(1, 12, 0));
    await minuteTick();
    await waitFor(() => expect(hook.result.current.state.todayLockSource).toBe("auto"));
    expect(texts(hook)).toEqual(["Walk", "Read two chapters"]);
  });

  it("coming back to the app after the set time saves the open words", async () => {
    const hook = await open(11, 59);
    await act(async () => hook.result.current.noteOpenEdit("t0", "Walk far"));
    jest.setSystemTime(at(1, 12, 5));
    await foreground();
    await waitFor(() => expect(hook.result.current.state.todayLockSource).toBe("auto"));
    expect(texts(hook)).toEqual(["Walk far", "Read"]);
  });

  it("words taken back (null) are not saved", async () => {
    const { result } = await open(10, 0);
    await act(async () => result.current.noteOpenEdit("t0", "Walk far"));
    await act(async () => result.current.noteOpenEdit("t0", null));
    await act(async () => result.current.lockToday());
    expect(result.current.state.tasks.map((t) => t.text)).toEqual(["Walk", "Read"]);
  });

  it("an auto-set refused after an unlock in Settings saves nothing: the words stay unsaved and the day stays open", async () => {
    const hook = await open(12, 30);
    await waitFor(() => expect(hook.result.current.state.todayLockSource).toBe("auto"));
    await act(async () => hook.result.current.unlockToday());
    await flush();
    await act(async () => hook.result.current.noteOpenEdit("t0", "Walk far"));
    jest.setSystemTime(at(1, 12, 31));
    await minuteTick();
    await foreground();
    await flush();
    expect(hook.result.current.state.todayLocked).toBe(false);
    expect(texts(hook)).toEqual(["Walk", "Read"]);
    // The row is still open and still the user's: saving it by hand works as ever.
    await act(async () => hook.result.current.editTask("t0", "Walk far"));
    expect(texts(hook)).toEqual(["Walk far", "Read"]);
  });
});
