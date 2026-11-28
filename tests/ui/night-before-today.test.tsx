// The night before (1.7) end to end on the REAL Today screen with the real
// store and AsyncStorage: evening card -> sheet -> Keep till morning, then a
// relaunch the next morning -> Add one, Save one, Let the rest go. Plus the
// owner's edge cases: after-midnight dump, a sheet opened at 11:58 PM and
// saved at 12:03 AM, a full/locked Today, a full Saved for later, a list never
// acted on, and a malformed saved list. Local-time fixtures only.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, Alert, AppState as RNAppState, Keyboard, Platform } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { __resetActionSheetForTests } from "@/lib/daily-tasks/action-sheet";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, MAX_PARKED_TASKS, type AppState, type NightList, type ParkedTask, type Task } from "@/lib/daily-tasks/types";
import { __setAnnouncementsForTests } from "@/lib/daily-tasks/whats-new";

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
jest.mock("@/lib/daily-tasks/announce", () => ({
  ...jest.requireActual("@/lib/daily-tasks/announce"),
  announcePolitely: jest.fn(),
  announceLater: jest.fn(),
  announceLiveChange: jest.fn(),
}));
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


jest.mock("@/lib/daily-tasks/momentum-ai", () => ({
  ...jest.requireActual("@/lib/daily-tasks/momentum-ai"),
  getMomentumAiProxyUrl: jest.fn(() => null),
}));

const THU = "2026-11-26";
const FRI = "2026-11-27";
const SAT = "2026-11-28";
const KEY = "daily-tasks/state/v1";

let appStateHandlers: ((status: string) => void)[];
const appState = RNAppState as unknown as { currentState: unknown };
const realCurrentState = appState.currentState;
const originalOS = Platform.OS;

const flush = async (times = 8) => {
  for (let i = 0; i < times; i++) await act(async () => {});
};
const setNow = (d: Date) => jest.setSystemTime(d);

