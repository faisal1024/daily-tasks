// What's new in 1.6 on Today with the REAL store: who sees it (updaters, once;
// alone when 1.4's is unseen too), never over another sheet, its cards with
// Nag mode on and off, with and without Plus, and where each button leads
// (the sheet closes first, then the action follows once it has gone).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Alert, AppState as RNAppState, Keyboard } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { router } from "expo-router";

import HomeScreen from "@/app/(tabs)/index";
import { SHEET_SWAP_DELAY_MS } from "@/hooks/use-paywall-gate";
import { __resetActionSheetForTests } from "@/lib/daily-tasks/action-sheet";
import { track } from "@/lib/daily-tasks/analytics";
import { queueCaptureOpen } from "@/lib/daily-tasks/capture";
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
let focusEvents: jest.SpyInstance;
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
  focusEvents = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent").mockImplementation(() => {});
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
const cardIds = () =>
  screen
    .queryAllByTestId(/^whats-new-16-card-/)
    .map((card) => String(card.props.testID).replace("whats-new-16-card-", ""));
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

describe("who sees it", () => {
  it("someone updating from 1.4.x (1.4's seen) sees it once Today is idle, and it's seen once closed", async () => {
    await openToday({ whatsNewSeen: [NAG_ID] });
    expect(sheet()).toBeNull();
    await settle();
    expect(sheet()).toBeOnTheScreen();
    expect(nagSheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([{ id: ID, source: "today" }]);
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID]);
    await press("Got it");
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "dismiss", source: "today" }]);
    // Shown once: not at the next foreground.
    await comeBack();
    await advance(5000);
    expect(sheet()).toBeNull();
  });

  it("1.4's and 1.6's both unseen (updating from before 1.4): only 1.6's shows, and 1.4's is marked seen quietly", async () => {
    await openToday();
    // Marked as soon as the state is in, before anything shows.
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID]);
    await settle();
    expect(sheet()).toBeOnTheScreen();
    expect(nagSheet()).toBeNull();
    expect(eventsNamed("whats_new_shown")).toEqual([{ id: ID, source: "today" }]);
    await press("Got it");
    await comeBack();
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(nagSheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
  });

  it("a new install never sees it: finishing first run marks it seen", async () => {
    mockPlus = { ...FREE };
    await render(tree());
    await flush();
    await fireEvent.press(screen.getByRole("button", { name: "I'll add my own" }));
    await advance(5000);
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
    await comeBack();
    await advance(5000);
    expect(sheet()).toBeNull();
    expect(eventsNamed("whats_new_shown").filter((event) => event.id === ID)).toEqual([]);
  });

  it("swiping it down (the system's own dismissal) marks it seen too", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID] });
    await act(async () => sheet()!.parent!.props.onRequestClose());
    expect(sheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
  });
});

describe("never over another sheet", () => {
  it("the Sunday reset up: not while it is, and not straight after; the next foreground", async () => {
    mockReset.isOpen = true;
    const view = await openToday({ whatsNewSeen: [NAG_ID] });
    await advance(5000);
    expect(sheet()).toBeNull();
    mockReset.isOpen = false;
    await view.rerender(tree());
    await advance(5000);
    expect(sheet()).toBeNull();
    await comeBack();
    await settle();
    expect(sheet()).toBeOnTheScreen();
  });

  it("a paywall up: not over it", async () => {
    mockPlus = { ...FREE, paywallSource: "win_back" };
    await openToday({ whatsNewSeen: [NAG_ID] });
    await advance(5000);
    expect(sheet()).toBeNull();
  });

  it("the brain dump opened first: not over it", async () => {
    await openToday({ whatsNewSeen: [NAG_ID] });
    await fireEvent.press(screen.getByTestId("brain-dump-entry"));
    await flush();
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
    await advance(5000);
    expect(sheet()).toBeNull();
  });

  it("a dump link while it's up: it steps aside, not seen, and the dump follows once it has gone", async () => {
    await openSheet({ whatsNewSeen: [NAG_ID] });
    await act(async () => queueCaptureOpen({ id: "c1", source: "widget" }));
    await flush();
    expect(sheet()).toBeNull();
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID]);
  });
});

