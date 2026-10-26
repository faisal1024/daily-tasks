// Principal-tester additions for 1.6's What's new (PR #113), Today with the REAL
// store: relaunches and day changes after it was shown, new installs and
// updaters caught mid first run, every button's order (closes + marked seen
// first, the action only after SHEET_SWAP_DELAY_MS, and never the other
// button's route), no stacking over other sheets, the new-user capture card on
// Today, and ids-only analytics. Complements whats-new-16.test.tsx.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Alert, AppState as RNAppState, Keyboard } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { router } from "expo-router";

import HomeScreen from "@/app/(tabs)/index";
import { SHEET_SWAP_DELAY_MS } from "@/hooks/use-paywall-gate";
import { __resetActionSheetForTests } from "@/lib/daily-tasks/action-sheet";
import { track } from "@/lib/daily-tasks/analytics";
import { queueCaptureOpen } from "@/lib/daily-tasks/capture";
import { queueFocusOpen, queueFocusStart } from "@/lib/daily-tasks/focus-link";
import {
  FIRST_DAYS_KEY,
  FIRST_DAYS_SHOWN_KEY,
  saveFirstDays,
  startFirstDays,
  type FirstDaysRecord,
} from "@/lib/daily-tasks/first-days";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { takeSettingsFocus } from "@/lib/daily-tasks/settings-focus";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, DEFAULT_NOTIFICATIONS, type AppState, type Task } from "@/lib/daily-tasks/types";
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
// The Sunday reset's provider lives at the tabs layout: here it is a stand-in.
const mockReset = {
  isOpen: false,
  start: jest.fn(),
  stepAside: jest.fn(() => false),
  registerOthers: jest.fn(() => () => {}),
};
jest.mock("@/components/daily-tasks/sunday-reset-provider", () => ({
  useSundayReset: () => mockReset,
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
const NAG = { ...DEFAULT_NOTIFICATIONS, style: "nag" as const, nagConfirmed: true };

const tracked = track as jest.Mock;
const eventsNamed = (name: string) => tracked.mock.calls.filter((call) => call[0] === name).map((call) => call[1]);
const navigate = router.navigate as jest.Mock;
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
  mockReset.isOpen = false;
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
    <HomeScreen />
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
const nagSheet = () => screen.queryByTestId("nag-intro-sheet");
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


const relaunch = async () => {
  await advance(1000);
  await screen.unmount();
  __resetStorageForTests();
  const view = await render(tree());
  await flush();
  return view;
};
const nextDay = (day: number) => jest.setSystemTime(new Date(2026, 9, day, 9, 0));
const shownEvents = () => eventsNamed("whats_new_shown").filter((event) => event.id === ID);

describe("shown once, for good: relaunches and a day change", () => {
  it("1.4 seen: after Got it, relaunch, a new day and a foreground never show it again (one 'shown' in all)", async () => {
    // No tasks: a new day has no leftovers to answer, so only the "once" rule can keep the sheet away.
    await openSheet({ whatsNewSeen: [NAG_ID], tasks: [] });
    await press("Got it");
    await relaunch();
    await advance(5000);
    expect(sheet()).toBeNull();
    nextDay(27);
    await relaunch();
    await advance(5000);
    await comeBack();
    await settle();
    expect(sheet()).toBeNull();
    expect(nagSheet()).toBeNull();
    nextDay(30);
    await relaunch();
    await settle();
    expect(sheet()).toBeNull();
    expect(shownEvents()).toHaveLength(1);
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
  });

  it("from before 1.4 (never saw 1.4's): only 1.6 ever shows; neither sheet, nor a duplicate id, comes back later", async () => {
    await openSheet({ tasks: [] });
    expect(nagSheet()).toBeNull();
    await press("Got it");
    nextDay(27);
    await relaunch();
    await settle();
    expect(sheet()).toBeNull();
    expect(nagSheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeNull();
    expect(nagSheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
    // 1.4's was never on screen, in any launch.
    expect(eventsNamed("whats_new_shown").filter((event) => event.id === NAG_ID)).toEqual([]);
  });

  it("closed by a button (not Got it) counts the same: Meet Nag mode, then relaunch and a new day", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID], tasks: [] });
    await press("Try Nag mode");
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(nagSheet()).toBeOnTheScreen();
    await relaunch();
    nextDay(27);
    await relaunch();
    await settle();
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
  });

  it("quit with it up (not closed): it is not lost, and it shows once on the next launch, then never again", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID], tasks: [] });
    await relaunch();
    await settle();
    expect(sheet()).toBeOnTheScreen();
    await press("Got it");
    await relaunch();
    await settle();
    expect(sheet()).toBeNull();
    expect(shownEvents()).toHaveLength(2);
  });
});

