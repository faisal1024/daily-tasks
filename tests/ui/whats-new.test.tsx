// What's new on Today (1.4) with the REAL store, sheet and turn-on flow: who
// is shown "Meet Nag mode", when (only once Today is idle), that it shows
// once, what its chips and preview do, and where "Try Nag mode" leads with
// and without Plus.
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AccessibilityInfo,
  ActionSheetIOS,
  Alert,
  Animated,
  AppState as RNAppState,
  Keyboard,
  TextInput,
  type AlertButton,
} from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { useReducedMotion } from "react-native-reanimated";

import HomeScreen from "@/app/(tabs)/index";
import { SHEET_SWAP_DELAY_MS } from "@/hooks/use-paywall-gate";
import { __resetActionSheetForTests } from "@/lib/daily-tasks/action-sheet";
import { track } from "@/lib/daily-tasks/analytics";
import { queueFocusOpen, queueFocusStart } from "@/lib/daily-tasks/focus-link";
import { NAG_TEMPLATES } from "@/lib/daily-tasks/nag";
import { requestNotificationPermission, getNotificationPermissionStatus } from "@/lib/daily-tasks/notifications";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type Task } from "@/lib/daily-tasks/types";
import {
  __setAnnouncementsForTests,
  nagIntroSamples,
  WHATS_NEW_DELAY_MS,
  WHATS_NEW_MAX_TRIES,
  WHATS_NEW_RETRY_MS,
  WHATS_NEW_SHOW_TIMEOUT_MS,
} from "@/lib/daily-tasks/whats-new";

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
// The real overlay animates; here it is just "up" until dismissed.
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
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 };
let mockWindow = PHONE;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const TODAY = "2026-10-12";
const START = new Date(2026, 9, 12, 9, 0);
const KEY = "daily-tasks/state/v1";
const ID = "1.4-nag";

const WALK: Task = { id: "t0", text: "Walk", createdAt: "", carriedOver: false };
const STRETCH: Task = { id: "t1", text: "Stretch", createdAt: "", carriedOver: false };

const tracked = track as jest.Mock;
const eventsNamed = (name: string) => tracked.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);
const requestPermission = requestNotificationPermission as jest.Mock;
const permissionStatus = getNotificationPermissionStatus as jest.Mock;
const reducedMotion = useReducedMotion as jest.Mock;

let alert: jest.SpyInstance;
let focusEvents: jest.SpyInstance;
let keyboardHandlers: Record<string, ((event: unknown) => void)[]>;
let appStateHandlers: ((status: string) => void)[];
const appState = RNAppState as unknown as { currentState: unknown };
const realCurrentState = appState.currentState;

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  jest.clearAllMocks();
  // The released announcements (the suite's setup turns them off for everyone else).
  __setAnnouncementsForTests(null);
  mockPlus = { ...PLUS };
  mockWindow = PHONE;
  mockOpenPaywall.mockImplementation(() => true);
  permissionStatus.mockImplementation(async () => "granted");
  requestPermission.mockImplementation(async () => "granted");
  reducedMotion.mockReturnValue(false);
  appState.currentState = "active";
  appStateHandlers = [];
  jest.spyOn(RNAppState, "addEventListener").mockImplementation(((_event: string, handler: (status: string) => void) => {
    appStateHandlers.push(handler);
    return { remove: () => void appStateHandlers.splice(appStateHandlers.indexOf(handler), 1) };
  }) as never);
  jest.spyOn(console, "error").mockImplementation(() => {});
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  focusEvents = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
  keyboardHandlers = {};
  jest.spyOn(Keyboard, "addListener").mockImplementation(((event: string, handler: (event: unknown) => void) => {
    (keyboardHandlers[event] ??= []).push(handler);
    return { remove: () => {} };
  }) as never);
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

/** A state the app could have saved. `before14`: as 1.3 wrote it, without whatsNewSeen. */
async function save(saved: Partial<AppState> = {}, { before14 = true } = {}) {
  const state: AppState = syncTodayHistory(
    {
      ...buildInitialState(START),
      hasSeenOnboarding: true,
      reorderHintSeen: true,
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      tasks: [WALK, STRETCH],
      ...saved,
    },
    TODAY,
  );
  const raw: Partial<AppState> = { ...state };
  if (before14 && !("whatsNewSeen" in saved)) delete raw.whatsNewSeen;
  await AsyncStorage.setItem(KEY, JSON.stringify(raw));
}
const tree = () => (
  <DailyTasksProvider>
    <HomeScreen />
  </DailyTasksProvider>
);
async function launch() {
  const view = await render(tree());
  await flush();
  return view;
}
async function openToday(saved: Partial<AppState> = {}, options?: { before14?: boolean }) {
  await save(saved, options);
  return launch();
}
async function relaunch() {
  await advance(1000);
  await screen.unmount();
  __resetStorageForTests();
  return launch();
}
const savedState = async (): Promise<AppState> => {
  await advance(1000);
  return JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}");
};

