// Weekly review card (Phase 6) and its Plus gate on the Journey screen.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import JourneyScreen from "@/app/(tabs)/journey";
import { WeeklyReviewCard } from "@/components/daily-tasks/weekly-review-card";
import { track } from "@/lib/daily-tasks/analytics";
import { addDays, todayKey } from "@/lib/daily-tasks/date";
import type { PlusContextValue } from "@/lib/daily-tasks/plus-context";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { DayRecord, History } from "@/lib/daily-tasks/types";
import { buildWeeklyReview, hasInsights } from "@/lib/daily-tasks/weekly-review";

import { renderWithProviders as render } from "./render";

const mockOpenPaywall = jest.fn(() => true);
let mockPlus: Partial<PlusContextValue> = {};
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: mockOpenPaywall }),
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

const TODAY = "2026-09-26";

function record(date: string, total: number, completed: number): DayRecord {
  return { date, total, completed, locked: false, lockSource: null, tasks: [], reflection: null, reflectionResult: null };
}

/** A week with a baseline last week, so the comparison insight exists. */
function historyWithInsights(today: string): History {
  const h: History = {};
  for (const [ago, total, done] of [
    [1, 3, 3],
    [2, 3, 3],
    [8, 3, 1],
    [9, 3, 1],
    [10, 3, 1],
  ]) {
    const date = addDays(today, -ago);
    h[date] = record(date, total, done);
  }
  return h;
}

const WITH_INSIGHTS = buildWeeklyReview(historyWithInsights(TODAY), TODAY);
const NO_INSIGHTS = buildWeeklyReview({ [TODAY]: record(TODAY, 3, 1) }, TODAY);

beforeEach(async () => {
  jest.clearAllMocks();
  mockPlus = {};
  await AsyncStorage.clear();
});

describe("WeeklyReviewCard", () => {
  it("shows the patterns to Plus users, with the bars labelled for VoiceOver", async () => {
    expect(hasInsights(WITH_INSIGHTS)).toBe(true);
    await render(<WeeklyReviewCard review={WITH_INSIGHTS} plus canUnlock={false} onUnlock={jest.fn()} />);
    expect(screen.getByTestId("weekly-review-insights")).toHaveTextContent(/up from 3 last week/);
    expect(screen.queryByTestId("weekly-review-unlock")).toBeNull();
    expect(screen.getByText("Today")).toBeOnTheScreen();
    const bars = screen.getByLabelText(/^Last 7 days\. /);
    expect(bars.props.accessibilityLabel).toMatch(/Today: no tasks$/);
  });

  it("offers free users an unlock row only when there are patterns to show", async () => {
    const onUnlock = jest.fn();
    const { rerender } = await render(
      <WeeklyReviewCard review={WITH_INSIGHTS} plus={false} canUnlock onUnlock={onUnlock} />,
    );
    expect(screen.queryByTestId("weekly-review-insights")).toBeNull();
    await fireEvent.press(screen.getByTestId("weekly-review-unlock"));
    expect(onUnlock).toHaveBeenCalledTimes(1);

    await rerender(<WeeklyReviewCard review={NO_INSIGHTS} plus={false} canUnlock onUnlock={onUnlock} />);
    expect(screen.queryByTestId("weekly-review-unlock")).toBeNull();
    // Still checking Plus (canUnlock false): no upsell.
    await rerender(<WeeklyReviewCard review={WITH_INSIGHTS} plus={false} canUnlock={false} onUnlock={onUnlock} />);
    expect(screen.queryByTestId("weekly-review-unlock")).toBeNull();
  });
});

describe("Journey: weekly review gate", () => {
  it("a confirmed free user's unlock opens the weekly_review paywall and logs the gate hit", async () => {
    mockPlus = { paywallBuild: true, paywallEnabled: true, entitlementActive: false, entitlementKnown: true };
    const today = todayKey();
    await AsyncStorage.setItem(
      "daily-tasks/state/v1",
      JSON.stringify({
        ...buildInitialState(),
        hasSeenOnboarding: true,
        plusGrandfathered: false,
        history: { ...historyWithInsights(today), [today]: record(today, 0, 0) },
      }),
    );
    await render(
      <DailyTasksProvider>
        <JourneyScreen />
      </DailyTasksProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("weekly-review-unlock")).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId("weekly-review-unlock"));
    expect(track).toHaveBeenCalledWith("plus_gate_hit", { feature: "weekly_review" });
    expect(mockOpenPaywall).toHaveBeenCalledWith("weekly_review");
  });
});

describe("Progress: milestones are ticked by hand", () => {
  it("Reached asks first, then marks the milestone done", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    await AsyncStorage.setItem(
      "daily-tasks/state/v1",
      JSON.stringify({
        ...buildInitialState(),
        hasSeenOnboarding: true,
        momentumPlan: {
          id: "plan",
          goalTitle: "Run a 5K",
          generatedAt: new Date().toISOString(),
          provider: "template",
          milestones: [{ id: "run_1_mile", title: "Run 1 mile", description: "", completedAt: null }],
          taskPool: [],
          todaySuggestions: [],
          promptSummary: "",
          version: 1,
        },
      }),
    );
    await render(
      <DailyTasksProvider>
        <JourneyScreen />
      </DailyTasksProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("milestone-reach-run_1_mile")).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId("milestone-reach-run_1_mile"));
    const [title, , buttons] = alert.mock.calls[0] as unknown as [string, string, { text: string; onPress?: () => void }[]];
    expect(title).toBe("Reached this milestone?");

    // "Not yet" changes nothing.
    await act(async () => buttons.find((b) => b.text === "Not yet")?.onPress?.());
    expect(screen.getByTestId("milestone-reach-run_1_mile")).toBeOnTheScreen();

    await act(async () => buttons.find((b) => b.text === "Yes, I got there")?.onPress?.());
    expect(screen.queryByTestId("milestone-reach-run_1_mile")).toBeNull();
    expect(screen.getByText("Milestone reached!")).toBeOnTheScreen();

    // "Done" can be undone after a confirmation.
    alert.mockClear();
    await fireEvent.press(screen.getByTestId("milestone-done-run_1_mile"));
    const [undoTitle, , undoButtons] = alert.mock.calls[0] as unknown as [string, string, { text: string; onPress?: () => void }[]];
    expect(undoTitle).toBe("Mark as not reached?");
    await act(async () => undoButtons.find((b) => b.text === "Not reached yet")?.onPress?.());
    expect(screen.getByTestId("milestone-reach-run_1_mile")).toBeOnTheScreen();
    alert.mockRestore();
  });
});

