// 1.6, two small pieces around What's new:
// - Saved for later's "add a day" tip in the Ideas sheet (shown until a dated
//   item was saved once, or it was closed; the flag lives in saved state).
// - Settings brings the place a What's new button asked for into view
//   ("Write your lines", "See what it remembers"), with VoiceOver on its header.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, ScrollView } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import SettingsScreen from "@/app/(tabs)/settings";
import { IdeasSheet } from "@/components/daily-tasks/ideas-sheet";
import { SHEET_SWAP_DELAY_MS } from "@/hooks/use-paywall-gate";
import { showSavedDateTip } from "@/lib/daily-tasks/saved-date-tip";
import { requestSettingsFocus, takeSettingsFocus } from "@/lib/daily-tasks/settings-focus";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, reducer } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

const mockPlus = {
  paywallBuild: true,
  paywallEnabled: true,
  entitlementActive: true,
  entitlementKnown: true,
  paywallSource: null as string | null,
};
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: jest.fn(() => true), restore: jest.fn(), redeemCode: jest.fn() }),
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

const TIP = "Tip: add a day, like “dentist Friday”, and it comes back then.";
const NOW = new Date(2026, 9, 26, 9);
const TODAY = "2026-10-26";

describe("the 'add a day' tip in the Ideas sheet", () => {
  const props = (over: Partial<Parameters<typeof IdeasSheet>[0]> = {}): Parameters<typeof IdeasSheet>[0] => ({
    visible: true,
    onClose: jest.fn(),
    goalTitle: null,
    source: { personalized: false, label: "Starter ideas" },
    ideas: [],
    addedTexts: new Set<string>(),
    remainingSlots: 2,
    adaptationReason: null,
    canRegenerate: false,
    regenerating: false,
    failureMessage: null,
    onAdd: jest.fn(),
    onAddAll: jest.fn(),
    onRegenerate: jest.fn(),
    onAddParked: jest.fn(),
    onRemoveParked: jest.fn(),
    parked: [{ id: "p1", text: "Buy shoes" }],
    ...over,
  });

  it("shows under Saved for later, one line, with a 44 pt close button", async () => {
    const onDismiss = jest.fn();
    await render(<IdeasSheet {...props({ savedDateTip: true, onDismissSavedDateTip: onDismiss })} />);
    expect(screen.getByText(TIP)).toBeOnTheScreen();
    const close = screen.getByRole("button", { name: "Dismiss tip" });
    expect(close.props.style).toMatchObject({ minHeight: 44, minWidth: 44 });
    await fireEvent.press(close);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("in the saved-only view too", async () => {
    await render(<IdeasSheet {...props({ savedOnly: true, savedDateTip: true, onDismissSavedDateTip: jest.fn() })} />);
    expect(screen.getByText(TIP)).toBeOnTheScreen();
  });

  it("not when it's done, and not with nothing saved", async () => {
    const { rerender } = await render(<IdeasSheet {...props({ savedDateTip: false })} />);
    expect(screen.queryByText(TIP)).toBeNull();
    await rerender(<IdeasSheet {...props({ savedDateTip: true, parked: [] })} />);
    expect(screen.queryByText(TIP)).toBeNull();
  });

  describe("the store", () => {
    const base = (): AppState => ({ ...buildInitialState(NOW), hasSeenOnboarding: true });
    const at = NOW.toISOString();

    it("a brain dump that saves a dated item ends it for good", () => {
      const undated = reducer(base(), { type: "parkTasks", texts: ["Call Mark"], at });
      expect(showSavedDateTip(undated)).toBe(true);
      expect(undated.savedDateTipDone).toBe(false);
      const dated = reducer(undated, { type: "parkTasks", texts: ["Dentist Friday"], at });
      expect(dated.parkedTasks.find((item) => item.text === "Dentist Friday")?.when).toBeTruthy();
      expect(dated.savedDateTipDone).toBe(true);
      // The dated item goes: the tip stays done.
      const id = dated.parkedTasks.find((item) => item.text === "Dentist Friday")!.id;
      const gone = reducer(dated, { type: "removeParkedTask", id });
      expect(showSavedDateTip(gone)).toBe(false);
    });

    it("a capture with a day (share sheet, Siri) ends it too", () => {
      const next = reducer(base(), { type: "parkCaptures", texts: ["dentist friday"], at, refDays: [TODAY] });
      expect(next.savedDateTipDone).toBe(true);
    });

    it("a capture without a day: the tip stays", () => {
      const next = reducer(base(), { type: "parkCaptures", texts: ["Buy shoes"], at, refDays: [TODAY] });
      expect(showSavedDateTip(next)).toBe(true);
    });

    it("noteCaptured (an import found captures, saved or not) marks the share sheet or Siri as used, once", () => {
      const next = reducer(base(), { type: "noteCaptured" });
      expect(next.capturedEver).toBe(true);
      expect(reducer(next, { type: "noteCaptured" })).toBe(next);
    });

    it("closing it ends it; a second close changes nothing", () => {
      const closed = reducer(base(), { type: "dismissSavedDateTip" });
      expect(closed.savedDateTipDone).toBe(true);
      expect(reducer(closed, { type: "dismissSavedDateTip" })).toBe(closed);
    });
  });
});

describe("Settings: brought into view from What's new", () => {
  const KEY = "daily-tasks/state/v1";
  let focusEvents: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    takeSettingsFocus();
    __resetStorageForTests();
    await AsyncStorage.clear();
    focusEvents = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
  });
  afterEach(() => focusEvents.mockRestore());

  const wait = (ms: number) => act(async () => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  async function renderSettings() {
    const state: AppState = {
      ...buildInitialState(NOW),
      hasSeenOnboarding: true,
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      notifications: { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true },
    };
    await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(state, state.lastOpenedDate)));
    await render(
      <DailyTasksProvider>
        <SettingsScreen />
      </DailyTasksProvider>,
    );
    await waitFor(() => expect(screen.getByRole("header", { name: "In your own words" })).toBeOnTheScreen());
  }
  /** What VoiceOver was sent to: the header's name (its label, or its text). */
  const focusedHeaders = () =>
    focusEvents.mock.calls
      .filter((call) => call[1] === "focus")
      .map((call) => {
        const props = (call[0] as { props?: Record<string, unknown> }).props ?? {};
        return props.accessibilityRole === "header" ? (props.accessibilityLabel ?? props.children) : "not a header";
      });

  it("Write your lines (asked before Settings mounts): VoiceOver goes to 'In your own words', once laid out", async () => {
    requestSettingsFocus("nag-own-lines");
    await renderSettings();
    await wait(SHEET_SWAP_DELAY_MS + 100);
    expect(focusedHeaders()).toEqual(["In your own words"]);
    // Taken: it doesn't happen again.
    expect(takeSettingsFocus()).toBeNull();
  });

  it("See what it remembers (asked while Settings is up): VoiceOver goes to 'What your coach remembers'", async () => {
    await renderSettings();
    focusEvents.mockClear();
    await act(async () => requestSettingsFocus("coach-memory"));
    await wait(SHEET_SWAP_DELAY_MS + 100);
    expect(focusedHeaders()).toEqual(["What your coach remembers"]);
  });

  const layout = (testID: string, y: number) =>
    act(async () =>
      fireEvent(screen.getByTestId(testID), "layout", { nativeEvent: { layout: { x: 0, y, width: 300, height: 100 } } }),
    );
  const scrollTo = () => ScrollView.prototype.scrollTo as unknown as jest.Mock;

  it("scrolls to the own lines: the Reminders section's y + the Nag card's + the lines' own, less a little room", async () => {
    await renderSettings();
    await layout("settings-reminders", 1200);
    await layout("settings-nag", 180);
    await layout("settings-nag-own-lines-place", 420);
    scrollTo().mockClear();
    await act(async () => requestSettingsFocus("nag-own-lines"));
    await wait(SHEET_SWAP_DELAY_MS + 100);
    expect(scrollTo()).toHaveBeenCalledWith({ y: 1200 + 180 + 420 - 16, animated: true });
  });

  it("scrolls to coach memory (in the content itself); without animation under Reduce Motion", async () => {
    (useReducedMotion as jest.Mock).mockReturnValue(true);
    try {
      await renderSettings();
      await layout("settings-coach-memory-place", 900);
      scrollTo().mockClear();
      await act(async () => requestSettingsFocus("coach-memory"));
      await wait(SHEET_SWAP_DELAY_MS + 100);
      expect(scrollTo()).toHaveBeenCalledWith({ y: 884, animated: false });
    } finally {
      (useReducedMotion as jest.Mock).mockReturnValue(false);
    }
  });

  it("not laid out yet: no scroll, VoiceOver still moves", async () => {
    await renderSettings();
    scrollTo().mockClear();
    focusEvents.mockClear();
    await act(async () => requestSettingsFocus("nag-own-lines"));
    await wait(SHEET_SWAP_DELAY_MS + 100);
    expect(scrollTo()).not.toHaveBeenCalled();
    expect(focusedHeaders()).toEqual(["In your own words"]);
  });

  it("nothing asked: nothing moved", async () => {
    await renderSettings();
    focusEvents.mockClear();
    await wait(SHEET_SWAP_DELAY_MS + 100);
    expect(focusedHeaders()).toEqual([]);
  });
});
