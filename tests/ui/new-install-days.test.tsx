// 1.6, a new install end to end over its first four days, with the REAL
// store, Today and first-days cards: day 1 nothing; day 2 "Meet Nag mode"
// (and its card); day 3 the widget tip; day 4 "Save for later from
// anywhere". One first-days card a day, and never the What's new sheet
// (first run marked every announcement seen).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Alert, AppState as RNAppState, Keyboard, Platform } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { __resetActionSheetForTests } from "@/lib/daily-tasks/action-sheet";
import { track } from "@/lib/daily-tasks/analytics";
import { __newLaunchForTests, loadFirstDays, saveFirstDays, startFirstDays } from "@/lib/daily-tasks/first-days";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState, type DayRecord, type Task } from "@/lib/daily-tasks/types";
import { __setAnnouncementsForTests, allAnnouncementIds, WHATS_NEW_DELAY_MS } from "@/lib/daily-tasks/whats-new";

import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/widget-bridge", () => ({
  invalidateFocusSession: jest.fn(),
  readFocusCommands: jest.fn(() => ({ raw: null, processedSeq: 0 })),
  markFocusCommandsProcessed: jest.fn(),
  readFocusStartRequest: jest.fn(() => ({ raw: null, handledId: null })),
  markFocusStartRequestHandled: jest.fn(),
  focusSessionJson: jest.fn((session: object, rev: number) => JSON.stringify({ v: 1, rev, ...session })),
  writeWidgetSnapshot: jest.fn(),
  writeFocusSession: jest.fn(),
  invalidateWidgetSnapshot: jest.fn(),
  readWidgetToggles: jest.fn(() => ({ raw: null, processedSeq: 0 })),
  markWidgetTogglesProcessed: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusSessionNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  dismissFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
  requestNotificationPermission: jest.fn(async () => "granted"),
  syncNotifications: jest.fn(async () => {}),
  registerFocusCategory: jest.fn(async () => {}),
  registerNagCategory: jest.fn(async () => {}),
  registerNotificationCategories: jest.fn(async () => {}),
  subscribeNagResponses: jest.fn(() => () => {}),
  subscribeFocusResponses: jest.fn(() => () => {}),
}));
jest.mock("@/lib/daily-tasks/navigation", () => ({ navigateToToday: jest.fn() }));
jest.mock("@/hooks/use-app-update", () => ({
  useAppUpdate: () => ({ update: null, dismiss: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/app-review", () => ({ requestAppReview: jest.fn(async () => false) }));
jest.mock("@/lib/daily-tasks/announce", () => ({ announcePolitely: jest.fn() }));
const mockPlus = {
  paywallBuild: true,
  paywallEnabled: true,
  entitlementActive: false,
  entitlementKnown: true,
  paywallSource: null as string | null,
  purchaseCount: 0,
  winBackDue: false,
};
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: jest.fn(() => true) }),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/coach-note", () => ({
  ...jest.requireActual("@/lib/daily-tasks/coach-note"),
  requestCoachNotes: jest.fn(async () => {
    throw new Error("no proxy in tests");
  }),
}));
jest.mock("@/components/daily-tasks/onboarding-modal", () => ({ OnboardingModal: () => null }));
jest.mock("@/components/daily-tasks/celebration-overlay", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    CelebrationOverlay: ({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) =>
      visible ? (
        <Text testID="celebration" onPress={onDismiss}>
          celebration
        </Text>
      ) : null,
  };
});
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));

// Tuesday 20 October 2026 is first-run day; four weekdays, 9:00 local (no Sunday reset card).
const DAYS = ["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"] as const;
const at9 = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 9, 0);
};
const KEY = "daily-tasks/state/v1";
const task = (id: string, text: string): Task => ({ id, text, createdAt: "", carriedOver: false });

const tracked = track as jest.Mock;
const shownCards = () =>
  tracked.mock.calls
    .filter(([name, props]) => name === "first_days_card" && props.action === "shown")
    .map(([, props]) => props.kind as string);
const eventsNamed = (name: string) => tracked.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);

const appState = RNAppState as unknown as { currentState: unknown };
const realCurrentState = appState.currentState;
const originalOS = Platform.OS;

