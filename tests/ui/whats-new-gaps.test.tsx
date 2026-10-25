// What's new on Today (1.4), the principal tester's additions (PR #93), on the
// REAL store, sheet and turn-on flow: a save as 1.3 wrote it across launches,
// the quiet-moment conditions the first suite left unpinned (another tab, a
// rating ask, the retry's own delay, the keyboard arriving mid-wait), the
// paywall and permission endings, and that no task text leaves the phone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AccessibilityInfo,
  Alert,
  AppState as RNAppState,
  Keyboard,
  Text,
  TextInput,
  type AlertButton,
} from "react-native";
import { NavigationContext } from "@react-navigation/native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { useReducedMotion } from "react-native-reanimated";

import HomeScreen from "@/app/(tabs)/index";
import { SHEET_SWAP_DELAY_MS } from "@/hooks/use-paywall-gate";
import { useWhatsNew } from "@/hooks/use-whats-new";
import { track } from "@/lib/daily-tasks/analytics";
import { requestNotificationPermission, getNotificationPermissionStatus } from "@/lib/daily-tasks/notifications";
import { requestAppReview } from "@/lib/daily-tasks/app-review";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider, useDailyTasks } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type Task } from "@/lib/daily-tasks/types";
import {
  __setAnnouncementsForTests,
  todayIdleForWhatsNew,
  WHATS_NEW_DELAY_MS,
  WHATS_NEW_RETRY_MS,
  whatsNewMoment,
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
  jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
  jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions").mockImplementation(() => {});
  keyboardHandlers = {};
  jest.spyOn(Keyboard, "addListener").mockImplementation(((event: string, handler: (event: unknown) => void) => {
    (keyboardHandlers[event] ??= []).push(handler);
    return { remove: () => {} };
  }) as never);
  __resetStorageForTests();
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

const NAG_ON = "Nag mode is on. Change it in Settings › Reminders.";
const toast = () => screen.queryByTestId("today-toast");
const appReview = requestAppReview as jest.Mock;

/**
 * The saved state as 1.3 wrote it: today's fields without anything 1.4 added
 * (whatsNewSeen, reorderHintSeen, and the reminder style, voice, level and
 * window inside notifications).
 */
async function save13(saved: Partial<AppState> = {}) {
  const state = syncTodayHistory(
    {
      ...buildInitialState(START),
      hasSeenOnboarding: true,
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      tasks: [WALK, STRETCH],
      todayCompletions: [WALK.id],
      ...saved,
    },
    TODAY,
  );
  const raw = JSON.parse(JSON.stringify(state)) as Record<string, unknown> & { notifications: Record<string, unknown> };
  delete raw.whatsNewSeen;
  delete raw.reorderHintSeen;
  for (const key of ["style", "nagConfirmed", "nagPersona", "nagLevel", "nagWindow", "nagPausedDate"]) {
    delete raw.notifications[key];
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(raw));
  return raw;
}

describe("a save from 1.3", () => {
  it("loads as it was and shows the sheet exactly once: again after a quit with it up, never after it was closed", async () => {
    const raw = await save13();
    expect(raw).not.toHaveProperty("whatsNewSeen");
    expect(raw.notifications).not.toHaveProperty("style");
    await launch();
    // Their day is as they left it.
    expect(screen.getByRole("checkbox", { name: /Task 1: Walk/ }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole("checkbox", { name: /Task 2: Stretch/ }).props.accessibilityState.checked).toBe(false);
    await settle();
    expect(sheet()).toBeOnTheScreen();
    // Starts on the defaults (1.3 saved no voice or level), naming the open task.
    expect(checked("Voice: Mom")).toBe(true);
    expect(checked("Level: Firm")).toBe(true);
    expect(sample()).toContain("“Stretch”");

    // Launch two: quit with it up, so it is shown again.
    await relaunch();
    expect(sheet()).toBeNull();
    await settle();
    expect(sheet()).toBeOnTheScreen();
    await fireEvent.press(inSheet().getByRole("button", { name: "Not now" }));
    await flush();
    const after = await savedState();
    expect(after.whatsNewSeen).toEqual([ID]);
    expect(after.tasks.map((task) => task.text)).toEqual(["Walk", "Stretch"]);
    expect(after.todayCompletions).toEqual([WALK.id]);
    expect(after.notifications).toEqual(DEFAULT_NOTIFICATIONS);

    // Launches three and four: never again.
    for (let launchNumber = 3; launchNumber <= 4; launchNumber++) {
      await relaunch();
      await advance(10_000);
      expect(sheet()).toBeNull();
    }
    expect(eventsNamed("whats_new_shown")).toHaveLength(2);
    expect(eventsNamed("whats_new_action")).toHaveLength(1);
  });

  it("that had not finished first run never shows it: not before, not after, not on the next launch", async () => {
    mockPlus = { ...FREE };
    await save13({ hasSeenOnboarding: false, tasks: [], todayCompletions: [] });
    await launch();
    await advance(5000);
    expect(sheet()).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "I'll add my own" }));
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    await advance(5000);
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([ID]);
    await relaunch();
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([]);
  });

  it("a damaged whatsNewSeen (a string holding the id) is none seen: the sheet still shows", async () => {
    await save({ whatsNewSeen: ID as unknown as string[] });
    await launch();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });
});

