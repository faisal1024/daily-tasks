// Phase 9b on Settings ("Plan around my calendar") and Progress ("Set a goal"),
// with the real DailyTasksProvider and a mocked Plus context.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import JourneyScreen from "@/app/(tabs)/journey";
import SettingsScreen from "@/app/(tabs)/settings";
import { requestAgendaAccess } from "@/lib/daily-tasks/agenda";
import type { PlusContextValue } from "@/lib/daily-tasks/plus-context";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

const mockOpenPaywall = jest.fn(() => true);
const mockRedeemCode = jest.fn(async () => true);
let mockPlus: Partial<PlusContextValue> = {};
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: mockOpenPaywall, restore: jest.fn(), redeemCode: mockRedeemCode }),
}));
jest.mock("@/lib/daily-tasks/agenda", () => ({
  ...jest.requireActual("@/lib/daily-tasks/agenda"),
  requestAgendaAccess: jest.fn(async () => "denied"),
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

const FREE: Partial<PlusContextValue> = {
  paywallBuild: true,
  paywallEnabled: true,
  entitlementActive: false,
  entitlementKnown: true,
};

async function renderWith(ui: React.ReactElement, saved: Partial<AppState> = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true, ...saved }),
  );
  return render(<DailyTasksProvider>{ui}</DailyTasksProvider>);
}

const calendarSwitch = () => screen.getByRole("switch", { name: "Plan around my calendar" });

beforeEach(async () => {
  jest.clearAllMocks();
  mockPlus = { paywallBuild: false, paywallEnabled: false, entitlementActive: false };
  await AsyncStorage.clear();
});

describe("Settings: Plan around my calendar", () => {
  it("denied access shows an alert and stays off", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await renderWith(<SettingsScreen />, { plusGrandfathered: true });
    await waitFor(() => expect(calendarSwitch()).toBeOnTheScreen());
    await fireEvent(calendarSwitch(), "valueChange", true);
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0][0]).toBe("Calendar access is off");
    expect(calendarSwitch().props.value).toBe(false);
    alert.mockRestore();
  });

  it("granted access turns it on (and it can be turned off again)", async () => {
    (requestAgendaAccess as jest.Mock).mockResolvedValueOnce("granted");
    await renderWith(<SettingsScreen />, { plusGrandfathered: true });
    await waitFor(() => expect(calendarSwitch()).toBeOnTheScreen());
    await fireEvent(calendarSwitch(), "valueChange", true);
    await waitFor(() => expect(calendarSwitch().props.value).toBe(true));
    await fireEvent(calendarSwitch(), "valueChange", false);
    await waitFor(() => expect(calendarSwitch().props.value).toBe(false));
  });

  it("a free user gets the paywall, and no permission is asked", async () => {
    mockPlus = { ...FREE };
    await renderWith(<SettingsScreen />, { plusGrandfathered: false });
    await waitFor(() => expect(calendarSwitch()).toBeOnTheScreen());
    await fireEvent(calendarSwitch(), "valueChange", true);
    expect(mockOpenPaywall).toHaveBeenCalledWith("calendar");
    expect(requestAgendaAccess).not.toHaveBeenCalled();
    expect(calendarSwitch().props.value).toBe(false);
  });

  it("shows off for a free user even if it was saved on", async () => {
    mockPlus = { ...FREE };
    await renderWith(<SettingsScreen />, { plusGrandfathered: false, agendaEnabled: true });
    await waitFor(() => expect(calendarSwitch()).toBeOnTheScreen());
    expect(calendarSwitch().props.value).toBe(false);
  });
});

