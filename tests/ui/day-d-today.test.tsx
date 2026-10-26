// 1.5 D on Today with the REAL store and sheets: the Nag mode card and its
// sheet for a new install, the welcome back line, the first-tick toast and
// haptic, and the optional name in the greeting. Local-time fixtures only
// (day keys and Dates built from local constructors), so the suite reads the
// same in every time zone.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, ActionSheetIOS, Alert, AppState as RNAppState, Keyboard, Platform, Share } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { __resetActionSheetForTests } from "@/lib/daily-tasks/action-sheet";
import { track } from "@/lib/daily-tasks/analytics";
import { announcePolitely } from "@/lib/daily-tasks/announce";
import {
  FIRST_DAYS_KEY,
  FIRST_DAYS_SHOWN_KEY,
  loadFirstDays,
  saveFirstDays,
  startFirstDays,
  type FirstDaysRecord,
} from "@/lib/daily-tasks/first-days";
import { FIRST_TICK_KEY, FIRST_TICK_TOAST } from "@/lib/daily-tasks/first-tick";
import { getNotificationPermissionStatus } from "@/lib/daily-tasks/notifications";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import {
  DEFAULT_AUTO_LOCK,
  DEFAULT_NOTIFICATIONS,
  type AppState,
  type DayRecord,
  type Task,
} from "@/lib/daily-tasks/types";
import {
  __setAnnouncementsForTests,
  NAG_CARD_COPY,
  NAG_FIRST_DAYS_ID,
  NAG_INTRO_COPY,
  WHATS_NEW_DELAY_MS,
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

// Monday 26 October 2026, 9:00 local.
const START = new Date(2026, 9, 26, 9, 0);
const TODAY = "2026-10-26";
const YESTERDAY = "2026-10-25";
const KEY = "daily-tasks/state/v1";

const WALK: Task = { id: "t0", text: "Walk", createdAt: "", carriedOver: false };
const STRETCH: Task = { id: "t1", text: "Stretch", createdAt: "", carriedOver: false };
const HYDRATE: Task = { id: "t2", text: "Hydrate", createdAt: "", carriedOver: false };

const tracked = track as jest.Mock;
const eventsNamed = (name: string) => tracked.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);
const cardEvents = () => eventsNamed("first_days_card");
const permissionStatus = getNotificationPermissionStatus as jest.Mock;

let appStateHandlers: ((status: string) => void)[];
const appState = RNAppState as unknown as { currentState: unknown };
const realCurrentState = appState.currentState;
const originalOS = Platform.OS;

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  jest.clearAllMocks();
  // Released announcements stay off: these tests are about the new install's own Nag intro.
  __setAnnouncementsForTests([]);
  Platform.OS = "ios";
  permissionStatus.mockImplementation(async () => "granted");
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

const dayRecord = (date: string, completed: number): DayRecord => ({
  date,
  total: 3,
  completed,
  locked: false,
  lockSource: null,
  tasks: [],
  reflection: null,
  reflectionResult: null,
});

