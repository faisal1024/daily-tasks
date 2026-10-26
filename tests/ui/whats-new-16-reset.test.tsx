// Principal-tester additions for 1.6's What's new (PR #113) with the REAL Sunday
// reset provider (the other What's new tests stand it in): "See Plus" opens the
// paywall with the right source, only after the sheet has gone; "Try it now"
// opens the reset only after it; a Sunday notification tap while the sheet is
// up steps it aside (not seen) and the reset follows.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Alert, AppState as RNAppState, Keyboard } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { SundayResetProvider } from "@/components/daily-tasks/sunday-reset-provider";
import { SHEET_SWAP_DELAY_MS } from "@/hooks/use-paywall-gate";
import { __resetActionSheetForTests } from "@/lib/daily-tasks/action-sheet";
import { track } from "@/lib/daily-tasks/analytics";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { takeSettingsFocus } from "@/lib/daily-tasks/settings-focus";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState, type Task } from "@/lib/daily-tasks/types";
import { __setAnnouncementsForTests, WHATS_NEW_DELAY_MS } from "@/lib/daily-tasks/whats-new";

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

const FREE = {
  paywallBuild: true,
  paywallEnabled: true,
  entitlementActive: false,
  entitlementKnown: true,
  paywallSource: null as string | null,
  purchaseCount: 0,
  winBackDue: false,
};
const PLUS = { ...FREE, entitlementActive: true };
let mockPlus: typeof FREE;
const mockOpenPaywall = jest.fn((_source: string) => true);
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ ...mockPlus, openPaywall: mockOpenPaywall }),
}));
const mockResponseListeners: ((response: unknown) => void)[] = [];
jest.mock("expo-notifications", () => ({
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  getPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "granted", granted: true })),
  getAllScheduledNotificationsAsync: jest.fn(async () => []),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  scheduleNotificationAsync: jest.fn(async () => "id"),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn((listener: (response: unknown) => void) => {
    mockResponseListeners.push(listener);
    return { remove: () => {} };
  }),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date", TIME_INTERVAL: "timeInterval" },
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
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 };
let mockWindow = PHONE;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const TODAY = "2026-10-26";
const START = new Date(2026, 9, 26, 9, 0);
const KEY = "daily-tasks/state/v1";
const ID = "1.6-features";
const NAG_ID = "1.4-nag";
const WALK: Task = { id: "t0", text: "Walk", createdAt: "", carriedOver: false };

const tracked = track as jest.Mock;
const eventsNamed = (name: string) => tracked.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);
let appStateHandlers: ((status: string) => void)[];
const appState = RNAppState as unknown as { currentState: unknown };
const realCurrentState = appState.currentState;

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  jest.clearAllMocks();
  // The released announcements: 1.4's and 1.6's.
  __setAnnouncementsForTests(null);
  mockPlus = { ...PLUS };
  mockWindow = PHONE;
  mockResponseListeners.length = 0;
  mockOpenPaywall.mockImplementation(() => true);
  appState.currentState = "active";
  appStateHandlers = [];
  jest.spyOn(RNAppState, "addEventListener").mockImplementation(((_event: string, handler: (status: string) => void) => {
    appStateHandlers.push(handler);
    return { remove: () => void appStateHandlers.splice(appStateHandlers.indexOf(handler), 1) };
  }) as never);
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
  jest.spyOn(Keyboard, "addListener").mockImplementation((() => ({ remove: () => {} })) as never);
  takeSettingsFocus();
  __resetStorageForTests();
  __resetActionSheetForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  appState.currentState = realCurrentState;
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

/** A state an updater could have saved (before 1.4 by default: no whatsNewSeen at all). */
async function save(saved: Partial<AppState> = {}) {
  const state: AppState = syncTodayHistory(
    {
      ...buildInitialState(START),
      hasSeenOnboarding: true,
      reorderHintSeen: true,
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      tasks: [WALK],
      ...saved,
    },
    TODAY,
  );
  const raw: Partial<AppState> = { ...state };
  if (!("whatsNewSeen" in saved)) delete raw.whatsNewSeen;
  await AsyncStorage.setItem(KEY, JSON.stringify(raw));
}
const tree = () => (
  <DailyTasksProvider>
    <SundayResetProvider>
      <HomeScreen />
    </SundayResetProvider>
  </DailyTasksProvider>
);
async function openToday(saved: Partial<AppState> = {}) {
  await save(saved);
  const view = await render(tree());
  await flush();
  return view;
}
const savedState = async (): Promise<AppState> => {
  await advance(1000);
  return JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}");
};

