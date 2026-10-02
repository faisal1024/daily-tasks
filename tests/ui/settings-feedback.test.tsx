// Settings' Feedback rows (1.3, PR #78): "Rate Three Today" opens the App
// Store's Write a Review page (itms-apps first, the https page if that can't
// open), "Send feedback" opens the support page; each tap is tracked once.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Linking } from "react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import SettingsScreen from "@/app/(tabs)/settings";
import { track } from "@/lib/daily-tasks/analytics";
import { FEEDBACK_URL, WRITE_REVIEW_URL, WRITE_REVIEW_WEB_URL } from "@/lib/daily-tasks/links";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";

import { renderWithProviders as render } from "./render";

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
const events = (name: string) => tracked.mock.calls.filter((call) => call[0] === name);

let openURL: jest.SpyInstance;
let alert: jest.SpyInstance;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true }),
  );
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  openURL.mockRestore();
  alert.mockRestore();
});

async function renderSettings() {
  await render(
    <DailyTasksProvider>
      <SettingsScreen />
    </DailyTasksProvider>,
  );
  await waitFor(() => expect(screen.getByRole("link", { name: "Rate Three Today" })).toBeOnTheScreen());
}

const rateRow = () => screen.getByRole("link", { name: "Rate Three Today" });
const feedbackRow = () => screen.getByRole("link", { name: "Send feedback" });

describe("Settings: Feedback rows", () => {
  it("are links with hints saying where they go", async () => {
    await renderSettings();
    expect(rateRow().props.accessibilityHint).toBe("Opens the App Store to write a review");
    expect(feedbackRow().props.accessibilityHint).toBe("Opens the support page");
  });

  it("Rate opens the App Store app's Write a Review page, tracked once", async () => {
    await renderSettings();
    await fireEvent.press(rateRow());
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1));
    expect(openURL).toHaveBeenCalledWith(WRITE_REVIEW_URL);
    expect(WRITE_REVIEW_URL).toMatch(/^itms-apps:\/\/.*action=write-review$/);
    expect(events("rate_row_tapped")).toEqual([["rate_row_tapped"]]);
    expect(alert).not.toHaveBeenCalled();
  });

  it("Rate falls back to the https page when itms-apps can't open", async () => {
    openURL.mockRejectedValueOnce(new Error("no handler"));
    await renderSettings();
    await fireEvent.press(rateRow());
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(2));
    expect(openURL.mock.calls.map((call) => call[0])).toEqual([WRITE_REVIEW_URL, WRITE_REVIEW_WEB_URL]);
    expect(WRITE_REVIEW_WEB_URL).toMatch(/^https:\/\/apps\.apple\.com\/.*action=write-review$/);
    expect(alert).not.toHaveBeenCalled();
    expect(events("rate_row_tapped")).toHaveLength(1);
  });

  it("Rate says it couldn't open when neither link opens", async () => {
    openURL.mockRejectedValue(new Error("no handler"));
    await renderSettings();
    await fireEvent.press(rateRow());
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert).toHaveBeenCalledWith("Couldn't open link", "Please try again later.");
    expect(openURL).toHaveBeenCalledTimes(2);
  });

  it("Send feedback opens the support page, tracked once", async () => {
    await renderSettings();
    await fireEvent.press(feedbackRow());
    await waitFor(() => expect(openURL).toHaveBeenCalledWith(FEEDBACK_URL));
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(events("feedback_row_tapped")).toEqual([["feedback_row_tapped"]]);
    expect(events("rate_row_tapped")).toEqual([]);
  });
});
