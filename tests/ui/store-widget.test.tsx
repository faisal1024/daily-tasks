// The real DailyTasksProvider with the widget bridge mocked: the snapshot the
// widget gets, and taps made in the widget applied like in-app taps, on the
// day they were made (even when the app is only opened the next day).
import type { ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { todayKey } from "@/lib/daily-tasks/date";
import type { PlusContextValue } from "@/lib/daily-tasks/plus-context";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import * as storage from "@/lib/daily-tasks/storage";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState as DailyState, DayRecord, Task } from "@/lib/daily-tasks/types";
import {
  invalidateWidgetSnapshot,
  markWidgetTogglesProcessed,
  writeWidgetSnapshot,
} from "@/lib/daily-tasks/widget-bridge";
import type { WidgetSnapshot, WidgetToggle } from "@/lib/daily-tasks/widget-snapshot";

let mockQueue: { raw: string | null; processedSeq: number } = { raw: null, processedSeq: 0 };
jest.mock("@/lib/daily-tasks/widget-bridge", () => ({
  writeWidgetSnapshot: jest.fn(),
  invalidateWidgetSnapshot: jest.fn(),
  readWidgetToggles: jest.fn(() => mockQueue),
  markWidgetTogglesProcessed: jest.fn((seq: number) => {
    mockQueue = { ...mockQueue, processedSeq: seq };
  }),
}));

/** No paywall in this build (everyone has Plus) unless a test says otherwise. */
const NO_PAYWALL: Partial<PlusContextValue> = {
  paywallBuild: false,
  paywallEnabled: false,
  entitlementActive: false,
  entitlementKnown: true,
};
let mockPlus: Partial<PlusContextValue> = NO_PAYWALL;
jest.mock("@/lib/daily-tasks/plus-context", () => ({ usePlus: () => mockPlus }));

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const TASKS: Task[] = ["Walk", "Read", "Stretch"].map((text, i) => ({
  id: `t${i}`,
  text,
  createdAt: new Date().toISOString(),
  carriedOver: false,
}));

function queue(toggles: WidgetToggle[], processedSeq = 0) {
  mockQueue = { raw: JSON.stringify(toggles), processedSeq };
}

