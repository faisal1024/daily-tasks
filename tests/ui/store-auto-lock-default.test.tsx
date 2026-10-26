// 1.5 A: auto-lock starts OFF for a new install and after "Reset all data",
// while saves from 1.4.x keep their value and older saves (no field) still
// read ON, on the real store. Local-time fixtures (CI runs in several zones).
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";

import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, Task } from "@/lib/daily-tasks/types";

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

const KEY = "daily-tasks/state/v1";
const WALK: Task = { id: "t0", text: "Walk", createdAt: new Date(2026, 9, 1, 8).toISOString(), carriedOver: false };
const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
  // 12:30 on 1 Oct: after noon, so an auto-lock at noon is due. Fake only the clock.
  jest.useFakeTimers({
    now: new Date(2026, 9, 1, 12, 30),
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
  });
});
afterEach(() => jest.useRealTimers());

async function launch(saved?: Record<string, unknown>) {
  if (saved) {
    const state: AppState = {
      ...buildInitialState(new Date(2026, 9, 1, 8)),
      hasSeenOnboarding: true,
      tasks: [WALK],
      ...saved,
    } as AppState;
    const raw = JSON.parse(JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
    if (saved.autoLock === undefined) delete raw.autoLock;
    await AsyncStorage.setItem(KEY, JSON.stringify(raw));
  }
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  for (let i = 0; i < 4; i++) await act(async () => {});
  return hook;
}

describe("auto-lock default (1.5), on the real store", () => {
  it("a new install starts with auto-lock off", async () => {
    const { result } = await launch();
    expect(result.current.state.autoLock).toEqual({ enabled: false, hour: 12, minute: 0 });
  });

  it("Reset all data puts it back to off, even if it was on", async () => {
    const { result } = await launch({ autoLock: { enabled: true, hour: 9, minute: 15 }, tasks: [] });
    expect(result.current.state.autoLock).toEqual({ enabled: true, hour: 9, minute: 15 });
    await act(async () => result.current.resetAll());
    expect(result.current.state.autoLock).toEqual({ enabled: false, hour: 12, minute: 0 });
  });

  it("a 1.4.x save with auto-lock on keeps it, and locks a day with a task after its time", async () => {
    const { result } = await launch({ autoLock: { enabled: true, hour: 12, minute: 0 } });
    expect(result.current.state.autoLock.enabled).toBe(true);
    await waitFor(() => expect(result.current.state.todayLocked).toBe(true));
    expect(result.current.state.todayLockSource).toBe("auto");
  });

  it("a 1.4.x save with auto-lock off keeps it off, and nothing locks", async () => {
    const { result } = await launch({ autoLock: { enabled: false, hour: 12, minute: 0 } });
    expect(result.current.state.autoLock.enabled).toBe(false);
    expect(result.current.state.todayLocked).toBe(false);
  });

  it("an older save without the field reads as on, as those builds ran, and locks too", async () => {
    const { result } = await launch({ autoLock: undefined });
    expect(result.current.state.autoLock).toEqual({ enabled: true, hour: 12, minute: 0 });
    await waitFor(() => expect(result.current.state.todayLocked).toBe(true));
  });
});
