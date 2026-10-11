// Settings > Reminders (1.4, PR #89): the "What reminders say" switch, and
// each reminder switch as one element to VoiceOver (the switch, with the
// row's title as its label and its help as its hint; the visible text is
// hidden from it so nothing is read twice).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import SettingsScreen from "@/app/(tabs)/settings";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_NOTIFICATIONS, type AppState } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallBuild: false, paywallEnabled: false, entitlementActive: false, openPaywall: jest.fn(), restore: jest.fn(), redeemCode: jest.fn() }),
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
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
}));

const HELP = "Reminders won't show what your tasks are. Good if others can see your lock screen.";

async function renderSettings(saved: Partial<AppState> = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true, ...saved }),
  );
  const view = await render(
    <DailyTasksProvider>
      <SettingsScreen />
    </DailyTasksProvider>,
  );
  await waitFor(() => expect(screen.getByText("What reminders say")).toBeOnTheScreen());
  return view;
}

const hideSwitch = () => screen.getByRole("switch", { name: "Hide task names in notifications" });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe("Settings: Hide task names in notifications", () => {
  it("sits under a 'What reminders say' heading, off by default, with its help text", async () => {
    await renderSettings();
    expect(screen.getByRole("header", { name: "What reminders say" })).toBeOnTheScreen();
    expect(screen.getByText(HELP, { includeHiddenElements: true })).toBeOnTheScreen();
    expect(hideSwitch().props.value).toBe(false);
    expect(hideSwitch().props.accessibilityState).toMatchObject({ checked: false });
    expect(hideSwitch().props.accessibilityHint).toBe(HELP);
  });

  it("turning it on is saved and shown, as value and as checked state", async () => {
    await renderSettings();
    await fireEvent(hideSwitch(), "valueChange", true);
    await waitFor(() => expect(hideSwitch().props.value).toBe(true));
    expect(hideSwitch().props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent(hideSwitch(), "valueChange", false);
    await waitFor(() => expect(hideSwitch().props.value).toBe(false));
  });

  it("a saved 'on' loads as on", async () => {
    await renderSettings({ notifications: { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true } });
    await waitFor(() => expect(hideSwitch().props.value).toBe(true));
  });
});

describe("Settings: each reminder switch is one element to VoiceOver", () => {
  const ROWS: [string, string][] = [
    ["Morning reminders", "A gentle start if today is still blank."],
    ["Progress reminders", "Calm nudges while Today's Three are still open."],
    ["Evening reminders", "A soft wrap-up when something is still left."],
    ["Every hour", "A nudge each hour (8am–9pm) until Today's Three are done."],
    ["Hide task names in notifications", HELP],
  ];

  it("the switch carries the title, the help and its state; the visible text is hidden from VoiceOver", async () => {
    await renderSettings();
    for (const [title, help] of ROWS) {
      const row = screen.getByRole("switch", { name: title });
      expect(row.props.accessibilityHint).toBe(help);
      expect(row.props.accessibilityState).toMatchObject({ checked: row.props.value, disabled: false });
      // The visible title and help are there to see, but not to be read again.
      expect(screen.getByText(title, { includeHiddenElements: true })).toBeOnTheScreen();
      expect(screen.getByText(help, { includeHiddenElements: true })).toBeOnTheScreen();
      expect(screen.queryByText(title)).toBeNull();
      expect(screen.queryByText(help)).toBeNull();
      // One switch per row.
      expect(screen.getAllByRole("switch", { name: title })).toHaveLength(1);
    }
  });

  it("'Every hour' pauses the progress and evening switches, and says so in their hint", async () => {
    await renderSettings({ notifications: { ...DEFAULT_NOTIFICATIONS, hourly: true } });
    for (const title of ["Progress reminders", "Evening reminders"]) {
      const row = screen.getByRole("switch", { name: title });
      expect(row.props.accessibilityHint).toBe("Paused while Every hour is on.");
      expect(row.props.accessibilityState).toMatchObject({ disabled: true });
      expect(row.props.disabled).toBe(true);
    }
    expect(hideSwitch().props.accessibilityState).toMatchObject({ disabled: false });
  });
});
