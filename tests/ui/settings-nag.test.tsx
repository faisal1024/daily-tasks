// Settings > Reminders > Reminder style (1.4): Calm or Nag. Nag is Plus-only
// (a free user goes to the paywall) and opt-in (asked once, with what is sent
// said plainly). With Nag on: the voice, the level, the window, a sample line
// and "Stop nagging me today".
import { Alert, type AlertButton } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as Notifications from "expo-notifications";

import SettingsScreen from "@/app/(tabs)/settings";
import { SHEET_SWAP_DELAY_MS } from "@/hooks/use-paywall-gate";
import { track } from "@/lib/daily-tasks/analytics";
import { formatTime } from "@/lib/daily-tasks/date";
import { NAG_TEMPLATES } from "@/lib/daily-tasks/nag";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type NotificationConfig, type Task } from "@/lib/daily-tasks/types";

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

const mocked = Notifications as jest.Mocked<typeof Notifications>;
const tracked = track as jest.Mock;
const eventsNamed = (name: string) => tracked.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);

const D = "2026-10-12";
const KEY = "daily-tasks/state/v1";
const DENTIST: Task = { id: "t0", text: "Call the dentist", createdAt: new Date(2026, 9, 12, 8).toISOString(), carriedOver: false };
const NAG_ON: NotificationConfig = { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true };

const CONFIRM_TITLE = "Turn on Nag mode?";
const CONFIRM_MESSAGE =
  "Up to twice a day, your open tasks are sent to our AI service so it can write reminders in the voice you pick. They arrive at random times, at most one an hour, and get pushier while tasks stay open.";
const HIDDEN_NOTE = "With task names hidden, nags won't name your tasks and nothing is sent to our AI service.";
const CALM_NOTE = "Morning reminders still apply. The other calm nudges are paused while Nag is on.";

let alert: jest.SpyInstance;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  jest.clearAllMocks();
  mockPlus = { ...PLUS };
  mockOpenPaywall.mockImplementation(() => true);
  mocked.getPermissionsAsync.mockImplementation(async () => ({ status: "granted", granted: true }) as never);
  mocked.requestPermissionsAsync.mockImplementation(async () => ({ status: "granted", granted: true }) as never);
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

const savedNotifications = async (): Promise<NotificationConfig> => JSON.parse((await AsyncStorage.getItem(KEY)) ?? "null").notifications;
const radio = (name: string) => screen.getByRole("radio", { name });
const checked = (name: string) => radio(name).props.accessibilityState.checked;
const nagCard = () => screen.queryByTestId("settings-nag");
const sample = () => screen.getByTestId("settings-nag-sample").props.children as string;
/** Voice and Level chips say their group: "Voice: Mom", "Level: Firm". */
const voice = (name: string) => radio(`Voice: ${name}`);
const level = (name: string) => radio(`Level: ${name}`);
const openNagHours = async () => {
  await fireEvent.press(screen.getByTestId("settings-nag-hours"));
  await waitFor(() => expect(screen.getByTestId("settings-nag-hours").props.accessibilityState).toMatchObject({ expanded: true }));
};
const picker = (label: string) => screen.getAllByTestId("native-time-picker").find((node) => node.props.accessibilityLabel === label)!;
const lastAlert = () => alert.mock.calls[alert.mock.calls.length - 1] as [string, string, AlertButton[]];
const pressAlertButton = (text: string) => act(async () => lastAlert()[2].find((button) => button.text === text)!.onPress?.());