describe("its cards", () => {
  it("Nag mode on, with Plus: all five, in order; headers for the title and each card", async () => {
    await openSheet({ notifications: NAG });
    expect(cardIds()).toEqual(["save_later", "own_lines", "sunday_reset", "coach_memory", "nag_answer"]);
    expect(screen.getByTestId("whats-new-16-sheet").props.accessibilityViewIsModal).toBe(true);
    for (const name of [
      "What's new",
      "Save for later from anywhere",
      "Nag in your own words",
      "Sunday reset",
      "Your coach remembers",
      "Answer a nag right away",
    ]) {
      expect(inSheet().getByRole("header", { name })).toBeOnTheScreen();
    }
    expect(inSheet().getByText("New in 1.6")).toBeOnTheScreen();
    expect(
      inSheet().getByText("Long-press a nag to Snooze an hour or Mark it done. Nags now always fit the task they're about."),
    ).toBeOnTheScreen();
    expect(inSheet().getByRole("button", { name: "Write your lines" })).toBeOnTheScreen();
    expect(inSheet().getByRole("button", { name: "Try it now" })).toBeOnTheScreen();
    expect(inSheet().queryByTestId("whats-new-16-own_lines-plus")).toBeNull();
    // VoiceOver starts at the title.
    expect(focusEvents).toHaveBeenCalled();
  });

  it("Nag mode off, with Plus: four, no nag card; 'Try Nag mode'", async () => {
    await openSheet();
    expect(cardIds()).toEqual(["save_later", "own_lines", "sunday_reset", "coach_memory"]);
    expect(inSheet().getByRole("button", { name: "Try Nag mode" })).toBeOnTheScreen();
    expect(inSheet().queryByRole("button", { name: "Write your lines" })).toBeNull();
  });

  it("without Plus: four, 'Try Nag mode' and 'See Plus', the Plus cards tagged (said with the heading)", async () => {
    mockPlus = { ...FREE };
    await openSheet();
    expect(cardIds()).toEqual(["save_later", "own_lines", "sunday_reset", "coach_memory"]);
    expect(inSheet().getByRole("button", { name: "Try Nag mode" })).toBeOnTheScreen();
    expect(inSheet().getByRole("button", { name: "See Plus" }).props.accessibilityHint).toBe("Shows what Plus includes");
    expect(inSheet().getByRole("header", { name: "Nag in your own words, Plus" })).toBeOnTheScreen();
    expect(inSheet().getByRole("header", { name: "Sunday reset, Plus" })).toBeOnTheScreen();
  });

  it("a saved Nag style without Plus is Calm: no nag card, 'Try Nag mode'", async () => {
    mockPlus = { ...FREE };
    await openSheet({ notifications: NAG });
    expect(cardIds()).toEqual(["save_later", "own_lines", "sunday_reset", "coach_memory"]);
    expect(inSheet().getByRole("button", { name: "Try Nag mode" })).toBeOnTheScreen();
  });

  it("the own-lines example reads as one sentence with VoiceOver", async () => {
    await openSheet();
    expect(screen.getByTestId("whats-new-16-example").props.accessibilityLabel).toBe(
      "For example, {task}. Now. I mean it. becomes: Gym. Now. I mean it.",
    );
  });

  it("every button is at least 44 points tall", async () => {
    await openSheet({ notifications: NAG });
    for (const id of ["save_later", "own_lines", "sunday_reset", "coach_memory"]) {
      expect(screen.getByTestId(`whats-new-16-${id}-button`).props.style).toMatchObject({ minHeight: 44 });
    }
    expect(screen.getByTestId("whats-new-16-got-it").props.style.minHeight).toBeGreaterThanOrEqual(44);
  });

  it("at the largest text sizes Got it scrolls with the cards (nothing is covered)", async () => {
    mockWindow = { ...PHONE, fontScale: 2 };
    await openSheet();
    expect(within(screen.getByTestId("whats-new-16-scroll")).getByTestId("whats-new-16-got-it")).toBeOnTheScreen();
  });

  it("at the usual text size Got it stays pinned below the cards", async () => {
    await openSheet();
    expect(within(screen.getByTestId("whats-new-16-scroll")).queryByTestId("whats-new-16-got-it")).toBeNull();
    expect(screen.getByTestId("whats-new-16-got-it")).toBeOnTheScreen();
  });
});