const sheet = () => screen.queryByTestId("nag-intro-sheet");
const inSheet = () => within(screen.getByTestId("nag-intro-sheet"));
const sample = () => screen.getByTestId("nag-intro-sample").props.children as string;
const radio = (name: string) => inSheet().getByRole("radio", { name });
const checked = (name: string) => radio(name).props.accessibilityState.checked as boolean;
const lastAlert = () => alert.mock.calls[alert.mock.calls.length - 1] as [string, string, AlertButton[]];
const pressAlertButton = (text: string) => act(async () => lastAlert()[2].find((button) => button.text === text)!.onPress?.());
/** iOS has put the sheet on screen (the Modal's onShow), which is what stops it being taken back. */
const sheetShown = async () => {
  const modal = sheet()?.parent;
  if (modal) await act(async () => modal.props.onShow?.());
};
/** Past the quiet window after a launch or a return to the foreground. */
const settle = async () => {
  await advance(WHATS_NEW_DELAY_MS + 50);
  await sheetShown();
};
/** The app goes to the background and comes back: a new foreground session. */
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

describe("who sees it", () => {
  it("someone updating to 1.4 sees it once Today has been idle for a moment, not on the first frame", async () => {
    await openToday();
    expect(sheet()).toBeNull();
    await advance(WHATS_NEW_DELAY_MS - 50);
    expect(sheet()).toBeNull();
    await advance(100);
    expect(sheet()).toBeOnTheScreen();
    expect(eventsNamed("whats_new_shown")).toEqual([{ id: ID, source: "today" }]);
    // Not seen until it is closed.
    expect((await savedState()).whatsNewSeen ?? []).toEqual([]);
  });

  it("a new install never sees it: finishing first run marks it seen", async () => {
    mockPlus = { ...FREE };
    await launch();
    expect(screen.getByRole("button", { name: "I'll add my own" })).toBeOnTheScreen();
    await advance(5000);
    expect(sheet()).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "I'll add my own" }));
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    await advance(5000);
    expect(sheet()).toBeNull();
    const saved = await savedState();
    expect(saved.hasSeenOnboarding).toBe(true);
    expect(saved.whatsNewSeen).toEqual([ID]);
    await relaunch();
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([]);
  });

  it("someone who has seen it doesn't see it again", async () => {
    await openToday({ whatsNewSeen: [ID] });
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([]);
  });

  it("someone with Nag mode on already never sees it, also after going back to Calm", async () => {
    await openToday({ notifications: { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true } });
    await advance(5000);
    expect(sheet()).toBeNull();
    const saved = await savedState();
    expect(saved.whatsNewSeen).toEqual([ID]);
    await AsyncStorage.setItem(KEY, JSON.stringify({ ...saved, notifications: { ...saved.notifications, style: "calm" } }));
    await relaunch();
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([]);
  });
});

