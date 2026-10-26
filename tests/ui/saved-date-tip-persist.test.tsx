// Saved for later's "add a day" tip with the REAL store, across relaunches:
// shown while no saved item has a day and it was never closed; hidden for good
// after a dated item was saved (also once that item has gone) or after it was
// dismissed, and still hidden after the app is relaunched.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ReactNode } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import { IdeasSheet } from "@/components/daily-tasks/ideas-sheet";
import { showSavedDateTip } from "@/lib/daily-tasks/saved-date-tip";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({
    paywallBuild: true,
    paywallEnabled: true,
    entitlementActive: true,
    entitlementKnown: true,
    paywallSource: null,
    openPaywall: jest.fn(() => true),
  }),
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
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));

const KEY = "daily-tasks/state/v1";
const NOW = new Date(2026, 9, 26, 9);
const TODAY = "2026-10-26";
const TIP = "Tip: add a day (“dentist Friday”) and it comes back then.";

let latest: ReturnType<typeof useDailyTasks>;
function Probe(): ReactNode {
  latest = useDailyTasks();
  const { state } = latest;
  return (
    <IdeasSheet
      visible
      onClose={() => {}}
      goalTitle={null}
      source={{ personalized: false, label: "Starter ideas" }}
      ideas={[]}
      addedTexts={new Set<string>()}
      remainingSlots={2}
      adaptationReason={null}
      canRegenerate={false}
      regenerating={false}
      failureMessage={null}
      onAdd={() => {}}
      onAddAll={() => {}}
      onRegenerate={() => {}}
      onAddParked={() => {}}
      onRemoveParked={latest.removeParkedTask}
      parked={state.parkedTasks.map((item) => ({ id: item.id, text: item.text, ...(item.when ? { when: item.when } : {}) }))}
      savedDateTip={showSavedDateTip(state)}
      onDismissSavedDateTip={latest.dismissSavedDateTip}
    />
  );
}
const tree = () => (
  <DailyTasksProvider>
    <Probe />
  </DailyTasksProvider>
);
const tip = () => screen.queryByText(TIP);
const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => {});
};

async function launch(saved?: Partial<AppState>) {
  if (saved) {
    const state: AppState = syncTodayHistory(
      { ...buildInitialState(NOW), hasSeenOnboarding: true, autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false }, ...saved },
      TODAY,
    );
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  }
  await render(tree());
  await waitFor(() => expect(latest.ready).toBe(true));
  await flush();
}
/** Quit and open again: what was saved is all that is left. */
async function relaunch() {
  // The save is debounced: let it land.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 700));
  });
  await screen.unmount();
  __resetStorageForTests();
  await launch();
}
const parked = (text: string, when?: { date: string; kind: "on" | "by" }) => ({
  id: `p-${text}`,
  text,
  parkedAt: NOW.toISOString(),
  ...(when ? { when } : {}),
});

beforeEach(async () => {
  __resetStorageForTests();
  await AsyncStorage.clear();
});

describe("the add-a-day tip across relaunches", () => {
  it("shows with undated items only, and is still there after a relaunch", async () => {
    await launch({ parkedTasks: [parked("Buy shoes")] });
    expect(tip()).toBeOnTheScreen();
    await relaunch();
    expect(tip()).toBeOnTheScreen();
  });

  it("dismissed: gone, and still gone after a relaunch", async () => {
    await launch({ parkedTasks: [parked("Buy shoes")] });
    await fireEvent.press(screen.getByRole("button", { name: "Dismiss tip" }));
    expect(tip()).toBeNull();
    await relaunch();
    expect(tip()).toBeNull();
    expect(latest.state.savedDateTipDone).toBe(true);
  });

  it("a dated item saved: gone; the item removed and a relaunch: still gone", async () => {
    await launch({ parkedTasks: [parked("Buy shoes")] });
    expect(tip()).toBeOnTheScreen();
    await act(async () => latest.parkTasks(["Dentist Friday"]));
    await flush();
    expect(latest.state.parkedTasks.some((item) => item.when)).toBe(true);
    expect(tip()).toBeNull();
    const dated = latest.state.parkedTasks.find((item) => item.when)!;
    await act(async () => latest.removeParkedTask(dated.id));
    await flush();
    expect(tip()).toBeNull();
    await relaunch();
    expect(tip()).toBeNull();
  });

  it("a saved list that already holds a dated item (an updater's) shows no tip, now or after a relaunch", async () => {
    await launch({ parkedTasks: [parked("Call Mark"), parked("Dentist", { date: "2026-10-30", kind: "on" })] });
    expect(tip()).toBeNull();
    await relaunch();
    expect(tip()).toBeNull();
  });
});