describe("Settings: Reminder style", () => {
  it("is Calm by default: two choices in a radio group, no nag controls", async () => {
    await renderSettings();
    expect(screen.getAllByLabelText("Reminder style").some((node) => node.props.accessibilityRole === "radiogroup")).toBe(true);
    expect(checked("Calm")).toBe(true);
    expect(checked("Nag")).toBe(false);
    expect(screen.getByText("Calm nudges at set times that say what's still open.")).toBeOnTheScreen();
    expect(nagCard()).toBeNull();
    expect(screen.queryByText("Stop nagging me today")).toBeNull();
    expect(screen.queryByText(HIDDEN_NOTE)).toBeNull();
    expect((await savedNotifications()).style).toBe("calm");
  });

  it("free: Nag carries a Plus mark, and choosing it opens the paywall instead of turning on", async () => {
    mockPlus = { ...FREE };
    await renderSettings();
    expect(screen.getByText("Nag · Plus")).toBeOnTheScreen();
    expect(screen.queryByRole("radio", { name: "Nag" })).toBeNull();
    await fireEvent.press(radio("Nag, Plus"));
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
    expect(mockOpenPaywall).toHaveBeenCalledWith("nag_mode");
    expect(eventsNamed("plus_gate_hit")).toEqual([{ feature: "nag_mode" }]);
    expect(alert).not.toHaveBeenCalled();
    expect(checked("Calm")).toBe(true);
    expect(nagCard()).toBeNull();
    expect((await savedNotifications()).style).toBe("calm");
    expect(eventsNamed("nag_mode_enabled")).toEqual([]);
  });

  it("free, then Plus bought on that paywall: the question is asked once the paywall has closed", async () => {
    mockPlus = { ...FREE };
    const view = await renderSettings();
    await fireEvent.press(radio("Nag, Plus"));
    mockPlus = { ...FREE, paywallSource: "nag_mode" };
    await view.rerender(tree());
    mockPlus = { ...PLUS };
    await view.rerender(tree());
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, SHEET_SWAP_DELAY_MS + 100)));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(lastAlert()[0]).toBe(CONFIRM_TITLE);
    await pressAlertButton("Turn on");
    await waitFor(() => expect(checked("Nag")).toBe(true));
  });

  it("free, paywall dismissed: nothing is asked and nothing turns on", async () => {
    mockPlus = { ...FREE };
    const view = await renderSettings();
    await fireEvent.press(radio("Nag, Plus"));
    mockPlus = { ...FREE, paywallSource: "nag_mode" };
    await view.rerender(tree());
    mockPlus = { ...FREE };
    await view.rerender(tree());
    await act(async () => new Promise<void>((resolve) => setTimeout(resolve, SHEET_SWAP_DELAY_MS + 100)));
    expect(alert).not.toHaveBeenCalled();
    expect(checked("Calm")).toBe(true);
  });

  it("Plus: choosing Nag asks first, in these words", async () => {
    await renderSettings();
    await fireEvent.press(radio("Nag"));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    const [title, message, buttons] = lastAlert();
    expect(title).toBe(CONFIRM_TITLE);
    expect(message).toBe(CONFIRM_MESSAGE);
    expect(buttons.map((button) => button.text)).toEqual(["Not now", "Turn on"]);
    expect(buttons[0].style).toBe("cancel");
    expect(`${title} ${message}`).not.toMatch(/[—–]/);
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    // Not on until answered.
    expect(checked("Nag")).toBe(false);
    expect((await savedNotifications()).style).toBe("calm");
  });

  it("'Not now' leaves it Calm; 'Turn on' turns Nag on, saves it and shows the controls", async () => {
    await renderSettings();
    await fireEvent.press(radio("Nag"));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    await pressAlertButton("Not now");
    expect(checked("Calm")).toBe(true);
    expect(eventsNamed("nag_mode_enabled")).toEqual([]);

    await fireEvent.press(radio("Nag"));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(2));
    await pressAlertButton("Turn on");
    await waitFor(() => expect(checked("Nag")).toBe(true));
    expect(checked("Calm")).toBe(false);
    expect(nagCard()).toBeOnTheScreen();
    expect(screen.getByText("Reminders in a voice you pick, at random times, at most one an hour.")).toBeOnTheScreen();
    await waitFor(async () => expect(await savedNotifications()).toMatchObject({ style: "nag", nagConfirmed: true, nagPersona: "mom", nagLevel: "firm" }));
    expect(eventsNamed("nag_mode_enabled")).toEqual([{ persona: "mom", level: "firm" }]);
  });

  it("is asked once: back to Calm and on again needs no second answer", async () => {
    await renderSettings(NAG_ON);
    expect(checked("Nag")).toBe(true);
    await fireEvent.press(radio("Calm"));
    await waitFor(() => expect(checked("Calm")).toBe(true));
    expect(nagCard()).toBeNull();
    expect(eventsNamed("nag_mode_disabled")).toHaveLength(1);
    await waitFor(async () => expect((await savedNotifications()).style).toBe("calm"));

    await fireEvent.press(radio("Nag"));
    await waitFor(() => expect(checked("Nag")).toBe(true));
    expect(alert).not.toHaveBeenCalled();
    expect(eventsNamed("nag_mode_enabled")).toEqual([{ persona: "mom", level: "firm" }]);
  });

  it("without permission to notify, Nag asks for it; refused, it stays Calm", async () => {
    mocked.getPermissionsAsync.mockImplementation(async () => ({ status: "denied", granted: false, canAskAgain: false }) as never);
    await renderSettings();
    await fireEvent.press(radio("Nag"));
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(lastAlert()[0]).toBe("Notifications unavailable");
    expect(lastAlert()[1]).toBe("Allow notifications in System Settings to get reminders for Today's Three.");
    expect(checked("Calm")).toBe(true);
  });

  it("a saved Nag without Plus shows and behaves as Calm, and the saved choice is kept", async () => {
    mockPlus = { ...FREE };
    await renderSettings({ ...NAG_ON, nagPersona: "coach" });
    expect(checked("Calm")).toBe(true);
    expect(checked("Nag, Plus")).toBe(false);
    expect(nagCard()).toBeNull();
    // Tapping the choice that already shows doesn't throw the saved one away.
    await fireEvent.press(radio("Calm"));
    expect(await savedNotifications()).toMatchObject({ style: "nag", nagPersona: "coach" });
    expect(eventsNamed("nag_mode_disabled")).toEqual([]);
  });

  it("with task names hidden and Nag on, it says nags won't name tasks and nothing is sent, under the style choice", async () => {
    await renderSettings({ ...NAG_ON, hideTaskNames: true });
    expect(screen.getByTestId("settings-nag-hidden-names")).toHaveTextContent(HIDDEN_NOTE);
    expect(HIDDEN_NOTE).not.toMatch(/[—–]/);
  });

  it("the hidden-names note is only for Nag in use: not in Calm, and not for a saved Nag without Plus", async () => {
    const view = await renderSettings({ hideTaskNames: true });
    expect(screen.queryByTestId("settings-nag-hidden-names")).toBeNull();
    expect(screen.queryByText(HIDDEN_NOTE)).toBeNull();
    view.unmount();

    mockPlus = { ...FREE };
    await renderSettings({ ...NAG_ON, hideTaskNames: true });
    expect(checked("Calm")).toBe(true);
    expect(screen.queryByTestId("settings-nag-hidden-names")).toBeNull();
  });
});

