// Settings > Reminders > "What is Nag mode?" (1.4): the row that opens the
// "Meet Nag mode" sheet again. Shown only while Nag is not on; it never
// changes what's-new's seen list; its "Try Nag mode" is the same turn-on flow
// as the Reminder style choice next to it.
import { Alert, type AlertButton } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import SettingsScreen from "@/app/(tabs)/settings";
import { SHEET_SWAP_DELAY_MS } from "@/hooks/use-paywall-gate";
import { track } from "@/lib/daily-tasks/analytics";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type NotificationConfig, type Task } from "@/lib/daily-tasks/types";
import { __setAnnouncementsForTests } from "@/lib/daily-tasks/whats-new";

import { renderWithProviders as render } from "./render";

const FREE = { paywallBuild: true, paywallEnabled: true, entitlementActive: false, entitlementKnown: true, paywallSource: null as string | null };
const PLUS = { ...FREE, entitlementActive: true };
let mockPlus: typeof FREE;
const mockOpenPaywall = jest.fn((_source: string) => true);
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: mockOpenPaywall, restore: jest.fn(), redeemCode: jest.fn() }),
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
  getPresentedNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  dismissNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const tracked = track as jest.Mock;
const eventsNamed = (name: string) => tracked.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);

const KEY = "daily-tasks/state/v1";
const ID = "1.4-nag";
const DENTIST: Task = { id: "t0", text: "Call the dentist", createdAt: new Date(2026, 9, 12, 8).toISOString(), carriedOver: false };

let alert: jest.SpyInstance;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  jest.clearAllMocks();
  __setAnnouncementsForTests(null);
  mockPlus = { ...PLUS };
  mockOpenPaywall.mockImplementation(() => true);
  __resetStorageForTests();
  await AsyncStorage.clear();
  jest.useFakeTimers({
    now: new Date(2026, 9, 12, 8, 30),
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "nextTick"],
  });
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  globalThis.fetch = jest.fn(async () => {
    throw new Error("network used");
  }) as unknown as typeof fetch;
});

afterEach(() => {
  alert.mockRestore();
  jest.useRealTimers();
  globalThis.fetch = realFetch;
});

const tree = () => (
  <DailyTasksProvider>
    <SettingsScreen />
  </DailyTasksProvider>
);

async function renderSettings(notifications: Partial<NotificationConfig> = {}, extra: Partial<AppState> = {}) {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 9, 12, 8)),
    hasSeenOnboarding: true,
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    tasks: [DENTIST],
    notifications: { ...DEFAULT_NOTIFICATIONS, ...notifications },
    ...extra,
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
  const view = await render(tree());
  await waitFor(() => expect(screen.getByRole("header", { name: "Reminder style" })).toBeOnTheScreen());
  await waitFor(() => expect(screen.getByRole("link", { name: "Rate Three Today" })).toBeOnTheScreen());
  return view;
}

const saved = async (): Promise<AppState> => JSON.parse((await AsyncStorage.getItem(KEY)) ?? "null");
const row = () => screen.queryByRole("button", { name: "What is Nag mode?" });
const sheet = () => screen.queryByTestId("nag-intro-sheet");
const inSheet = () => within(screen.getByTestId("nag-intro-sheet"));
const styleChecked = (name: string) => screen.getByRole("radio", { name }).props.accessibilityState.checked;
const lastAlert = () => alert.mock.calls[alert.mock.calls.length - 1] as [string, string, AlertButton[]];
const pressAlertButton = (text: string) => act(async () => lastAlert()[2].find((button) => button.text === text)!.onPress?.());
const wait = (ms: number) => act(async () => new Promise<void>((resolve) => setTimeout(resolve, ms)));
async function openIntro() {
  await fireEvent.press(row()!);
  await waitFor(() => expect(sheet()).toBeOnTheScreen());
}