describe("when it shows", () => {
  const ROLLOVER = {
    sourceDate: "2026-10-11",
    tasks: [{ id: "y0", text: "Call the dentist", completed: false, carriedOver: false, rolloverOutcome: null }],
  };

  it("the wait is longer than a sheet takes to animate away, so it is never presented over one still closing", () => {
    expect(WHATS_NEW_DELAY_MS).toBe(SHEET_SWAP_DELAY_MS + 150);
  });

  it("yesterday's leftovers come first: not once they are dealt with (that is planning), but at the next foreground", async () => {
    await openToday({ tasks: [], pendingRollover: ROLLOVER } as Partial<AppState>);
    expect(screen.getByTestId("rollover-card")).toBeOnTheScreen();
    await advance(5000);
    expect(sheet()).toBeNull();
    await fireEvent.press(screen.getByTestId("rollover-fresh"));
    await advance(10_000);
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen ?? []).toEqual([]);
    await comeBack();
    await advance(WHATS_NEW_DELAY_MS - 50);
    expect(sheet()).toBeNull();
    await advance(100);
    expect(sheet()).toBeOnTheScreen();
  });

  it("a paywall up at launch: not right after it closes, but at the next foreground", async () => {
    mockPlus = { ...FREE, paywallSource: "win_back" };
    const view = await openToday();
    await advance(5000);
    expect(sheet()).toBeNull();
    mockPlus = { ...FREE };
    await view.rerender(tree());
    await advance(10_000);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });

  it("waits until it is known whether they have Plus (the sheet differs with and without), then shows in the same session", async () => {
    mockPlus = { ...FREE, entitlementKnown: false };
    const view = await openToday();
    await advance(5000);
    expect(sheet()).toBeNull();
    mockPlus = { ...FREE };
    await view.rerender(tree());
    await advance(WHATS_NEW_DELAY_MS - 50);
    expect(sheet()).toBeNull();
    await advance(100);
    expect(inSheet().getByText("Nag mode is part of Plus. Calm reminders stay free.")).toBeOnTheScreen();
  });

  it("the user did something while Plus was still being checked: not in this session", async () => {
    mockPlus = { ...FREE, entitlementKnown: false };
    const view = await openToday();
    await advance(1000);
    await fireEvent.press(screen.getByRole("checkbox", { name: /Task 1: Walk/ }));
    mockPlus = { ...FREE };
    await view.rerender(tree());
    await advance(10_000);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });

  it("a task ticked inside the quiet window: it gives up for this session and tries at the next foreground", async () => {
    await openToday();
    await advance(WHATS_NEW_DELAY_MS - 200);
    await fireEvent.press(screen.getByRole("checkbox", { name: /Task 1: Walk/ }));
    await advance(30_000);
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen ?? []).toEqual([]);
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
    // The preview names the task still open.
    expect(sample()).toContain("“Stretch”");
  });

  it("not after a celebration either", async () => {
    const hydrate: Task = { id: "t2", text: "Hydrate", createdAt: "", carriedOver: false };
    await openToday({ tasks: [WALK, STRETCH, hydrate], todayCompletions: [WALK.id, STRETCH.id] });
    await fireEvent.press(screen.getByRole("checkbox", { name: /Task 3: Hydrate/ }));
    await flush();
    expect(screen.getByTestId("celebration")).toBeOnTheScreen();
    await advance(5000);
    expect(sheet()).toBeNull();
    await fireEvent.press(screen.getByTestId("celebration"));
    await advance(10_000);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });

  it("a brain dump opened first: not when it closes, but at the next foreground", async () => {
    await openToday();
    await fireEvent.press(screen.getByTestId("brain-dump-entry"));
    await flush();
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
    await advance(5000);
    expect(sheet()).toBeNull();
    await fireEvent.press(screen.getByLabelText("Close brain dump"));
    await advance(10_000);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });

  it("not over a timer (running, or at its time's-up check-in): a later session shows it", async () => {
    const now = START.getTime();
    await openToday({
      focusSession: {
        id: "s1",
        taskId: WALK.id,
        taskText: WALK.text,
        stepText: null,
        date: TODAY,
        kind: "timer",
        durationMs: 600_000,
        startedAt: now - 60_000,
        endAt: now + 540_000,
        pausedRemainingMs: null,
        status: "running",
      },
    } as Partial<AppState>);
    await advance(5000);
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen ?? []).toEqual([]);
  });

  it("never interrupts typing, and does not slide up as the keyboard goes down: the next foreground shows it", async () => {
    await openToday();
    await act(async () => keyboardHandlers.keyboardDidShow.forEach((handler) => handler({})));
    await advance(5000);
    expect(sheet()).toBeNull();
    await act(async () => keyboardHandlers.keyboardDidHide.forEach((handler) => handler({})));
    await advance(10_000);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });

  it("a field in use without the on-screen keyboard is the user typing too: no retry, the next foreground", async () => {
    const focused = jest.spyOn(TextInput.State, "currentlyFocusedInput").mockReturnValue({} as never);
    await openToday();
    await advance(5000);
    expect(sheet()).toBeNull();
    focused.mockReturnValue(null as never);
    await advance(WHATS_NEW_RETRY_MS * 3);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });

  it("a menu open as the wait ends (iOS would drop the sheet): not in this session", async () => {
    __resetActionSheetForTests();
    const menu = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
    await openToday();
    await fireEvent.press(screen.getByLabelText("Start a timer: Walk"));
    expect(menu).toHaveBeenCalledTimes(1);
    await advance(10_000);
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([]);
    // Cancel: the menu has gone.
    const [options, answer] = menu.mock.calls[0];
    await act(async () => answer(options.cancelButtonIndex!));
    await advance(10_000);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });

  it("iOS not active yet as the wait ends (a launch-time blocker): it asks again a little later", async () => {
    appState.currentState = "inactive";
    await openToday();
    await advance(5000);
    expect(sheet()).toBeNull();
    appState.currentState = "active";
    await advance(WHATS_NEW_RETRY_MS + 50);
    expect(sheet()).toBeOnTheScreen();
  });

  it("each return to the foreground is one chance: used up by the user, new at the next", async () => {
    await openToday();
    await act(async () => keyboardHandlers.keyboardDidShow.forEach((handler) => handler({})));
    await act(async () => keyboardHandlers.keyboardDidHide.forEach((handler) => handler({})));
    await comeBack();
    await advance(200);
    await fireEvent.press(screen.getByRole("checkbox", { name: /Task 2: Stretch/ }));
    await advance(10_000);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
    expect(eventsNamed("whats_new_shown")).toHaveLength(1);
  });
});

describe("iOS dropped the sheet", () => {
  it("never on screen 1.5 s after it was asked to open: it is taken back, not seen, and asked again a little later", async () => {
    await openToday();
    await advance(WHATS_NEW_DELAY_MS + 50);
    // Asked to open, but onShow never comes.
    expect(sheet()).toBeOnTheScreen();
    await advance(WHATS_NEW_SHOW_TIMEOUT_MS - 100);
    expect(sheet()).toBeOnTheScreen();
    await advance(150);
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen ?? []).toEqual([]);
    // It asks again a little later, and this time it comes up and stays.
    await advance(WHATS_NEW_RETRY_MS);
    expect(sheet()).toBeOnTheScreen();
    await sheetShown();
    await advance(WHATS_NEW_SHOW_TIMEOUT_MS * 4);
    expect(sheet()).toBeOnTheScreen();
    expect((await savedState()).whatsNewSeen ?? []).toEqual([]);
  });

  it("dropped every time: three tries in a session, then it leaves Today alone until the next foreground", async () => {
    await openToday();
    // In small steps: each try is set up by the one before.
    for (let step = 0; step < 60; step++) await advance(500);
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toHaveLength(WHATS_NEW_MAX_TRIES);
    expect((await savedState()).whatsNewSeen ?? []).toEqual([]);
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
    await advance(WHATS_NEW_SHOW_TIMEOUT_MS * 4);
    expect(sheet()).toBeOnTheScreen();
  });

  it("on screen in time: it stays", async () => {
    await openSheet();
    await advance(WHATS_NEW_SHOW_TIMEOUT_MS * 4);
    expect(sheet()).toBeOnTheScreen();
  });
});