describe("new installs, including one that updates mid first run", () => {
  it("a build-1.5 user caught mid first run: finishing first run on 1.6 never shows the sheet, at any later launch or day", async () => {
    // Saved before first run finished, with no whatsNewSeen at all.
    await save({ hasSeenOnboarding: false, tasks: [] });
    mockPlus = { ...FREE };
    await render(tree());
    await flush();
    await advance(5000);
    expect(sheet()).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "I'll add my own" }));
    await advance(5000);
    expect(sheet()).toBeNull();
    await relaunch();
    await settle();
    expect(sheet()).toBeNull();
    nextDay(29);
    await relaunch();
    await comeBack();
    await settle();
    expect(sheet()).toBeNull();
    expect(nagSheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
    expect(shownEvents()).toEqual([]);
  });

  it("a new install's saved ids cover every announcement: nothing is left for a day-3 launch either", async () => {
    await openToday({ hasSeenOnboarding: true, whatsNewSeen: [NAG_ID, ID], tasks: [] });
    nextDay(29);
    await relaunch();
    await settle();
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([]);
  });
});

describe("each button: closes first (and is seen), acts only after the hand-off delay, and only its own route", () => {
  const settingsRoute = (focus: "nag-own-lines" | "coach-memory") => () => {
    expect(navigate).toHaveBeenCalledWith("/settings");
    expect(takeSettingsFocus()).toBe(focus);
    expect(nagSheet()).toBeNull();
    expect(mockReset.start).not.toHaveBeenCalled();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  };
  const cases = [
    {
      name: "Write your lines",
      saved: { notifications: NAG },
      plus: true,
      action: "write_lines",
      done: settingsRoute("nag-own-lines"),
    },
    {
      name: "See what it remembers",
      saved: {},
      plus: true,
      action: "coach_memory",
      done: settingsRoute("coach-memory"),
    },
    {
      name: "Try Nag mode",
      saved: {},
      plus: true,
      action: "try_nag",
      done: () => {
        expect(nagSheet()).toBeOnTheScreen();
        expect(navigate).not.toHaveBeenCalled();
        expect(takeSettingsFocus()).toBeNull();
        expect(mockReset.start).not.toHaveBeenCalled();
      },
    },
    {
      name: "Try Nag mode",
      saved: {},
      plus: false,
      action: "try_nag",
      done: () => {
        expect(nagSheet()).toBeOnTheScreen();
        // Meet Nag mode opens first; the paywall is its See Plus, never straight from the card.
        expect(mockOpenPaywall).not.toHaveBeenCalled();
        expect(navigate).not.toHaveBeenCalled();
      },
    },
    {
      // A Monday: the reset opens as Plan tomorrow, and the button says so (Sunday: "Try it now").
      name: "Plan tomorrow now",
      saved: {},
      plus: true,
      action: "try_reset",
      done: () => {
        expect(mockReset.start).toHaveBeenCalledTimes(1);
        expect(mockReset.start).toHaveBeenCalledWith("whats_new");
        expect(mockOpenPaywall).not.toHaveBeenCalled();
        expect(nagSheet()).toBeNull();
        expect(navigate).not.toHaveBeenCalled();
      },
    },
    {
      name: "See Plus",
      saved: {},
      plus: false,
      action: "try_reset",
      done: () => {
        // Today only hands over; the provider owns the paywall (see whats-new-16-reset.test.tsx).
        expect(mockReset.start).toHaveBeenCalledTimes(1);
        expect(mockReset.start).toHaveBeenCalledWith("whats_new");
        expect(nagSheet()).toBeNull();
        expect(navigate).not.toHaveBeenCalled();
        expect(eventsNamed("sunday_reset")).toEqual([]);
      },
    },
  ];

  it.each(cases)("$name (Plus: $plus)", async ({ name, saved, plus, action, done }) => {
    mockPlus = plus ? { ...PLUS } : { ...FREE };
    await openSheet({ whatsNewSeen: [NAG_ID], ...saved });
    await press(name);
    // Closed straight away, before anything else comes up.
    expect(sheet()).toBeNull();
    expect(nagSheet()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    expect(mockReset.start).not.toHaveBeenCalled();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    expect(takeSettingsFocus()).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS - 100);
    expect(navigate).not.toHaveBeenCalled();
    expect(mockReset.start).not.toHaveBeenCalled();
    expect(nagSheet()).toBeNull();
    await advance(150);
    done();
    // One event, an id; seen once; and the sheet never comes back.
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action, source: "today" }]);
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
    await comeBack();
    await advance(5000);
    expect(sheet()).toBeNull();
  });

  it("How it works is the only button that keeps the sheet up, and it is not marked seen by it", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID] });
    await press("How it works");
    await advance(SHEET_SWAP_DELAY_MS + 200);
    expect(sheet()).toBeOnTheScreen();
    expect(navigate).not.toHaveBeenCalled();
    expect(mockReset.start).not.toHaveBeenCalled();
    expect(nagSheet()).toBeNull();
    // Hide and How it works again are still in place; nothing was seen until Got it.
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID]);
    await press("Got it");
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
  });

  it("two quick taps (a second button inside the delay) act once: the sheet is already gone", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID] });
    await press("See what it remembers");
    expect(sheet()).toBeNull();
    expect(screen.queryByRole("button", { name: "Plan tomorrow now" })).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(eventsNamed("whats_new_action")).toHaveLength(1);
  });
});