describe("Settings: with Nag on", () => {
  it("under the Level chips a line says about how many nags a day the chosen level means", async () => {
    await renderSettings(NAG_ON);
    const note = () => screen.getByTestId("settings-nag-level-count");
    expect(note()).toHaveTextContent("About 7 a day");
    await fireEvent.press(level("Gentle"));
    await waitFor(() => expect(note()).toHaveTextContent("About 4 a day"));
    await fireEvent.press(level("Relentless"));
    await waitFor(() => expect(note()).toHaveTextContent("About 11 a day"));
    await fireEvent.press(level("Firm"));
    await waitFor(() => expect(note()).toHaveTextContent("About 7 a day"));
  });

  it("Nag chosen but notifications denied in iOS: a line says no nags arrive", async () => {
    mocked.getPermissionsAsync.mockImplementation(async () => ({ status: "denied", granted: false, canAskAgain: false }) as never);
    await renderSettings(NAG_ON);
    await waitFor(() =>
      expect(screen.getByTestId("settings-nag-permission-denied")).toHaveTextContent("Notifications are off in System Settings, so no nags arrive."),
    );
    // Nag still shows as the choice, with its controls.
    expect(checked("Nag")).toBe(true);
    expect(nagCard()).not.toBeNull();
  });

  it("the denied line is only for Nag in use with permission denied: not when allowed, not in Calm, not for a saved Nag without Plus", async () => {
    const allowed = await renderSettings(NAG_ON);
    expect(screen.queryByTestId("settings-nag-permission-denied")).toBeNull();
    allowed.unmount();

    mocked.getPermissionsAsync.mockImplementation(async () => ({ status: "denied", granted: false, canAskAgain: false }) as never);
    const calm = await renderSettings();
    // The permission has been read: the reminders card says so.
    await waitFor(() => expect(screen.getByText("Blocked at the system level. You can turn them back on in Settings.")).toBeOnTheScreen());
    expect(screen.queryByTestId("settings-nag-permission-denied")).toBeNull();
    calm.unmount();

    mockPlus = { ...FREE };
    await renderSettings(NAG_ON);
    expect(checked("Calm")).toBe(true);
    expect(screen.queryByTestId("settings-nag-permission-denied")).toBeNull();
  });

  it("the voice and the level are radio groups that save the choice", async () => {
    await renderSettings(NAG_ON);
    for (const [group, names] of [
      ["Voice", ["Mom", "Dad", "Partner", "Coach", "Drill sergeant"]],
      ["Level", ["Gentle", "Firm", "Relentless"]],
    ] as const) {
      const node = screen.getAllByLabelText(group).find((item) => item.props.accessibilityRole === "radiogroup");
      expect(node).toBeTruthy();
      // Each chip says its group, and shows only its own name.
      for (const name of names) {
        expect(radio(`${group}: ${name}`)).toBeOnTheScreen();
        expect(screen.getByText(name)).toBeOnTheScreen();
        expect(screen.queryByRole("radio", { name })).toBeNull();
      }
    }
    const isOn = (name: string) => checked(name);
    expect(["Voice: Mom", "Voice: Dad", "Voice: Partner", "Voice: Coach", "Voice: Drill sergeant"].map(isOn)).toEqual([true, false, false, false, false]);
    expect(["Level: Gentle", "Level: Firm", "Level: Relentless"].map(isOn)).toEqual([false, true, false]);

    await fireEvent.press(voice("Drill sergeant"));
    await fireEvent.press(level("Relentless"));
    await waitFor(() => expect(checked("Voice: Drill sergeant")).toBe(true));
    expect(checked("Voice: Mom")).toBe(false);
    expect(checked("Level: Relentless")).toBe(true);
    expect(checked("Level: Firm")).toBe(false);
    await waitFor(async () => expect(await savedNotifications()).toMatchObject({ nagPersona: "drill", nagLevel: "relentless", style: "nag" }));
  });

  it("Dad saves as dad and Partner as spouse (1.4.1: the label changed, the saved id didn't); the five voice chips wrap onto a second row", async () => {
    await renderSettings(NAG_ON);
    const group = screen.getAllByLabelText("Voice").find((item) => item.props.accessibilityRole === "radiogroup");
    expect(group?.props.className).toContain("flex-wrap");
    expect(screen.getAllByRole("radio").filter((item) => /^Voice: /.test(item.props.accessibilityLabel))).toHaveLength(5);
    await fireEvent.press(voice("Dad"));
    await waitFor(async () => expect(await savedNotifications()).toMatchObject({ nagPersona: "dad", style: "nag" }));
    expect(checked("Voice: Dad")).toBe(true);
    await fireEvent.press(voice("Partner"));
    await waitFor(async () => expect(await savedNotifications()).toMatchObject({ nagPersona: "spouse" }));
    expect(checked("Voice: Partner")).toBe(true);
  });

  it("shows a sample built-in line for the voice and level, and another on 'Show another'", async () => {
    await renderSettings(NAG_ON);
    const momLines = JSON.stringify(NAG_TEMPLATES.mom).replace(/\{task\}/g, "“Call the dentist”");
    const first = sample();
    expect(first.length).toBeGreaterThan(0);
    expect(momLines).toContain(JSON.stringify(first).slice(1, -1));
    expect(screen.getByTestId("settings-nag-sample").props.accessibilityLabel).toBe(`Sample: ${first}`);

    await fireEvent.press(screen.getByRole("button", { name: "Show another" }));
    await waitFor(() => expect(sample()).not.toBe(first));

    await fireEvent.press(voice("Drill sergeant"));
    await waitFor(() => expect(JSON.stringify(NAG_TEMPLATES.drill).replace(/\{task\}/g, "“Call the dentist”")).toContain(JSON.stringify(sample()).slice(1, -1)));
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("the sample never names a task while names are hidden", async () => {
    await renderSettings({ ...NAG_ON, hideTaskNames: true });
    for (let turn = 0; turn < 8; turn += 1) {
      expect(sample()).not.toMatch(/dentist/i);
      await fireEvent.press(screen.getByRole("button", { name: "Show another" }));
    }
    expect(screen.getByTestId("settings-nag-hidden-names")).toHaveTextContent(HIDDEN_NOTE);
  });

  it("the window is one row, 'Nag hours' with both times in the device's format, that opens the two pickers", async () => {
    await renderSettings(NAG_ON);
    const row = screen.getByTestId("settings-nag-hours");
    const hours = `${formatTime(9, 0)} to ${formatTime(21, 0)}`;
    expect(row.props.accessibilityRole).toBe("button");
    expect(row.props.accessibilityLabel).toBe(`Nag hours: ${hours}`);
    expect(row.props.accessibilityState).toMatchObject({ expanded: false });
    expect(row.props.style).toMatchObject({ minHeight: 44 });
    expect(screen.getByText("Nag hours")).toBeOnTheScreen();
    expect(screen.getByText(hours)).toBeOnTheScreen();
    // Closed: no pickers, no help line.
    expect(screen.queryAllByTestId("native-time-picker").filter((node) => /^Nag /.test(node.props.accessibilityLabel))).toEqual([]);
    expect(screen.queryByText("Nags only arrive between these times. The window is at least 3 hours long.")).toBeNull();

    await openNagHours();
    expect(picker("Nag from")).toBeTruthy();
    expect(picker("Nag until")).toBeTruthy();
    expect(screen.getByText("Nags only arrive between these times. The window is at least 3 hours long.")).toBeOnTheScreen();

    // The row follows the pickers.
    await fireEvent(picker("Nag from"), "change", { type: "set" }, new Date(2026, 9, 12, 10, 30));
    await waitFor(() => expect(screen.getByTestId("settings-nag-hours").props.accessibilityLabel).toBe(`Nag hours: ${formatTime(10, 30)} to ${formatTime(21, 0)}`));

    await fireEvent.press(screen.getByTestId("settings-nag-hours"));
    await waitFor(() => expect(screen.getByTestId("settings-nag-hours").props.accessibilityState).toMatchObject({ expanded: false }));
    expect(screen.queryByText("Nags only arrive between these times. The window is at least 3 hours long.")).toBeNull();
  });

  it("the window has a start and an end picker, 9:00 to 21:00 by default, kept three hours long", async () => {
    await renderSettings(NAG_ON);
    await openNagHours();
    const time = (label: string) => {
      const value = picker(label).props.value as Date;
      return [value.getHours(), value.getMinutes()];
    };
    expect(time("Nag from")).toEqual([9, 0]);
    expect(time("Nag until")).toEqual([21, 0]);

    await fireEvent(picker("Nag from"), "change", { type: "set" }, new Date(2026, 9, 12, 10, 30));
    await waitFor(() => expect(time("Nag from")).toEqual([10, 30]));
    await waitFor(async () => expect((await savedNotifications()).nagWindow).toEqual({ startMinutes: 630, endMinutes: 1260 }));

    // An end too close to the start moves the start back.
    await fireEvent(picker("Nag until"), "change", { type: "set" }, new Date(2026, 9, 12, 12, 0));
    await waitFor(() => expect(time("Nag until")).toEqual([12, 0]));
    expect(time("Nag from")).toEqual([9, 0]);
    await waitFor(async () => expect((await savedNotifications()).nagWindow).toEqual({ startMinutes: 540, endMinutes: 720 }));

    // A dismissed picker changes nothing.
    await fireEvent(picker("Nag from"), "change", { type: "dismissed" }, new Date(2026, 9, 12, 6, 0));
    expect(time("Nag from")).toEqual([9, 0]);
  });

  it("'Stop nagging me today' pauses for today and becomes 'Nagging is off until tomorrow' with Resume", async () => {
    await renderSettings(NAG_ON);
    const stop = screen.getByRole("button", { name: "Stop nagging me today" });
    expect(screen.queryByText("Nagging is off until tomorrow")).toBeNull();
    await fireEvent.press(stop);
    await waitFor(() => expect(screen.getByText("Nagging is off until tomorrow")).toBeOnTheScreen());
    expect(screen.queryByRole("button", { name: "Stop nagging me today" })).toBeNull();
    await waitFor(async () => expect((await savedNotifications()).nagPausedDate).toBe(D));
    expect(eventsNamed("nag_paused_today")).toEqual([{ source: "settings" }]);
    // Still Nag: only today is quiet.
    expect(checked("Nag")).toBe(true);

    await fireEvent.press(screen.getByRole("button", { name: "Resume" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Stop nagging me today" })).toBeOnTheScreen());
    expect(screen.queryByText("Nagging is off until tomorrow")).toBeNull();
    await waitFor(async () => expect((await savedNotifications()).nagPausedDate).toBeNull());
    expect(eventsNamed("nag_paused_today")).toHaveLength(1);
  });

  it("a pause from an earlier day is over", async () => {
    await renderSettings({ ...NAG_ON, nagPausedDate: "2026-10-11" });
    expect(screen.getByRole("button", { name: "Stop nagging me today" })).toBeOnTheScreen();
    expect(screen.queryByText("Nagging is off until tomorrow")).toBeNull();
  });

  it("the daytime and evening switches are disabled with one line under them saying why; the morning one still works", async () => {
    await renderSettings(NAG_ON);
    for (const title of ["Progress reminders", "Evening reminders", "Every hour"]) {
      const row = screen.getByRole("switch", { name: title });
      expect(row.props.accessibilityHint).toBe("Paused while Nag is on.");
      expect(row.props.accessibilityState).toMatchObject({ disabled: true });
    }
    // One line for all three, not a hint on each row.
    expect(screen.getAllByText(CALM_NOTE)).toHaveLength(1);
    expect(screen.getByTestId("settings-nag-calm-note")).toHaveTextContent(CALM_NOTE);
    // (The rows' own text is hidden from VoiceOver, which reads the switch: look there too.)
    const anywhere = { includeHiddenElements: true };
    expect(screen.queryByText("Not used while Nag is on.", anywhere)).toBeNull();
    expect(screen.queryByText("Paused while Nag is on.", anywhere)).toBeNull();
    expect(screen.queryByText("Calm nudges while Today's Three are still open.", anywhere)).toBeNull();
    expect(screen.getByText("A gentle start if today is still blank.", anywhere)).toBeTruthy();
    expect(CALM_NOTE).not.toMatch(/[—–]/);
    const morning = screen.getByRole("switch", { name: "Morning reminders" });
    expect(morning.props.accessibilityHint).toBe("A gentle start if today is still blank.");
    expect(morning.props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("every control has a role, a name and a state, and a 44 point target", async () => {
    await renderSettings(NAG_ON);
    const names = ["Calm", "Nag", "Voice: Mom", "Voice: Dad", "Voice: Partner", "Voice: Coach", "Voice: Drill sergeant", "Level: Gentle", "Level: Firm", "Level: Relentless"];
    for (const name of names) {
      const node = radio(name);
      expect(typeof node.props.accessibilityState.checked).toBe("boolean");
      expect(node.props.style).toMatchObject({ minHeight: 44 });
      // Room above and below the words, so wrapped large text doesn't touch the border.
      expect(node.props.className).toMatch(/\bpy-2\b/);
    }
    expect(screen.getAllByRole("radio").filter((node) => node.props.accessibilityState.checked)).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Stop nagging me today" }).props.style).toMatchObject({ minHeight: 44 });
    expect(screen.getByRole("button", { name: "Show another" })).toBeOnTheScreen();
    await openNagHours();
    expect(picker("Nag from")).toBeTruthy();
    expect(picker("Nag until")).toBeTruthy();
  });

  it("in Calm the switches keep their own help and there is no line about Nag", async () => {
    await renderSettings();
    expect(screen.queryByTestId("settings-nag-calm-note")).toBeNull();
    expect(screen.getByRole("switch", { name: "Progress reminders" }).props.accessibilityHint).toBe("Calm nudges while Today's Three are still open.");
    expect(screen.getByText("Calm nudges while Today's Three are still open.", { includeHiddenElements: true })).toBeTruthy();
  });
});

describe("Settings: the Drill sergeant's rude levels are announced", () => {
  const NOTE = "Drill sergeant gets rude at this level: it mocks your effort, not you.";
  const rude = () => screen.queryByTestId("settings-nag-level-rude");

  it("under the count, for the Drill sergeant at Firm and Relentless only", async () => {
    await renderSettings(NAG_ON);
    // Mom, Firm.
    expect(rude()).toBeNull();
    await fireEvent.press(voice("Drill sergeant"));
    await waitFor(() => expect(rude()).toHaveTextContent(NOTE));
    await fireEvent.press(level("Relentless"));
    await waitFor(() => expect(screen.getByTestId("settings-nag-level-count")).toHaveTextContent("About 11 a day"));
    expect(rude()).toHaveTextContent(NOTE);
    await fireEvent.press(level("Gentle"));
    await waitFor(() => expect(rude()).toBeNull());
    await fireEvent.press(level("Firm"));
    await waitFor(() => expect(rude()).toHaveTextContent(NOTE));
    // Plain text, so VoiceOver reads it like the count above it.
    expect(rude()?.props.accessibilityElementsHidden).not.toBe(true);
    expect(rude()?.props.importantForAccessibility).not.toBe("no-hide-descendants");
    await fireEvent.press(voice("Coach"));
    await waitFor(() => expect(rude()).toBeNull());
  });
});
