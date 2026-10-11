// Settings' "Unlock today" row (1.4, PR #87): the only way to unlock a set
// day. It shows only while today is set, asks first with "Keep locked" as the
// prominent answer, and "Unlock" unlocks once and is tracked once.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Alert, type AlertButton } from "react-native";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import SettingsScreen from "@/app/(tabs)/settings";
import { track } from "@/lib/daily-tasks/analytics";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState, type Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

// The real store, with a spy on the one action this row may call.
const mockUnlockToday = jest.fn();
jest.mock("@/lib/daily-tasks/store", () => {
  const actual = jest.requireActual("@/lib/daily-tasks/store");
  return {
    ...actual,
    useDailyTasks: () => {
      const store = actual.useDailyTasks();
      return {
        ...store,
        unlockToday: () => {
          mockUnlockToday();
          store.unlockToday();
        },
      };
    },
  };
});
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({
    paywallBuild: false,
    paywallEnabled: false,
    entitlementActive: false,
    openPaywall: jest.fn(),
    restore: jest.fn(),
    redeemCode: jest.fn(),
  }),
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

const tracked = track as jest.Mock;
const unlockEvents = () => tracked.mock.calls.filter((call) => call[0] === "day_unlocked");

// Local times (day keys and the auto-set time are local; CI runs several zones).
const D = "2026-10-01";
const KEY = "daily-tasks/state/v1";
const WALK: Task = { id: "t0", text: "Walk", createdAt: new Date(2026, 9, 1, 8).toISOString(), carriedOver: false };
const NOON = { enabled: true, hour: 12, minute: 0 };
const MANUAL = { todayLocked: true, todayLockSource: "manual" as const, todayLockedAt: new Date(2026, 9, 1, 9).toISOString() };

let alert: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  __resetStorageForTests();
  await AsyncStorage.clear();
  // Fake only the clock; real timers keep RNTL's async waits working.
  jest.useFakeTimers({
    now: new Date(2026, 9, 1, 12, 30),
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
  });
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  alert.mockRestore();
  jest.useRealTimers();
});

/** Auto-set is off unless a test turns it on, so only `saved` decides whether the day is set. */
async function renderSettings(saved: Partial<AppState>) {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 9, 1, 8)),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    tasks: [WALK],
    ...saved,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
  await render(
    <DailyTasksProvider>
      <SettingsScreen />
    </DailyTasksProvider>,
  );
  // The screen is up with the saved state loaded (the auto-set switch is its neighbour).
  await waitFor(() => expect(screen.getByRole("link", { name: "Rate Three Today" })).toBeOnTheScreen());
}

const row = () => screen.queryByTestId("settings-unlock-today");
const savedState = async (): Promise<AppState> => JSON.parse((await AsyncStorage.getItem(KEY)) ?? "null");

/** Tap the row and hand back the alert's title, message and buttons. */
async function openConfirm() {
  await fireEvent.press(screen.getByRole("button", { name: "Unlock today" }));
  expect(alert).toHaveBeenCalledTimes(1);
  const [title, message, buttons] = alert.mock.calls[0] as [string, string, AlertButton[]];
  return { title, message, buttons };
}

describe("Settings: Unlock today (1.4)", () => {
  it("has no row while today isn't set (and nothing else offers an unlock)", async () => {
    await renderSettings({});
    expect(row()).toBeNull();
    expect(screen.queryByText(/unlock/i)).toBeNull();
    expect(alert).not.toHaveBeenCalled();
  });

  it.each([
    ["set by hand", MANUAL],
    // Launched at 12:30 with a task from 08:00 and auto-set at noon: the store sets it.
    ["set automatically", { autoLock: NOON }],
  ])("shows the row while today is %s", async (_how, saved) => {
    await renderSettings(saved);
    await waitFor(() => expect(row()).toBeOnTheScreen());
    const button = screen.getByRole("button", { name: "Unlock today" });
    expect(button).toBe(row());
    expect(button.props.accessibilityHint).toBe("Asks first, then lets you change today's three");
  });

  it("asks first: 'Keep locked' is the cancel and the preferred button, 'Unlock' is plain (not red)", async () => {
    await renderSettings(MANUAL);
    const { title, message, buttons } = await openConfirm();
    expect(title).toBe("Unlock today's three?");
    expect(message).toBe("You set these on purpose.");
    expect(buttons.map(({ text, style, isPreferred }) => ({ text, style, isPreferred: isPreferred ?? false }))).toEqual([
      { text: "Keep locked", style: "cancel", isPreferred: true },
      { text: "Unlock", style: "default", isPreferred: false },
    ]);
    // Nothing happened yet: asking isn't unlocking.
    expect(mockUnlockToday).not.toHaveBeenCalled();
    expect(unlockEvents()).toEqual([]);
    expect(row()).toBeOnTheScreen();
  });

  it("Keep locked does nothing: still set, the row stays, nothing tracked or announced", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    await renderSettings(MANUAL);
    const { buttons } = await openConfirm();
    await act(async () => buttons.find((b) => b.text === "Keep locked")?.onPress?.());
    expect(mockUnlockToday).not.toHaveBeenCalled();
    expect(unlockEvents()).toEqual([]);
    expect(announce).not.toHaveBeenCalled();
    expect(row()).toBeOnTheScreen();
    expect((await savedState()).todayLocked).toBe(true);
    announce.mockRestore();
  });

  it("Unlock unlocks today once, tracks day_unlocked {source: settings} once, and the row goes", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
    // Auto-set at noon, now 12:30: the unlock must hold (no re-lock bringing the row back).
    await renderSettings({ autoLock: NOON });
    await waitFor(() => expect(row()).toBeOnTheScreen());
    const { buttons } = await openConfirm();
    await act(async () => buttons.find((b) => b.text === "Unlock")?.onPress?.());

    expect(mockUnlockToday).toHaveBeenCalledTimes(1);
    expect(unlockEvents()).toEqual([["day_unlocked", { source: "settings" }]]);
    expect(announce).toHaveBeenCalledWith("Today is unlocked. You can change your three.");
    await waitFor(() => expect(row()).toBeNull());
    await waitFor(async () => {
      const saved = await savedState();
      expect(saved.todayLocked).toBe(false);
      expect(saved.manualUnlockDate).toBe(D);
    });
    // Still gone once everything has settled: auto-set didn't take it back.
    for (let i = 0; i < 6; i++) await act(async () => {});
    expect(row()).toBeNull();
    expect(mockUnlockToday).toHaveBeenCalledTimes(1);
    expect(unlockEvents()).toHaveLength(1);
    announce.mockRestore();
  });
});