/** A state the app could have saved on TODAY (its history for today is written the way the store does). */
async function save(saved: Partial<AppState> = {}) {
  const state: AppState = syncTodayHistory(
    {
      ...buildInitialState(START),
      hasSeenOnboarding: true,
      reorderHintSeen: true,
      // These suites are not about the Plus-win-back or trial notes.
      whatsNewSeen: ["1.4-nag"],
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      tasks: [WALK, STRETCH, HYDRATE],
      ...saved,
    },
    TODAY,
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
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
async function openToday(saved: Partial<AppState> = {}, record?: FirstDaysRecord | null) {
  await save(saved);
  if (record) await saveFirstDays(record);
  return launch();
}
const settle = async () => {
  await advance(WHATS_NEW_DELAY_MS + 50);
  // iOS has put the sheet on screen (the Modal's onShow), which is what stops it being taken back.
  const modal = screen.queryByTestId("nag-intro-sheet")?.parent;
  if (modal) await act(async () => modal.props.onShow?.());
};
/** The app goes to the background and comes back: a new open. */
const comeBack = async () => {
  for (const status of ["background", "active"]) {
    appState.currentState = status;
    await act(async () => [...appStateHandlers].forEach((handler) => handler(status)));
    await flush(2);
  }
};
const tick = (name: RegExp) => fireEvent.press(screen.getByRole("checkbox", { name }));

const nagCard = () => screen.queryByTestId("nag-card");
const sheet = () => screen.queryByTestId("nag-intro-sheet");
/** A new install's record as first run writes it; the sheet waits for the next open. */
const newInstall = (day = TODAY): FirstDaysRecord => startFirstDays(day);
/** The same, with the sheet already due (an earlier launch ended first run). */
const dueOnLaunch = (day = TODAY): FirstDaysRecord => ({ ...startFirstDays(day, "an-earlier-launch#0") });
/** First run ended in this very open: the card is in play, the sheet waits for the next open. */
const cardOnly = (day = TODAY): FirstDaysRecord => startFirstDays(day);
const saved = async () => (await loadFirstDays()) as FirstDaysRecord;

describe("the Nag card on a new install", () => {
  it("day 1: never, not even after the first tick; day 2 it appears, once, with its 'shown' event", async () => {
    await openToday({}, cardOnly());
    await advance(3000);
    expect(nagCard()).toBeNull();
    await tick(/Task 1: Walk/);
    await flush();
    await advance(3000);
    expect(nagCard()).toBeNull();
    expect(cardEvents().filter((event: { kind: string }) => event.kind === "nag")).toEqual([]);
    await screen.unmount();
    __resetStorageForTests();
    await AsyncStorage.clear();
    await save();
    // The next day (first run ended yesterday).
    await saveFirstDays(cardOnly(YESTERDAY));
    await launch();
    expect(nagCard()).toBeOnTheScreen();
    const card = within(screen.getByTestId("nag-card"));
    expect(card.getByText(NAG_CARD_COPY.title)).toBeOnTheScreen();
    expect(card.getByText(NAG_CARD_COPY.body)).toBeOnTheScreen();
    expect(card.getByRole("button", { name: NAG_CARD_COPY.button })).toBeOnTheScreen();
    expect(cardEvents()).toEqual([{ kind: "nag", action: "shown" }]);
    // Still there on a remount the same day, with no second 'shown'.
    await screen.unmount();
    __resetStorageForTests();
    await launch();
    expect(nagCard()).toBeOnTheScreen();
    expect(cardEvents()).toEqual([{ kind: "nag", action: "shown" }]);
  });

  it("day 2: shows without any tick; day 3: gone", async () => {
    await openToday({}, cardOnly(YESTERDAY));
    await flush();
    expect(nagCard()).toBeOnTheScreen();
    await screen.unmount();
    __resetStorageForTests();
    await AsyncStorage.removeItem(FIRST_DAYS_SHOWN_KEY);
    // A record from two days ago: its window has closed.
    await saveFirstDays(cardOnly("2026-10-24"));
    await launch();
    await advance(3000);
    expect(nagCard()).toBeNull();
  });

  it("not on a finished day, and not with Nag mode already on", async () => {
    await openToday({ todayCompletions: ["t0", "t1", "t2"] }, cardOnly(YESTERDAY));
    await advance(3000);
    expect(nagCard()).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await save({ notifications: { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true } });
    await launch();
    await advance(3000);
    expect(nagCard()).toBeNull();
  });

  it("comes after the morning nudge, before the widget tip: nudge, then Nag card, then tip", async () => {
    permissionStatus.mockImplementation(async () => "undetermined");
    // Day 2: the nudge is due, the Nag card is due and the tip is due, all at once.
    await openToday({}, { ...cardOnly(YESTERDAY), widgetTip: "due" });
    await flush();
    expect(screen.getByTestId("nudge-card")).toBeOnTheScreen();
    expect(nagCard()).toBeNull();
    expect(screen.queryByTestId("widget-tip")).toBeNull();
    await fireEvent.press(screen.getByTestId("nudge-card-not-now"));
    await flush();
    expect(screen.queryByTestId("nudge-card")).toBeNull();
    expect(nagCard()).toBeOnTheScreen();
    expect(screen.queryByTestId("widget-tip")).toBeNull();
    await fireEvent.press(screen.getByTestId("nag-card-dismiss"));
    await flush();
    expect(nagCard()).toBeNull();
    expect(screen.getByTestId("widget-tip")).toBeOnTheScreen();
  });

  it("× dismisses it for good: no card later, and the sheet never comes on its own", async () => {
    await openToday({}, { ...dueOnLaunch(YESTERDAY) });
    // The sheet is due on this launch; dismiss the card before it comes up.
    expect(nagCard()).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: NAG_CARD_COPY.dismiss }));
    await flush();
    expect(nagCard()).toBeNull();
    expect(cardEvents()).toContainEqual({ kind: "nag", action: "dismissed" });
    expect((await saved()).nagIntro).toBe("done");
    expect((await saved()).nagCardUntil).toBeNull();
    await advance(WHATS_NEW_DELAY_MS * 4);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await launch();
    await settle();
    expect(nagCard()).toBeNull();
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([]);
  });

  it("'Meet Nag mode' opens the sheet (as a new install's, not as news), and seeing it ends the card and the auto sheet", async () => {
    await openToday({}, cardOnly(YESTERDAY));
    await fireEvent.press(screen.getByRole("button", { name: NAG_CARD_COPY.button }));
    await flush();
    expect(sheet()).toBeOnTheScreen();
    expect(within(screen.getByTestId("nag-intro-sheet")).getByText(NAG_INTRO_COPY.title)).toBeOnTheScreen();
    // Nothing is new to them: no 'New in 1.4' label and no 'Also new' line.
    expect(screen.queryByTestId("nag-intro-label")).toBeNull();
    expect(screen.queryByTestId("nag-intro-footer")).toBeNull();
    expect(cardEvents()).toContainEqual({ kind: "nag", action: "open" });
    expect(eventsNamed("whats_new_shown")).toEqual([{ id: NAG_FIRST_DAYS_ID, source: "card" }]);
    // Seen once it's closed (a sheet that had to step aside would leave the card).
    expect((await saved()).nagIntro).not.toBe("done");
    // Close it.
    await fireEvent.press(within(screen.getByTestId("nag-intro-sheet")).getByRole("button", { name: "Not now" }));
    await advance(1000);
    expect(sheet()).toBeNull();
    expect(nagCard()).toBeNull();
    expect((await saved()).nagIntro).toBe("done");
    expect(eventsNamed("whats_new_action")).toEqual([
      expect.objectContaining({ id: NAG_FIRST_DAYS_ID, action: "dismiss", source: "card" }),
    ]);
    await comeBack();
    await settle();
    expect(sheet()).toBeNull();
    expect(nagCard()).toBeNull();
  });

  it("never for someone who updated from 1.4 (no record), even on a finished day", async () => {
    await openToday({ todayCompletions: ["t0", "t1", "t2"] });
    await settle();
    await comeBack();
    await settle();
    expect(nagCard()).toBeNull();
    expect(sheet()).toBeNull();
    expect(cardEvents()).toEqual([]);
    expect(await AsyncStorage.getItem(FIRST_DAYS_KEY)).toBeNull();
  });

  it("never for a 1.5 A record (no Nag fields): no card on any day, no sheet at any open", async () => {
    const { nagCardFrom, nagCardUntil, nagIntro, nagIntroOpen, ...aEra } = startFirstDays(YESTERDAY);
    void [nagCardFrom, nagCardUntil, nagIntro, nagIntroOpen];
    await AsyncStorage.setItem(FIRST_DAYS_KEY, JSON.stringify({ ...aEra, nudgeFrom: null }));
    await openToday({ todayCompletions: ["t0"] });
    await settle();
    await comeBack();
    await settle();
    expect(nagCard()).toBeNull();
    expect(sheet()).toBeNull();
    expect(cardEvents().filter((event: { kind: string }) => event.kind === "nag")).toEqual([]);
  });

  it("not next to yesterday's leftovers", async () => {
    await openToday(
      {
        tasks: [],
        pendingRollover: {
          sourceDate: YESTERDAY,
          tasks: [{ id: "y0", text: "Call the dentist", completed: false, carriedOver: false, rolloverOutcome: null }],
        },
      } as Partial<AppState>,
      cardOnly(YESTERDAY),
    );
    await advance(3000);
    expect(screen.getByTestId("rollover-card")).toBeOnTheScreen();
    expect(nagCard()).toBeNull();
  });
});