describe("where each button leads", () => {
  it("Show me opens the how-to in place: nothing closes", async () => {
    await openSheet();
    await press("Show me");
    expect(sheet()).toBeOnTheScreen();
    expect(screen.getByTestId("whats-new-16-how-to")).toBeOnTheScreen();
    expect(inSheet().getByText("In any app, tap Share, then Three Today.")).toBeOnTheScreen();
    expect(inSheet().getByRole("button", { name: "Show me" }).props.accessibilityState).toMatchObject({ expanded: true });
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "how_to", source: "today" }]);
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID]);
  });

  it("Write your lines: the sheet closes (seen), then Settings opens at the own lines", async () => {
    await openSheet({ notifications: NAG });
    await press("Write your lines");
    expect(sheet()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(navigate).toHaveBeenCalledWith("/settings");
    expect(takeSettingsFocus()).toBe("nag-own-lines");
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "write_lines", source: "today" }]);
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
  });

  it("See what it remembers: Settings at What your coach remembers", async () => {
    await openSheet();
    await press("See what it remembers");
    expect(sheet()).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(navigate).toHaveBeenCalledWith("/settings");
    expect(takeSettingsFocus()).toBe("coach-memory");
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "coach_memory", source: "today" }]);
  });

  it("Try Nag mode: the sheet goes, then Meet Nag mode comes up (not worded as 1.4's news)", async () => {
    await openSheet();
    await press("Try Nag mode");
    expect(sheet()).toBeNull();
    expect(nagSheet()).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(nagSheet()).toBeOnTheScreen();
    expect(screen.queryByText("New in 1.4")).toBeNull();
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "try_nag", source: "today" }]);
    expect(eventsNamed("whats_new_shown")).toEqual([
      { id: ID, source: "today" },
      { id: ID, source: "whats_new" },
    ]);
    // Closing it goes back to Today; nothing comes back.
    await fireEvent.press(within(nagSheet()!).getByRole("button", { name: "Not now" }));
    expect(nagSheet()).toBeNull();
    expect((await savedState()).whatsNewSeen).toEqual([NAG_ID, ID]);
  });

  it("Try Nag mode without Plus: through Meet Nag mode's See Plus to the paywall (source nag_mode)", async () => {
    mockPlus = { ...FREE };
    await openSheet();
    await press("Try Nag mode");
    await advance(SHEET_SWAP_DELAY_MS + 50);
    await fireEvent.press(within(nagSheet()!).getByRole("button", { name: "See Plus" }));
    expect(nagSheet()).toBeNull();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(mockOpenPaywall).toHaveBeenCalledWith("nag_mode");
  });

  it("Try it now with Plus: the sheet goes, then the Sunday reset starts", async () => {
    await openSheet();
    await press("Try it now");
    expect(sheet()).toBeNull();
    expect(mockReset.start).not.toHaveBeenCalled();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(mockReset.start).toHaveBeenCalledWith("whats_new");
    expect(eventsNamed("sunday_reset")).toEqual([{ step: "card", action: "start", source: "whats_new" }]);
    expect(eventsNamed("whats_new_action")).toEqual([{ id: ID, action: "try_reset", source: "today" }]);
  });

  it("See Plus (Sunday reset, free): the same start, which opens the paywall (source sunday_reset)", async () => {
    mockPlus = { ...FREE };
    await openSheet();
    await press("See Plus");
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(mockReset.start).toHaveBeenCalledWith("whats_new");
    expect(eventsNamed("sunday_reset")).toEqual([]);
  });

  it("a dump link between the tap and the action: the action is dropped, the dump opens", async () => {
    await openSheet();
    await press("Try it now");
    await act(async () => queueCaptureOpen({ id: "c2", source: "widget" }));
    await flush();
    await advance(SHEET_SWAP_DELAY_MS + 50);
    expect(mockReset.start).not.toHaveBeenCalled();
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
  });

  it("events carry ids only, never words", async () => {
    await openSheet({ notifications: NAG });
    await press("Show me");
    await press("Write your lines");
    for (const call of tracked.mock.calls.filter(([name]) => String(name).startsWith("whats_new"))) {
      for (const value of Object.values(call[1] as Record<string, unknown>)) {
        expect(String(value)).toMatch(/^[a-z0-9_.-]{1,40}$/i);
      }
    }
  });
});