describe("a focus prompt while the sheet is up", () => {
  it("the sheet closes first, not seen; the focus screen opens only once it has gone", async () => {
    await openSheet();
    // A timer is started from the widget, then its Live Activity is tapped.
    await act(async () => queueFocusStart({ kind: "timer", source: "widget" }));
    await flush();
    const session = (await savedState()).focusSession!;
    expect(session.taskId).toBe(WALK.id);
    expect(sheet()).toBeOnTheScreen();
    await act(async () => queueFocusOpen({ sessionId: session.id }));
    await flush();
    // One modal at a time.
    expect(sheet()).toBeNull();
    expect(screen.queryByTestId("focus-modal")).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS - 100);
    expect(screen.queryByTestId("focus-modal")).toBeNull();
    await advance(150);
    expect(screen.getByTestId("focus-modal")).toBeOnTheScreen();
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen ?? []).toEqual([]);
    expect(eventsNamed("whats_new_action")).toEqual([]);
  });
});

describe("it shows once", () => {
  it("Not now marks it seen and changes nothing else; a relaunch doesn't bring it back", async () => {
    await openSheet();
    const before = await savedState();
    focusEvents.mockClear();
    await fireEvent.press(inSheet().getByRole("button", { name: "Not now" }));
    await flush();
    expect(sheet()).toBeNull();
    // VoiceOver goes back to Today's title once the sheet has gone.
    expect(focusEvents).not.toHaveBeenCalled();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(focusEvents).toHaveBeenCalledTimes(1);
    expect(focusEvents.mock.calls[0][1]).toBe("focus");
    const after = await savedState();
    expect(after.whatsNewSeen).toEqual([ID]);
    expect({ ...after, whatsNewSeen: undefined }).toEqual({ ...before, whatsNewSeen: undefined });
    expect(after.notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(screen.queryByTestId("today-toast")).toBeNull();
    expect(alert).not.toHaveBeenCalled();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "dismiss", persona: "mom", level: "firm", source: "today" }]);
    expect(eventsNamed("nag_mode_enabled")).toEqual([]);

    await advance(5000);
    expect(sheet()).toBeNull();
    await relaunch();
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toHaveLength(1);
  });

  it("the close button and the system's own dismissal mark it seen too", async () => {
    await openSheet();
    await fireEvent.press(inSheet().getByRole("button", { name: "Close" }));
    await flush();
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([ID]);

    await AsyncStorage.clear();
    await screen.unmount();
    __resetStorageForTests();
    tracked.mockClear();
    await openSheet();
    // A swipe down (iOS) or the back button (Android).
    const modal = screen.getByTestId("nag-intro-sheet").parent!;
    expect(typeof modal.props.onRequestClose).toBe("function");
    await act(async () => modal.props.onRequestClose());
    await flush();
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([ID]);
    expect(eventsNamed("whats_new_action").map((props) => props.action)).toEqual(["dismiss"]);
  });

  it("quit while it is still up: it wasn't closed, so the next launch shows it again", async () => {
    await openSheet();
    await relaunch();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });
});