describe("never stacks over another sheet", () => {
  it("a focus prompt while it is up: it steps aside (not seen), the focus screen follows the delay", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID] });
    await act(async () => queueFocusStart({ kind: "timer", source: "widget" }));
    await flush();
    const session = (await savedState()).focusSession!;
    await act(async () => queueFocusOpen({ sessionId: session.id }));
    await flush();
    expect(sheet()).toBeNull();
    expect(screen.queryByTestId("focus-modal")).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(screen.getByTestId("focus-modal")).toBeOnTheScreen();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID]);
    expect(eventsNamed("whats_new_action")).toEqual([]);
  });

  it("a focus session in progress from the start: not shown over it", async () => {
    await openToday({ whatsNewSeen: [NAG_ID] });
    await act(async () => queueFocusStart({ kind: "timer", source: "widget" }));
    await flush();
    await advance(5000);
    await sheetShown();
    expect(sheet()).toBeNull();
  });

  it("the Dump widget tapped while 'Try Nag mode' (from it) is up: Meet Nag mode steps aside, the dump follows the delay, and 1.6 does not return", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID] });
    await press("Try Nag mode");
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(nagSheet()).toBeOnTheScreen();
    await act(async () => queueCaptureOpen({ id: "c9", source: "widget" }));
    await flush();
    expect(nagSheet()).toBeNull();
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
  });

  it("Meet Nag mode (from 1.6) is the only sheet: a foreground return and the wait do not bring 1.6 over it", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID] });
    await press("Try Nag mode");
    await advance(SHEET_SWAP_DELAY_MS + 50);
    await comeBack();
    await advance(5000);
    expect(nagSheet()).toBeOnTheScreen();
    expect(sheet()).toBeNull();
  });

  it("a 1.5 user's own 'Meet Nag mode' (due on this open) never comes up with 1.6's: 1.6 first, theirs at the next foreground", async () => {
    const { nagCardUntil: _until, ...rest } = startFirstDays("2026-10-24");
    const record: FirstDaysRecord = { ...rest, nagIntro: "due", nagCardUntil: null, nudgeFrom: null, widgetTip: "done" };
    delete record.nagIntroOpen;
    await AsyncStorage.setItem(FIRST_DAYS_KEY, JSON.stringify(record));
    await openToday({ whatsNewSeen: [NAG_ID], todayCompletions: ["t0"] });
    await settle();
    expect(sheet()).toBeOnTheScreen();
    expect(nagSheet()).toBeNull();
    await press("Got it");
    await advance(5000);
    // Same foreground: the quiet window is spent.
    expect(nagSheet()).toBeNull();
    await comeBack();
    await advance(WHATS_NEW_DELAY_MS + 50);
    expect(sheet()).toBeNull();
    expect(nagSheet()).toBeOnTheScreen();
  });

  // Was a bug (whatsNewStepAside's pending-action branch returned false): fixed, the step-aside now returns true
  // after dropping the action, so the dump waits for the closing sheet.
  it("a dump link inside the hand-off gap waits for the closing sheet (not on screen at once)", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID] });
    await press("Plan tomorrow now");
    await act(async () => queueCaptureOpen({ id: "c3", source: "widget" }));
    await flush();
    expect(mockReset.start).not.toHaveBeenCalled();
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
  });
});