function lastSnapshot(): WidgetSnapshot {
  const calls = (writeWidgetSnapshot as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
}

/** Capture AppState listeners (see store.test.tsx for why not spyOn/restore). */
function listenToAppState() {
  const addEventListener = AppState.addEventListener as unknown as jest.Mock;
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

const wrapper = ({ children }: { children: ReactNode }) => (
  <DailyTasksProvider>{children}</DailyTasksProvider>
);

/** Saved state for the day of `now`, with the three tasks and some done. */
async function renderStore(opts: { now?: Date; done?: string[]; saved?: Partial<DailyState> } = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({
      ...buildInitialState(opts.now ?? new Date()),
      hasSeenOnboarding: true,
      tasks: TASKS,
      todayCompletions: opts.done ?? [],
      ...opts.saved,
    }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

beforeEach(async () => {
  mockQueue = { raw: null, processedSeq: 0 };
  mockPlus = NO_PAYWALL;
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("store: widget snapshot", () => {
  it("writes today's tasks to the widget once loaded, and again when one is completed", async () => {
    const { result } = await renderStore();
    expect(lastSnapshot()).toMatchObject({
      date: todayKey(),
      tasks: [
        { id: "t0", text: "Walk", done: false },
        { id: "t1", text: "Read", done: false },
        { id: "t2", text: "Stretch", done: false },
      ],
      plus: true,
    });
    await act(async () => result.current.toggleTask("t1"));
    expect(lastSnapshot().tasks[1]).toEqual({ id: "t1", text: "Read", done: true });
  });

  it("doesn't make a free user's widget interactive while RevenueCat is still checking", async () => {
    mockPlus = { paywallBuild: true, paywallEnabled: true, entitlementActive: false, entitlementKnown: false };
    const { result } = await renderStore({ saved: { plusGrandfathered: false } });
    // The app itself doesn't gate while waiting...
    expect(result.current.hasPlus).toBe(true);
    // ...but the widget only gets confirmed Plus.
    expect(lastSnapshot().plus).toBe(false);
  });
});

function pastDay(date: string, total: number): DayRecord {
  return { date, total, completed: 0, locked: false, lockSource: null, tasks: [], reflection: null, reflectionResult: null };
}

describe("store: widget \"Day N\"", () => {
  it("writes day = daysShowedUp (only past days with tasks count, plus today)", async () => {
    const { result } = await renderStore({
      saved: {
        history: {
          "2000-01-01": pastDay("2000-01-01", 3),
          "2000-01-02": pastDay("2000-01-02", 0),
          "2000-01-03": pastDay("2000-01-03", 2),
        },
      },
    });
    expect(result.current.daysShowedUp).toBe(3);
    expect(lastSnapshot().day).toBe(3);
  });

  it("rewrites the snapshot with the new day after midnight", async () => {
    const appState = listenToAppState();
    try {
      fakeClockAt(new Date(2026, 8, 25, 22, 0));
      const { result } = await renderStore({ now: new Date(2026, 8, 25, 22, 0) });
      // Ticking a task records the 25th as a day shown up (counted once it's past).
      await act(async () => result.current.toggleTask("t0"));
      const before = result.current.daysShowedUp;
      expect(lastSnapshot().day).toBe(before);

      jest.setSystemTime(new Date(2026, 8, 26, 8, 0));
      await act(async () => appState.emit("active"));

      expect(result.current.state.lastOpenedDate).toBe("2026-09-26");
      expect(result.current.daysShowedUp).toBe(before + 1);
      expect(lastSnapshot()).toMatchObject({ date: "2026-09-26", day: before + 1 });
    } finally {
      appState.restore();
    }
  });
});

describe("store: widget taps", () => {
  it("applies taps on launch like in-app taps (a perfect day included), then marks them processed", async () => {
    const today = todayKey();
    queue([
      { seq: 1, id: "t0", date: today, done: true },
      { seq: 2, id: "t1", date: today, done: true },
      { seq: 3, id: "t2", date: today, done: true },
    ]);
    const { result } = await renderStore();
    expect(result.current.state.todayCompletions).toEqual(["t0", "t1", "t2"]);
    expect(result.current.state.history[today]).toMatchObject({ total: 3, completed: 3 });
    expect(result.current.state.journey.perfectAwarded).toBe(true);
    expect(markWidgetTogglesProcessed).toHaveBeenCalledWith(3);
  });

  it("lands an evening tap on its own day when the app is only opened the next morning", async () => {
    const evening = new Date(2026, 8, 25, 23, 0);
    const day = todayKey(evening);
    fakeClockAt(new Date(2026, 8, 26, 9, 0));
    queue([{ seq: 1, id: "t2", date: day, done: true }]);
    const { result } = await renderStore({ now: evening, done: ["t0", "t1"] });

    expect(result.current.state.lastOpenedDate).toBe("2026-09-26");
    expect(result.current.state.history[day]).toMatchObject({ total: 3, completed: 3 });
    // Nothing left over from that day to carry into today.
    expect(result.current.state.pendingRollover).toBeNull();
    // XP and the perfect-day bonus go to that day, as if tapped in the app.
    expect(result.current.state.journey).toMatchObject({ awardDate: day, perfectAwarded: true });
    expect(result.current.state.journey.awardedTaskIds).toContain("t2");
    expect(markWidgetTogglesProcessed).toHaveBeenCalledWith(1);
  });

  it("lands an evening tap on its own day when the app comes back to the foreground after midnight", async () => {
    const appState = listenToAppState();
    try {
      fakeClockAt(new Date(2026, 8, 25, 22, 0));
      const { result } = await renderStore({ now: new Date(2026, 8, 25, 22, 0), done: ["t0", "t1"] });
      expect(result.current.state.lastOpenedDate).toBe("2026-09-25");

      queue([{ seq: 1, id: "t2", date: "2026-09-25", done: true }]);
      jest.setSystemTime(new Date(2026, 8, 26, 8, 0));
      await act(async () => appState.emit("active"));

      expect(result.current.state.lastOpenedDate).toBe("2026-09-26");
      expect(result.current.state.history["2026-09-25"]).toMatchObject({ total: 3, completed: 3 });
      expect(result.current.state.pendingRollover).toBeNull();
      expect(markWidgetTogglesProcessed).toHaveBeenCalledWith(1);
    } finally {
      appState.restore();
    }
  });

  it("leaves taps queued when iOS reports 'active' before saved state has loaded, then applies them to the saved day", async () => {
    const appState = listenToAppState();
    try {
      const evening = new Date(2026, 8, 25, 23, 0);
      fakeClockAt(new Date(2026, 8, 26, 9, 0));
      const saved = storage.normalizeState(
        JSON.parse(
          JSON.stringify({
            ...buildInitialState(evening),
            hasSeenOnboarding: true,
            tasks: TASKS,
            todayCompletions: ["t0", "t1"],
          }),
        ),
      );
      let finishLoad!: (value: DailyState | null) => void;
      const load = jest
        .spyOn(storage, "loadState")
        .mockImplementationOnce(() => new Promise((resolve) => (finishLoad = resolve)));
      queue([{ seq: 1, id: "t2", date: "2026-09-25", done: true }]);

      const hook = await renderHook(() => useDailyTasks(), { wrapper });
      // Cold launch: "active" arrives while loadState() is still pending.
      await act(async () => appState.emit("active"));
      expect(hook.result.current.ready).toBe(false);
      expect(markWidgetTogglesProcessed).not.toHaveBeenCalled();
      expect(hook.result.current.state.todayCompletions).toEqual([]);

      await act(async () => finishLoad(saved));
      await waitFor(() => expect(hook.result.current.ready).toBe(true));
      expect(hook.result.current.state.history["2026-09-25"]).toMatchObject({ total: 3, completed: 3 });
      expect(markWidgetTogglesProcessed).toHaveBeenCalledWith(1);
      load.mockRestore();
    } finally {
      appState.restore();
    }
  });

  it("replaying the same queue doesn't un-tick or award twice; other days are ignored", async () => {
    const appState = listenToAppState();
    try {
      const today = todayKey();
      const { result } = await renderStore();
      queue([
        { seq: 1, id: "t0", date: "2000-01-01", done: true },
        { seq: 2, id: "t2", date: today, done: true },
      ]);
      await act(async () => appState.emit("active"));
      expect(result.current.state.todayCompletions).toEqual(["t2"]);
      const xp = result.current.state.journey.xp;

      // processedSeq wasn't saved: the same taps arrive again.
      mockQueue = { ...mockQueue, processedSeq: 0 };
      await act(async () => appState.emit("active"));
      expect(result.current.state.todayCompletions).toEqual(["t2"]);
      expect(result.current.state.journey.xp).toBe(xp);
    } finally {
      appState.restore();
    }
  });

  it("rewrites the snapshot after applying taps even when nothing changed (undoes the widget's optimistic tick)", async () => {
    const appState = listenToAppState();
    try {
      const { result } = await renderStore();
      const writes = (writeWidgetSnapshot as jest.Mock).mock.calls.length;
      queue([{ seq: 1, id: "deleted-task", date: todayKey(), done: true }]);
      await act(async () => appState.emit("active"));
      expect(result.current.state.todayCompletions).toEqual([]);
      expect(invalidateWidgetSnapshot).toHaveBeenCalled();
      expect((writeWidgetSnapshot as jest.Mock).mock.calls.length).toBe(writes + 1);
      expect(lastSnapshot().tasks.every((task) => !task.done)).toBe(true);
    } finally {
      appState.restore();
    }
  });
});
