// The real DailyTasksProvider with the widget bridge mocked: the snapshot the
// widget gets, and ticks made in the widget applied like in-app taps.
import type { ReactNode } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { todayKey } from "@/lib/daily-tasks/date";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { Task } from "@/lib/daily-tasks/types";
import {
  markWidgetTogglesProcessed,
  writeWidgetSnapshot,
} from "@/lib/daily-tasks/widget-bridge";
import type { WidgetSnapshot, WidgetToggle } from "@/lib/daily-tasks/widget-snapshot";

let mockQueue: { raw: string | null; processedSeq: number } = { raw: null, processedSeq: 0 };
jest.mock("@/lib/daily-tasks/widget-bridge", () => ({
  writeWidgetSnapshot: jest.fn(),
  readWidgetToggles: jest.fn(() => mockQueue),
  markWidgetTogglesProcessed: jest.fn((seq: number) => {
    mockQueue = { ...mockQueue, processedSeq: seq };
  }),
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

const wrapper = ({ children }: { children: ReactNode }) => (
  <DailyTasksProvider>{children}</DailyTasksProvider>
);

async function renderStore() {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true, tasks: TASKS }),
  );
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

beforeEach(async () => {
  mockQueue = { raw: null, processedSeq: 0 };
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe("store: widget", () => {
  it("writes today's tasks to the widget once loaded, and again when one is completed", async () => {
    const { result } = await renderStore();
    const today = todayKey();
    expect(lastSnapshot()).toMatchObject({
      date: today,
      tasks: [
        { id: "t0", text: "Walk", done: false },
        { id: "t1", text: "Read", done: false },
        { id: "t2", text: "Stretch", done: false },
      ],
    });
    await act(async () => result.current.toggleTask("t1"));
    expect(lastSnapshot().tasks[1]).toEqual({ id: "t1", text: "Read", done: true });
  });

  it("applies ticks made in the widget on launch like in-app taps (a perfect day included), then marks them processed", async () => {
    const today = todayKey();
    queue([
      { seq: 1, id: "t0", date: today, done: true },
      { seq: 2, id: "t1", date: today, done: true },
      { seq: 3, id: "t2", date: today, done: true },
    ]);
    const { result } = await renderStore();
    await waitFor(() => expect(result.current.completedCount).toBe(3));
    expect(result.current.state.todayCompletions).toEqual(["t0", "t1", "t2"]);
    expect(result.current.state.history[today]).toMatchObject({ total: 3, completed: 3 });
    expect(result.current.state.journey.perfectAwarded).toBe(true);
    expect(markWidgetTogglesProcessed).toHaveBeenCalledWith(3);
  });

  it("applies new ticks when the app comes to the foreground; replaying the queue or a stale day changes nothing", async () => {
    const appState = listenToAppState();
    try {
      const today = todayKey();
      const { result } = await renderStore();
      expect(result.current.state.todayCompletions).toEqual([]);

      queue([
        { seq: 1, id: "t0", date: "2000-01-01", done: true }, // an old day's widget
        { seq: 2, id: "t2", date: today, done: true },
      ]);
      await act(async () => appState.emit("active"));
      expect(result.current.state.todayCompletions).toEqual(["t2"]);
      expect(markWidgetTogglesProcessed).toHaveBeenLastCalledWith(2);
      const xp = result.current.state.journey.xp;

      // The same queue again (e.g. processedSeq wasn't saved): no double award.
      mockQueue = { ...mockQueue, processedSeq: 0 };
      await act(async () => appState.emit("active"));
      expect(result.current.state.todayCompletions).toEqual(["t2"]);
      expect(result.current.state.journey.xp).toBe(xp);
    } finally {
      appState.restore();
    }
  });

  // BUG (reported, not fixed): a tick made in the widget late in the evening is
  // lost if the app isn't opened before midnight. On the next launch/foreground
  // the toggle's date is yesterday, so tasksToFlip drops it and it's marked
  // processed; yesterday's history never gets the completion (and a streak
  // kept alive only by that widget tick breaks).
  it.todo(
    "applies a widget tick from before midnight to yesterday's record when the app next opens",
  );
});