describe("the sheet", () => {
  it("says what it is: label, title as a header (where VoiceOver starts), the line, the points, the footer", async () => {
    await openSheet();
    const view = inSheet();
    expect(screen.getByTestId("nag-intro-sheet").props.accessibilityViewIsModal).toBe(true);
    expect(view.getByText("New in 1.4")).toBeOnTheScreen();
    expect(view.getByRole("header", { name: "Meet Nag mode" })).toBeOnTheScreen();
    expect(view.getByText("Reminders with a personality. Pick who nags you and how hard.")).toBeOnTheScreen();
    expect(view.getByText("Random times, at most one an hour.")).toBeOnTheScreen();
    expect(view.getByText("Gets pushier while your tasks stay open.")).toBeOnTheScreen();
    expect(view.getByText("One tap stops it for the day. It stays quiet during Do Not Disturb and Focus.")).toBeOnTheScreen();
    expect(
      view.getByText("Also new: drag to reorder your three, reminders that name your tasks, and ideas for your next milestone."),
    ).toBeOnTheScreen();
    // Focus is sent to the title as it opens (a frame later, and again once it is on screen).
    await advance(50);
    expect(focusEvents).toHaveBeenCalled();
    expect(focusEvents.mock.calls.every((call) => call[1] === "focus")).toBe(true);
    // Buttons are at least 44 points tall.
    for (const id of ["nag-intro-try", "nag-intro-not-now", "nag-intro-close", "nag-intro-another"]) {
      const style = screen.getByTestId(id).props.style;
      const flat = Object.assign({}, ...(Array.isArray(style) ? style.flat(Infinity) : [style]));
      expect(flat.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  /** Where each of these comes in the sheet, top to bottom. */
  const order = (...ids: string[]) => {
    const json = JSON.stringify(screen.toJSON());
    return ids.map((id) => json.indexOf(`"testID":"${id}"`));
  };
  const ascending = (positions: number[]) =>
    positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]));

  it("with Plus: Try Nag mode, and no Plus line", async () => {
    await openSheet();
    expect(screen.queryByText("Nag mode is part of Plus. Calm reminders stay free.")).toBeNull();
    expect(screen.queryByTestId("nag-intro-plus")).toBeNull();
    const primary = screen.getByTestId("nag-intro-try");
    expect(primary.props.accessibilityLabel).toBe("Try Nag mode");
    expect(primary.props.accessibilityHint).toBeUndefined();
    expect(within(primary).getByText("Try Nag mode")).toBeOnTheScreen();
    expect(inSheet().queryByText("See Plus")).toBeNull();
  });

  it("without Plus: it says Nag mode is paid directly above the main button, which reads See Plus, before any tap", async () => {
    mockPlus = { ...FREE };
    await openSheet();
    expect(inSheet().getByText("Nag mode is part of Plus. Calm reminders stay free.")).toBeOnTheScreen();
    const primary = screen.getByTestId("nag-intro-try");
    expect(primary.props.accessibilityRole).toBe("button");
    expect(primary.props.accessibilityLabel).toBe("See Plus");
    expect(primary.props.accessibilityHint).toBe("Shows what Plus includes");
    expect(within(primary).getByText("See Plus")).toBeOnTheScreen();
    expect(inSheet().queryByText("Try Nag mode")).toBeNull();
    // Pinned under the scrolling part: after its last line, the Plus line, then the two buttons.
    expect(ascending(order("nag-intro-footer", "nag-intro-plus", "nag-intro-try", "nag-intro-not-now"))).toBe(true);
    const plusLine = screen.getByTestId("nag-intro-plus");
    const siblings = plusLine.parent!.children as { props: { testID?: string } }[];
    expect(siblings.map((child) => child.props.testID)).toEqual(["nag-intro-plus", "nag-intro-try", "nag-intro-not-now"]);
    // Nothing was opened by looking.
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });

  it("without Plus at large text sizes: the Plus line is directly above the buttons in the scrolling part", async () => {
    mockPlus = { ...FREE };
    mockWindow = { width: 320, height: 568, scale: 2, fontScale: 3.1 };
    await openSheet();
    expect(ascending(order("nag-intro-plus", "nag-intro-try", "nag-intro-not-now", "nag-intro-footer"))).toBe(true);
    const siblings = screen.getByTestId("nag-intro-plus").parent!.children as { props: { testID?: string } }[];
    expect(siblings.map((child) => child.props.testID)).toEqual(["nag-intro-plus", "nag-intro-try", "nag-intro-not-now"]);
    expect(screen.getByTestId("nag-intro-try").props.accessibilityLabel).toBe("See Plus");
  });

  it("VoiceOver hears the new sample when a Voice or Level chip changes it, as with Show another", async () => {
    const said = AccessibilityInfo.announceForAccessibilityWithOptions as jest.Mock;
    await openSheet();
    said.mockClear();
    await fireEvent.press(radio("Voice: Coach"));
    expect(said.mock.calls).toEqual([[nagIntroSamples({ persona: "coach", level: "firm", taskText: "Walk" })[0], { queue: true }]]);
    expect(said.mock.calls[0][0]).toBe(sample());
    await fireEvent.press(radio("Level: Gentle"));
    expect(said).toHaveBeenCalledTimes(2);
    expect(said.mock.calls[1]).toEqual([nagIntroSamples({ persona: "coach", level: "gentle", taskText: "Walk" })[0], { queue: true }]);
    expect(said.mock.calls[1][0]).toBe(sample());
    // The chip already chosen changes nothing: nothing more is said.
    await fireEvent.press(radio("Level: Gentle"));
    expect(said).toHaveBeenCalledTimes(2);
    await fireEvent.press(inSheet().getByRole("button", { name: "Show another" }));
    expect(said).toHaveBeenCalledTimes(3);
    expect(said.mock.calls[2][0]).toBe(sample());
  });

  it("Gentle opens on the day's first line, not on the end of the day", async () => {
    await openSheet({ tasks: [] });
    await fireEvent.press(radio("Level: Gentle"));
    expect(NAG_TEMPLATES.mom.early).toContain(sample());
  });

  it("the chips are radio buttons that carry their group, starting on the saved voice and level", async () => {
    await openSheet();
    expect(["Mom", "Spouse", "Coach", "Drill sergeant"].map((name) => checked(`Voice: ${name}`))).toEqual([true, false, false, false]);
    expect(["Gentle", "Firm", "Relentless"].map((name) => checked(`Level: ${name}`))).toEqual([false, true, false]);
    expect(screen.getByTestId("nag-intro-voice").props.accessibilityRole).toBe("radiogroup");
    expect(screen.getByTestId("nag-intro-level").props.accessibilityRole).toBe("radiogroup");
    expect(screen.getByTestId("nag-intro-level-count").props.children).toBe("About 7 a day");
  });

  it("the preview looks like a notification and follows the chips; Show another cycles it", async () => {
    await openSheet();
    const preview = () => screen.getByTestId("nag-intro-preview");
    const title = () => screen.getByTestId("nag-intro-preview-title").props.children as string;
    const momFirm = nagIntroSamples({ persona: "mom", level: "firm", taskText: "Walk" });
    expect(title()).toBe("Three Today · Mom");
    expect(sample()).toBe(momFirm[0]);
    expect(sample()).toContain("“Walk”");
    expect(preview().props.accessible).toBe(true);
    expect(preview().props.accessibilityLabel).toBe(`Sample: ${momFirm[0]}`);

    await fireEvent.press(radio("Voice: Coach"));
    const coachFirm = nagIntroSamples({ persona: "coach", level: "firm", taskText: "Walk" });
    expect(checked("Voice: Coach")).toBe(true);
    expect(checked("Voice: Mom")).toBe(false);
    expect(title()).toBe("Three Today · Coach");
    expect(sample()).toBe(coachFirm[0]);
    expect(sample()).not.toBe(momFirm[0]);

    await fireEvent.press(radio("Level: Relentless"));
    const coachRelentless = nagIntroSamples({ persona: "coach", level: "relentless", taskText: "Walk" });
    expect(screen.getByTestId("nag-intro-level-count").props.children).toBe("About 11 a day");
    expect(sample()).toBe(coachRelentless[0]);
    expect(NAG_TEMPLATES.coach.late.relentless.map((line) => line.replace("{task}", "“Walk”"))).toContain(sample());

    await fireEvent.press(radio("Level: Gentle"));
    expect(screen.getByTestId("nag-intro-level-count").props.children).toBe("About 4 a day");
    const coachGentle = nagIntroSamples({ persona: "coach", level: "gentle", taskText: "Walk" });
    expect(sample()).toBe(coachGentle[0]);

    const another = inSheet().getByRole("button", { name: "Show another" });
    const seen = [sample()];
    for (let turn = 1; turn < coachGentle.length; turn++) {
      await fireEvent.press(another);
      expect(sample()).toBe(coachGentle[turn]);
      expect(preview().props.accessibilityLabel).toBe(`Sample: ${coachGentle[turn]}`);
      seen.push(sample());
    }
    expect(new Set(seen).size).toBe(coachGentle.length);
    // Round again.
    await fireEvent.press(another);
    expect(sample()).toBe(coachGentle[0]);
    // Picking a chip starts from its first line.
    await fireEvent.press(another);
    await fireEvent.press(radio("Voice: Drill sergeant"));
    expect(sample()).toBe(nagIntroSamples({ persona: "drill", level: "gentle", taskText: "Walk" })[0]);
    // Nothing was saved or sent for any of it.
    expect((await savedState()).notifications).toEqual(DEFAULT_NOTIFICATIONS);
  });

  it("names the next open task, not a done one", async () => {
    await openSheet({ tasks: [WALK, STRETCH], todayCompletions: [WALK.id] });
    expect(sample()).toContain("“Stretch”");
    expect(sample()).not.toContain("Walk");
  });

  it("with task names hidden the preview names no task, whatever is picked", async () => {
    await openSheet({ tasks: [WALK], notifications: { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true } });
    const another = inSheet().getByRole("button", { name: "Show another" });
    for (const voice of ["Mom", "Spouse", "Coach", "Drill sergeant"]) {
      await fireEvent.press(radio(`Voice: ${voice}`));
      for (let turn = 0; turn < 8; turn++) {
        expect(sample()).not.toMatch(/Walk|“/);
        expect(screen.getByTestId("nag-intro-preview").props.accessibilityLabel).not.toMatch(/Walk|“/);
        await fireEvent.press(another);
      }
    }
  });

  it("with no task open it shows a general line", async () => {
    await openSheet({ tasks: [] });
    expect(sample()).toBe(nagIntroSamples({ persona: "mom", level: "firm", taskText: null })[0]);
    expect(sample()).not.toContain("“");
  });

  it("the new line fades in, but not with Reduce Motion", async () => {
    const timing = jest.spyOn(Animated, "timing");
    await openSheet();
    timing.mockClear();
    await fireEvent.press(radio("Voice: Coach"));
    expect(timing).toHaveBeenCalledTimes(1);
    await fireEvent.press(inSheet().getByRole("button", { name: "Not now" }));
    await screen.unmount();
    await AsyncStorage.clear();
    __resetStorageForTests();

    reducedMotion.mockReturnValue(true);
    timing.mockClear();
    await openSheet();
    await fireEvent.press(radio("Voice: Coach"));
    await fireEvent.press(inSheet().getByRole("button", { name: "Show another" }));
    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByTestId("nag-intro-sample").props.children).toBe(
      nagIntroSamples({ persona: "coach", level: "firm", taskText: "Walk" })[1],
    );
  });

  it("at the largest text sizes everything is still there, with the buttons in the scrolling part", async () => {
    mockWindow = { width: 320, height: 568, scale: 2, fontScale: 3.1 };
    await openSheet();
    const view = inSheet();
    expect(view.getByRole("button", { name: "Try Nag mode" })).toBeOnTheScreen();
    expect(view.getByRole("button", { name: "Not now" })).toBeOnTheScreen();
    expect(view.getByRole("header", { name: "Meet Nag mode" })).toBeOnTheScreen();
    expect(view.getAllByRole("radio")).toHaveLength(7);
  });
});