beforeEach(async () => {
  jest.useFakeTimers({ now: at9(DAYS[0]) });
  jest.clearAllMocks();
  // The released announcements: the point is that a new install sees none.
  __setAnnouncementsForTests(null);
  Platform.OS = "ios";
  appState.currentState = "active";
  jest.spyOn(RNAppState, "addEventListener").mockImplementation((() => ({ remove: () => {} })) as never);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
  jest.spyOn(Keyboard, "addListener").mockImplementation((() => ({ remove: () => {} })) as never);
  __resetStorageForTests();
  __resetActionSheetForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  appState.currentState = realCurrentState;
  Platform.OS = originalOS;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const flush = async (times = 6) => {
  for (let i = 0; i < times; i++) await act(async () => {});
};
const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await flush(2);
};
const record = (date: string, completed: number, total = 2): DayRecord => ({
  date,
  total,
  completed,
  locked: false,
  lockSource: null,
  tasks: [],
  reflection: null,
  reflectionResult: null,
});

/**
 * Day `index`'s launch: the clock on that morning, the app's saved state for
 * a new day (its tasks, the earlier days' history; first run's marks kept),
 * and a new launch. The first-days record carries over as the app left it.
 */
async function launchDay(index: number, tasks: Task[], history: DayRecord[]) {
  const day = DAYS[index];
  jest.setSystemTime(at9(day));
  const base: AppState = {
    ...buildInitialState(at9(day)),
    hasSeenOnboarding: true,
    reorderHintSeen: true,
    // As first run leaves it: every announcement this build knows is seen.
    whatsNewSeen: allAnnouncementIds(),
    autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
    tasks,
    history: Object.fromEntries(history.map((entry) => [entry.date, entry])),
  };
  await AsyncStorage.setItem(KEY, JSON.stringify(syncTodayHistory(base, day)));
  __resetStorageForTests();
  __newLaunchForTests();
  tracked.mockClear();
  const view = await render(
    <DailyTasksProvider>
      <HomeScreen />
    </DailyTasksProvider>,
  );
  await flush();
  // Long past any quiet window.
  await advance(WHATS_NEW_DELAY_MS + 50);
  const nagModal = screen.queryByTestId("nag-intro-sheet")?.parent;
  if (nagModal) await act(async () => nagModal.props.onShow?.());
  return view;
}
const tick = (name: RegExp) => fireEvent.press(screen.getByRole("checkbox", { name }));
const q = (id: string) => screen.queryByTestId(id);

it("days 1 to 4: nothing, then Meet Nag mode, then the widget tip, then Save for later; one a day; never What's new", async () => {
  // First run ended on day 1 (in an earlier open).
  await saveFirstDays(startFirstDays(DAYS[0], "first-run#0"));

  // Day 1: nothing yet. One of two ticked (not a finished day).
  let view = await launchDay(0, [task("a", "Walk"), task("b", "Stretch")], []);
  await tick(/Walk/);
  await advance(5000);
  for (const id of ["nag-card", "nag-intro-sheet", "widget-tip", "capture-card", "whats-new-16-sheet"]) expect(q(id)).toBeNull();
  expect(shownCards()).toEqual([]);
  await view.unmount();

  // Day 2: the Nag card, and Meet Nag mode on its own (a later day, after a tick).
  view = await launchDay(1, [task("c", "Hydrate")], [record(DAYS[0], 1)]);
  expect(q("nag-intro-sheet")).toBeOnTheScreen();
  expect(eventsNamed("whats_new_shown")).toEqual([{ id: "1.5-nag-intro", source: "today" }]);
  await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
  await advance(1000);
  expect(q("nag-intro-sheet")).toBeNull();
  expect(q("nag-card")).toBeNull();
  // The day is finished: the widget tip is earned, for a later day.
  await tick(/Hydrate/);
  await advance(5000);
  expect(q("widget-tip")).toBeNull();
  expect(q("capture-card")).toBeNull();
  expect(shownCards()).toEqual(["nag"]);
  expect(q("whats-new-16-sheet")).toBeNull();
  await view.unmount();

  // Day 3: the widget tip; Save for later is eligible (two earlier days, a tick) but waits: one a day.
  view = await launchDay(2, [task("d", "Read")], [record(DAYS[0], 1), record(DAYS[1], 1, 1)]);
  expect(q("widget-tip")).toBeOnTheScreen();
  expect(q("capture-card")).toBeNull();
  await fireEvent.press(screen.getByTestId("widget-tip-dismiss"));
  await advance(5000);
  expect(q("widget-tip")).toBeNull();
  expect(q("capture-card")).toBeNull();
  expect(shownCards()).toEqual(["widget"]);
  expect(q("whats-new-16-sheet")).toBeNull();
  expect(q("nag-intro-sheet")).toBeNull();
  await view.unmount();

  // Day 4: Save for later from anywhere, once.
  view = await launchDay(3, [task("e", "Plan")], [record(DAYS[0], 1), record(DAYS[1], 1, 1), record(DAYS[2], 0, 1)]);
  expect(q("capture-card")).toBeOnTheScreen();
  expect(shownCards()).toEqual(["capture"]);
  await fireEvent.press(screen.getByRole("button", { name: "Got it" }));
  expect(q("capture-card")).toBeNull();
  expect((await loadFirstDays())?.captureCard).toBe("done");
  for (const id of ["nag-card", "nag-intro-sheet", "widget-tip", "whats-new-16-sheet"]) expect(q(id)).toBeNull();
  await view.unmount();
});