describe("Settings: Redeem a code", () => {
  const redeem = () => screen.queryByRole("button", { name: "Redeem offer code" });

  it("a free user can open Apple's code sheet; no alert when it shows", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockPlus = { ...FREE };
    await renderWith(<SettingsScreen />, { plusGrandfathered: false });
    await waitFor(() => expect(screen.getByTestId("settings-plus")).toBeOnTheScreen());
    expect(redeem()).toBeOnTheScreen();
    await fireEvent.press(redeem()!);
    await waitFor(() => expect(mockRedeemCode).toHaveBeenCalledTimes(1));
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("says so when the sheet couldn't be opened", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockRedeemCode.mockResolvedValueOnce(false);
    mockPlus = { ...FREE };
    await renderWith(<SettingsScreen />, { plusGrandfathered: false });
    await waitFor(() => expect(redeem()).toBeOnTheScreen());
    await fireEvent.press(redeem()!);
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert).toHaveBeenCalledWith("Offer codes aren't available", "Code redemption isn't available right now.");
    alert.mockRestore();
  });

  it("is hidden while Plus is active (Restore stays)", async () => {
    mockPlus = { ...FREE, entitlementActive: true };
    await renderWith(<SettingsScreen />, { plusGrandfathered: false });
    await waitFor(() => expect(screen.getByTestId("settings-plus")).toBeOnTheScreen());
    expect(screen.getByRole("button", { name: "Restore purchases" })).toBeOnTheScreen();
    expect(redeem()).toBeNull();
  });

  it("is hidden for early supporters who already have every feature", async () => {
    mockPlus = { ...FREE };
    await renderWith(<SettingsScreen />, { plusGrandfathered: true });
    await waitFor(() => expect(screen.getByTestId("settings-plus")).toBeOnTheScreen());
    expect(redeem()).toBeNull();
  });

  it("isn't there at all in a build without a paywall", async () => {
    await renderWith(<SettingsScreen />, { plusGrandfathered: false });
    await waitFor(() => expect(calendarSwitch()).toBeOnTheScreen());
    expect(screen.queryByTestId("settings-plus")).toBeNull();
    expect(redeem()).toBeNull();
  });
});

describe("Progress: Set a goal", () => {
  it("offers the goal step when there's no goal; Cancel closes it", async () => {
    await renderWith(<JourneyScreen />);
    await waitFor(() => expect(screen.getByTestId("set-goal-card")).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole("button", { name: "Set a goal" }));
    // Straight to the goal step (no welcome/name), with Cancel instead of Back.
    const cancel = await screen.findByRole("button", { name: "Cancel" });
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await fireEvent.press(cancel);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull());
    expect(screen.getByTestId("set-goal-card")).toBeOnTheScreen();
  });

  it("isn't shown once there's a goal", async () => {
    await renderWith(<JourneyScreen />, {
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Run a 5K" },
    });
    // Once the saved goal loads, the card goes (and stays gone).
    await waitFor(() => expect(screen.queryByTestId("set-goal-card")).toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByTestId("set-goal-card")).toBeNull();
  });
});

describe("Settings: Setting the day (Phase 10b)", () => {
  const walk = [{ id: "t1", text: "Walk", createdAt: "", carriedOver: false }];
  const autoSwitch = () => screen.getByRole("switch", { name: "Set the day automatically" });
  const picker = () => screen.getByLabelText("Time to set the day");

  it("has no Today's Three list or switch any more (that lives on Today)", async () => {
    await renderWith(<SettingsScreen />, {
      tasks: walk,
      autoLock: { enabled: false, hour: 12, minute: 0 },
    });
    await waitFor(() => expect(screen.getByText("Setting the day")).toBeOnTheScreen());
    expect(screen.queryByRole("switch", { name: "Set today's three" })).toBeNull();
    expect(screen.queryByText("Today's Three")).toBeNull();
    expect(screen.queryByText("Walk")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("explains a set day, with a named auto-set switch and a 'Time' row", async () => {
    await renderWith(<SettingsScreen />, { autoLock: { enabled: false, hour: 12, minute: 0 } });
    await waitFor(() => expect(screen.getByText("Setting the day")).toBeOnTheScreen());
    expect(
      screen.getByText("A set day keeps your three fixed; you can still check them off."),
    ).toBeOnTheScreen();
    expect(screen.getByText("Days with at least one task are set at this time.")).toBeOnTheScreen();
    expect(screen.getByText("Time")).toBeOnTheScreen();
    expect(autoSwitch().props.value).toBe(false);
    // Off: the picker is disabled; turning auto-set on enables it.
    expect(picker().props.disabled).toBe(true);
    expect(screen.getByTestId("time-picker-row")).toBeDisabled();
    await fireEvent(autoSwitch(), "valueChange", true);
    await waitFor(() => expect(picker().props.disabled).toBe(false));
  });

  it("a picked time is saved (any minute, no 5-minute snapping)", async () => {
    await renderWith(<SettingsScreen />, { autoLock: { enabled: true, hour: 12, minute: 0 } });
    await waitFor(() => expect(picker()).toBeOnTheScreen());
    expect((picker().props.value as Date).getHours()).toBe(12);
    expect(picker().props.minuteInterval).toBeUndefined();
    const picked = new Date();
    picked.setHours(21, 37, 0, 0);
    await fireEvent(picker(), "change", { type: "set" }, picked);
    await waitFor(() => expect((picker().props.value as Date).getHours()).toBe(21));
    expect((picker().props.value as Date).getMinutes()).toBe(37);
  });
});