describe("Settings: What is Nag mode?", () => {
  it("is under the style card while Calm is the style, and opens the same sheet", async () => {
    await renderSettings({}, { whatsNewSeen: [ID] });
    expect(row()).toBeOnTheScreen();
    expect(screen.getByTestId("settings-nag-intro").props.style).toMatchObject({ minHeight: 44 });
    expect(sheet()).toBeNull();
    await openIntro();
    expect(inSheet().getByRole("header", { name: "Meet Nag mode" })).toBeOnTheScreen();
    expect(inSheet().getByText("New in 1.4")).toBeOnTheScreen();
    expect(screen.getByTestId("nag-intro-sample").props.children).toContain("“Call the dentist”");
    expect(eventsNamed("whats_new_shown")).toEqual([{ id: ID, source: "settings" }]);
  });

  it("it doesn't come up by itself in Settings, and opening it never changes what's been seen", async () => {
    // Someone who updated and hasn't had the sheet on Today yet.
    const { whatsNewSeen: _dropped, ...before14 } = syncTodayHistory(
      { ...buildInitialState(new Date(2026, 9, 12, 8)), hasSeenOnboarding: true, autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false }, tasks: [DENTIST] },
      "2026-10-12",
    );
    await AsyncStorage.setItem(KEY, JSON.stringify(before14));
    await render(tree());
    await waitFor(() => expect(screen.getByRole("link", { name: "Rate Three Today" })).toBeOnTheScreen());
    await wait(900);
    expect(sheet()).toBeNull();
    await openIntro();
    await fireEvent.press(inSheet().getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(sheet()).toBeNull());
    await wait(100);
    expect((await saved()).whatsNewSeen ?? []).toEqual([]);
    expect((await saved()).notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "dismiss", persona: "mom", level: "firm", source: "settings" }]);
    // Still there to open again.
    expect(row()).toBeOnTheScreen();
  });

  it("is gone while Nag is on", async () => {
    await renderSettings({ style: "nag", nagConfirmed: true });
    expect(screen.getByTestId("settings-nag")).toBeOnTheScreen();
    expect(row()).toBeNull();
  });

  it("is there for a saved Nag that is waiting for Plus", async () => {
    mockPlus = { ...FREE };
    await renderSettings({ style: "nag", nagConfirmed: true });
    expect(row()).toBeOnTheScreen();
    await openIntro();
    expect(inSheet().getByText("Nag mode is part of Plus. Calm reminders stay free.")).toBeOnTheScreen();
  });

  it("starts on the saved voice and level", async () => {
    await renderSettings({ nagPersona: "coach", nagLevel: "gentle" });
    await openIntro();
    expect(inSheet().getByRole("radio", { name: "Voice: Coach" }).props.accessibilityState.checked).toBe(true);
    expect(inSheet().getByRole("radio", { name: "Level: Gentle" }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId("nag-intro-preview-title").props.children).toBe("Three Today · Coach");
  });

  it("Plus: Try Nag mode asks the question, and Turn on turns it on with what was picked", async () => {
    await renderSettings();
    await openIntro();
    await fireEvent.press(inSheet().getByRole("radio", { name: "Voice: Spouse" }));
    await fireEvent.press(inSheet().getByRole("radio", { name: "Level: Relentless" }));
    await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(lastAlert()[0]).toBe("Turn on Nag mode?");
    expect(sheet()).toBeOnTheScreen();
    expect(styleChecked("Calm")).toBe(true);
    await pressAlertButton("Turn on");
    await waitFor(() => expect(sheet()).toBeNull());
    await waitFor(() => expect(styleChecked("Nag")).toBe(true));
    expect(row()).toBeNull();
    expect(screen.getByRole("radio", { name: "Voice: Spouse" }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole("radio", { name: "Level: Relentless" }).props.accessibilityState.checked).toBe(true);
    expect(announcePolitely).toHaveBeenCalledWith("Nag mode is on");
    await waitFor(async () =>
      expect((await saved()).notifications).toMatchObject({ style: "nag", nagConfirmed: true, nagPersona: "spouse", nagLevel: "relentless" }),
    );
    expect(eventsNamed("nag_mode_enabled")).toEqual([{ persona: "spouse", level: "relentless" }]);
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "try", persona: "spouse", level: "relentless", source: "settings" }]);
  });

  it("Plus, the question already answered once: it turns on with one tap", async () => {
    await renderSettings({ nagConfirmed: true });
    await openIntro();
    await fireEvent.press(inSheet().getByRole("radio", { name: "Voice: Coach" }));
    await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
    await waitFor(() => expect(styleChecked("Nag")).toBe(true));
    expect(alert).not.toHaveBeenCalled();
    expect(sheet()).toBeNull();
    await waitFor(async () => expect((await saved()).notifications).toMatchObject({ style: "nag", nagPersona: "coach", nagLevel: "firm" }));
  });

  it("free: Try Nag mode closes the sheet and opens the paywall (source nag_mode); bought there, the question follows", async () => {
    mockPlus = { ...FREE };
    const view = await renderSettings();
    await openIntro();
    await fireEvent.press(inSheet().getByRole("radio", { name: "Voice: Drill sergeant" }));
    await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
    await waitFor(() => expect(sheet()).toBeNull());
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    await wait(SHEET_SWAP_DELAY_MS + 100);
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
    expect(mockOpenPaywall).toHaveBeenCalledWith("nag_mode");
    expect(eventsNamed("plus_gate_hit")).toEqual([{ feature: "nag_mode" }]);
    expect(alert).not.toHaveBeenCalled();

    mockPlus = { ...FREE, paywallSource: "nag_mode" };
    await view.rerender(tree());
    mockPlus = { ...PLUS };
    await view.rerender(tree());
    await wait(SHEET_SWAP_DELAY_MS + 100);
    // Once: the style choice's own gate didn't open this paywall, so it asks nothing.
    expect(alert).toHaveBeenCalledTimes(1);
    expect(lastAlert()[0]).toBe("Turn on Nag mode?");
    await pressAlertButton("Turn on");
    await waitFor(() => expect(styleChecked("Nag")).toBe(true));
    await waitFor(async () => expect((await saved()).notifications).toMatchObject({ style: "nag", nagPersona: "drill", nagLevel: "firm" }));
  });

  it("a saved Nag waiting for Plus, bought from here: the voice picked here is the one saved", async () => {
    mockPlus = { ...FREE };
    const view = await renderSettings({ style: "nag", nagConfirmed: true, nagPersona: "mom" });
    await openIntro();
    await fireEvent.press(inSheet().getByRole("radio", { name: "Voice: Coach" }));
    await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
    await wait(SHEET_SWAP_DELAY_MS + 100);
    mockPlus = { ...FREE, paywallSource: "nag_mode" };
    await view.rerender(tree());
    mockPlus = { ...PLUS };
    await view.rerender(tree());
    await wait(SHEET_SWAP_DELAY_MS + 100);
    expect(alert).not.toHaveBeenCalled();
    await waitFor(() => expect(styleChecked("Nag")).toBe(true));
    await waitFor(async () => expect((await saved()).notifications).toMatchObject({ style: "nag", nagPersona: "coach" }));
  });

  it("the style choice still works as before next to it", async () => {
    await renderSettings();
    await fireEvent.press(screen.getByRole("radio", { name: "Nag" }));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    await pressAlertButton("Turn on");
    await waitFor(() => expect(styleChecked("Nag")).toBe(true));
    expect(eventsNamed("nag_mode_enabled")).toEqual([{ persona: "mom", level: "firm" }]);
    expect(eventsNamed("whats_new_shown")).toEqual([]);
    // Back to Calm: the row is back.
    await fireEvent.press(screen.getByRole("radio", { name: "Calm" }));
    await waitFor(() => expect(row()).toBeOnTheScreen());
  });
});