describe("the sheet on its own, once, on the next open after first run", () => {
  it("not in the open first run ended in; at the next foreground (a later day, after a tick) it comes up, as a new install's", async () => {
    await openToday({ todayCompletions: ["t0"] }, newInstall(YESTERDAY));
    await advance(WHATS_NEW_DELAY_MS * 5);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
    expect(screen.queryByTestId("nag-intro-label")).toBeNull();
    expect(screen.queryByTestId("nag-intro-footer")).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([{ id: NAG_FIRST_DAYS_ID, source: "today" }]);
  });

  it("on a later launch it comes up after the quiet moment (not on the first frame)", async () => {
    await openToday({ todayCompletions: ["t0"] }, dueOnLaunch(YESTERDAY));
    expect(sheet()).toBeNull();
    await advance(WHATS_NEW_DELAY_MS - 100);
    expect(sheet()).toBeNull();
    await advance(200);
    expect(sheet()).toBeOnTheScreen();
  });

  it("is seen on close: the card and the sheet are done, and nothing comes back at any later open or launch", async () => {
    await openToday({ todayCompletions: ["t0"] }, dueOnLaunch(YESTERDAY));
    await settle();
    expect(sheet()).toBeOnTheScreen();
    await fireEvent.press(within(screen.getByTestId("nag-intro-sheet")).getByRole("button", { name: "Not now" }));
    await advance(1000);
    expect(sheet()).toBeNull();
    expect((await saved()).nagIntro).toBe("done");
    expect(nagCard()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await launch();
    await settle();
    expect(sheet()).toBeNull();
    expect(nagCard()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toHaveLength(1);
  });

  it("never with yesterday's leftovers waiting, nor during first run", async () => {
    await openToday(
      {
        tasks: [],
        pendingRollover: {
          sourceDate: YESTERDAY,
          tasks: [{ id: "y0", text: "Call the dentist", completed: false, carriedOver: false, rolloverOutcome: null }],
        },
      } as Partial<AppState>,
      dueOnLaunch(),
    );
    await advance(WHATS_NEW_DELAY_MS * 5);
    expect(sheet()).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await AsyncStorage.clear();
    await save({ hasSeenOnboarding: false, tasks: [] });
    await saveFirstDays(dueOnLaunch());
    await launch();
    await advance(WHATS_NEW_DELAY_MS * 5);
    expect(screen.getByTestId("first-run-dump")).toBeOnTheScreen();
    expect(sheet()).toBeNull();
  });

  it("not when Nag mode is already on", async () => {
    await openToday({ notifications: { ...DEFAULT_NOTIFICATIONS, style: "nag", nagConfirmed: true } }, dueOnLaunch());
    await advance(WHATS_NEW_DELAY_MS * 5);
    expect(sheet()).toBeNull();
  });

  it("never on the first-run day, nor before anything was ever ticked", async () => {
    // Due (a later open), first-run day, a tick: still not today.
    await openToday({ todayCompletions: ["t0"] }, dueOnLaunch());
    await advance(WHATS_NEW_DELAY_MS * 5);
    await comeBack();
    await settle();
    expect(sheet()).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await AsyncStorage.clear();
    // A later day, but nothing ticked yet, ever.
    await openToday({}, dueOnLaunch(YESTERDAY));
    await advance(WHATS_NEW_DELAY_MS * 5);
    await comeBack();
    await settle();
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([]);
  });

  it("a user who ticks first isn't interrupted in that open; the next open shows it", async () => {
    await openToday({}, dueOnLaunch(YESTERDAY));
    await advance(WHATS_NEW_DELAY_MS - 300);
    await tick(/Task 1: Walk/);
    await advance(WHATS_NEW_DELAY_MS * 5);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });
});

describe("welcome back", () => {
  /** Days the app was opened and finished something, ending on the date given. */
  const history = (...days: [string, number][]) => ({
    history: Object.fromEntries(days.map(([date, done]) => [date, dayRecord(date, done)])),
  });

  it("after a 2+ day gap: 'Welcome back. Day N is still yours.' with the Day chip's N, until the first tick", async () => {
    await openToday(history(["2026-10-20", 3], ["2026-10-21", 2], ["2026-10-24", 1]));
    const line = screen.getByTestId("welcome-back");
    // Three past days with a tick, and today: the Day chip says Day 4, so does the welcome.
    expect(screen.getByLabelText("Day 4 of showing up")).toBeOnTheScreen();
    expect(within(line).getByText("Welcome back. Day 4 is still yours.")).toBeOnTheScreen();
    await tick(/Task 1: Walk/);
    await flush();
    expect(screen.queryByTestId("welcome-back")).toBeNull();
  });

  it("not when the last open was yesterday or today, and not for a new install", async () => {
    await openToday(history(["2026-10-25", 1]));
    expect(screen.queryByTestId("welcome-back")).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await AsyncStorage.clear();
    await openToday();
    expect(screen.queryByTestId("welcome-back")).toBeNull();
  });

  it("across a month boundary: a gap from 31 Oct to 2 Nov is 2 days", async () => {
    jest.setSystemTime(new Date(2026, 10, 2, 9, 0));
    const state: AppState = syncTodayHistory(
      {
        ...buildInitialState(new Date(2026, 10, 2, 9)),
        hasSeenOnboarding: true,
        whatsNewSeen: ["1.4-nag"],
        autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
        tasks: [WALK],
        history: { "2026-10-31": dayRecord("2026-10-31", 1) },
      },
      "2026-11-02",
    );
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
    await launch();
    expect(screen.getByText("Welcome back. Day 2 is still yours.")).toBeOnTheScreen();
    expect(eventsNamed("welcome_back_shown")).toEqual([{ count: 2 }]);
  });

  it("'welcome_back_shown' {count: days} goes out once a day, across remounts and launches; not after a tick", async () => {
    await openToday(history(["2026-10-21", 2]));
    await flush();
    expect(eventsNamed("welcome_back_shown")).toEqual([{ count: 5 }]);
    await comeBack();
    await screen.unmount();
    __resetStorageForTests();
    await launch();
    expect(screen.getByTestId("welcome-back")).toBeOnTheScreen();
    expect(eventsNamed("welcome_back_shown")).toHaveLength(1);
  });

  it("no event when the welcome never shows (first tick before the effect, or a one-day gap)", async () => {
    await openToday(history(["2026-10-25", 2]));
    await flush();
    expect(eventsNamed("welcome_back_shown")).toEqual([]);
  });

  it("not in first run", async () => {
    await openToday({ hasSeenOnboarding: false, tasks: [], ...history(["2026-10-20", 3]) });
    expect(screen.getByTestId("first-run-dump")).toBeOnTheScreen();
    expect(screen.queryByTestId("welcome-back")).toBeNull();
  });
});

describe("first tick: the toast once ever, and a light haptic on every tick", () => {
  const impact = Haptics.impactAsync as jest.Mock;

  it("the first tick of an install says it, politely, once; undo and tick again doesn't repeat it", async () => {
    await openToday();
    await tick(/Task 1: Walk/);
    await flush();
    expect(within(screen.getByTestId("today-toast")).getByText(/One down\./)).toBeOnTheScreen();
    expect(announcePolitely).toHaveBeenCalledWith(FIRST_TICK_TOAST);
    expect(await AsyncStorage.getItem(FIRST_TICK_KEY)).not.toBeNull();
    (announcePolitely as jest.Mock).mockClear();
    await tick(/Task 1: Walk/);
    await tick(/Task 1: Walk/);
    await flush();
    expect(announcePolitely).not.toHaveBeenCalledWith(FIRST_TICK_TOAST);
    await tick(/Task 2: Stretch/);
    await flush();
    expect(announcePolitely).not.toHaveBeenCalledWith(FIRST_TICK_TOAST);
  });

  it("never at the second tick of a day, nor on a later launch", async () => {
    await openToday({ todayCompletions: ["t0"] });
    await tick(/Task 2: Stretch/);
    await flush();
    expect(announcePolitely).not.toHaveBeenCalledWith(FIRST_TICK_TOAST);
    expect(await AsyncStorage.getItem(FIRST_TICK_KEY)).toBeNull();
  });

  it("not for someone with a past tick in their history (an update from an earlier version)", async () => {
    await openToday({ history: { "2026-10-20": dayRecord("2026-10-20", 2) } });
    await tick(/Task 1: Walk/);
    await flush();
    expect(announcePolitely).not.toHaveBeenCalledWith(FIRST_TICK_TOAST);
    expect(screen.queryByText(FIRST_TICK_TOAST)).toBeNull();
    expect(await AsyncStorage.getItem(FIRST_TICK_KEY)).toBeNull();
  });

  it("a firmer impact for done than for un-ticking: medium on ticking, light on un-ticking", async () => {
    await openToday({ history: { "2026-10-20": dayRecord("2026-10-20", 2) } });
    await tick(/Task 1: Walk/);
    await tick(/Task 1: Walk/);
    await tick(/Task 2: Stretch/);
    expect(impact.mock.calls.map(([style]) => style)).toEqual(["medium", "light", "medium"]);
  });
});

describe("the optional name", () => {
  /** First run to the "three" screen (the offline sort fills it in). */
  async function toThreeScreen() {
    await save({ hasSeenOnboarding: false, tasks: [] });
    await launch();
    await fireEvent.changeText(screen.getByLabelText("What's on your mind today"), "walk, call mum, report");
    await fireEvent.press(screen.getByRole("button", { name: "Pick my three" }));
    await flush(10);
    await advance(2000);
    expect(screen.getByTestId("first-run-name")).toBeOnTheScreen();
    expect(screen.getByText("For your greeting. Change it anytime in Settings.")).toBeOnTheScreen();
  }
  const useThem = () => fireEvent.press(screen.getByRole("button", { name: /Use th(ese|is)/ }));
  const storedName = async () => JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}").momentumProfile?.name;

  it("a name typed on the 'three' screen is cleaned, saved and shown in the greeting", async () => {
    await toThreeScreen();
    await fireEvent.changeText(screen.getByTestId("first-run-name"), "  Elena   Maria ");
    await useThem();
    await flush(10);
    expect(screen.getByText(/^Good morning, Elena$/)).toBeOnTheScreen();
    await advance(1000);
    expect(await storedName()).toBe("Elena Maria");
  });

  it("leaving it empty (or only spaces) finishes first run without a name or a greeting name", async () => {
    await toThreeScreen();
    await fireEvent.changeText(screen.getByTestId("first-run-name"), "    ");
    await useThem();
    await flush(10);
    expect(screen.queryByTestId("first-run-name")).toBeNull();
    expect(screen.queryByText(/^Good morning, /)).toBeNull();
    await advance(1000);
    expect([undefined, null, ""]).toContain(await storedName());
    expect(screen.getByRole("checkbox", { name: /Task 1: Walk/ })).toBeOnTheScreen();
  });

  it("'I'll add my own' skips the whole screen, name included", async () => {
    await save({ hasSeenOnboarding: false, tasks: [] });
    await launch();
    await fireEvent.press(screen.getByRole("button", { name: "I'll add my own" }));
    await flush();
    expect(screen.queryByTestId("first-run-name")).toBeNull();
    await advance(1000);
    expect([undefined, null, ""]).toContain(await storedName());
  });
});

describe("Share your day on Today", () => {
  const FINISHED = { todayCompletions: ["t0", "t1", "t2"] };
  let share: jest.SpyInstance;
  beforeEach(() => {
    share = jest.spyOn(Share, "share").mockResolvedValue({ action: Share.sharedAction } as never);
  });

  it("a finished day offers it on iOS; the sheet shows the day's names and Share goes to iOS, tracked as counts", async () => {
    await openToday(FINISHED);
    await fireEvent.press(screen.getByRole("button", { name: "Share your day" }));
    await flush();
    const picture = within(screen.getByTestId("share-day-card"));
    for (const name of ["Walk", "Stretch", "Hydrate"]) expect(picture.getByText(name)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("share-day-share"));
    await flush();
    expect(share).toHaveBeenCalledTimes(1);
    expect(eventsNamed("finish_card_shared")).toEqual([{ count: 3, kind: "names" }]);
    await advance(500);
    expect(screen.queryByTestId("share-day-sheet")).toBeNull();
  });

  it("Hide task names in Settings is respected: no names on the picture, no switch", async () => {
    await openToday({ ...FINISHED, notifications: { ...DEFAULT_NOTIFICATIONS, hideTaskNames: true } });
    await fireEvent.press(screen.getByRole("button", { name: "Share your day" }));
    await flush();
    const picture = within(screen.getByTestId("share-day-card"));
    for (const name of ["Walk", "Stretch", "Hydrate"]) expect(picture.queryByText(name)).toBeNull();
    expect(screen.queryByTestId("share-day-names")).toBeNull();
    await fireEvent.press(screen.getByTestId("share-day-share"));
    await flush();
    expect(eventsNamed("finish_card_shared")).toEqual([{ count: 3, kind: "no_names" }]);
  });

  it("not offered on Android, nor before the day is finished", async () => {
    Platform.OS = "android";
    await openToday(FINISHED);
    expect(screen.queryByRole("button", { name: "Share your day" })).toBeNull();
    await screen.unmount();
    Platform.OS = "ios";
    __resetStorageForTests();
    await AsyncStorage.clear();
    await openToday({ todayCompletions: ["t0"] });
    expect(screen.queryByRole("button", { name: "Share your day" })).toBeNull();
  });
});

describe("Saved for later: Swap in", () => {
  const FULL = { parkedTasks: [{ id: "p1", text: "Zulu", parkedAt: "2026-10-25T08:00:00.000Z" }] };
  let menu: jest.SpyInstance;
  beforeEach(() => {
    menu = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
  });
  const openSaved = async () => {
    await fireEvent.press(screen.getByRole("button", { name: /^Saved for later, 1 item/ }));
    await flush();
  };

  it("on a full day: Swap in lists the open tasks only; the pick keeps its spot, the old one is saved for later", async () => {
    await openToday({ ...FULL, todayCompletions: ["t0"] });
    await openSaved();
    // No "Starter ideas" chip over the user's own saved items.
    expect(screen.queryByTestId("ideas-source-row")).toBeNull();
    await fireEvent.press(screen.getByTestId("swap-in-p1"));
    expect(menu).toHaveBeenCalledTimes(1);
    const [options, answer] = menu.mock.calls[0];
    expect(options.options).toEqual(["Stretch", "Hydrate", "Cancel"]);
    expect(options.message).toBe("Which task should it replace? That one goes to Saved for later.");
    await act(async () => answer(0));
    await flush();
    expect(screen.getByRole("checkbox", { name: /Task 1: Walk/ })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: /Task 2: Zulu/ })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: /Task 3: Hydrate/ })).toBeOnTheScreen();
    expect(within(screen.getByTestId("today-toast")).getByText(/Swapped in\. .Stretch. is saved for later\./)).toBeOnTheScreen();
    expect(eventsNamed("saved_swapped_in")).toEqual([{ source: "saved" }]);
    expect((Haptics.impactAsync as jest.Mock).mock.calls.map(([style]) => style)).toEqual(["light"]);
    // The old one is now the saved item, and Walk (done) stayed done.
    expect(screen.getByText("Stretch")).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: /Task 1: Walk/ }).props.accessibilityState.checked).toBe(true);
  });

  it("Cancel swaps nothing and tracks nothing", async () => {
    await openToday(FULL);
    await openSaved();
    await fireEvent.press(screen.getByTestId("swap-in-p1"));
    const [options, answer] = menu.mock.calls[0];
    await act(async () => answer(options.cancelButtonIndex));
    await flush();
    expect(screen.getByRole("checkbox", { name: /Task 2: Stretch/ })).toBeOnTheScreen();
    expect(eventsNamed("saved_swapped_in")).toEqual([]);
  });

  it("a running focus timer on the task that left is stopped", async () => {
    const now = START.getTime();
    await openToday({
      ...FULL,
      focusSession: {
        id: "s1",
        taskId: "t1",
        taskText: "Stretch",
        stepText: null,
        date: TODAY,
        kind: "timer",
        durationMs: 600_000,
        startedAt: now,
        endAt: now + 600_000,
        pausedRemainingMs: null,
        status: "running",
      },
    } as Partial<AppState>);
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    await openSaved();
    await fireEvent.press(screen.getByTestId("swap-in-p1"));
    // The menu lists Walk, Stretch, Hydrate: Stretch is the one with the timer.
    await act(async () => menu.mock.calls[0][1](1));
    await flush();
    await advance(1000);
    expect(screen.getByRole("checkbox", { name: /Task 2: Zulu/ })).toBeOnTheScreen();
    expect(JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}").focusSession).toBeNull();
    // Said, like Not today.
    expect(within(screen.getByTestId("today-toast")).getByText(/Swapped in\. .Stretch. is saved for later\. Timer stopped\./)).toBeOnTheScreen();
  });

  it("not offered on a locked day, nor when every task is done", async () => {
    await openToday({ ...FULL, todayLocked: true, todayLockSource: "manual" });
    await openSaved();
    expect(screen.queryByTestId("swap-in-p1")).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await AsyncStorage.clear();
    await openToday({ ...FULL, todayCompletions: ["t0", "t1", "t2"] });
    await openSaved();
    expect(screen.queryByTestId("swap-in-p1")).toBeNull();
  });

  it("not offered while there is a free slot (the item is simply added)", async () => {
    await openToday({ ...FULL, tasks: [WALK, STRETCH] });
    expect(screen.queryByRole("button", { name: /^Saved for later, 1 item/ })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: /Opens suggestions/ }));
    await flush();
    expect(screen.getByText("Zulu")).toBeOnTheScreen();
    expect(screen.queryByTestId("swap-in-p1")).toBeNull();
  });

  it("on Android it asks under the item: the open tasks as buttons, and Cancel even with three", async () => {
    Platform.OS = "android";
    await openToday(FULL);
    await openSaved();
    await fireEvent.press(screen.getByTestId("swap-in-p1"));
    expect(menu).not.toHaveBeenCalled();
    const choices = within(screen.getByTestId("swap-choices-p1"));
    expect(choices.getByText("Which task should it replace? That one goes to Saved for later.")).toBeOnTheScreen();
    expect(choices.getAllByRole("button").map((button) => button.props.accessibilityLabel)).toEqual([
      "Replace Walk",
      "Replace Stretch",
      "Replace Hydrate",
      "Cancel",
    ]);
    // Cancel closes it and swaps nothing.
    await fireEvent.press(choices.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("swap-choices-p1")).toBeNull();
    expect(eventsNamed("saved_swapped_in")).toEqual([]);
    await fireEvent.press(screen.getByTestId("swap-in-p1"));
    await fireEvent.press(within(screen.getByTestId("swap-choices-p1")).getByRole("button", { name: "Replace Hydrate" }));
    await flush();
    expect(screen.getByRole("checkbox", { name: /Task 3: Zulu/ })).toBeOnTheScreen();
  });
});