describe("Try Nag mode with Plus", () => {
  it("asks the same question as Settings, and Turn on saves Nag with the voice and level picked here", async () => {
    await openSheet();
    await fireEvent.press(radio("Voice: Drill sergeant"));
    await fireEvent.press(radio("Level: Relentless"));
    await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
    await flush();
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = lastAlert();
    expect(title).toBe("Turn on Nag mode?");
    expect(message).toBe(
      "Up to twice a day, your open tasks are sent to our AI service so it can write reminders in the voice you pick. They arrive at random times, at most one an hour, and get pushier while tasks stay open.",
    );
    expect(buttons.map((button) => button.text)).toEqual(["Not now", "Turn on"]);
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    // Not on, and still up, until answered.
    expect(sheet()).toBeOnTheScreen();
    expect((await savedState()).notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(screen.queryByTestId("today-toast")).toBeNull();

    await pressAlertButton("Turn on");
    await flush();
    expect(sheet()).toBeNull();
    expect(within(screen.getByTestId("today-toast")).getByText("Nag mode is on. Change it in Settings › Reminders.")).toBeOnTheScreen();
    const saved = await savedState();
    expect(saved.notifications).toMatchObject({ style: "nag", nagConfirmed: true, nagPersona: "drill", nagLevel: "relentless" });
    expect(saved.whatsNewSeen).toEqual([ID]);
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "try", persona: "drill", level: "relentless", source: "today" }]);
    expect(eventsNamed("nag_mode_enabled")).toEqual([{ persona: "drill", level: "relentless" }]);
    await relaunch();
    await advance(5000);
    expect(sheet()).toBeNull();
  });

  it("Not now on the question leaves the sheet up and nothing changed", async () => {
    await openSheet();
    await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
    await flush();
    await pressAlertButton("Not now");
    await flush();
    expect(sheet()).toBeOnTheScreen();
    expect((await savedState()).notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(screen.queryByTestId("today-toast")).toBeNull();
    await fireEvent.press(inSheet().getByRole("button", { name: "Not now" }));
    await flush();
    expect((await savedState()).whatsNewSeen).toEqual([ID]);
    expect((await savedState()).notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(eventsNamed("whats_new_action").map((props) => props.action)).toEqual(["try", "dismiss"]);
  });

  it("a double tap asks one question, not two; once it is answered the button works again", async () => {
    await openSheet();
    const primary = inSheet().getByRole("button", { name: "Try Nag mode" });
    await fireEvent.press(primary);
    await fireEvent.press(primary);
    await flush();
    await fireEvent.press(primary);
    await flush();
    expect(alert).toHaveBeenCalledTimes(1);
    await pressAlertButton("Not now");
    await flush();
    await fireEvent.press(primary);
    await flush();
    expect(alert).toHaveBeenCalledTimes(2);
    await pressAlertButton("Turn on");
    await flush();
    expect((await savedState()).notifications).toMatchObject({ style: "nag", nagConfirmed: true });
    expect(eventsNamed("nag_mode_enabled")).toHaveLength(1);
  });

  it("a double tap while iOS is being asked for notifications asks iOS once, and one question follows", async () => {
    permissionStatus.mockImplementation(async () => "undetermined");
    let answer: (status: string) => void = () => {};
    requestPermission.mockImplementation(() => new Promise<string>((resolve) => (answer = resolve)));
    await openSheet();
    const primary = inSheet().getByRole("button", { name: "Try Nag mode" });
    await fireEvent.press(primary);
    await flush();
    await fireEvent.press(primary);
    await flush();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    await act(async () => answer("granted"));
    await flush();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(lastAlert()[0]).toBe("Turn on Nag mode?");
  });

  it("asks iOS for notifications first when it hasn't been asked", async () => {
    permissionStatus.mockImplementation(async () => "undetermined");
    await openSheet();
    await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
    await flush();
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(lastAlert()[0]).toBe("Turn on Nag mode?");
  });

  it("notifications refused: it says so, and nothing turns on", async () => {
    permissionStatus.mockImplementation(async () => "denied");
    requestPermission.mockImplementation(async () => "denied");
    await openSheet();
    await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
    await flush();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(lastAlert().slice(0, 2)).toEqual([
      "Notifications unavailable",
      "Allow notifications in System Settings to get reminders for Today's Three.",
    ]);
    expect(sheet()).toBeOnTheScreen();
    expect((await savedState()).notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(screen.queryByTestId("today-toast")).toBeNull();
    expect(eventsNamed("nag_mode_enabled")).toEqual([]);
  });
});

describe("Try Nag mode without Plus", () => {
  async function tryFree() {
    mockPlus = { ...FREE };
    const view = await openSheet();
    await fireEvent.press(radio("Voice: Spouse"));
    await fireEvent.press(radio("Level: Gentle"));
    await fireEvent.press(inSheet().getByRole("button", { name: "See Plus" }));
    await flush();
    return view;
  }

  it("closes the sheet, then opens the paywall with source nag_mode", async () => {
    await tryFree();
    // One modal at a time: the sheet goes first.
    expect(sheet()).toBeNull();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
    expect(mockOpenPaywall).toHaveBeenCalledWith("nag_mode");
    expect(eventsNamed("plus_gate_hit")).toEqual([{ feature: "nag_mode" }]);
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "try", persona: "spouse", level: "gentle", source: "today" }]);
    expect(alert).not.toHaveBeenCalled();
    const saved = await savedState();
    expect(saved.whatsNewSeen).toEqual([ID]);
    expect(saved.notifications).toEqual(DEFAULT_NOTIFICATIONS);
  });

  it("VoiceOver's focus is not sent to Today's title as the sheet closes for the paywall", async () => {
    mockPlus = { ...FREE };
    await openSheet();
    focusEvents.mockClear();
    await fireEvent.press(inSheet().getByRole("button", { name: "See Plus" }));
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
    await advance(5000);
    expect(focusEvents).not.toHaveBeenCalled();
  });

  it("Today stays busy between the sheet closing and the paywall opening: no rating ask slips in", async () => {
    mockPlus = { ...FREE };
    const appReview = jest.requireMock("@/lib/daily-tasks/app-review").requestAppReview as jest.Mock;
    await openSheet({
      reviewDueAt: new Date(START.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      reviewDueSource: "perfect_day",
    } as Partial<AppState>);
    // The rating ask is due 2 s after launch: close the sheet just before it.
    await advance(1900 - (Date.now() - START.getTime()));
    await fireEvent.press(inSheet().getByRole("button", { name: "See Plus" }));
    expect(sheet()).toBeNull();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    await advance(300);
    expect(Date.now() - START.getTime()).toBeGreaterThan(2000);
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    expect(appReview).not.toHaveBeenCalled();
    await advance(SHEET_SWAP_DELAY_MS);
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
    expect(appReview).not.toHaveBeenCalled();
  });

  it("Plus bought there: the question follows, and Turn on saves the picked voice and level", async () => {
    const view = await tryFree();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    mockPlus = { ...FREE, paywallSource: "nag_mode" };
    await view.rerender(tree());
    mockPlus = { ...PLUS };
    await view.rerender(tree());
    expect(alert).not.toHaveBeenCalled();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(lastAlert()[0]).toBe("Turn on Nag mode?");
    await pressAlertButton("Turn on");
    await flush();
    expect(within(screen.getByTestId("today-toast")).getByText("Nag mode is on. Change it in Settings › Reminders.")).toBeOnTheScreen();
    expect((await savedState()).notifications).toMatchObject({ style: "nag", nagPersona: "spouse", nagLevel: "gentle" });
    expect(eventsNamed("nag_mode_enabled")).toEqual([{ persona: "spouse", level: "gentle" }]);
    // The sheet doesn't come back over it.
    await advance(5000);
    expect(sheet()).toBeNull();
  });

  it("paywall closed without buying: nothing is asked, nothing turns on, and the sheet stays gone", async () => {
    const view = await tryFree();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    mockPlus = { ...FREE, paywallSource: "nag_mode" };
    await view.rerender(tree());
    mockPlus = { ...FREE };
    await view.rerender(tree());
    await advance(5000);
    expect(alert).not.toHaveBeenCalled();
    expect(sheet()).toBeNull();
    expect(screen.queryByTestId("today-toast")).toBeNull();
    expect((await savedState()).notifications).toEqual(DEFAULT_NOTIFICATIONS);
  });
});

