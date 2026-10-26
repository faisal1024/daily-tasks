// Settings' "Unlock today" row (1.4, PR #87): the only way to unlock a set
// day. It shows only while today is set (first on the screen), asks first with
// "Keep locked" as the prominent answer (the words differ for a day set by hand
// and one set automatically), and "Unlock" unlocks once, is tracked once, and
// says so on screen. An unlock that changed nothing is neither tracked nor said.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, type AlertButton } from "react-native";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import SettingsScreen from "@/app/(tabs)/settings";
import { track } from "@/lib/daily-tasks/analytics";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState, type Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

// The real store, with a spy on the one action this row may call. A test can
// make the store's answer "nothing was unlocked" (mockRefuseUnlock).
const mockUnlockToday = jest.fn();
let mockRefuseUnlock = false;
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
          if (mockRefuseUnlock) return false;
          return store.unlockToday();
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
jest.mock("@/lib/daily-tasks/announce", () => ({ announcePolitely: jest.fn() }));
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
const announce = announcePolitely as jest.Mock;
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
  mockRefuseUnlock = false;
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
const note = () => screen.queryByTestId("settings-unlocked-note");
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

  it("asks first: 'Keep locked' is the cancel, 'Unlock' the clear (preferred, not red) action (1.5)", async () => {
    await renderSettings(MANUAL);
    const { title, message, buttons } = await openConfirm();
    expect(title).toBe("Unlock today?");
    expect(message).toBe("Your three will be open to change again. You can lock today again any time.");
    expect(buttons.map(({ text, style, isPreferred }) => ({ text, style, isPreferred: isPreferred ?? false }))).toEqual([
      { text: "Keep locked", style: "cancel", isPreferred: false },
      { text: "Unlock", style: "default", isPreferred: true },
    ]);
    // Nothing happened yet: asking isn't unlocking.
    expect(mockUnlockToday).not.toHaveBeenCalled();
    expect(unlockEvents()).toEqual([]);
    expect(row()).toBeOnTheScreen();
  });

  it("on a 24-hour device the confirm says the time the 24-hour way, as Today's status line does", async () => {
    // What the system hands back with 24-hour time on (the app passes no locale or hour cycle of its own).
    const clock = jest.spyOn(Date.prototype, "toLocaleTimeString").mockImplementation(function (this: Date) {
      return `${String(this.getHours()).padStart(2, "0")}:${String(this.getMinutes()).padStart(2, "0")}`;
    });
    await renderSettings({ autoLock: { ...NOON, hour: 12, minute: 15 } });
    await waitFor(() => expect(row()).toBeOnTheScreen());
    const { message } = await openConfirm();
    expect(message).toBe("Today was locked automatically at 12:15. Unlocking keeps it open for the rest of today.");
    expect(message).not.toMatch(/AM|PM/);
    for (const call of clock.mock.calls) expect(call).toEqual([undefined, { hour: "numeric", minute: "2-digit" }]);
    clock.mockRestore();
  });

  it("a day set automatically asks with its own words (same title, same buttons, same rule)", async () => {
    // Launched at 12:30 with auto-set at noon: the store sets it, stamped with the auto-set time.
    await renderSettings({ autoLock: NOON });
    await waitFor(() => expect(row()).toBeOnTheScreen());
    const { title, message, buttons } = await openConfirm();
    expect(title).toBe("Unlock today?");
    expect(message).toBe(
      "Today was locked automatically at 12:00 PM. Unlocking keeps it open for the rest of today.",
    );
    expect(message).not.toMatch(/—/);
    expect(buttons.map(({ text, style, isPreferred }) => ({ text, style, isPreferred: isPreferred ?? false }))).toEqual([
      { text: "Keep locked", style: "cancel", isPreferred: false },
      { text: "Unlock", style: "default", isPreferred: true },
    ]);
  });

  it("is the first card in Settings while today is set (above every other card)", async () => {
    await renderSettings(MANUAL);
    const json = JSON.stringify(screen.toJSON());
    const rowAt = json.indexOf('"accessibilityLabel":"Unlock today"');
    expect(rowAt).toBeGreaterThanOrEqual(0);
    // Under the screen's title, and above every card and section that follows.
    expect(rowAt).toBeGreaterThan(json.indexOf("Tune your day"));
    for (const later of ["Lock the day automatically", "Locking the day", "settings-routines", "Rate Three Today"]) {
      expect(json.indexOf(later)).toBeGreaterThan(rowAt);
    }
    // Nothing to tap or switch comes before it.
    const firstControl = json.search(/"accessibilityRole":"(button|switch|link)"/);
    expect(json.slice(firstControl).startsWith('"accessibilityRole":"button","accessibilityLabel":"Unlock today"')).toBe(true);
  });

  it("Keep locked does nothing: still set, the row stays, nothing tracked or announced", async () => {
    await renderSettings(MANUAL);
    const { buttons } = await openConfirm();
    await act(async () => buttons.find((b) => b.text === "Keep locked")?.onPress?.());
    expect(mockUnlockToday).not.toHaveBeenCalled();
    expect(unlockEvents()).toEqual([]);
    expect(announce).not.toHaveBeenCalled();
    expect(note()).toBeNull();
    expect(row()).toBeOnTheScreen();
    expect((await savedState()).todayLocked).toBe(true);
  });

  it("an Unlock that unlocked nothing (the alert sat open past midnight) isn't tracked, announced or confirmed", async () => {
    await renderSettings(MANUAL);
    const { buttons } = await openConfirm();
    mockRefuseUnlock = true;
    await act(async () => buttons.find((b) => b.text === "Unlock")?.onPress?.());
    expect(mockUnlockToday).toHaveBeenCalledTimes(1);
    expect(unlockEvents()).toEqual([]);
    expect(announce).not.toHaveBeenCalled();
    expect(note()).toBeNull();
    expect(screen.queryByText("Today is unlocked.")).toBeNull();
  });

  it("Unlock unlocks today once, tracks day_unlocked {source: settings} once, says so, and the row goes", async () => {
    // Auto-set at noon, now 12:30: the unlock must hold (no re-lock bringing the row back).
    await renderSettings({ autoLock: NOON });
    await waitFor(() => expect(row()).toBeOnTheScreen());
    const { buttons } = await openConfirm();
    await act(async () => buttons.find((b) => b.text === "Unlock")?.onPress?.());

    expect(mockUnlockToday).toHaveBeenCalledTimes(1);
    expect(unlockEvents()).toEqual([["day_unlocked", { source: "settings" }]]);
    // Said through the polite helper (once), and shown where the row was.
    expect(announce.mock.calls).toEqual([["Today is unlocked."]]);
    await waitFor(() => expect(row()).toBeNull());
    // (The icon is part of the note's content, so match the words.)
    expect(note()).toHaveTextContent(/Today is unlocked\.$/);
    expect(screen.getByText("Today is unlocked.")).toBeOnTheScreen();
    expect(note()?.props.accessibilityLiveRegion).toBe("polite");
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
  });
});