describe("the profile form (Journey, Settings) and what's new", () => {
  let store: ReturnType<typeof useDailyTasks>;
  function Probe() {
    store = useDailyTasks();
    return null;
  }
  const probeTree = () => (
    <DailyTasksProvider>
      <Probe />
    </DailyTasksProvider>
  );

  it("first run ended by the profile form: a new install is not shown what's new", async () => {
    await render(probeTree());
    await flush();
    expect(store.state.hasSeenOnboarding).toBe(false);
    await act(async () => store.completeMomentumOnboarding({ ...store.state.momentumProfile, goalTitle: "Run 5k" }));
    expect(store.state.hasSeenOnboarding).toBe(true);
    expect(store.state.whatsNewSeen).toEqual([ID]);
  });

  it("an updater who edits their profile before the sheet came up still gets it", async () => {
    await save13();
    await render(probeTree());
    await flush();
    await act(async () => store.completeMomentumOnboarding({ ...store.state.momentumProfile, goalTitle: "Run 5k" }));
    expect(store.state.whatsNewSeen).toEqual([]);
    await screen.unmount();
    __resetStorageForTests();
    await launch();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });
});

describe("the quiet moment", () => {
  it("the keyboard coming up during the wait ends this session's chance; the next foreground gets a full wait", async () => {
    await openToday();
    await advance(WHATS_NEW_DELAY_MS - 100);
    await act(async () => keyboardHandlers.keyboardDidShow.forEach((handler) => handler({})));
    await advance(5000);
    expect(sheet()).toBeNull();
    await act(async () => keyboardHandlers.keyboardDidHide.forEach((handler) => handler({})));
    // Not as the keyboard goes down: they are in the middle of planning.
    await advance(10_000);
    expect(sheet()).toBeNull();
    await comeBack();
    await advance(WHATS_NEW_DELAY_MS - 100);
    expect(sheet()).toBeNull();
    await advance(200);
    expect(sheet()).toBeOnTheScreen();
  });

  it("with the keyboard already up as Today opens it does not show in that session", async () => {
    jest.spyOn(Keyboard, "isVisible").mockReturnValue(true);
    await openToday();
    await advance(5000);
    expect(sheet()).toBeNull();
    jest.spyOn(Keyboard, "isVisible").mockReturnValue(false);
    await act(async () => keyboardHandlers.keyboardDidHide.forEach((handler) => handler({})));
    await advance(10_000);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });

  it("held back by a launch-time blocker (iOS not active yet), it asks again after the longer retry delay, not the first one", async () => {
    appState.currentState = "inactive";
    await openToday();
    await advance(WHATS_NEW_DELAY_MS + 50);
    expect(sheet()).toBeNull();
    appState.currentState = "active";
    await advance(WHATS_NEW_DELAY_MS + 100);
    expect(sheet()).toBeNull();
    await advance(WHATS_NEW_RETRY_MS - WHATS_NEW_DELAY_MS);
    expect(sheet()).toBeOnTheScreen();
    expect(WHATS_NEW_RETRY_MS).toBeGreaterThan(WHATS_NEW_DELAY_MS);
  });

  it("a field in use the whole time: it never comes up, and is not marked seen", async () => {
    jest.spyOn(TextInput.State, "currentlyFocusedInput").mockReturnValue({} as never);
    await openToday();
    await advance(60_000);
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([]);
    expect((await savedState()).whatsNewSeen ?? []).toEqual([]);
  });

  it("not while another tab is showing, nor on coming back to Today mid-session: at the next foreground on Today", async () => {
    let tabFocused = false;
    const listeners: Record<string, (() => void)[]> = {};
    const navigation = {
      isFocused: () => tabFocused,
      addListener: (event: string, handler: () => void) => {
        (listeners[event] ??= []).push(handler);
        return () => {};
      },
    };
    await save();
    await render(
      <NavigationContext.Provider value={navigation as never}>
        <DailyTasksProvider>
          <HomeScreen />
        </DailyTasksProvider>
      </NavigationContext.Provider>,
    );
    await flush();
    await advance(5000);
    expect(sheet()).toBeNull();
    tabFocused = true;
    await act(async () => listeners.focus.forEach((handler) => handler()));
    await advance(10_000);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });

  it("no rating ask comes up over the sheet", async () => {
    await openToday({
      reviewDueAt: new Date(START.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      reviewDueSource: "perfect_day",
    } as Partial<AppState>);
    await settle();
    expect(sheet()).toBeOnTheScreen();
    await advance(10_000);
    expect(appReview).not.toHaveBeenCalled();
  });

  it("not right after a rating ask: it waits for the quiet time after it, asking again every 2 s", async () => {
    await save({
      reviewDueAt: new Date(START.getTime() - 2 * 60 * 60 * 1000).toISOString(),
      reviewDueSource: "perfect_day",
    } as Partial<AppState>);
    // Plus is still being checked as the app opens, so the rating ask (2 s in) gets there first.
    mockPlus = { ...PLUS, entitlementKnown: false };
    const view = await launch();
    await advance(2500);
    expect(appReview).toHaveBeenCalledTimes(1);
    mockPlus = { ...PLUS };
    await view.rerender(tree());
    await advance(WHATS_NEW_DELAY_MS + 100);
    expect(sheet()).toBeNull();
    await advance(WHATS_NEW_RETRY_MS + 100);
    expect(sheet()).toBeNull();
    // It keeps asking (one retry per step here) until the quiet time is over.
    for (let step = 0; step < 6 && sheet() === null; step++) await advance(WHATS_NEW_RETRY_MS + 100);
    expect(sheet()).toBeOnTheScreen();
    expect(Date.now() - START.getTime()).toBeGreaterThanOrEqual(2000 + 10_000);
    expect(appReview).toHaveBeenCalledTimes(1);
  });
});

// The three conditions the screen tests cannot reach (the aha paywall's timer,
// a drag, a break-down on its way), with the hook given what Today gives it.
describe("the hook, with Today's inputs", () => {
  const IDLE = {
    todayFocused: true,
    somethingUp: false,
    rolloverPending: false,
    keyboardUp: false,
    dragging: false,
    breakingDown: false,
  };
  const QUIET = { appActive: true, busy: false, menuOpen: false, fieldInUse: false, ratingRecent: false, ahaPending: false };
  let moment = { ...QUIET };
  function Probe({ idle = IDLE }: { idle?: typeof IDLE }) {
    const whatsNew = useWhatsNew({
      active: true,
      idle: todayIdleForWhatsNew(idle),
      pending: false,
      activity: "",
      canShowNow: () => whatsNewMoment(moment),
    });
    return <Text testID="probe">{whatsNew.openId ?? "none"}</Text>;
  }
  const probe = (idle?: typeof IDLE) => (
    <DailyTasksProvider>
      <Probe idle={idle} />
    </DailyTasksProvider>
  );
  const opened = () => screen.getByTestId("probe").props.children as string;
  async function mount(idle?: typeof IDLE) {
    moment = { ...QUIET };
    await save();
    const view = await render(probe(idle));
    await flush();
    return view;
  }

  it("idle and quiet: it opens after the delay", async () => {
    await mount();
    await advance(WHATS_NEW_DELAY_MS - 50);
    expect(opened()).toBe("none");
    await advance(100);
    expect(opened()).toBe(ID);
  });

  it("waits while the aha paywall's timer is pending, asking again every 2 s, then opens", async () => {
    await mount();
    moment = { ...QUIET, ahaPending: true };
    await advance(WHATS_NEW_DELAY_MS + 50);
    expect(opened()).toBe("none");
    await advance(WHATS_NEW_RETRY_MS + 50);
    expect(opened()).toBe("none");
    moment = { ...QUIET };
    await advance(WHATS_NEW_RETRY_MS + 50);
    expect(opened()).toBe(ID);
  });

  it("a row being dragged: not then, and not when it is dropped (this session is over for it)", async () => {
    const view = await mount({ ...IDLE, dragging: true });
    await advance(5000);
    expect(opened()).toBe("none");
    await view.rerender(probe(IDLE));
    await advance(10_000);
    expect(opened()).toBe("none");
  });

  it("a drag starting inside the wait cancels it", async () => {
    const view = await mount();
    await advance(WHATS_NEW_DELAY_MS - 100);
    await view.rerender(probe({ ...IDLE, dragging: true }));
    await advance(5000);
    expect(opened()).toBe("none");
  });

  it("a break-down in flight: not then, and not when it lands", async () => {
    const view = await mount({ ...IDLE, breakingDown: true });
    await advance(5000);
    expect(opened()).toBe("none");
    await view.rerender(probe(IDLE));
    await advance(10_000);
    expect(opened()).toBe("none");
  });

  it("a break-down starting inside the wait cancels it", async () => {
    const view = await mount();
    await advance(WHATS_NEW_DELAY_MS - 100);
    await view.rerender(probe({ ...IDLE, breakingDown: true }));
    await advance(5000);
    expect(opened()).toBe("none");
    expect((await savedState()).whatsNewSeen ?? []).toEqual([]);
  });
});

describe("Try Nag mode: the other endings", () => {
  async function tryFreeThenBuy() {
    mockPlus = { ...FREE };
    const view = await openSheet();
    await fireEvent.press(radio("Voice: Coach"));
    await fireEvent.press(radio("Level: Relentless"));
    await fireEvent.press(inSheet().getByRole("button", { name: "See Plus" }));
    await flush();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(mockOpenPaywall).toHaveBeenCalledWith("nag_mode");
    mockPlus = { ...FREE, paywallSource: "nag_mode" };
    await view.rerender(tree());
    return view;
  }

  it("free, Plus bought on the paywall: nothing is on until Turn on; then Nag with the voice and level picked in the sheet", async () => {
    const view = await tryFreeThenBuy();
    mockPlus = { ...PLUS };
    await view.rerender(tree());
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(lastAlert()[0]).toBe("Turn on Nag mode?");
    // Bought, but not answered: still Calm with the saved voice, and no toast.
    expect((await savedState()).notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(toast()).toBeNull();
    await pressAlertButton("Turn on");
    await flush();
    expect(within(toast()!).getByText(NAG_ON)).toBeOnTheScreen();
    const saved = await savedState();
    expect(saved.notifications).toMatchObject({ style: "nag", nagConfirmed: true, nagPersona: "coach", nagLevel: "relentless" });
    expect(saved.whatsNewSeen).toEqual([ID]);
    expect(eventsNamed("nag_mode_enabled")).toEqual([{ persona: "coach", level: "relentless" }]);
    // The next launch: no sheet, and the toast is not replayed.
    await relaunch();
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(screen.queryByText(NAG_ON)).toBeNull();
  });

  it("free, Plus bought, then Not now on the question: Calm stays, no toast, and the sheet does not come back", async () => {
    const view = await tryFreeThenBuy();
    mockPlus = { ...PLUS };
    await view.rerender(tree());
    await advance(SHEET_SWAP_DELAY_MS + 50);
    await pressAlertButton("Not now");
    await flush();
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(toast()).toBeNull();
    const saved = await savedState();
    expect(saved.notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(eventsNamed("nag_mode_enabled")).toEqual([]);
    await relaunch();
    await advance(5000);
    expect(sheet()).toBeNull();
  });

  it("free, Plus bought, notifications refused: it says so; nothing is asked or turned on", async () => {
    permissionStatus.mockImplementation(async () => "denied");
    requestPermission.mockImplementation(async () => "denied");
    const view = await tryFreeThenBuy();
    mockPlus = { ...PLUS };
    await view.rerender(tree());
    await advance(SHEET_SWAP_DELAY_MS + 50);
    await flush();
    expect(alert).toHaveBeenCalledTimes(1);
    expect(lastAlert()[0]).toBe("Notifications unavailable");
    expect(lastAlert()[2]).toBeUndefined();
    expect(toast()).toBeNull();
    expect((await savedState()).notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(eventsNamed("nag_mode_enabled")).toEqual([]);
    await advance(5000);
    expect(sheet()).toBeNull();
  });

  it("the paywall dismissed: nothing changes, now or on the next launch", async () => {
    const view = await tryFreeThenBuy();
    const before = await savedState();
    mockPlus = { ...FREE };
    await view.rerender(tree());
    await advance(10_000);
    expect(alert).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(sheet()).toBeNull();
    expect(toast()).toBeNull();
    expect(await savedState()).toEqual(before);
    expect(before.notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(before.whatsNewSeen).toEqual([ID]);
    await relaunch();
    await advance(10_000);
    expect(sheet()).toBeNull();
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
    expect(eventsNamed("whats_new_shown")).toHaveLength(1);
  });

  it("the paywall could not open: nothing follows when Plus turns up later", async () => {
    mockOpenPaywall.mockImplementation(() => false);
    mockPlus = { ...FREE };
    const view = await openSheet();
    await fireEvent.press(inSheet().getByRole("button", { name: "See Plus" }));
    await advance(SHEET_SWAP_DELAY_MS + 50);
    mockPlus = { ...PLUS };
    await view.rerender(tree());
    await advance(5000);
    expect(alert).not.toHaveBeenCalled();
    expect((await savedState()).notifications).toEqual(DEFAULT_NOTIFICATIONS);
  });

  it("Plus, notifications refused, then Not now: seen, Calm, and never a toast", async () => {
    permissionStatus.mockImplementation(async () => "denied");
    requestPermission.mockImplementation(async () => "denied");
    await openSheet();
    await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
    await flush();
    expect(lastAlert()[0]).toBe("Notifications unavailable");
    // Tapping again asks iOS again and says it again: still nothing on.
    await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
    await flush();
    expect(alert).toHaveBeenCalledTimes(2);
    expect(lastAlert()[0]).toBe("Notifications unavailable");
    await fireEvent.press(inSheet().getByRole("button", { name: "Not now" }));
    await flush();
    const saved = await savedState();
    expect(saved.whatsNewSeen).toEqual([ID]);
    expect(saved.notifications).toEqual(DEFAULT_NOTIFICATIONS);
    expect(toast()).toBeNull();
    await relaunch();
    await advance(5000);
    expect(sheet()).toBeNull();
  });

  it("the toast is for turning it on from the sheet only: none for Close, Not now, a relaunch, or Nag already on", async () => {
    await openSheet();
    await fireEvent.press(inSheet().getByRole("button", { name: "Close" }));
    await advance(5000);
    expect(screen.queryByText(NAG_ON)).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await AsyncStorage.clear();
    await openToday({ notifications: { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true } });
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(screen.queryByText(NAG_ON)).toBeNull();
  });
});

describe("nothing about a task leaves the phone", () => {
  // Private, and not a task the built-in lines leave unnamed (nagTaskIsSensitive): the preview shows it.
  const SECRET: Task = { id: "t0", text: "Ask Okonkwo about the surprise party", createdAt: "", carriedOver: false };
  const LEAK = /Okonkwo|surprise/i;
  const said = (spy: jest.SpyInstance) => JSON.stringify(spy.mock.calls.map((call) => call.map(String)));

  it("the preview names the task, yet no analytics event, console line or request carries it", async () => {
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {}),
    );
    const realFetch = globalThis.fetch;
    const fetched = jest.fn(async () => {
      throw new Error("no network in tests");
    });
    globalThis.fetch = fetched as unknown as typeof fetch;
    try {
      await openSheet({ tasks: [SECRET, STRETCH] });
      expect(sample()).toMatch(LEAK);
      const another = inSheet().getByRole("button", { name: "Show another" });
      for (const voice of ["Dad", "Partner", "Coach", "Drill sergeant", "Mom"]) {
        await fireEvent.press(radio(`Voice: ${voice}`));
        for (const level of ["Gentle", "Relentless", "Firm"]) {
          await fireEvent.press(radio(`Level: ${level}`));
          await fireEvent.press(another);
        }
      }
      // Looking at the preview sends nothing at all.
      expect(fetched).not.toHaveBeenCalled();
      await fireEvent.press(inSheet().getByRole("button", { name: "Try Nag mode" }));
      await flush();
      expect(fetched).not.toHaveBeenCalled();
      await pressAlertButton("Not now");
      await fireEvent.press(inSheet().getByRole("button", { name: "Not now" }));
      await advance(5000);

      expect(tracked.mock.calls.length).toBeGreaterThan(0);
      expect(JSON.stringify(tracked.mock.calls)).not.toMatch(LEAK);
      for (const spy of consoles) expect(said(spy)).not.toMatch(LEAK);
      expect(JSON.stringify(fetched.mock.calls)).not.toMatch(LEAK);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("a sensitive task is not named in the preview at all, for any voice or level, and the Drill sergeant is not rude about it", async () => {
    await openSheet({ tasks: [{ id: "t0", text: "Call Dr Okonkwo about the biopsy", createdAt: "", carriedOver: false }] });
    const another = inSheet().getByRole("button", { name: "Show another" });
    for (const voice of ["Mom", "Dad", "Partner", "Coach", "Drill sergeant"]) {
      await fireEvent.press(radio(`Voice: ${voice}`));
      for (const level of ["Gentle", "Firm", "Relentless"]) {
        await fireEvent.press(radio(`Level: ${level}`));
        for (let turn = 0; turn < 12; turn += 1) {
          expect(sample()).not.toMatch(/Okonkwo|biopsy|maggot|worm|slacker|cupcake|pathetic/i);
          await fireEvent.press(another);
        }
      }
    }
  });

  it("the free path to the paywall carries none of it either", async () => {
    mockPlus = { ...FREE };
    const consoles = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => {}),
    );
    await openSheet({ tasks: [SECRET] });
    expect(sample()).toMatch(LEAK);
    await fireEvent.press(inSheet().getByRole("button", { name: "See Plus" }));
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(JSON.stringify(mockOpenPaywall.mock.calls)).toBe('[["nag_mode"]]');
    expect(JSON.stringify(tracked.mock.calls)).not.toMatch(LEAK);
    for (const spy of consoles) expect(said(spy)).not.toMatch(LEAK);
  });
});