beforeEach(async () => {
  jest.useFakeTimers({ now: new Date(2026, 10, 26, 21, 0) });
  jest.clearAllMocks();
  __setAnnouncementsForTests([]);
  Platform.OS = "ios";
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

const task = (id: string, text: string): Task => ({ id, text, createdAt: "", carriedOver: false });
const parked = (n: number): ParkedTask => ({ id: `p${n}`, text: `Saved ${n}`, parkedAt: "2026-11-01T00:00:00.000Z" });

/** A state the app could have saved on `day`. */
async function save(day: string, extra: Partial<AppState> = {}) {
  const [y, m, d] = day.split("-").map(Number);
  const state: AppState = syncTodayHistory(
    {
      ...buildInitialState(new Date(y, m - 1, d, 9)),
      hasSeenOnboarding: true,
      reorderHintSeen: true,
      whatsNewSeen: ["1.4-nag", "1.7-night"],
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      ...extra,
    },
    day,
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(state));
}
async function launch() {
  const view = await render(
    <DailyTasksProvider>
      <HomeScreen />
    </DailyTasksProvider>,
  );
  await flush();
  return view;
}
async function relaunch(view: { unmount: () => void | Promise<void> }) {
  await view.unmount();
  __resetStorageForTests();
  return launch();
}
const stored = async (): Promise<AppState> => JSON.parse((await AsyncStorage.getItem(KEY)) as string);
/** Persistence is debounced; let it write. */
const persisted = async () => {
  await act(async () => {
    jest.advanceTimersByTime(2000);
  });
  await flush();
  return stored();
};
const press = async (id: string | RegExp) => {
  await fireEvent.press(typeof id === "string" ? screen.getByTestId(id) : screen.getByRole("button", { name: id }));
  await flush();
};
const held = (texts: string[], forDay = FRI, nightOf = THU, picked: string[] = []): NightList => ({
  forDay,
  nightOf,
  text: texts.join("\n"),
  items: texts.map((text, i) => ({ id: `n${i}`, text, picked: picked.includes(text) })),
  source: "local",
  createdAt: new Date(2026, 10, 26, 21).toISOString(),
});
const rowTexts = () => screen.queryAllByTestId("night-morning-row").length;

const until = async (testID: string, tries = 40) => {
  for (let i = 0; i < tries; i++) {
    if (screen.queryByTestId(testID)) return;
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    await flush(2);
  }
  throw new Error(`never saw ${testID}`);
};
// The tag is hidden from the accessibility tree (VoiceOver reads it in the row's label).
const HIDDEN = { includeHiddenElements: true };
const MORNING_TEXTS = ["Call the dentist", "Buy milk", "Email Sam"];

describe("the night before on the real Today screen", () => {
  it("evening card -> sheet -> keep; next morning: Add one, Save one, Let the rest go", async () => {
    await save(THU);
    const view = await launch();
    expect(screen.getByTestId("night-before-card")).toBeOnTheScreen();
    await press("night-before-start");
    await fireEvent.changeText(screen.getByTestId("night-before-input"), MORNING_TEXTS.join("\n"));
    await flush();
    await press("night-before-sort");
    await until("night-before-review-title");
    expect(screen.getAllByTestId("night-before-row")).toHaveLength(3);
    // Tick "Email Sam" first, then close without keeping: nothing is thrown out.
    await fireEvent.press(screen.getAllByTestId("night-before-row")[2]);
    await press("night-before-close");
    let disk = await persisted();
    expect(disk.nightList?.items.map((row) => [row.text, row.picked])).toEqual([
      ["Call the dentist", false],
      ["Buy milk", false],
      ["Email Sam", true],
    ]);
    expect(disk.parkedTasks).toEqual([]);
    expect(disk.tasks).toEqual([]);
    expect(disk.tomorrowDraft ?? null).toBeNull();
    // The card now says it's held; reopen it, keep till morning.
    await press("night-before-open");
    expect(screen.getAllByTestId("night-before-row")[2].props.accessibilityState).toMatchObject({ checked: true });
    await press("night-before-keep");
    await press("night-before-nudge-no");
    await press("night-before-finish");
    // App killed overnight; next morning the list is there, Today is untouched.
    setNow(new Date(2026, 10, 27, 8, 0));
    await relaunch(view);
    expect(screen.getByTestId("night-morning")).toBeOnTheScreen();
    expect(rowTexts()).toBe(3);
    // Ticked-first leads.
    expect(screen.getAllByTestId("night-morning-row")[0]).toHaveTextContent(/^Email Sam/);
    disk = await persisted();
    expect(disk.parkedTasks).toEqual([]);
    expect(disk.tasks).toEqual([]);
    // Add "Email Sam"; Save "Buy milk"; let the rest go.
    await fireEvent.press(screen.getAllByTestId("night-morning-add")[0]); // first row = Email Sam
    await flush();
    disk = await persisted();
    expect(disk.tasks.map((t) => [t.text, t.nightFor])).toEqual([["Email Sam", FRI]]);
    expect(screen.getByTestId(`task-night-${disk.tasks[0].id}`, HIDDEN)).toBeOnTheScreen(); // tag on the Today row
    const saveButtons = screen.getAllByTestId("night-morning-save");
    // rows left: Call the dentist, Buy milk -> save the second.
    await fireEvent.press(saveButtons[1]);
    await flush();
    disk = await persisted();
    expect(disk.parkedTasks.map((t) => [t.text, t.nightFor])).toEqual([["Buy milk", FRI]]);
    expect(rowTexts()).toBe(1);
    await press("night-morning-finish");
    expect(screen.queryByTestId("night-morning")).toBeNull();
    disk = await persisted();
    expect(disk.nightList ?? null).toBeNull();
    // "Call the dentist" was never filed anywhere.
    expect(disk.tasks.map((t) => t.text)).toEqual(["Email Sam"]);
    expect(disk.parkedTasks.map((t) => t.text)).toEqual(["Buy milk"]);
    // And a relaunch brings nothing back.
    await relaunch(view);
    expect(screen.queryByTestId("night-morning")).toBeNull();
    expect((await persisted()).nightList ?? null).toBeNull();
  });
});

describe("night-before edge cases on Today", () => {
  it("after midnight (before 4 AM) the dump plans the day that has begun, and its list is on Today at once", async () => {
    setNow(new Date(2026, 10, 27, 0, 30));
    await save(THU);
    await launch();
    expect(screen.getByText("Plan today")).toBeOnTheScreen();
    await press("night-before-start");
    await fireEvent.changeText(screen.getByTestId("night-before-input"), "Call the dentist\nBuy milk");
    await flush();
    await press("night-before-sort");
    await until("night-before-review-title");
    await press("night-before-keep");
    await press("night-before-nudge-no");
    await press("night-before-finish");
    const disk = await persisted();
    expect(disk.nightList).toMatchObject({ forDay: FRI, nightOf: THU });
    expect(screen.getByTestId("night-morning")).toBeOnTheScreen();
    expect(rowTexts()).toBe(2);
    expect(disk.tasks).toEqual([]);
    expect(disk.parkedTasks).toEqual([]);
  });

  it("opened at 11:58 PM, kept at 12:03 AM: still the list for the day that was tomorrow, and it survives", async () => {
    setNow(new Date(2026, 10, 26, 23, 58));
    await save(THU);
    const view = await launch();
    await press("night-before-start");
    await fireEvent.changeText(screen.getByTestId("night-before-input"), "Call the dentist\nBuy milk");
    await flush();
    setNow(new Date(2026, 10, 27, 0, 3));
    await press("night-before-sort");
    await until("night-before-review-title");
    await press("night-before-keep");
    await press("night-before-nudge-no");
    await press("night-before-finish");
    const disk = await persisted();
    expect(disk.nightList).toMatchObject({ forDay: FRI, nightOf: THU });
    expect(disk.nightList?.items).toHaveLength(2);
    // It is now Friday morning: the list is Friday's, not let go, not filed.
    expect(disk.parkedTasks).toEqual([]);
    expect(disk.tasks).toEqual([]);
    // Relaunched on Friday morning, the list is on its day, whole.
    await relaunch(view);
    expect(screen.getByTestId("night-morning")).toBeOnTheScreen();
    expect(rowTexts()).toBe(2);
  });

  it("Add is off when Today's three are set (Save still works); Add is off on a locked day", async () => {
    setNow(new Date(2026, 10, 27, 8, 0));
    await save(FRI, {
      tasks: [task("a", "One"), task("b", "Two"), task("c", "Three")],
      nightList: held(MORNING_TEXTS),
    });
    const view = await launch();
    expect(screen.getByTestId("night-morning-blocked")).toHaveTextContent("Today's three are set. Save it for later instead.");
    for (const add of screen.getAllByTestId("night-morning-add")) expect(add.props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getAllByTestId("night-morning-add")[0]);
    await flush();
    expect((await persisted()).tasks).toHaveLength(3);
    await fireEvent.press(screen.getAllByTestId("night-morning-save")[0]);
    await flush();
    expect((await persisted()).parkedTasks.map((t) => t.text)).toEqual(["Call the dentist"]);
    await view.unmount();
    __resetStorageForTests();
    await AsyncStorage.clear();
    await save(FRI, { tasks: [task("a", "One")], todayLocked: true, nightList: held(MORNING_TEXTS) });
    await launch();
    expect(screen.getByTestId("night-morning-blocked")).toHaveTextContent("Today is set. Save it for later instead.");
    for (const add of screen.getAllByTestId("night-morning-add")) expect(add.props.accessibilityState).toMatchObject({ disabled: true });
    expect((await persisted()).tasks).toHaveLength(1);
  });

  it("Save with Saved for later full says so, keeps the row, and pushes nothing out", async () => {
    setNow(new Date(2026, 10, 27, 8, 0));
    const full = Array.from({ length: MAX_PARKED_TASKS }, (_, n) => parked(n));
    await save(FRI, { parkedTasks: full, nightList: held(MORNING_TEXTS) });
    await launch();
    await fireEvent.press(screen.getAllByTestId("night-morning-save")[0]);
    await flush();
    expect(screen.getByTestId("night-morning-blocked")).toHaveTextContent("Saved for later is full.");
    expect(rowTexts()).toBe(3);
    const disk = await persisted();
    expect(disk.parkedTasks.map((t) => t.id)).toEqual(full.map((t) => t.id));
    expect(disk.nightList?.items).toHaveLength(3);
  });

  it("a list never acted on is let go at the next rollover and never parked", async () => {
    setNow(new Date(2026, 10, 27, 8, 0));
    await save(FRI, { nightList: held(MORNING_TEXTS) });
    const view = await launch();
    expect(screen.getByTestId("night-morning")).toBeOnTheScreen();
    expect((await persisted()).nightList?.items).toHaveLength(3);
    // Saturday morning.
    setNow(new Date(2026, 10, 28, 8, 0));
    await relaunch(view);
    expect(screen.queryByTestId("night-morning")).toBeNull();
    const disk = await persisted();
    expect(disk.lastOpenedDate).toBe(SAT);
    expect(disk.nightList ?? null).toBeNull();
    expect(disk.parkedTasks).toEqual([]);
    expect(disk.tasks).toEqual([]);
  });

  it("the tag shows on the target day only", async () => {
    setNow(new Date(2026, 10, 27, 8, 0));
    await save(FRI, { tasks: [{ ...task("a", "Email Sam"), nightFor: FRI }] });
    const view = await launch();
    expect(screen.getByTestId("task-night-a", HIDDEN)).toBeOnTheScreen();
    setNow(new Date(2026, 10, 28, 8, 0));
    await relaunch(view);
    expect(screen.getByText("Email Sam")).toBeOnTheScreen();
    expect(screen.queryByTestId("task-night-a", HIDDEN)).toBeNull();
  });

  it("a malformed or old nightList in storage is cleaned, never breaks the app", async () => {
    setNow(new Date(2026, 10, 27, 8, 0));
    await save(FRI, {
      nightList: {
        forDay: FRI,
        nightOf: THU,
        text: "x",
        source: "weird",
        createdAt: 5,
        items: [
          { id: "a", text: "Good one", picked: true },
          null,
          { id: 7, text: "numeric id" },
          { id: "b", text: "   " },
          { id: "c", text: "good  ONE" },
          { id: "d", text: "Second", picked: "yes" },
        ],
      } as never,
    });
    const view = await launch();
    expect(rowTexts()).toBe(2);
    expect(screen.getAllByTestId("night-morning-row")[0]).toHaveTextContent(/^Good one/);
    await view.unmount();
    // A list with a bad day, or not an object at all, reads as none.
    for (const bad of [{ forDay: "tomorrow", nightOf: THU, items: [] }, "garbage", 5, []]) {
      __resetStorageForTests();
      await AsyncStorage.clear();
      await save(FRI, { nightList: bad as never });
      const again = await launch();
      expect(screen.queryByTestId("night-morning")).toBeNull();
      expect(screen.getByText(/Today/)).toBeTruthy();
      await again.unmount();
    }
  });
});