describe("the rollover card's title names the day the leftovers are from", () => {
  const pending = (sourceDate: string) =>
    ({
      sourceDate,
      tasks: [{ id: "y0", text: "Call the dentist", completed: false, carriedOver: false, rolloverOutcome: null }],
    }) as unknown as AppState["pendingRollover"];
  const title = () => within(screen.getByTestId("rollover-card")).getByRole("header");

  it.each([
    ["2026-10-25", "Unfinished from yesterday"],
    ["2026-10-23", "Unfinished from Friday"],
    ["2026-10-20", "Unfinished from Tuesday"],
    ["2026-10-19", "Unfinished from last week"],
    ["2026-09-30", "Unfinished from last week"],
  ])("leftovers from %s: '%s'", async (sourceDate, expected) => {
    await openToday({ tasks: [], pendingRollover: pending(sourceDate) });
    expect(title()).toHaveTextContent(expected);
  });

  it("across a month boundary: from Friday 30 Oct on Monday 2 Nov it says Friday, not yesterday", async () => {
    jest.setSystemTime(new Date(2026, 10, 2, 9, 0));
    const state: AppState = syncTodayHistory(
      {
        ...buildInitialState(new Date(2026, 10, 2, 9)),
        hasSeenOnboarding: true,
        whatsNewSeen: ["1.4-nag"],
        autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
        tasks: [],
        pendingRollover: pending("2026-10-30"),
      },
      "2026-11-02",
    );
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
    await launch();
    expect(title()).toHaveTextContent("Unfinished from Friday");
  });

  it("beside last night's draft it is 'Also from …'", async () => {
    await openToday({
      tasks: [],
      pendingRollover: pending("2026-10-23"),
      tomorrowDraft: { forDate: TODAY, tasks: ["Plan the week"], note: "", because: "", source: "local" },
    } as unknown as Partial<AppState>);
    expect(title()).toHaveTextContent(/^Also from Friday$/);
  });
});
