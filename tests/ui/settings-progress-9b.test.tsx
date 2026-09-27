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
let mockPlus: Partial<PlusContextValue> = {};
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: mockOpenPaywall, restore: jest.fn() }),
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

describe("Settings: Set today's three (Phase 10a wording)", () => {
  const walk = [{ id: "t1", text: "Walk", createdAt: "", carriedOver: false }];
  const setSwitch = () => screen.getByRole("switch", { name: "Set today's three" });

  it("says 'Set today's three' while open, and sets the day from the switch", async () => {
    await renderWith(<SettingsScreen />, { tasks: walk });
    await waitFor(() => expect(setSwitch()).toBeOnTheScreen());
    expect(screen.getByText("Set today's three")).toBeOnTheScreen();
    expect(screen.getByText("Setting the day")).toBeOnTheScreen();
    expect(screen.queryByText(/Lock today's list|Daily lock/)).toBeNull();
    await fireEvent(setSwitch(), "valueChange", true);
    await waitFor(() => expect(screen.getByText("Today's three are set")).toBeOnTheScreen());
    expect(setSwitch().props.value).toBe(true);
    await fireEvent(setSwitch(), "valueChange", false);
    await waitFor(() => expect(screen.getByText("Set today's three")).toBeOnTheScreen());
  });
});
