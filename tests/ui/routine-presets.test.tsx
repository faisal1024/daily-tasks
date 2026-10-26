// 1.5 D: one-tap routine presets in the Routines sheet, through Settings and
// the real store. Days come filled in; the tap creates the routine at once
// (tracked as source "preset", never with its text); a free user's third tap
// meets the Plus gate; presets already made don't come back; at three routines
// they are gone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import SettingsScreen from "@/app/(tabs)/settings";
import { track } from "@/lib/daily-tasks/analytics";
import type { PlusContextValue } from "@/lib/daily-tasks/plus-context";
import { ROUTINE_PRESETS } from "@/lib/daily-tasks/routines";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, Routine } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

const mockOpenPaywall = jest.fn(() => true);
let mockPlus: Partial<PlusContextValue> = {};
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: mockOpenPaywall, restore: jest.fn(), redeemCode: jest.fn() }),
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

const FREE: Partial<PlusContextValue> = {
  paywallBuild: true,
  paywallEnabled: true,
  entitlementActive: false,
  entitlementKnown: true,
};
const routine = (id: string, text: string, days: number[]): Routine => ({
  id,
  text,
  days,
  paused: false,
  createdAt: "2026-10-20T08:00:00.000Z",
});
const tracked = track as jest.Mock;
const eventsNamed = (name: string) => tracked.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);
const preset = (text: string) => screen.getByTestId(`routine-preset-${text}`);
const stored = async (): Promise<AppState> => JSON.parse((await AsyncStorage.getItem("daily-tasks/state/v1")) ?? "{}");

async function openRoutines(saved: Partial<AppState> = {}) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(), hasSeenOnboarding: true, plusGrandfathered: false, ...saved }),
  );
  await render(
    <DailyTasksProvider>
      <SettingsScreen />
    </DailyTasksProvider>,
  );
  await waitFor(() => expect(screen.getByTestId("settings-routines")).toBeOnTheScreen());
  await fireEvent.press(screen.getByTestId("settings-routines"));
  await waitFor(() => expect(screen.getByTestId("routines-sheet")).toBeOnTheScreen());
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockPlus = { ...FREE };
  await AsyncStorage.clear();
});

describe("Routine presets", () => {
  it("with no routines all six are offered, each saying its days", async () => {
    await openRoutines();
    const box = within(screen.getByTestId("routine-presets"));
    expect(box.getByText("Start with one")).toBeOnTheScreen();
    for (const p of ROUTINE_PRESETS) expect(preset(p.text)).toBeOnTheScreen();
    expect(within(preset("Stretch")).getByText("Weekdays")).toBeOnTheScreen();
    expect(within(preset("Walk")).getByText("Every day")).toBeOnTheScreen();
    expect(preset("Tidy desk").props.accessibilityLabel).toMatch(/^Add Tidy desk, /);
  });

  it("one tap adds it with its days filled in, tracks source 'preset' (no text), and it leaves the offer", async () => {
    await openRoutines();
    await fireEvent.press(preset("Stretch"));
    await waitFor(() => expect(screen.queryByTestId("routine-preset-Stretch")).toBeNull());
    expect(screen.getByText("Stretch")).toBeOnTheScreen();
    expect(eventsNamed("routine_created")).toEqual([{ count: 1, source: "preset" }]);
    await waitFor(async () => expect((await stored()).routines).toHaveLength(1));
    const [made] = (await stored()).routines;
    expect(made).toMatchObject({ text: "Stretch", days: [1, 2, 3, 4, 5], paused: false });
    expect(screen.getByTestId("routine-presets")).toBeOnTheScreen();
    expect(within(screen.getByTestId("routine-presets")).getByText("Or one of these")).toBeOnTheScreen();
  });

  it("Sunday's 'Plan the week' and Friday's 'Tidy desk' get their single day", async () => {
    await openRoutines();
    await fireEvent.press(preset("Plan the week"));
    await fireEvent.press(preset("Tidy desk"));
    await waitFor(async () => expect((await stored()).routines).toHaveLength(2));
    const byText = Object.fromEntries((await stored()).routines.map((r) => [r.text, r.days]));
    expect(byText).toEqual({ "Plan the week": [0], "Tidy desk": [5] });
  });

  it("free: the third tap meets the Plus gate and makes nothing", async () => {
    await openRoutines({ routines: [routine("r1", "Walk after lunch", [1]), routine("r2", "Read", [2])] });
    expect(screen.getByTestId("routine-presets")).toBeOnTheScreen();
    await fireEvent.press(preset("Stretch"));
    await waitFor(() => expect(mockOpenPaywall).toHaveBeenCalledWith("routines"), { timeout: 2000 });
    expect((await stored()).routines).toHaveLength(2);
    expect(eventsNamed("routine_created")).toEqual([]);
  });

  it("free: the second routine from a preset is allowed", async () => {
    await openRoutines({ routines: [routine("r1", "Read", [2])] });
    await fireEvent.press(preset("Stretch"));
    await waitFor(async () => expect((await stored()).routines).toHaveLength(2));
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    expect(eventsNamed("routine_created")).toEqual([{ count: 2, source: "preset" }]);
  });

  it("Plus: the third is added, and with three the presets are gone", async () => {
    mockPlus = { ...FREE, entitlementActive: true };
    await openRoutines({ routines: [routine("r1", "Walk after lunch", [1]), routine("r2", "Read", [2])] });
    await fireEvent.press(preset("Stretch"));
    await waitFor(async () => expect((await stored()).routines).toHaveLength(3));
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("routine-presets")).toBeNull());
  });

  it("a preset already made (same words) isn't offered again", async () => {
    await openRoutines({ routines: [routine("r1", "walk", [3])] });
    expect(screen.queryByTestId("routine-preset-Walk")).toBeNull();
    expect(preset("Stretch")).toBeOnTheScreen();
  });

  it("none after a Plus lapse leaves three or more routines", async () => {
    await openRoutines({
      routines: [routine("r1", "A", [1]), routine("r2", "B", [2]), routine("r3", "C", [3])],
    });
    expect(screen.queryByTestId("routine-presets")).toBeNull();
  });
});