describe("analytics", () => {
  it("sends ids only: the announcement, the action, the voice and the level", async () => {
    const { sanitizeProps } = jest.requireActual("@/lib/daily-tasks/analytics");
    await openSheet();
    await fireEvent.press(inSheet().getByRole("button", { name: "Show another" }));
    await fireEvent.press(inSheet().getByRole("button", { name: "Not now" }));
    const calls = tracked.mock.calls.filter((call) => String(call[0]).startsWith("whats_new"));
    expect(calls).toEqual([
      ["whats_new_shown", { id: ID, source: "today" }],
      ["whats_new_action", { id: ID, action: "dismiss", persona: "mom", level: "firm", source: "today" }],
    ]);
    // Every property survives the allowlist as it is, and none holds a task's words.
    for (const [, props] of calls) {
      expect(sanitizeProps(props)).toEqual(props);
      expect(JSON.stringify(props)).not.toMatch(/Walk|Stretch/);
    }
    expect(sanitizeProps({ id: "1.4-nag", action: "try" })).toEqual({ id: "1.4-nag", action: "try" });
    expect(sanitizeProps({ id: "Call the dentist today" })).toEqual({});
    // No event anywhere carries the task text.
    expect(JSON.stringify(tracked.mock.calls)).not.toMatch(/Walk|Stretch/);
  });
});