describe("a new user's 'Save for later from anywhere' card on Today", () => {
  const D1 = "2026-10-24";
  const D2 = "2026-10-25";
  const withoutNagCard = (over: Partial<FirstDaysRecord> = {}): FirstDaysRecord => {
    const { nagCardFrom: _a, nagCardUntil: _b, nagIntro: _c, nagIntroOpen: _d, ...record } = startFirstDays(D1);
    return { ...record, nudgeFrom: null, widgetTip: "done", openDays: [D1, D2], ...over };
  };
  const NEW_USER = { whatsNewSeen: [NAG_ID, ID], todayCompletions: ["t0"] } as Partial<AppState>;
  const captureCard = () => screen.queryByTestId("capture-card");
  const cardEvents = () => eventsNamed("first_days_card");

  async function launchWith(record: FirstDaysRecord, saved: Partial<AppState> = NEW_USER) {
    await saveFirstDays(record);
    await openToday(saved);
    await advance(WHATS_NEW_DELAY_MS + 200);
  }

  it("day 3 with two earlier open days and a tick: the card, never the What's new sheet, with ids-only events", async () => {
    await launchWith(withoutNagCard());
    expect(captureCard()).toBeOnTheScreen();
    expect(sheet()).toBeNull();
    expect(cardEvents()).toEqual([{ kind: "capture", action: "shown" }]);
    for (const event of cardEvents()) {
      for (const value of Object.values(event as Record<string, unknown>)) expect(String(value)).toMatch(/^[a-z0-9_.-]{1,40}$/i);
    }
  });

  it("only one earlier open day, or no tick yet: nothing", async () => {
    await launchWith(withoutNagCard({ openDays: [D1] }));
    expect(captureCard()).toBeNull();
    await screen.unmount();
    __resetStorageForTests();
    await AsyncStorage.clear();
    await launchWith(withoutNagCard(), { whatsNewSeen: [NAG_ID, ID], todayCompletions: [] });
    expect(captureCard()).toBeNull();
    expect(cardEvents()).toEqual([]);
  });

  it("something already captured (share sheet or Siri): skipped", async () => {
    await launchWith(withoutNagCard(), { ...NEW_USER, capturedEver: true });
    expect(captureCard()).toBeNull();
    expect(cardEvents()).toEqual([]);
  });

  it("captured something (an item saved) before day 3: the card never shows", async () => {
    await launchWith(withoutNagCard({ openDays: [D1] }));
    expect(captureCard()).toBeNull();
    // Day 3 reached only later; by then something was captured.
    await screen.unmount();
    __resetStorageForTests();
    await AsyncStorage.clear();
    await launchWith(withoutNagCard(), { ...NEW_USER, capturedEver: true, parkedTasks: [{ id: "p1", text: "Buy shoes", parkedAt: START.toISOString() }] });
    expect(captureCard()).toBeNull();
  });

  it("never on a day another first-days card showed", async () => {
    await AsyncStorage.setItem(FIRST_DAYS_SHOWN_KEY, JSON.stringify({ widget: TODAY }));
    await launchWith(withoutNagCard());
    expect(captureCard()).toBeNull();
    expect(cardEvents()).toEqual([]);
  });

  it("shown once: Got it ends it for good; a relaunch and the next days never bring it back", async () => {
    await launchWith(withoutNagCard());
    await fireEvent.press(screen.getByRole("button", { name: "Got it" }));
    expect(captureCard()).toBeNull();
    await relaunch();
    await advance(3000);
    expect(captureCard()).toBeNull();
    nextDay(27);
    await relaunch();
    await advance(3000);
    expect(captureCard()).toBeNull();
    expect(cardEvents().filter((event) => event.action === "shown")).toHaveLength(1);
  });

  it("left alone: it is still there on a same-day relaunch (one 'shown'), gone the next day for good", async () => {
    await launchWith(withoutNagCard());
    await relaunch();
    await advance(3000);
    expect(captureCard()).toBeOnTheScreen();
    nextDay(27);
    await relaunch();
    await advance(3000);
    expect(captureCard()).toBeNull();
    nextDay(28);
    await relaunch();
    await advance(3000);
    expect(captureCard()).toBeNull();
    expect(cardEvents().filter((event) => event.action === "shown")).toHaveLength(1);
  });
});

describe("analytics: ids only, no words, through the whole sheet", () => {
  it("every property of every what's-new event is an id from a closed list", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID], notifications: NAG, tasks: [{ ...WALK, text: "Call Dr. Rivera about the biopsy" }] });
    await press("How it works");
    await press("Write your lines");
    await advance(SHEET_SWAP_DELAY_MS + 50);
    const events = tracked.mock.calls.filter(([name]) => String(name).startsWith("whats_new"));
    expect(events.length).toBeGreaterThanOrEqual(3);
    const allowed = new Set(["whats_new_shown", "whats_new_action"]);
    for (const [name, props] of events) {
      expect(allowed.has(name)).toBe(true);
      expect(Object.keys(props as object).sort()).toEqual(name === "whats_new_shown" ? ["id", "source"] : ["action", "id", "source"]);
    }
    // Nothing anywhere carries the task's words.
    expect(JSON.stringify(tracked.mock.calls)).not.toMatch(/Rivera|biopsy|\{task\}|own words|Got it/);
  });
});