const sheet = () => screen.queryByTestId("whats-new-16-sheet");
const inSheet = () => within(screen.getByTestId("whats-new-16-sheet"));
const sheetShown = async () => {
  const modal = sheet()?.parent;
  if (modal) await act(async () => modal.props.onShow?.());
};
const settle = async () => {
  await advance(WHATS_NEW_DELAY_MS + 50);
  await sheetShown();
};
const comeBack = async () => {
  for (const status of ["background", "active"]) {
    appState.currentState = status;
    await act(async () => [...appStateHandlers].forEach((handler) => handler(status)));
    await flush(2);
  }
};
async function openSheet(saved: Partial<AppState> = {}) {
  const view = await openToday(saved);
  await settle();
  expect(sheet()).toBeOnTheScreen();
  return view;
}
const press = (name: string) => fireEvent.press(inSheet().getByRole("button", { name }));



const resetSheet = () => screen.queryByTestId("sunday-reset-sheet");
const tap = {
  actionIdentifier: "expo.modules.notifications.actions.DEFAULT",
  notification: {
    date: 1,
    request: { identifier: "daily-tasks:2026-10-25:sunday_reset:1800", content: { data: { kind: "sunday_reset" } } },
  },
};

describe("Sunday reset from 1.6's sheet, with the real provider", () => {
  it("Try it now (Plus): the sheet closes, the reset comes up only after the delay, and 1.6 does not return over it", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID] });
    await press("Try it now");
    expect(sheet()).toBeNull();
    expect(resetSheet()).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS - 100);
    expect(resetSheet()).toBeNull();
    await advance(150);
    expect(resetSheet()).toBeOnTheScreen();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    expect(eventsNamed("sunday_reset").filter((event) => event.action === "start")).toEqual([
      { step: "card", action: "start", source: "whats_new" },
    ]);
    await comeBack();
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(resetSheet()).toBeOnTheScreen();
  });

  it("See Plus (free): the paywall opens with source sunday_reset, only after the sheet has gone, once", async () => {
    mockPlus = { ...FREE };
    await openSheet({ whatsNewSeen: [NAG_ID] });
    await press("See Plus");
    expect(sheet()).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS - 100);
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    await advance(150);
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
    expect(mockOpenPaywall).toHaveBeenCalledWith("sunday_reset");
    expect(resetSheet()).toBeNull();
    expect(eventsNamed("sunday_reset")).toEqual([{ step: "card", action: "plus", source: "whats_new" }]);
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "try_reset", source: "today" }]);
  });

  it("See Plus, then the paywall dismissed: nothing opens and the sheet does not return", async () => {
    mockPlus = { ...FREE };
    const view = await openSheet({ whatsNewSeen: [NAG_ID] });
    await press("See Plus");
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(mockOpenPaywall).toHaveBeenCalledWith("sunday_reset");
    // The paywall is up, then closes without a purchase.
    mockPlus = { ...FREE, paywallSource: "sunday_reset" };
    await view.rerender(tree());
    await advance(100);
    mockPlus = { ...FREE };
    await view.rerender(tree());
    await advance(SHEET_SWAP_DELAY_MS + 200);
    expect(resetSheet()).toBeNull();
    expect(sheet()).toBeNull();
  });

  it("See Plus, then Plus bought on the paywall: the reset opens once the paywall has gone", async () => {
    mockPlus = { ...FREE };
    const view = await openSheet({ whatsNewSeen: [NAG_ID] });
    await press("See Plus");
    await advance(SHEET_SWAP_DELAY_MS + 50);
    mockPlus = { ...FREE, paywallSource: "sunday_reset" };
    await view.rerender(tree());
    await advance(100);
    mockPlus = { ...PLUS };
    await view.rerender(tree());
    await advance(SHEET_SWAP_DELAY_MS + 200);
    expect(resetSheet()).toBeOnTheScreen();
    expect(sheet()).toBeNull();
  });

  it("a Sunday notification tap while the sheet is up: it steps aside (not seen), the reset follows after the delay", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID] });
    expect(mockResponseListeners.length).toBeGreaterThan(0);
    await act(async () => mockResponseListeners.forEach((listener) => listener(tap)));
    await flush();
    expect(sheet()).toBeNull();
    expect(resetSheet()).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS + 100);
    expect(resetSheet()).toBeOnTheScreen();
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID]);
    expect(eventsNamed("whats_new_action")).toEqual([]);
  });

  it("the reset already up: 1.6 never comes over it (at launch, or at a later foreground)", async () => {
    await openToday({ whatsNewSeen: [NAG_ID] });
    await act(async () => mockResponseListeners.forEach((listener) => listener(tap)));
    await flush();
    expect(resetSheet()).toBeOnTheScreen();
    await advance(5000);
    await comeBack();
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(resetSheet()).toBeOnTheScreen();
  });
});
