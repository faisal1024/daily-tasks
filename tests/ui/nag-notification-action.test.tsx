// Nag mode (1.4): the "Stop for today" button on a nag. The category is
// registered at launch; a tap on the button pauses today's nags (the same as
// the Settings button), also when that tap is what launched the app. A plain
// tap on a nag, and any other notification's buttons, pause nothing.
import type { ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import { track } from "@/lib/daily-tasks/analytics";
import { NAG_ACTION_STOP, parseNagNotificationResponse } from "@/lib/daily-tasks/notifications";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type Task } from "@/lib/daily-tasks/types";

jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallBuild: true, paywallEnabled: true, entitlementActive: true, entitlementKnown: true, paywallSource: null, openPaywall: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  getPresentedNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  dismissNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const mocked = Notifications as jest.Mocked<typeof Notifications>;
const tracked = track as jest.Mock;
const D = "2026-10-12";
const KEY = "daily-tasks/state/v1";
const WALK: Task = { id: "t0", text: "Walk", createdAt: new Date(2026, 9, 12, 8).toISOString(), carriedOver: false };

type Response = Notifications.NotificationResponse;
const response = (identifier: string, actionIdentifier: string, date = 1): Response =>
  ({ actionIdentifier, notification: { date, request: { identifier, content: { data: { kind: "nag", step: 2 } } } } }) as unknown as Response;
const TODAY_NAG = `daily-tasks:${D}:nag:1405`;
const DEFAULT_TAP = "expo.modules.notifications.actions.DEFAULT";

const wrapper = ({ children }: { children: ReactNode }) => <DailyTasksProvider>{children}</DailyTasksProvider>;
const realFetch = globalThis.fetch;

async function openApp() {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 9, 12, 8)),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    tasks: [WALK],
    notifications: { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true },
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
  const hook = await renderHook(() => useDailyTasks(), { wrapper });
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

/** The listener the store gave the system for taps on a nag (the focus timer has its own). */
const tap = (given: Response) =>
  act(async () => {
    for (const [listener] of mocked.addNotificationResponseReceivedListener.mock.calls) listener(given);
  });

beforeEach(async () => {
  jest.clearAllMocks();
  mocked.getLastNotificationResponse.mockImplementation(() => null);
  __resetStorageForTests();
  await AsyncStorage.clear();
  jest.useFakeTimers({
    now: new Date(2026, 9, 12, 14, 10),
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
  });
  globalThis.fetch = jest.fn(async () => {
    throw new Error("network used");
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = realFetch;
});

describe("a nag's 'Stop for today'", () => {
  it("is recognised only on a nag, and only for that button", () => {
    expect(parseNagNotificationResponse(response(TODAY_NAG, NAG_ACTION_STOP))).toEqual({ action: "stop", dayKey: D });
    expect(parseNagNotificationResponse(response(TODAY_NAG, DEFAULT_TAP))).toBeNull();
    expect(parseNagNotificationResponse(response(`daily-tasks:${D}:progress:1400`, NAG_ACTION_STOP))).toBeNull();
    expect(parseNagNotificationResponse(response("three-today:focus-timer", NAG_ACTION_STOP))).toBeNull();
    expect(parseNagNotificationResponse(response("daily-tasks:someday:nag:1400", NAG_ACTION_STOP))).toBeNull();
    expect(parseNagNotificationResponse(null)).toBeNull();
    expect(parseNagNotificationResponse(undefined)).toBeNull();
  });

  it("the category is registered at launch: one button, 'Stop for today', which opens the app", async () => {
    await openApp();
    const nag = mocked.setNotificationCategoryAsync.mock.calls.find(([id]) => id === "three-today:nag");
    expect(nag).toBeTruthy();
    expect(nag![1]).toEqual([{ identifier: "nag-stop-today", buttonTitle: "Stop for today", options: { opensAppToForeground: true } }]);
  });

  it("pauses today's nags, once, and says where it came from", async () => {
    const { result } = await openApp();
    expect(result.current.state.notifications.nagPausedDate).toBeNull();
    await tap(response(TODAY_NAG, NAG_ACTION_STOP));
    expect(result.current.state.notifications.nagPausedDate).toBe(D);
    // Still Nag: tomorrow it is back.
    expect(result.current.state.notifications.style).toBe("nag");
    await tap(response(TODAY_NAG, NAG_ACTION_STOP));
    await tap(response(`daily-tasks:${D}:nag:1630`, NAG_ACTION_STOP, 2));
    expect(tracked.mock.calls.filter((call) => call[0] === "nag_paused_today")).toEqual([["nag_paused_today", { source: "notification" }]]);
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}").notifications.nagPausedDate).toBe(D));
  });

  it("a plain tap on a nag, another day's nag and another reminder's button pause nothing", async () => {
    const { result } = await openApp();
    await tap(response(TODAY_NAG, DEFAULT_TAP));
    await tap(response("daily-tasks:2026-10-11:nag:2005", NAG_ACTION_STOP));
    await tap(response(`daily-tasks:${D}:evening:1900`, NAG_ACTION_STOP));
    expect(result.current.state.notifications.nagPausedDate).toBeNull();
    expect(tracked.mock.calls.filter((call) => call[0] === "nag_paused_today")).toEqual([]);
  });

  it("the tap that launched the app is applied once the saved state has loaded", async () => {
    mocked.getLastNotificationResponse.mockImplementation(() => response(TODAY_NAG, NAG_ACTION_STOP));
    const { result } = await openApp();
    await waitFor(() => expect(result.current.state.notifications.nagPausedDate).toBe(D));
    expect(result.current.state.tasks).toHaveLength(1);
    expect(mocked.clearLastNotificationResponse).toHaveBeenCalled();
  });
});
