import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { AccessibilityInfo, ActionSheetIOS, Alert, AppState as RNAppState } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { requestBreakDown, sortBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { closeDay } from "@/lib/daily-tasks/evening";
import { MomentumAiError } from "@/lib/daily-tasks/ai-status";
import { requestAppReview } from "@/lib/daily-tasks/app-review";
import { coachTaskKey, localCoachLine, requestCoachNotes } from "@/lib/daily-tasks/coach-note";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import { themeColors } from "@/theme.config";
import type { AppState, DayRecord, Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

// --- Mocks: a controllable store, and no native side effects -----------------

type MockStore = ReturnType<typeof makeStore>;
let mockStore: MockStore;

jest.mock("@/lib/daily-tasks/store", () => ({
  useDailyTasks: () => mockStore,
}));
jest.mock("@/hooks/use-app-update", () => ({
  useAppUpdate: () => ({ update: null, dismiss: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/app-review", () => ({
  requestAppReview: jest.fn(async () => true),
}));
jest.mock("@/components/daily-tasks/celebration-overlay", () => {
  const { Pressable, Text } = jest.requireActual("react-native");
  return {
    CelebrationOverlay: ({ visible, onDismiss }: { visible: boolean; onDismiss: () => void }) =>
      visible ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="dismiss celebration"
          onPress={onDismiss}
        >
          <Text>celebration-visible</Text>
        </Pressable>
      ) : null,
  };
});
let mockProxyUrl: string | null = null;
jest.mock("@/lib/daily-tasks/momentum-ai", () => ({
  ...jest.requireActual("@/lib/daily-tasks/momentum-ai"),
  getMomentumAiProxyUrl: () => mockProxyUrl,
}));
jest.mock("@/lib/daily-tasks/ai-helpers", () => {
  const actual = jest.requireActual("@/lib/daily-tasks/ai-helpers");
  return { ...actual, requestBreakDown: jest.fn(), sortBrainDump: jest.fn() };
});
// The Coach's note's one network call; each test decides how it answers.
jest.mock("@/lib/daily-tasks/coach-note", () => ({
  ...jest.requireActual("@/lib/daily-tasks/coach-note"),
  requestCoachNotes: jest.fn(),
}));
const mockOpenPaywall = jest.fn(() => true);
let mockPaywall: {
  paywallSource: string | null;
  entitlementActive: boolean;
  purchaseCount?: number;
  winBackDue?: boolean;
} = {
  paywallSource: null,
  entitlementActive: false,
};
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallEnabled: true, openPaywall: mockOpenPaywall, ...mockPaywall }),
}));
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 };
let mockWindow = PHONE;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));
jest.mock("@/lib/daily-tasks/evening", () => ({
  ...jest.requireActual("@/lib/daily-tasks/evening"),
  closeDay: jest.fn(),
}));
jest.mock("@/components/daily-tasks/onboarding-modal", () => ({ OnboardingModal: () => null }));
jest.mock("@/components/daily-tasks/rollover-modal", () => {
  const { Pressable, Text, View } = jest.requireActual("react-native");
  return {
    // A light stand-in for the inline card: present when something is pending.
    RolloverModal: ({ pending, onApply }: { pending: unknown; onApply: (ids: string[]) => void }) =>
      pending ? (
        <View testID="rollover-card">
          <Pressable testID="rollover-apply" onPress={() => onApply([])}>
            <Text>Start fresh</Text>
          </Pressable>
        </View>
      ) : null,
  };
});
const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({
  router: { navigate: (...args: unknown[]) => mockNavigate(...args) },
}));
jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusTimerNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
}));
const mockTrack = jest.fn();
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: (...args: unknown[]) => mockTrack(...args),
}));

const TODAY = "2026-09-26";

function tasks(...texts: string[]): Task[] {
  return texts.map((text, i) => ({ id: `t${i}`, text, createdAt: "", carriedOver: false }));
}

// A set day: the next undone task is the hero, with Break it down inline.
const SET = { todayLocked: true, todayLockSource: "manual" as const };

function perfectDay(date: string): DayRecord {
  return {
    date,
    total: 3,
    completed: 3,
    locked: true,
    lockSource: "manual",
    tasks: [],
    reflection: null,
    reflectionResult: null,
  };
}

function makeStore(overrides: Partial<AppState> = {}) {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 8, 26)),
    hasSeenOnboarding: true,
    ...overrides,
  };
  const completed = state.todayCompletions.filter((id) => state.tasks.some((t) => t.id === id));
  return {
    ready: true,
    state,
    today: TODAY,
    completedCount: completed.length,
    remainingSlots: 3 - state.tasks.length,
    isCompleted: (id: string) => state.todayCompletions.includes(id),
    addTask: jest.fn(),
    addTasks: jest.fn(),
    editTask: jest.fn(),
    deleteTask: jest.fn(),
    notToday: jest.fn(),
    toggleTask: jest.fn(),
    lockToday: jest.fn(),
    resolveRollover: jest.fn(),
    completeMomentumOnboarding: jest.fn(),
    setTodayReflection: jest.fn(),
    setTodayReflectionResult: jest.fn(),
    requestMomentumPlan: jest.fn(async () => {}),
    journeyLevel: 4,
    markReviewPrompted: jest.fn(),
    markReviewDue: jest.fn(),
    unlockToday: jest.fn(),
    plusConfirmed: true,
    plusPending: false,
    daysShowedUp: 1,
    setEveningClose: jest.fn(),
    applyTomorrowDraft: jest.fn(),
    dismissTomorrowDraft: jest.fn(),
    claimCoachRequest: jest.fn(),
    setCoachNotes: jest.fn(),
    markCoachNoteLogged: jest.fn(),
    parkTasks: jest.fn(),
    removeParkedTask: jest.fn(),
    addParkedTask: jest.fn(),
    setTaskSteps: jest.fn(),
    toggleTaskStep: jest.fn(),
    clearTaskSteps: jest.fn(),
    hasPlus: true,
  };
}

// Today's lower section depends on the hour (1.2): pin the clock so no test
// depends on when CI runs. By default a morning on TODAY, faking only the
// clock (the screen's own timers still run); tests that need fake timers or
// another hour install their own.
const MORNING = new Date(2026, 8, 26, 9, 0);

beforeEach(() => {
  jest.useFakeTimers({
    now: MORNING,
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask", "nextTick"],
  });
  // The real fallback-aware sorter by default (no proxy → simple local split).
  (sortBrainDump as jest.Mock).mockImplementation(
    jest.requireActual("@/lib/daily-tasks/ai-helpers").sortBrainDump,
  );
  (requestBreakDown as jest.Mock).mockImplementation(async () => {
    throw new MomentumAiError("unavailable", "not stubbed");
  });
  // As in the app with no proxy baked in: the coach call fails, quietly.
  (requestCoachNotes as jest.Mock).mockImplementation(async () => {
    throw new MomentumAiError("unavailable", "not stubbed");
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockProxyUrl = null;
  mockWindow = PHONE;
  mockPaywall = { paywallSource: null, entitlementActive: false };
  void AsyncStorage.clear();
});

describe("Today screen layout", () => {
  it("puts the tasks first, with one status line and a Need ideas entry", async () => {
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch") });
    await render(<HomeScreen />);

    expect(screen.getByRole("checkbox", { name: "Task 1: Walk" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Task 2: Stretch" })).toBeOnTheScreen();
    expect(screen.getByText("Still choosing. Set the day when it feels right.")).toBeOnTheScreen();
    expect(screen.getByTestId("need-ideas")).toBeOnTheScreen();
    // The old stacked cards are gone.
    expect(screen.queryByText(/Accountability check-in/i)).toBeNull();
    expect(screen.queryByText(/Today's Three is set/)).toBeNull();
  });

  it("asks for confirmation before locking, and only locks on confirm", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Set today's tasks" }));
    expect(mockStore.lockToday).not.toHaveBeenCalled();

    const [title, message, buttons] = alert.mock.calls[0] as unknown as [
      string,
      string,
      { text: string; onPress?: () => void }[],
    ];
    expect(title).toBe("Set today?");
    expect(message).toContain("Your empty slots stay empty.");
    await act(async () => buttons.find((b) => b.text === "Cancel")?.onPress?.());
    expect(mockStore.lockToday).not.toHaveBeenCalled();
    await act(async () => buttons.find((b) => b.text === "Set")?.onPress?.());
    expect(mockStore.lockToday).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it("opens an empty day on the morning hero, with ideas one tap away", async () => {
    mockStore = makeStore({
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Run a 5K" },
    });
    await render(<HomeScreen />);
    expect(screen.getByTestId("morning-hero")).toBeOnTheScreen();
    expect(screen.queryByTestId("need-ideas")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Or pick from ideas" }));
    expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen();
  });

  it("hides Need ideas and Set today once the day is locked", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    await render(<HomeScreen />);
    expect(screen.queryByTestId("need-ideas")).toBeNull();
    expect(screen.queryByRole("button", { name: "Set today's tasks" })).toBeNull();
    expect(screen.getByText("Today is set. 1 to go.")).toBeOnTheScreen();
  });

  it("toggles a task from its checkbox", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("checkbox", { name: "Task 1: Walk" }));
    expect(mockStore.toggleTask).toHaveBeenCalledWith("t0");
  });

  it("says how many slots are open in the header while unlocked, and the bar speaks it (comma, not a dot)", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    expect(screen.getByRole("progressbar")).toHaveAccessibilityValue({
      text: "0 of 1 done, 2 open",
    });
    expect(screen.getByText(/ · 0 of 1 done · 2 open$/)).toBeOnTheScreen();
  });

  it("drops the open-slot count from the header once the day is locked", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    await render(<HomeScreen />);
    expect(screen.getByRole("progressbar")).toHaveAccessibilityValue({ text: "0 of 1 done" });
  });

  it("shows the actual auto-lock time when it's known, not the configured one", async () => {
    mockStore = makeStore({
      tasks: tasks("Walk", "Stretch"),
      todayLocked: true,
      todayLockSource: "auto",
      todayLockedAt: new Date(2026, 8, 26, 14, 7).toISOString(),
      autoLock: { enabled: true, hour: 13, minute: 30 },
    });
    await render(<HomeScreen />);
    expect(
      screen.getByText("Set automatically at 2:07 PM. 2 to go."),
    ).toBeOnTheScreen();
  });

  it("falls back to the configured time for a garbled saved lock time", async () => {
    mockStore = makeStore({
      tasks: tasks("Walk"),
      todayLocked: true,
      todayLockSource: "auto",
      todayLockedAt: "not a time",
      autoLock: { enabled: true, hour: 13, minute: 30 },
    });
    await render(<HomeScreen />);
    expect(
      screen.getByText("Set automatically at 1:30 PM. 1 to go."),
    ).toBeOnTheScreen();
  });

  it("invites picking up to three on an empty day", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    expect(
      screen.getByText("Pick up to three things that would make today a good day."),
    ).toBeOnTheScreen();
  });

  it("explains an automatic lock with its time", async () => {
    mockStore = makeStore({
      tasks: tasks("Walk", "Stretch"),
      todayLocked: true,
      todayLockSource: "auto",
      autoLock: { enabled: true, hour: 13, minute: 30 },
    });
    await render(<HomeScreen />);
    expect(
      screen.getByText("Set automatically at 1:30 PM. 2 to go."),
    ).toBeOnTheScreen();
  });

  it("names the empty slots in the lock confirmation only when some are open", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch", "Hydrate") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Set today's tasks" }));
    const message = alert.mock.calls[0][1] as string;
    expect(message).not.toMatch(/empty slot/);
    // Lighter copy when all three are chosen: nothing is lost by locking.
    expect(message).toBe(
      "You can still check tasks off. Editing pauses until tomorrow, or until you tap Change.",
    );
    alert.mockRestore();
  });

  it("keeps the ideas entry quiet once tasks exist", async () => {
    mockStore = makeStore({
      tasks: tasks("Walk"),
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Run a 5K" },
    });
    await render(<HomeScreen />);
    const quiet = screen.getByRole("button", { name: "Need ideas?. Opens suggestions" });
    expect(quiet).not.toHaveStyle({ backgroundColor: themeColors.primary.light });
  });

  it("uses the new empty-slot copy, and 'Left open on purpose' once locked", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getAllByText("Add a task")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Add a task, slot 2" })).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Add a task, slot 3" })).toBeOnTheScreen();
    expect(screen.queryByText("Something you'll stand behind today.")).toBeNull();

    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    await rerender(<HomeScreen />);
    expect(screen.queryByText("Add a task")).toBeNull();
    expect(screen.getAllByRole("button", { name: "Left open on purpose" })).toHaveLength(2);
    expect(screen.queryByText("Room to breathe.")).toBeNull();
  });
});

describe("Need ideas sheet", () => {
  it("opens with starter ideas when there's no AI plan, and adds one", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    expect(screen.getByText("Starter ideas")).toBeOnTheScreen();
    const firstIdea = screen.getAllByRole("button", { name: /^Add (?!all|\d|a task)/ })[0];
    await fireEvent.press(firstIdea);
    expect(mockStore.addTask).toHaveBeenCalledTimes(1);
  });

  it("labels AI ideas as personalized and shows the failure note in the sheet", async () => {
    mockStore = makeStore({
      tasks: tasks("Walk"),
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Run a 5K" },
      momentumPlan: {
        id: "p",
        goalTitle: "Run a 5K",
        generatedAt: new Date(2026, 8, 26, 8).toISOString(),
        provider: "ai",
        milestones: [],
        taskPool: [],
        todaySuggestions: [
          {
            id: "a",
            text: "Run 1 mile",
            estimatedMinutes: 15,
            difficulty: "easy",
            reason: "",
            source: "ai",
          },
        ],
        promptSummary: "",
        version: 1,
      },
      momentumPlanStatus: "error",
      momentumPlanError: "busy",
    });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    expect(screen.getByText("Made for your goal")).toBeOnTheScreen();
    expect(
      screen.getByText(
        "Smart suggestions are taking a break for today. Your ideas below still work.",
      ),
    ).toBeOnTheScreen();
  });
});

describe("Need ideas sheet hint", () => {
  it("counts only the slots that are free, not every idea shown", async () => {
    // Three starter ideas but only one open slot.
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    expect(screen.getByText("Add it if it fits.")).toBeOnTheScreen();
    expect(screen.getByText("Add the first 1")).toBeOnTheScreen();
  });
});

describe("Need ideas sheet closes when it must", () => {
  it("closes when the day gets locked", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen();
    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    await rerender(<HomeScreen />);
    expect(screen.queryByTestId("ideas-sheet")).toBeNull();
  });

  it("stays open when yesterday's unfinished ones arrive (a card now, not a blocking modal)", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen();
    mockStore = makeStore({
      tasks: tasks("Walk"),
      pendingRollover: {
        sourceDate: "2026-09-25",
        tasks: [
          {
            id: "x",
            text: "Old",
            completed: false,
            carriedOver: false,
            rolloverOutcome: "unresolved",
          },
        ],
      },
    });
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen();
  });

  it("shows yesterday's unfinished ones as a usable card on Today", async () => {
    mockStore = makeStore({
      pendingRollover: {
        sourceDate: "2026-09-25",
        tasks: [{ id: "x", text: "Vacuum the house", completed: false, carriedOver: false, rolloverOutcome: "unresolved" }],
      },
    });
    await render(<HomeScreen />);
    expect(screen.getByTestId("rollover-card")).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId("rollover-apply"));
    expect(mockStore.resolveRollover).toHaveBeenCalled();
  });

  it("closes so the onboarding modal can show", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen();
    mockStore = makeStore({ tasks: tasks("Walk"), hasSeenOnboarding: false });
    await rerender(<HomeScreen />);
    expect(screen.queryByTestId("ideas-sheet")).toBeNull();
  });

  it("stays open while nothing needs the screen", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch") });
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen();
  });
});

describe("perfect-day moment", () => {
  const threeTasks = tasks("Walk", "Stretch", "Hydrate");
  const history = {
    "2026-09-20": perfectDay("2026-09-20"),
    "2026-09-21": perfectDay("2026-09-21"),
    "2026-09-22": perfectDay("2026-09-22"),
  };

  it("does not celebrate or mark a rating due when the app opens on a finished day", async () => {
    mockStore = makeStore({ tasks: threeTasks, todayCompletions: ["t0", "t1", "t2"], history });
    await render(<HomeScreen />);
    expect(screen.queryByText("celebration-visible")).toBeNull();
    expect(mockStore.markReviewDue).not.toHaveBeenCalled();
  });

  async function reachPerfectDay(overrides: Partial<AppState> = {}) {
    mockStore = makeStore({ tasks: threeTasks, todayCompletions: ["t0", "t1"], history, ...overrides });
    const view = await render(<HomeScreen />);
    mockStore = makeStore({ tasks: threeTasks, todayCompletions: ["t0", "t1", "t2"], history, ...overrides });
    await view.rerender(<HomeScreen />);
    return view;
  }

  it("celebrates the third task and marks a rating due, without asking on top of the celebration", async () => {
    jest.useFakeTimers({ now: MORNING });
    await reachPerfectDay();
    expect(screen.getByText("celebration-visible")).toBeOnTheScreen();
    expect(mockStore.markReviewDue).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(requestAppReview).not.toHaveBeenCalled();
  });

  it("celebrates but doesn't mark a rating due within the cooldown", async () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
    await reachPerfectDay({ lastReviewPromptAt: recent });
    expect(screen.getByText("celebration-visible")).toBeOnTheScreen();
    expect(mockStore.markReviewDue).not.toHaveBeenCalled();
  });
});

describe("rating on a later app open", () => {
  const HOUR = 60 * 60 * 1000;
  const SETTLE = 2000;
  const appState = RNAppState as unknown as { currentState: unknown };
  let original: unknown;
  let originalListen: ((...args: unknown[]) => unknown) | undefined;
  let foreground: ((status: string) => void)[] = [];

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 8, 26, 20, 0) });
    original = appState.currentState;
    appState.currentState = "active";
    originalListen = (RNAppState.addEventListener as jest.Mock).getMockImplementation();
    foreground = [];
    (RNAppState.addEventListener as jest.Mock).mockImplementation(
      (_type: string, listener: (status: string) => void) => {
        foreground.push(listener);
        return { remove: () => {} };
      },
    );
  });
  afterEach(() => {
    appState.currentState = original;
    (RNAppState.addEventListener as jest.Mock).mockImplementation(originalListen);
  });

  const settle = () =>
    act(async () => {
      jest.advanceTimersByTime(SETTLE);
    });
  const toForeground = async () => {
    await act(async () => foreground.forEach((listener) => listener("active")));
    await settle();
  };
  const openWithDue = async (dueAgoMs: number, overrides: Partial<AppState> = {}) => {
    mockStore = makeStore({
      tasks: tasks("Walk"),
      reviewDueAt: new Date(Date.now() - dueAgoMs).toISOString(),
      ...overrides,
    });
    return render(<HomeScreen />);
  };

  it("asks a moment after opening, an hour or more after the perfect day, and records it", async () => {
    await openWithDue(2 * HOUR);
    await act(async () => {
      jest.advanceTimersByTime(SETTLE - 1);
    });
    expect(requestAppReview).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(requestAppReview).toHaveBeenCalledTimes(1);
    expect(mockStore.markReviewPrompted).toHaveBeenCalledTimes(1);
  });

  it("waits while it's been under an hour, then asks on a later foreground", async () => {
    await openWithDue(30 * 60 * 1000);
    await settle();
    expect(requestAppReview).not.toHaveBeenCalled();

    jest.setSystemTime(new Date(2026, 8, 26, 20, 31));
    await toForeground();
    expect(requestAppReview).toHaveBeenCalledTimes(1);
  });

  it("drops an ask that's more than a week old", async () => {
    await openWithDue(8 * 24 * HOUR);
    await settle();
    expect(requestAppReview).not.toHaveBeenCalled();
  });

  it.each([
    ["onboarding hasn't been done", { hasSeenOnboarding: false }],
  ])("waits while %s", async (_why, overrides) => {
    await openWithDue(2 * HOUR, overrides as Partial<AppState>);
    await settle();
    expect(requestAppReview).not.toHaveBeenCalled();
  });

  it("waits while a sheet is open, and asks on a later foreground once it's closed", async () => {
    await openWithDue(2 * HOUR);
    // The user opens the ideas sheet within the first two seconds.
    await fireEvent.press(screen.getByTestId("need-ideas"));
    await settle();
    expect(requestAppReview).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Close ideas" }));
    await toForeground();
    expect(requestAppReview).toHaveBeenCalledTimes(1);
  });

  it("doesn't ask (or spend the cooldown) unless the app is active, or when the prompt wasn't shown", async () => {
    appState.currentState = "background";
    await openWithDue(2 * HOUR);
    await settle();
    expect(requestAppReview).not.toHaveBeenCalled();

    appState.currentState = "active";
    (requestAppReview as jest.Mock).mockResolvedValueOnce(false);
    await toForeground();
    expect(requestAppReview).toHaveBeenCalledTimes(1);
    expect(mockStore.markReviewPrompted).not.toHaveBeenCalled();
  });

  it("asks only once while a request is still in flight", async () => {
    const review = deferred<boolean>();
    (requestAppReview as jest.Mock).mockImplementationOnce(() => review.promise);
    await openWithDue(2 * HOUR);
    await settle();
    await toForeground();
    expect(requestAppReview).toHaveBeenCalledTimes(1);
    await act(async () => review.resolve(true));
    expect(mockStore.markReviewPrompted).toHaveBeenCalledTimes(1);
  });

  it("waits while focus mode is open, and asks on a later foreground once it's closed", async () => {
    // Morning, one ticked: the coach's note (and its Start) is showing.
    jest.setSystemTime(new Date(2026, 8, 26, 9, 0));
    mockStore = makeStore({
      tasks: tasks("Walk", "Read"),
      todayCompletions: ["t0"],
      reviewDueAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("coach-note-start-button"));
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    await settle();
    expect(requestAppReview).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
    await toForeground();
    expect(requestAppReview).toHaveBeenCalledTimes(1);
  });

  it("does nothing when no rating is due", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    await toForeground();
    expect(requestAppReview).not.toHaveBeenCalled();
  });
});

// --- Phase 3: brain dump, parked ideas, break it down -------------------------

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Open the brain dump: the morning hero on an empty day, the entry otherwise. */
async function openBrainDump() {
  const entry = screen.queryByTestId("brain-dump-entry");
  await fireEvent.press(entry ?? screen.getByRole("button", { name: /What's on your mind today\?/ }));
}

describe("Brain dump entry", () => {
  it("is the morning hero on an empty day, and a small entry next to ideas once tasks exist", async () => {
    mockStore = makeStore();
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getByTestId("morning-hero")).toBeOnTheScreen();
    expect(screen.queryByTestId("brain-dump-entry")).toBeNull();
    await openBrainDump();
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Close brain dump" }));
    mockStore = makeStore({ tasks: tasks("Walk") });
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("brain-dump-entry")).toHaveTextContent(/Brain dump/);
    expect(screen.getByTestId("brain-dump-entry")).not.toHaveTextContent(/everything/);
  });

  it("is hidden once the day is locked or full", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    const { rerender } = await render(<HomeScreen />);
    expect(screen.queryByTestId("brain-dump-entry")).toBeNull();
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch", "Hydrate") });
    await rerender(<HomeScreen />);
    expect(screen.queryByTestId("brain-dump-entry")).toBeNull();
  });
});

describe("Brain dump flow", () => {
  async function openAndWrite(text: string) {
    await openBrainDump();
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText("Brain dump text"), text);
    await fireEvent.press(screen.getByRole("button", { name: "Sort it for me" }));
  }

  it("sorts with the open slots and goal, adds the ticked picks, saves the rest, confirms, and closes", async () => {
    (sortBrainDump as jest.Mock).mockResolvedValue({
      result: { picks: ["Finish report", "Call mum"], parked: ["Buy shoes"], source: "ai" },
      notice: null,
    });
    mockStore = makeStore({
      tasks: tasks("Walk"),
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Run a 5K" },
    });
    await render(<HomeScreen />);
    await openAndWrite("all my stuff");
    expect(sortBrainDump).toHaveBeenCalledWith({
      text: "all my stuff",
      openSlots: 2,
      goalTitle: "Run a 5K",
    });
    expect(screen.queryByTestId("brain-dump-notice")).toBeNull();

    await fireEvent.press(screen.getByRole("checkbox", { name: "Call mum" }));
    await fireEvent.press(screen.getByRole("button", { name: "Add 1 to today" }));
    expect(mockStore.addTasks).toHaveBeenCalledWith(["Finish report"]);
    expect(mockStore.parkTasks).toHaveBeenCalledWith(["Call mum", "Buy shoes"]);
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
    expect(screen.getByTestId("today-toast")).toHaveTextContent(
      /Added 1\. 2 saved for later in Ideas\./,
    );
  });

  it("saves picks that no longer fit (a slot filled while the sheet was open), and says so", async () => {
    (sortBrainDump as jest.Mock).mockResolvedValue({
      result: { picks: ["Finish report", "Call mum"], parked: ["Buy shoes"], source: "ai" },
      notice: null,
    });
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    await openAndWrite("all my stuff");
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch") });
    await rerender(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Add 2 to today" }));
    expect(mockStore.addTasks).toHaveBeenCalledWith(["Finish report"]);
    expect(mockStore.parkTasks).toHaveBeenCalledWith(["Call mum", "Buy shoes"]);
    expect(screen.getByTestId("today-toast")).toHaveTextContent(
      /Added 1\. 2 saved for later in Ideas\./,
    );
  });

  it("works offline end to end: the simple split, with the fallback notice when AI fails", async () => {
    // No proxy: the real sorter splits locally (no notice).
    mockStore = makeStore();
    await render(<HomeScreen />);
    await openAndWrite("- book dentist\nfinish report; buy shoes\nwater plants • call mum");
    expect(screen.getByRole("checkbox", { name: "Book dentist" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Finish report" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Buy shoes" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Water plants" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Call mum" })).not.toBeChecked();
    expect(screen.queryByTestId("brain-dump-notice")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Add 3 to today" }));
    expect(mockStore.addTasks).toHaveBeenCalledWith(["Book dentist", "Finish report", "Buy shoes"]);
    expect(mockStore.parkTasks).toHaveBeenCalledWith(["Water plants", "Call mum"]);
  });

  it("shows the notice when smart sorting couldn't be reached", async () => {
    const actual = jest.requireActual("@/lib/daily-tasks/ai-helpers");
    (sortBrainDump as jest.Mock).mockImplementation((params) =>
      actual.sortBrainDump(params, async () => {
        throw new MomentumAiError("network", "offline");
      }),
    );
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch") });
    await render(<HomeScreen />);
    await openAndWrite("a\nb\nc");
    expect(screen.getByTestId("brain-dump-notice")).toBeOnTheScreen();
    // One open slot: one pick ticked, the rest saved (and blocked until unticked).
    expect(screen.getByRole("checkbox", { name: "A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "B" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "C" })).toBeDisabled();
  });

  it.each([
    ["the day gets locked", { todayLocked: true, todayLockSource: "manual" as const }],
    ["onboarding needs the screen", { hasSeenOnboarding: false }],
  ])("closes when %s", async (_why, overrides) => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    await openBrainDump();
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
    mockStore = makeStore({ tasks: tasks("Walk"), ...overrides });
    await rerender(<HomeScreen />);
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
  });

  it("stays open when yesterday's unfinished ones arrive (they're a card now, not a modal)", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    await openBrainDump();
    mockStore = makeStore({
      tasks: tasks("Walk"),
      pendingRollover: {
        sourceDate: "2026-09-25",
        tasks: [{ id: "x", text: "Old", completed: false, carriedOver: false, rolloverOutcome: "unresolved" }],
      },
    });
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
  });

  it("closes from its close button without adding anything", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    await openBrainDump();
    await fireEvent.press(screen.getByRole("button", { name: "Close brain dump" }));
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
    expect(mockStore.addTasks).not.toHaveBeenCalled();
    expect(mockStore.parkTasks).not.toHaveBeenCalled();
  });
});

describe("Ideas sheet: parked items and Set these three", () => {
  const parkedTasks = [
    { id: "p1", text: "Buy shoes", parkedAt: "" },
    { id: "p2", text: "Water plants", parkedAt: "" },
  ];

  it("shows parked items and wires add/remove to the store", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), parkedTasks });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    expect(screen.getByText("Saved from your brain dump")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Add Water plants" }));
    expect(mockStore.addParkedTask).toHaveBeenCalledWith("p2");
    await fireEvent.press(screen.getByRole("button", { name: "Remove Buy shoes from saved" }));
    expect(mockStore.removeParkedTask).toHaveBeenCalledWith("p1");
  });

  it("offers Set these three once the list fills up, going through the lock confirmation", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch") });
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch", "Hydrate") });
    await rerender(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Set these three" }));
    expect(mockStore.lockToday).not.toHaveBeenCalled();
    const [title, , buttons] = alert.mock.calls[0] as unknown as [
      string,
      string,
      { text: string; onPress?: () => void }[],
    ];
    expect(title).toBe("Set today?");
    await act(async () => buttons.find((b) => b.text === "Set")?.onPress?.());
    expect(mockStore.lockToday).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });
});

describe("Break it down", () => {
  it("isn't offered without an AI proxy", async () => {
    mockStore = makeStore({ ...SET, tasks: tasks("Clean kitchen") });
    await render(<HomeScreen />);
    expect(screen.queryByText("Break it down")).toBeNull();
  });

  it("asks the AI with the task and goal, shows busy, then saves the steps", async () => {
    mockProxyUrl = "https://proxy.test/api/momentum/plan";
    const pending = deferred<string[]>();
    (requestBreakDown as jest.Mock).mockImplementation(() => pending.promise);
    mockStore = makeStore({
      ...SET,
      tasks: tasks("Clean kitchen", "Walk"),
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Tidy home" },
    });
    await render(<HomeScreen />);
    // Only the hero (the next task) offers it.
    expect(screen.queryByRole("button", { name: "Break down Walk" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Break down Clean kitchen" }));
    expect(requestBreakDown).toHaveBeenCalledWith({ task: "Clean kitchen", goalTitle: "Tidy home" });
    // While it runs, the link gives way to a progress line (no double request).
    expect(screen.queryByRole("button", { name: "Break down Clean kitchen" })).toBeNull();
    expect(screen.getByText("Breaking it down…")).toBeOnTheScreen();

    await act(async () => pending.resolve(["Clear counter", "Wipe"]));
    // Passes the text it was asked about, so an edit meanwhile drops the steps.
    expect(mockStore.setTaskSteps).toHaveBeenCalledWith(
      "t0",
      ["Clear counter", "Wipe"],
      "Clean kitchen",
    );
    expect(screen.getByRole("button", { name: "Break down Clean kitchen" })).toBeEnabled();
    expect(screen.queryByText("Breaking it down…")).toBeNull();
  });

  it.each([
    [new MomentumAiError("busy", "cap"), "Smart steps are taking a break for today. Try again tomorrow."],
    [new MomentumAiError("timeout", "slow"), "Couldn't reach smart steps right now. Try again in a bit."],
    [
      new MomentumAiError("rate_limited", "429"),
      "Lots of requests right now. Try again a little later.",
    ],
    [new TypeError("Network request failed"), "Couldn't reach smart steps right now. Try again in a bit."],
  ])("alerts on failure (%s) and lets the user try again", async (error, message) => {
    mockProxyUrl = "https://proxy.test/api/momentum/plan";
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    (requestBreakDown as jest.Mock).mockRejectedValueOnce(error);
    mockStore = makeStore({ ...SET, tasks: tasks("Clean kitchen") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Break down Clean kitchen" }));
    expect(alert).toHaveBeenCalledWith("Couldn't break it down", message);
    expect(mockStore.setTaskSteps).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Break down Clean kitchen" })).toBeEnabled();
    alert.mockRestore();
  });

  it("runs only one break-down at a time", async () => {
    mockProxyUrl = "https://proxy.test/api/momentum/plan";
    const first = deferred<string[]>();
    (requestBreakDown as jest.Mock).mockImplementationOnce(() => first.promise);
    mockStore = makeStore({ ...SET, tasks: tasks("Clean kitchen", "Walk") });
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Break down Clean kitchen" }));
    // Finishing the first task mid-request makes Walk the hero; it offers no
    // Break it down until the first one lands.
    mockStore = makeStore({ ...SET, tasks: tasks("Clean kitchen", "Walk"), todayCompletions: ["t0"] });
    await rerender(<HomeScreen />);
    expect(screen.queryByRole("button", { name: "Break down Walk" })).toBeNull();
    const walk = screen.getByRole("checkbox", { name: "Up next. Task 2: Walk" });
    expect(walk.props.accessibilityActions.map((a: { name: string }) => a.name)).not.toContain("breakDown");
    await fireEvent(walk, "accessibilityAction", { nativeEvent: { actionName: "breakDown" } });
    expect(requestBreakDown).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(["a", "b"]));
    (requestBreakDown as jest.Mock).mockResolvedValueOnce(["c", "d"]);
    await fireEvent.press(screen.getByRole("button", { name: "Break down Walk" }));
    expect(requestBreakDown).toHaveBeenCalledTimes(2);
    expect(mockStore.setTaskSteps).toHaveBeenLastCalledWith("t1", ["c", "d"], "Walk");
  });

  it("shows saved steps; toggling and clearing go to the store", async () => {
    const withSteps = tasks("Clean kitchen");
    withSteps[0].steps = [
      { id: "s1", text: "Clear counter", done: false },
      { id: "s2", text: "Wipe", done: true },
    ];
    mockStore = makeStore({ tasks: withSteps });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("checkbox", { name: "Step 1 of 2: Clear counter" }));
    expect(mockStore.toggleTaskStep).toHaveBeenCalledWith("t0", "s1");
    expect(mockStore.toggleTask).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: "Clear steps" }));
    expect(mockStore.clearTaskSteps).toHaveBeenCalledWith("t0");
  });

  it("keeps steps tickable and clearable once the day is locked", async () => {
    const withSteps = tasks("Clean kitchen");
    withSteps[0].steps = [
      { id: "s1", text: "Clear counter", done: false },
      { id: "s2", text: "Wipe", done: false },
    ];
    mockStore = makeStore({ tasks: withSteps, todayLocked: true, todayLockSource: "manual" });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("checkbox", { name: "Step 2 of 2: Wipe" }));
    expect(mockStore.toggleTaskStep).toHaveBeenCalledWith("t0", "s2");
    await fireEvent.press(screen.getByRole("button", { name: "Clear steps" }));
    expect(mockStore.clearTaskSteps).toHaveBeenCalledWith("t0");
  });
});

describe("perfect-day moment: once per day", () => {
  const threeTasks = tasks("Walk", "Stretch", "Hydrate");
  const history = {
    "2026-09-20": perfectDay("2026-09-20"),
    "2026-09-21": perfectDay("2026-09-21"),
    "2026-09-22": perfectDay("2026-09-22"),
  };
  const withToday = (today: string, overrides: Partial<AppState>) => ({
    ...makeStore({ tasks: threeTasks, history, ...overrides }),
    today,
  });

  it("doesn't replay the celebration (or mark a rating again) when the third task is un-checked and re-checked", async () => {
    mockStore = withToday(TODAY, { todayCompletions: ["t0", "t1"] });
    const { rerender } = await render(<HomeScreen />);
    mockStore = withToday(TODAY, { todayCompletions: ["t0", "t1", "t2"] });
    await rerender(<HomeScreen />);
    const { markReviewDue } = mockStore;
    expect(screen.getByText("celebration-visible")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));

    mockStore = { ...withToday(TODAY, { todayCompletions: ["t0", "t1"] }), markReviewDue };
    await rerender(<HomeScreen />);
    mockStore = { ...withToday(TODAY, { todayCompletions: ["t0", "t1", "t2"] }), markReviewDue };
    await rerender(<HomeScreen />);
    expect(screen.queryByText("celebration-visible")).toBeNull();
    expect(markReviewDue).toHaveBeenCalledTimes(1);
  });

  it("celebrates again on a new day", async () => {
    mockStore = withToday(TODAY, { todayCompletions: ["t0", "t1"] });
    const { rerender } = await render(<HomeScreen />);
    mockStore = withToday(TODAY, { todayCompletions: ["t0", "t1", "t2"] });
    await rerender(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    expect(screen.queryByText("celebration-visible")).toBeNull();

    mockStore = withToday("2026-09-27", { todayCompletions: ["t0", "t1"] });
    await rerender(<HomeScreen />);
    mockStore = withToday("2026-09-27", { todayCompletions: ["t0", "t1", "t2"] });
    await rerender(<HomeScreen />);
    expect(screen.getByText("celebration-visible")).toBeOnTheScreen();
  });
});

// --- Phase 4: Plus gates for free users --------------------------------------

describe("Plus gates (free plan)", () => {
  it("Break it down opens the paywall right away instead of calling the AI, then runs once Plus is bought", async () => {
    jest.useFakeTimers({ now: MORNING });
    mockProxyUrl = "https://proxy.test/api/momentum/plan";
    (requestBreakDown as jest.Mock).mockResolvedValue(["Clear counter"]);
    const free = { ...makeStore({ ...SET, tasks: tasks("Clean kitchen") }), hasPlus: false };
    mockStore = free;
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getByTestId("break-down-plus")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Break down Clean kitchen" }));
    // No sheet is closing first, so no delay.
    expect(mockOpenPaywall).toHaveBeenCalledWith("break_down");
    expect(requestBreakDown).not.toHaveBeenCalled();

    // The paywall shows, the user buys, it closes.
    mockPaywall = { paywallSource: "break_down", entitlementActive: false };
    await rerender(<HomeScreen />);
    mockPaywall = { paywallSource: null, entitlementActive: true };
    mockStore = { ...free, hasPlus: true };
    await rerender(<HomeScreen />);
    expect(requestBreakDown).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(650);
    });
    expect(requestBreakDown).toHaveBeenCalledWith(expect.objectContaining({ task: "Clean kitchen" }));
  });

  it("after the free AI sorts, brain dump uses the on-device split (no AI call), logs the gate, and offers Plus", async () => {
    jest.useFakeTimers({ now: MORNING });
    mockProxyUrl = "https://proxy.test/api/momentum/plan";
    await AsyncStorage.setItem(FREE_DUMPS_KEY, "3");
    mockStore = { ...makeStore(), hasPlus: false };
    const { rerender } = await render(<HomeScreen />);
    await openBrainDump();
    await act(async () => {}); // the free count loads when the sheet opens
    await fireEvent.changeText(screen.getByLabelText("Brain dump text"), "a\nb\nc\nd");
    expect(screen.getByTestId("brain-dump-upgrade")).toHaveTextContent(
      /Free AI sorts used up, so this will be a simple split\. Plus turns your notes into clear tasks\./,
    );
    await fireEvent.press(screen.getByRole("button", { name: "Sort it for me" }));
    expect(sortBrainDump).not.toHaveBeenCalled();
    expect(mockTrack).toHaveBeenCalledWith("plus_gate_hit", { feature: "brain_dump", source: "free_exhausted" });
    expect(screen.getByRole("checkbox", { name: "A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "D" })).not.toBeChecked();
    expect(screen.getByTestId("brain-dump-notice")).toHaveTextContent(/free AI sorts are used up/);

    // Back on the write step the offer is still there for next time; from a
    // fresh sheet, Get Plus closes it and opens the paywall.
    await fireEvent.press(screen.getByRole("button", { name: "Add 3 to today" }));
    await openBrainDump();
    await act(async () => {});
    await fireEvent.press(screen.getByRole("button", { name: "Get Plus for AI sorting" }));
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
    // Waits for the sheet to animate away before the paywall.
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(650);
    });
    expect(mockOpenPaywall).toHaveBeenCalledWith("brain_dump");

    // Closing the paywall (bought or not) brings the brain dump back.
    mockPaywall = { paywallSource: "brain_dump", entitlementActive: false };
    await rerender(<HomeScreen />);
    mockPaywall = { paywallSource: null, entitlementActive: false };
    await rerender(<HomeScreen />);
    await act(async () => {
      jest.advanceTimersByTime(650);
    });
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
  });

  it("thanks the user only after a purchase, not when a subscriber's status loads at launch", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    mockPaywall = { paywallSource: null, entitlementActive: false, purchaseCount: 0 };
    const { rerender } = await render(<HomeScreen />);
    mockPaywall = { paywallSource: null, entitlementActive: true, purchaseCount: 0 };
    await rerender(<HomeScreen />);
    expect(screen.queryByText("You're on Plus. Thank you!")).toBeNull();
    mockPaywall = { paywallSource: null, entitlementActive: true, purchaseCount: 1 };
    await rerender(<HomeScreen />);
    expect(screen.getByText("You're on Plus. Thank you!")).toBeOnTheScreen();
  });

  it("Plus users' brain dump still goes through the AI sorter with no upgrade offer", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    await openBrainDump();
    expect(screen.queryByTestId("brain-dump-upgrade")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Brain dump text"), "a");
    await fireEvent.press(screen.getByRole("button", { name: "Sort it for me" }));
    expect(sortBrainDump).toHaveBeenCalledTimes(1);
  });
});

// --- Phase 11a: free AI brain dumps, win-back paywall ----------------------

const FREE_DUMPS_KEY = "daily-tasks/free-ai-dumps-used";

describe("Free AI brain dumps (free plan)", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  async function openAsFree() {
    await openBrainDump();
    await act(async () => {}); // the free count loads when the sheet opens
  }

  async function sortAsFree(text: string) {
    await openAsFree();
    await fireEvent.changeText(screen.getByLabelText("Brain dump text"), text);
    await fireEvent.press(screen.getByRole("button", { name: "Sort it for me" }));
    // Let the fire-and-forget refund settle.
    await act(async () => {});
  }

  it.each([
    [null, /AI will sort this one\. You have 3 free AI sorts to try\./],
    ["1", /AI will sort this one\. 2 free AI sorts left\./],
    ["2", /AI will sort this one\. 1 free AI sort left\./],
  ])("with %s used, says AI will sort it, with no Get Plus during the taste", async (used, copy) => {
    if (used) await AsyncStorage.setItem(FREE_DUMPS_KEY, used);
    mockStore = { ...makeStore(), hasPlus: false };
    await render(<HomeScreen />);
    await openAsFree();
    expect(screen.getByTestId("brain-dump-upgrade")).toHaveTextContent(copy);
    expect(screen.queryByRole("button", { name: "Get Plus for AI sorting" })).toBeNull();
  });

  it("when they're used up, says it's a simple split and offers Plus", async () => {
    await AsyncStorage.setItem(FREE_DUMPS_KEY, "3");
    mockStore = { ...makeStore(), hasPlus: false };
    await render(<HomeScreen />);
    await openAsFree();
    expect(screen.getByTestId("brain-dump-upgrade")).toHaveTextContent(
      /Free AI sorts used up, so this will be a simple split\. Plus turns your notes into clear tasks\./,
    );
    expect(screen.getByRole("button", { name: "Get Plus for AI sorting" })).toBeOnTheScreen();
  });

  it("sorts with the AI (no agenda) and says how many free sorts are left, without a gate hit", async () => {
    (sortBrainDump as jest.Mock).mockResolvedValue({
      result: { picks: ["Finish report"], parked: ["Buy shoes"], source: "ai" },
      notice: null,
    });
    mockStore = { ...makeStore({ agendaEnabled: true }), hasPlus: false };
    await render(<HomeScreen />);
    await sortAsFree("finish report, buy shoes");
    expect(sortBrainDump).toHaveBeenCalledWith({ text: "finish report, buy shoes", openSlots: 3, goalTitle: null });
    expect(screen.getByTestId("brain-dump-notice")).toHaveTextContent(/Sorted by AI · 2 free sorts left\./);
    expect(await AsyncStorage.getItem(FREE_DUMPS_KEY)).toBe("1");
    expect(mockTrack).not.toHaveBeenCalledWith("plus_gate_hit", expect.anything());
    expect(mockTrack).toHaveBeenCalledWith("brain_dump_sorted", { source: "ai", count: 1, plus: false });
  });

  it("says so on the last free sort", async () => {
    await AsyncStorage.setItem(FREE_DUMPS_KEY, "2");
    (sortBrainDump as jest.Mock).mockResolvedValue({
      result: { picks: ["A"], parked: [], source: "ai" },
      notice: null,
    });
    mockStore = { ...makeStore(), hasPlus: false };
    await render(<HomeScreen />);
    await sortAsFree("a");
    expect(screen.getByTestId("brain-dump-notice")).toHaveTextContent(
      /That was your last free AI sort\. Next time we'll use a simple split, or Plus keeps AI sorting on\./,
    );
    expect(await AsyncStorage.getItem(FREE_DUMPS_KEY)).toBe("3");
  });

  it("gives the free sort back when the AI can't be reached, and shows the fallback notice", async () => {
    await AsyncStorage.setItem(FREE_DUMPS_KEY, "1");
    const actual = jest.requireActual("@/lib/daily-tasks/ai-helpers");
    (sortBrainDump as jest.Mock).mockImplementation((params) =>
      actual.sortBrainDump(params, async () => {
        throw new MomentumAiError("network", "offline");
      }),
    );
    mockStore = { ...makeStore(), hasPlus: false };
    await render(<HomeScreen />);
    await sortAsFree("a\nb");
    expect(sortBrainDump).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("brain-dump-notice")).toHaveTextContent(/Couldn't reach smart sorting/);
    expect(await AsyncStorage.getItem(FREE_DUMPS_KEY)).toBe("1");
    expect(mockTrack).not.toHaveBeenCalledWith("plus_gate_hit", expect.anything());
    expect(mockTrack).toHaveBeenCalledWith("brain_dump_sorted", { source: "local", count: 2, plus: false });
  });

  it("uses the AI three times, then the fourth is the local split with the gate logged", async () => {
    (sortBrainDump as jest.Mock).mockResolvedValue({
      result: { picks: ["A"], parked: [], source: "ai" },
      notice: null,
    });
    mockStore = { ...makeStore(), hasPlus: false };
    await render(<HomeScreen />);
    for (let i = 0; i < 3; i += 1) {
      await sortAsFree("a");
      await fireEvent.press(screen.getByRole("button", { name: "Add 1 to today" }));
    }
    expect(sortBrainDump).toHaveBeenCalledTimes(3);
    expect(mockTrack).not.toHaveBeenCalledWith("plus_gate_hit", expect.anything());
    await sortAsFree("a\nb");
    expect(sortBrainDump).toHaveBeenCalledTimes(3);
    expect(mockTrack).toHaveBeenCalledWith("plus_gate_hit", { feature: "brain_dump", source: "free_exhausted" });
    // The simple split says why it isn't the AI, and offers Plus right there.
    expect(screen.getByTestId("brain-dump-notice")).toHaveTextContent(/free AI sorts are used up/);
    expect(screen.getByRole("button", { name: "Get Plus for AI sorting" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "A" })).toBeChecked();
  });

  it("the used-up split is tidied, and Get Plus on its review closes the sheet for the paywall", async () => {
    jest.useFakeTimers({ now: MORNING });
    await AsyncStorage.setItem(FREE_DUMPS_KEY, "3");
    mockStore = { ...makeStore(), hasPlus: false };
    await render(<HomeScreen />);
    await sortAsFree("I need to call mum\ngotta buy milk.\ncall mum!");
    expect(sortBrainDump).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Call mum" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Buy milk" })).toBeChecked();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    await fireEvent.press(screen.getByRole("button", { name: "Get Plus for AI sorting" }));
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
    // Nothing was added or saved: the typed text is kept to sort again.
    expect(mockStore.addTasks).not.toHaveBeenCalled();
    expect(mockStore.parkTasks).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(650);
    });
    expect(mockOpenPaywall).toHaveBeenCalledWith("brain_dump");
  });

  it("the 'couldn't reach smart sorting' review offers no Get Plus, even to a free user", async () => {
    await AsyncStorage.setItem(FREE_DUMPS_KEY, "1");
    const actual = jest.requireActual("@/lib/daily-tasks/ai-helpers");
    (sortBrainDump as jest.Mock).mockImplementation((params) =>
      actual.sortBrainDump(params, async () => {
        throw new MomentumAiError("network", "offline");
      }),
    );
    mockStore = { ...makeStore(), hasPlus: false };
    await render(<HomeScreen />);
    await sortAsFree("a\nb");
    expect(screen.getByTestId("brain-dump-notice")).toHaveTextContent(/Couldn't reach smart sorting/);
    expect(screen.getByTestId("brain-dump-notice")).not.toHaveTextContent(/free AI sorts are used up/);
    expect(screen.queryByRole("button", { name: "Get Plus for AI sorting" })).toBeNull();
  });

  it("never touches the free count for Plus users", async () => {
    (sortBrainDump as jest.Mock).mockResolvedValue({
      result: { picks: ["A"], parked: [], source: "ai" },
      notice: null,
    });
    mockStore = makeStore();
    await render(<HomeScreen />);
    await sortAsFree("a");
    expect(await AsyncStorage.getItem(FREE_DUMPS_KEY)).toBeNull();
    expect(screen.queryByTestId("brain-dump-notice")).toBeNull();
  });
});

describe("Win-back paywall on Today", () => {
  const lapsedFree = () => {
    mockPaywall = { paywallSource: null, entitlementActive: false, winBackDue: true };
    mockStore = { ...makeStore({ ...SET, tasks: tasks("Walk", "Read") }), hasPlus: false };
  };

  it("never opens on launch, only a moment after a task is completed", async () => {
    jest.useFakeTimers({ now: MORNING });
    lapsedFree();
    await render(<HomeScreen />);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockOpenPaywall).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("checkbox", { name: /Task 1: Walk/ }));
    await act(async () => {
      jest.advanceTimersByTime(1100);
    });
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
    expect(mockOpenPaywall).toHaveBeenCalledWith("win_back");
  });

  it("not when a task is unticked", async () => {
    jest.useFakeTimers({ now: MORNING });
    lapsedFree();
    mockStore = { ...mockStore, isCompleted: () => true };
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("checkbox", { name: /Task 1: Walk/ }));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });

  it("not when something else is on screen by then (a sheet opened)", async () => {
    jest.useFakeTimers({ now: MORNING });
    lapsedFree();
    mockStore = { ...makeStore({ tasks: tasks("Walk") }), hasPlus: false };
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("checkbox", { name: /Task 1: Walk/ }));
    await openBrainDump();
    await act(async () => {
      jest.advanceTimersByTime(1500);
    });
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });

  it.each([
    ["it isn't due", () => (mockPaywall = { paywallSource: null, entitlementActive: false, winBackDue: false })],
    ["the user has Plus", () => (mockStore = { ...mockStore, hasPlus: true })],
  ])("not when %s", async (_why, tweak) => {
    jest.useFakeTimers({ now: MORNING });
    lapsedFree();
    tweak();
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("checkbox", { name: /Task 1: Walk/ }));
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });
});

// --- Phase 6: iPad two-column layout -----------------------------------------

describe("Today on a wide screen", () => {
  const IPAD = { width: 1024, height: 1366, scale: 2, fontScale: 1 };

  it("uses two columns when ideas can still be added", async () => {
    mockWindow = IPAD;
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    expect(screen.getByTestId("today-two-column")).toBeOnTheScreen();
    expect(screen.getByTestId("need-ideas")).toBeOnTheScreen();
  });

  it("uses two columns for the perfect-day card on a finished, locked day", async () => {
    mockWindow = IPAD;
    mockStore = makeStore({
      tasks: tasks("Walk", "Read", "Stretch"),
      todayCompletions: ["t0", "t1", "t2"],
      todayLocked: true,
      todayLockSource: "manual",
    });
    await render(<HomeScreen />);
    expect(screen.getByTestId("today-two-column")).toBeOnTheScreen();
  });

  it("puts the evening check-in in the right column on a locked day that isn't perfect, in the evening", async () => {
    jest.useFakeTimers({ now: new Date(2026, 8, 26, 18, 0), doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask", "nextTick"] });
    mockWindow = IPAD;
    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    await render(<HomeScreen />);
    expect(screen.getByTestId("today-two-column")).toBeOnTheScreen();
    expect(screen.getByText("How did today feel?")).toBeOnTheScreen();
  });

  // 1.2: morning and midday fill the right column (the week row), so it's never empty.
  it("puts midday on the right on a locked day at lunchtime (no check-in yet)", async () => {
    jest.useFakeTimers({ now: new Date(2026, 8, 26, 12, 0), doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask", "nextTick"] });
    mockWindow = IPAD;
    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    await render(<HomeScreen />);
    expect(screen.queryByText("How did today feel?")).toBeNull();
    expect(screen.getByTestId("today-two-column")).toBeOnTheScreen();
    expect(screen.getAllByTestId("week-row")).toHaveLength(1);
  });

  it("puts the morning week row on the right on a full, unlocked day before noon", async () => {
    jest.useFakeTimers({ now: new Date(2026, 8, 26, 10, 0), doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask", "nextTick"] });
    mockWindow = IPAD;
    mockStore = makeStore({ tasks: tasks("Walk", "Read", "Stretch") });
    await render(<HomeScreen />);
    expect(screen.getByTestId("today-two-column")).toBeOnTheScreen();
    expect(screen.getAllByTestId("week-row")).toHaveLength(1);
  });

  it("stays one column on a phone", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    expect(screen.getByTestId("need-ideas")).toBeOnTheScreen();
    expect(screen.queryByTestId("today-two-column")).toBeNull();
  });
});

// --- Phase 8: inline Unlock, saved-for-later link ------------------------------

describe("Today: unlock and saved ideas", () => {
  const parked = [
    { id: "p1", text: "Buy shoes", parkedAt: "2026-09-26T08:00:00.000Z" },
    { id: "p2", text: "Call mum", parkedAt: "2026-09-26T08:00:00.000Z" },
  ];

  it("offers Change on the status line once the day is set, and it unlocks", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    await render(<HomeScreen />);
    expect(screen.getByText("Change")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Change today's tasks" }));
    expect(mockStore.unlockToday).toHaveBeenCalledTimes(1);
  });

  it("has no Change while the day is open", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    expect(screen.queryByRole("button", { name: "Change today's tasks" })).toBeNull();
  });

  it("keeps saved items reachable when the day is full, and opens the ideas sheet", async () => {
    mockStore = makeStore({ tasks: tasks("Walk", "Read", "Stretch"), parkedTasks: parked });
    await render(<HomeScreen />);
    expect(screen.queryByTestId("need-ideas")).toBeNull();
    const link = screen.getByTestId("saved-ideas-link");
    expect(link).toHaveTextContent(/Saved for later \(2\)/);
    await fireEvent.press(link);
    expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen();
  });

  it("goes back to the normal ideas view after the saved-only sheet is closed by a lock", async () => {
    const full = { tasks: tasks("Walk", "Read", "Stretch"), parkedTasks: parked };
    mockStore = makeStore(full);
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("saved-ideas-link"));
    expect(screen.getByText("Saved for later")).toBeOnTheScreen();

    // Locking closes the sheet (not its close button).
    mockStore = makeStore({ ...full, todayLocked: true, todayLockSource: "manual" });
    await rerender(<HomeScreen />);
    expect(screen.queryByTestId("ideas-sheet")).toBeNull();

    // Unlocked later with a free slot: Need ideas opens the normal view.
    mockStore = makeStore({ tasks: tasks("Walk", "Read"), parkedTasks: parked });
    await rerender(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen();
    expect(screen.queryByText("Saved for later")).toBeNull();
    expect(screen.getByText("Ideas for today")).toBeOnTheScreen();
  });

  it("keeps the saved-for-later link on a set day, even with a free slot", async () => {
    mockStore = makeStore({ ...SET, tasks: tasks("Walk"), parkedTasks: parked });
    await render(<HomeScreen />);
    expect(screen.getByTestId("saved-ideas-link")).toHaveTextContent(/Saved for later \(2\)/);
    expect(screen.queryByTestId("need-ideas")).toBeNull();
  });

  it.each([
    ["a free slot (the ideas entry shows instead)", { tasks: tasks("Walk", "Read"), parkedTasks: parked }],
    ["nothing saved", { tasks: tasks("Walk", "Read", "Stretch"), parkedTasks: [] }],
  ])("has no saved-for-later link with %s", async (_why, overrides) => {
    mockStore = makeStore(overrides);
    await render(<HomeScreen />);
    expect(screen.queryByTestId("saved-ideas-link")).toBeNull();
  });
});

// --- Phase 9a: the daily ritual -------------------------------------------------

describe("Today: morning draft and evening close", () => {
  const TOMORROW_CLOSE = {
    note: "A good day. You showed up.",
    because: "Picking up where today left off.",
    tomorrow: ["Stretch"],
    memory: null,
    source: "local" as const,
  };

  it("uses last night's draft, only as many tasks as there's room for", async () => {
    mockStore = makeStore({
      tasks: tasks("Walk", "Read"),
      tomorrowDraft: { forDate: TODAY, tasks: ["Stretch", "Call mum", "Hydrate"], note: "", because: "Lighter today.", source: "local" },
    });
    await render(<HomeScreen />);
    expect(screen.getByTestId("tomorrow-draft")).toHaveTextContent(/Lighter today\./);
    await fireEvent.press(screen.getByTestId("tomorrow-draft-use"));
    expect(mockStore.applyTomorrowDraft).toHaveBeenCalledWith(["Stretch"], ["Stretch", "Call mum", "Hydrate"]);
  });

  it("offers only draft tasks that weren't carried over, finished or dropped yesterday", async () => {
    const YESTERDAY = "2026-09-25";
    const rec = (id: string, text: string, completed: boolean, outcome: "carried" | "dropped" | null) => ({
      id,
      text,
      completed,
      carriedOver: false,
      rolloverOutcome: outcome,
    });
    mockStore = makeStore({
      // A was carried into today.
      tasks: [{ id: "c0", text: "A", createdAt: "", carriedOver: true }],
      tomorrowDraft: { forDate: TODAY, tasks: ["A", "B", "C", "D"], note: "", because: "", source: "local" },
      history: {
        [YESTERDAY]: {
          date: YESTERDAY,
          total: 4,
          completed: 1,
          locked: false,
          lockSource: null,
          reflection: null,
          reflectionResult: null,
          tasks: [rec("y0", "A", false, "carried"), rec("y1", "C", false, "dropped"), rec("y2", "d ", true, null)],
        },
      },
    });
    await render(<HomeScreen />);
    expect(screen.getByTestId("tomorrow-draft")).toHaveTextContent(/Ready for today/);
    await fireEvent.press(screen.getByTestId("tomorrow-draft-use"));
    expect(mockStore.applyTomorrowDraft).toHaveBeenCalledWith(["B"], ["B"]);
  });

  const EVENING: Parameters<typeof jest.useFakeTimers>[0] = {
    now: new Date(2026, 8, 26, 20, 0),
    doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask", "nextTick"],
  };
  const eveningDay = { tasks: tasks("Walk", "Read", "Stretch"), todayCompletions: ["t0", "t1"] };

  it("closes the day once from the check-in (even on a second quick tap), for the day it was tapped on", async () => {
    jest.useFakeTimers(EVENING);
    let finish!: (close: typeof TOMORROW_CLOSE) => void;
    (closeDay as jest.Mock).mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    mockStore = makeStore(eveningDay);
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Today felt good" }));
    await fireEvent.press(screen.getByRole("button", { name: "Today felt hard" }));
    expect(closeDay).toHaveBeenCalledTimes(1);
    const [input, options] = (closeDay as jest.Mock).mock.calls[0];
    expect(input).toMatchObject({
      result: "good",
      tasks: [
        { text: "Walk", done: true },
        { text: "Read", done: true },
        { text: "Stretch", done: false },
      ],
    });
    // Plus is confirmed but there's no proxy in this build: the on-device close.
    expect(options).toEqual({ useAi: false });
    expect(screen.getByTestId("evening-closing")).toBeOnTheScreen();

    // Midnight passes before the reply lands: it still belongs to the tapped day.
    const { setEveningClose } = mockStore;
    mockStore = { ...makeStore(eveningDay), today: "2026-09-27", setEveningClose };
    await rerender(<HomeScreen />);
    await act(async () => finish(TOMORROW_CLOSE));
    expect(setEveningClose).toHaveBeenCalledWith(TOMORROW_CLOSE, TODAY, "good");
  });

  it("keeps a day closed even when nothing was drafted; the same answer doesn't re-close, a different one does", async () => {
    jest.useFakeTimers(EVENING);
    const nothing = { ...TOMORROW_CLOSE, tomorrow: [] };
    (closeDay as jest.Mock).mockResolvedValue(nothing);
    mockStore = makeStore(eveningDay);
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Today felt good" }));
    await act(async () => {});
    expect(closeDay).toHaveBeenCalledTimes(1);

    // The store now records the close (no draft for tomorrow).
    mockStore = makeStore({
      ...eveningDay,
      todayReflectionResult: "good",
      eveningClose: { date: TODAY, result: "good", note: nothing.note },
    });
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("evening-result")).toHaveTextContent(/A good day\. You showed up\./);
    await fireEvent.press(screen.getByRole("button", { name: "Today felt good" }));
    await act(async () => {});
    expect(closeDay).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByRole("button", { name: "Today felt hard" }));
    await act(async () => {});
    expect(closeDay).toHaveBeenCalledTimes(2);
    expect((closeDay as jest.Mock).mock.calls[1][0]).toMatchObject({ result: "hard" });
  });

  it("offers \"Didn't get to it today\" only when something is still open", async () => {
    jest.useFakeTimers(EVENING);
    mockStore = makeStore({ tasks: tasks("Walk", "Read"), todayCompletions: ["t0"] });
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getByRole("button", { name: "I didn't get to it today" })).toHaveTextContent("Didn't get to it today");

    mockStore = makeStore({ tasks: tasks("Walk", "Read"), todayCompletions: ["t0", "t1"] });
    await rerender(<HomeScreen />);
    expect(screen.getByText("How did today feel?")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "I didn't get to it today" })).toBeNull();
  });
});


// --- Phase 10a: one calm card ------------------------------------------------

describe("Today card (Phase 10a)", () => {
  const upNext = () => screen.queryAllByText("Up next", { includeHiddenElements: true });
  let sheet: jest.SpyInstance;
  beforeEach(() => {
    sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
  });
  afterEach(() => sheet.mockRestore());
  /** Taps a task's words (opens its menu) and picks an option by label. */
  async function pickFromMenu(taskId: string, label: string) {
    await fireEvent.press(screen.getByTestId(`task-words-${taskId}`, { includeHiddenElements: true }));
    const [options, callback] = sheet.mock.calls[sheet.mock.calls.length - 1] as [
      { options: string[] },
      (index: number) => void,
    ];
    await act(async () => callback(options.options.indexOf(label)));
  }

  it("has no hero while the day is open and nothing is done yet", async () => {
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch") });
    await render(<HomeScreen />);
    expect(upNext()).toHaveLength(0);
    expect(screen.getByRole("checkbox", { name: "Task 1: Walk" })).toBeOnTheScreen();
  });

  it("once work has started, the first undone task is Up next (day still open)", async () => {
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch", "Hydrate"), todayCompletions: ["t0"] });
    await render(<HomeScreen />);
    expect(upNext()).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Up next. Task 2: Stretch" })).toBeOnTheScreen();
    const heroRow = within(screen.getByTestId("task-row-t1"));
    expect(heroRow.getByText("Up next", { includeHiddenElements: true })).toBeOnTheScreen();
    expect(heroRow.getByRole("button", { name: "Not today: Stretch" })).toBeOnTheScreen();
    // Other rows keep their actions in the menu, not inline.
    expect(
      within(screen.getByTestId("task-row-t2")).queryByRole("button", { name: "Not today: Hydrate" }),
    ).toBeNull();
    expect(screen.getByText("Keep going. 2 to go.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Set today's tasks" })).toBeNull();
  });

  it("once the day is set, the first undone task is Up next even before anything is done", async () => {
    mockStore = makeStore({ ...SET, tasks: tasks("Walk", "Stretch") });
    await render(<HomeScreen />);
    expect(upNext()).toHaveLength(1);
    expect(screen.getByRole("checkbox", { name: "Up next. Task 1: Walk" })).toBeOnTheScreen();
  });

  it("has no hero once everything is done: the gradient card instead (with room left, the status line stays)", async () => {
    mockStore = makeStore({ ...SET, tasks: tasks("Walk", "Stretch"), todayCompletions: ["t0", "t1"] });
    await render(<HomeScreen />);
    expect(upNext()).toHaveLength(0);
    const card = within(screen.getByTestId("done-card"));
    expect(card.getByText("All done for now. Rest is part of it.")).toBeOnTheScreen();
    expect(card.getByText("Close the day below and your coach drafts tomorrow.")).toBeOnTheScreen();
    // Phase 10b: only a full three-for-three day drops the line (Change stays reachable).
    expect(screen.getByTestId("status-line")).toBeOnTheScreen();
  });

  it("a full three-for-three set day has no status line", async () => {
    mockStore = makeStore({ ...SET, tasks: tasks("Walk", "Stretch", "Hydrate"), todayCompletions: ["t0", "t1", "t2"] });
    await render(<HomeScreen />);
    expect(screen.getByTestId("done-card")).toBeOnTheScreen();
    expect(screen.queryByTestId("status-line")).toBeNull();
  });

  it("says '3 of 3. Rest is part of it.' on the done card for a full day", async () => {
    mockStore = makeStore({
      tasks: tasks("Walk", "Stretch", "Hydrate"),
      todayCompletions: ["t0", "t1", "t2"],
    });
    await render(<HomeScreen />);
    expect(within(screen.getByTestId("done-card")).getByText("3 of 3. Rest is part of it.")).toBeOnTheScreen();
  });

  it("hides the empty add rows once the list is full", async () => {
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch", "Hydrate") });
    await render(<HomeScreen />);
    expect(screen.queryByText("Add a task")).toBeNull();
    expect(screen.queryByText("Left open on purpose")).toBeNull();
  });

  it("Not today (hero button) goes through the store's one notToday action and says so", async () => {
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    mockStore = makeStore({ ...SET, tasks: tasks("Walk", "Stretch") });
    await render(<HomeScreen />);
    await fireEvent.press(
      within(screen.getByTestId("task-row-t0")).getByRole("button", { name: "Not today: Walk" }),
    );
    expect(mockStore.notToday).toHaveBeenCalledWith("t0");
    // Not the old two-step park-then-delete.
    expect(mockStore.parkTasks).not.toHaveBeenCalled();
    expect(mockStore.deleteTask).not.toHaveBeenCalled();
    expect(screen.getByTestId("today-toast")).toHaveTextContent(/Saved for later\./);
    expect(announce).toHaveBeenCalledWith("Saved for later.");
    announce.mockRestore();
  });

  it("VoiceOver: Not today works on any row; Delete still confirms on an open day", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch") });
    await render(<HomeScreen />);
    const box = screen.getByRole("checkbox", { name: "Task 2: Stretch" });
    await fireEvent(box, "accessibilityAction", { nativeEvent: { actionName: "notToday" } });
    expect(mockStore.notToday).toHaveBeenCalledWith("t1");

    await fireEvent(box, "accessibilityAction", { nativeEvent: { actionName: "delete" } });
    expect(mockStore.deleteTask).not.toHaveBeenCalled();
    const [title, , buttons] = alert.mock.calls[0] as unknown as [
      string,
      string,
      { text: string; onPress?: () => void }[],
    ];
    expect(title).toBe("Remove this task?");
    await act(async () => buttons.find((b) => b.text === "Remove")?.onPress?.());
    expect(mockStore.deleteTask).toHaveBeenCalledWith("t1");
    alert.mockRestore();
  });

  it("on a set day VoiceOver offers Not today (which parks the task) but not Edit or Delete", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockStore = makeStore({ ...SET, tasks: tasks("Walk", "Stretch") });
    await render(<HomeScreen />);
    const box = screen.getByRole("checkbox", { name: "Task 2: Stretch" });
    expect(box.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(["notToday"]);
    await fireEvent(box, "accessibilityAction", { nativeEvent: { actionName: "delete" } });
    expect(alert).not.toHaveBeenCalled();
    expect(mockStore.deleteTask).not.toHaveBeenCalled();
    await fireEvent(box, "accessibilityAction", { nativeEvent: { actionName: "notToday" } });
    expect(mockStore.notToday).toHaveBeenCalledWith("t1");
    alert.mockRestore();
  });

  it("only the circle checks a task off; the words open its menu, and Edit edits", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    await pickFromMenu("t0", "Edit");
    expect(mockStore.toggleTask).not.toHaveBeenCalled();
    const input = screen.getByLabelText("Edit task 1");
    await fireEvent.changeText(input, "Walk far");
    await fireEvent(input, "submitEditing");
    expect(mockStore.editTask).toHaveBeenCalledWith("t0", "Walk far");

    await fireEvent.press(screen.getByRole("checkbox", { name: "Task 1: Walk" }));
    expect(mockStore.toggleTask).toHaveBeenCalledWith("t0");
  });

  it("the words don't check a task off on a set day either", async () => {
    mockStore = makeStore({ ...SET, tasks: tasks("Walk") });
    await render(<HomeScreen />);
    await pickFromMenu("t0", "Not today");
    expect(mockStore.toggleTask).not.toHaveBeenCalled();
    expect(mockStore.notToday).toHaveBeenCalledWith("t0");
    expect(sheet.mock.calls[0][0].options).toEqual(["Not today", "Cancel"]);
  });

  it("shows 'Today' with the date, and a small greeting above it when there's a name", async () => {
    mockStore = makeStore({
      tasks: tasks("Walk"),
      momentumProfile: { ...buildInitialState().momentumProfile, name: "Alex Smith" },
    });
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getByRole("header", { name: "Today" })).toBeOnTheScreen();
    expect(screen.getByText(/^(Good (morning|afternoon|evening)|Hello), Alex$/)).toBeOnTheScreen();
    const dateLabel = new Date(2026, 8, 26).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    expect(screen.getByText(`${dateLabel} · 0 of 1 done · 2 open`)).toBeOnTheScreen();

    mockStore = makeStore({ tasks: tasks("Walk") });
    await rerender(<HomeScreen />);
    expect(screen.queryByText(/^(Good (morning|afternoon|evening)|Hello)/)).toBeNull();
  });

  it("tracks Not today with where it came from", async () => {
    mockStore = makeStore({ ...SET, tasks: tasks("Walk") });
    await render(<HomeScreen />);
    const box = screen.getByRole("checkbox", { name: "Up next. Task 1: Walk" });
    await fireEvent(box, "accessibilityAction", { nativeEvent: { actionName: "notToday" } });
    expect(mockTrack).toHaveBeenCalledWith("task_not_today", { source: "set" });
  });
});

describe("status line on a finished day (Phase 10b)", () => {
  it("a set day with everything done but room left keeps the line, and Change is reachable", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), todayCompletions: ["t0"], ...SET });
    await render(<HomeScreen />);
    expect(screen.getByText("Today is set. All done.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Change today's tasks" }));
    expect(mockStore.unlockToday).toHaveBeenCalledTimes(1);
  });

  it("an open day with everything done but room left says so (no Set today)", async () => {
    mockStore = makeStore({ tasks: tasks("Walk", "Read"), todayCompletions: ["t0", "t1"] });
    await render(<HomeScreen />);
    expect(screen.getByText("All done so far. Add another, or enjoy the space.")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Set today's tasks" })).toBeNull();
  });

  it("a full three-for-three day hides the line", async () => {
    mockStore = makeStore({ tasks: tasks("Walk", "Read", "Call"), todayCompletions: ["t0", "t1", "t2"], ...SET });
    await render(<HomeScreen />);
    expect(screen.queryByText(/^Today is set\./)).toBeNull();
    expect(screen.queryByRole("button", { name: "Change today's tasks" })).toBeNull();
  });
});

// --- 1.2: Today by time of day --------------------------------------------------

describe("Today by time of day (1.2)", () => {
  // Only the clock is faked, so the screen's own timers still run.
  const at = (hour: number) =>
    jest.useFakeTimers({
      now: new Date(2026, 8, 26, hour, 0),
      doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask", "nextTick"],
    });
  const milestone = (id: string, title: string, completedAt: string | null = null) => ({
    id,
    title,
    description: "",
    completedAt,
  });
  const plan = (milestones: ReturnType<typeof milestone>[]) => ({
    id: "p",
    goalTitle: "Run a 5K",
    generatedAt: new Date(2026, 8, 20).toISOString(),
    provider: "template" as const,
    milestones,
    taskPool: [],
    todaySuggestions: [],
    promptSummary: "",
    version: 1,
  });
  const evening = (on: boolean) => ({
    momentumSettings: { ...buildInitialState().momentumSettings, eveningReflection: on },
  });

  it("morning: shows the week row (today counted, speaking its label), and no done card or midday extras", async () => {
    at(9);
    mockStore = makeStore({
      tasks: tasks("Walk", "Read"),
      momentumPlan: plan([milestone("m1", "Run 1 km")]),
    });
    await render(<HomeScreen />);
    expect(
      screen.getByRole("button", { name: "This week: showed up 1 of the last 7 days. Day 1." }),
    ).toBeOnTheScreen();
    expect(screen.getAllByTestId("week-row")).toHaveLength(1);
    expect(screen.queryByTestId("done-card")).toBeNull();
    expect(screen.queryByTestId("next-path-link")).toBeNull();
    expect(screen.queryByTestId("tonight-teaser")).toBeNull();
  });

  it("the week row opens Progress", async () => {
    at(9);
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("week-row"));
    expect(mockNavigate).toHaveBeenCalledWith("/journey");
  });

  it("midday: next open milestone (opens Progress) and the tonight teaser, then the week row", async () => {
    at(14);
    mockStore = makeStore({
      tasks: tasks("Walk", "Read"),
      todayCompletions: ["t0"],
      momentumPlan: plan([milestone("m1", "Run 1 km"), milestone("m2", "Run 3 km")]),
      completedMilestoneIds: ["m1"],
      ...evening(true),
    });
    await render(<HomeScreen />);
    const link = screen.getByTestId("next-path-link");
    expect(within(link).getByText("Run 3 km")).toBeOnTheScreen();
    expect(screen.getByTestId("tonight-teaser")).toBeOnTheScreen();
    expect(screen.getByTestId("week-row")).toBeOnTheScreen();
    expect(screen.queryByTestId("done-card")).toBeNull();
    await fireEvent.press(link);
    expect(mockNavigate).toHaveBeenCalledWith("/journey");
  });

  it("midday: no path link when every milestone is done, no teaser with the check-in off (even after 17:00)", async () => {
    at(19);
    mockStore = makeStore({
      tasks: tasks("Walk", "Read"),
      momentumPlan: plan([milestone("m1", "Run 1 km", "2026-09-20T08:00:00.000Z")]),
      ...evening(false),
    });
    await render(<HomeScreen />);
    // Midday's fallback after 17:00, not the evening check-in.
    expect(screen.queryByText("How did today feel?")).toBeNull();
    expect(screen.getByTestId("week-row")).toBeOnTheScreen();
    expect(screen.queryByTestId("next-path-link")).toBeNull();
    expect(screen.queryByTestId("tonight-teaser")).toBeNull();
  });

  it("evening: the check-in as before, and no week row or midday extras", async () => {
    at(18);
    mockStore = makeStore({
      tasks: tasks("Walk", "Read"),
      momentumPlan: plan([milestone("m1", "Run 1 km")]),
      ...evening(true),
    });
    await render(<HomeScreen />);
    expect(screen.getByText("How did today feel?")).toBeOnTheScreen();
    expect(screen.queryByTestId("week-row")).toBeNull();
    expect(screen.queryByTestId("next-path-link")).toBeNull();
    expect(screen.queryByTestId("tonight-teaser")).toBeNull();
    expect(screen.queryByTestId("done-card")).toBeNull();
  });

  it("done: the card with its title and small wins; Pull one more opens Ideas on an open day with a slot", async () => {
    at(10);
    mockStore = makeStore({
      tasks: tasks("Walk", "Read"),
      todayCompletions: ["t0", "t1"],
      history: { "2026-09-24": perfectDay("2026-09-24") },
      ...evening(false),
    });
    await render(<HomeScreen />);
    const card = within(screen.getByTestId("done-card"));
    expect(card.getByText("All done for now. Rest is part of it.")).toBeOnTheScreen();
    expect(card.getByText("This week you showed up 2 days and finished 5 tasks.")).toBeOnTheScreen();
    // Done replaces the morning section, at any hour.
    expect(screen.queryByTestId("week-row")).toBeNull();
    expect(screen.queryByTestId("need-ideas")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Pull one more from Ideas" }));
    expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen();
  });

  it("done: no Pull one more on a set day or a full day", async () => {
    at(10);
    mockStore = makeStore({ ...SET, tasks: tasks("Walk", "Read"), todayCompletions: ["t0", "t1"] });
    const view = await render(<HomeScreen />);
    expect(screen.getByTestId("done-card")).toBeOnTheScreen();
    expect(within(screen.getByTestId("done-card")).getByText("Your first finished day this week.")).toBeOnTheScreen();
    expect(screen.queryByTestId("pull-one-more")).toBeNull();

    mockStore = makeStore({ tasks: tasks("Walk", "Read", "Stretch"), todayCompletions: ["t0", "t1", "t2"] });
    await view.rerender(<HomeScreen />);
    expect(screen.getByText("3 of 3. Rest is part of it.")).toBeOnTheScreen();
    expect(screen.queryByTestId("pull-one-more")).toBeNull();
  });

  it("iPad morning: two columns, with the one week row in the right column", async () => {
    at(9);
    mockWindow = { width: 1024, height: 1366, scale: 2, fontScale: 1 };
    // A full day: no ideas entry, so the week row alone fills the right column.
    mockStore = makeStore({ tasks: tasks("Walk", "Read", "Stretch") });
    await render(<HomeScreen />);
    const columns = within(screen.getByTestId("today-two-column"));
    expect(columns.getAllByTestId("week-row")).toHaveLength(1);
    expect(within(screen.getByTestId("today-tasks")).queryByTestId("week-row")).toBeNull();
  });
});

// --- 1.2: the Coach's note (PR #64) ---------------------------------------------

describe("Coach's note (1.2)", () => {
  const at = (hour: number) =>
    jest.useFakeTimers({
      now: new Date(2026, 8, 26, hour, 0),
      doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask", "nextTick"],
    });
  const PROXY = "https://proxy.test/api/momentum/plan";
  const THREE = tasks("Walk the dog", "Read", "Call mum");
  const AI = {
    [coachTaskKey("Walk the dog")]: { start: "Find the lead by the door.", momentum: "Fresh air resets the afternoon." },
  };
  const request = requestCoachNotes as jest.Mock;

  it("morning, nothing ticked: a built-in start line about the first task, with a Start button", async () => {
    at(9);
    mockStore = makeStore({ tasks: THREE });
    await render(<HomeScreen />);
    expect(screen.getByTestId("coach-note")).toBeOnTheScreen();
    expect(screen.getByTestId("coach-note-start")).toHaveTextContent(localCoachLine("start", "Walk the dog", TODAY));
    expect(screen.getByRole("button", { name: "Start: Walk the dog" })).toBeOnTheScreen();
    expect(screen.getByLabelText(`Coach's note: ${localCoachLine("start", "Walk the dog", TODAY)}`)).toBeOnTheScreen();
  });
  it("midday: a momentum line about the first unticked task", async () => {
    at(14);
    mockStore = makeStore({ tasks: tasks("Walk the dog", "Read"), todayCompletions: ["t0"] });
    await render(<HomeScreen />);
    expect(screen.getByTestId("coach-note-momentum")).toHaveTextContent(localCoachLine("momentum", "Read", TODAY));
    expect(screen.queryByTestId("coach-note-start")).toBeNull();
  });

  it.each([
    ["plan (no tasks)", 9, {}, null],
    ["evening", 18, { tasks: tasks("Walk", "Read") }, "How did today feel?"],
    [
      "done",
      10,
      {
        tasks: tasks("Walk", "Read"),
        todayCompletions: ["t0", "t1"],
        momentumSettings: { ...buildInitialState().momentumSettings, eveningReflection: false },
      },
      "done-card",
    ],
  ] as [string, number, Partial<AppState>, string | null][])("%s shows no note", async (_name, hour, overrides, marker) => {
    at(hour);
    mockStore = makeStore(overrides);
    await render(<HomeScreen />);
    if (marker === "done-card") expect(screen.getByTestId("done-card")).toBeOnTheScreen();
    else if (marker) expect(screen.getByText(marker)).toBeOnTheScreen();
    else expect(screen.getByTestId("morning-hero")).toBeOnTheScreen();
    expect(screen.queryByTestId("coach-note")).toBeNull();
  });

  it("no note while the three are still being chosen in the morning: the full entries stay", async () => {
    at(9);
    mockStore = makeStore({ tasks: tasks("Walk the dog", "Read") });
    await render(<HomeScreen />);
    expect(screen.queryByTestId("coach-note")).toBeNull();
    expect(screen.queryByTestId("quiet-entries")).toBeNull();
    expect(screen.getByTestId("need-ideas")).toBeOnTheScreen();
    expect(screen.getByTestId("brain-dump-entry")).toBeOnTheScreen();
  });

  it("under the note, the ideas entries shrink to one quiet line that still opens both sheets", async () => {
    // Midday shows the note even before the three are set.
    at(14);
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    expect(screen.getByTestId("coach-note-start")).toBeOnTheScreen();
    const quiet = within(screen.getByTestId("quiet-entries"));
    expect(quiet.getByTestId("need-ideas")).toHaveTextContent("Need ideas?");
    await fireEvent.press(quiet.getByRole("button", { name: "Need ideas? Opens suggestions" }));
    expect(screen.getByTestId("ideas-sheet")).toBeOnTheScreen();
    await fireEvent.press(
      quiet.getByRole("button", { name: "Brain dump. Write everything down and pick today's tasks" }),
    );
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
  });

  it("Plus, three set: exactly one call (claimed first), the AI line once cached, and no call on re-render", async () => {
    at(9);
    mockProxyUrl = PROXY;
    let resolve: (notes: typeof AI) => void = () => {};
    request.mockImplementation(() => new Promise((r) => (resolve = r)));
    mockStore = makeStore({
      tasks: THREE,
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Run a 5K" },
    });
    const view = await render(<HomeScreen />);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toEqual({
      input: { tasks: ["Walk the dog", "Read", "Call mum"], goalTitle: "Run a 5K", tone: "calm" },
    });
    expect(mockStore.claimCoachRequest).toHaveBeenCalledWith(["Walk the dog", "Read", "Call mum"]);
    // Re-renders while the call is in flight never start a second one, even
    // with a fresh tasks array (the effect re-runs; the in-flight guard holds).
    const first = mockStore;
    await view.rerender(<HomeScreen />);
    mockStore = { ...makeStore({ tasks: tasks("Walk the dog", "Read", "Call mum") }), claimCoachRequest: first.claimCoachRequest };
    await view.rerender(<HomeScreen />);
    expect(request).toHaveBeenCalledTimes(1);
    // Nothing logged while the AI line may still come.
    expect(mockTrack).not.toHaveBeenCalledWith("coach_note_loaded", expect.anything());

    expect(first.claimCoachRequest).toHaveBeenCalledTimes(1);
    await act(async () => resolve(AI));
    expect(first.setCoachNotes).toHaveBeenCalledWith(TODAY, AI);

    // The store now holds the claim and the lines: the AI line shows, no new call.
    const claimed = {
      date: TODAY,
      notes: AI,
      requests: 1,
      asked: THREE.map((t) => coachTaskKey(t.text)),
      logged: false,
    };
    mockStore = { ...makeStore({ tasks: THREE, coachNotes: claimed }), claimCoachRequest: mockStore.claimCoachRequest };
    await view.rerender(<HomeScreen />);
    expect(screen.getByTestId("coach-note-start")).toHaveTextContent("Find the lead by the door.");
    expect(request).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith("coach_note_loaded", { source: "ai" });
    expect(mockStore.markCoachNoteLogged).toHaveBeenCalledWith(TODAY);
  });

  it("a failed call keeps the built-in line quietly (no error text, nothing stored)", async () => {
    at(9);
    mockProxyUrl = PROXY;
    request.mockRejectedValue(new MomentumAiError("network", "offline"));
    mockStore = makeStore({ tasks: THREE });
    const view = await render(<HomeScreen />);
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
    expect(mockStore.setCoachNotes).not.toHaveBeenCalled();
    expect(screen.getByTestId("coach-note-start")).toHaveTextContent(localCoachLine("start", "Walk the dog", TODAY));
    expect(screen.queryByText(/offline|went wrong|try again/i)).toBeNull();

    // The claim stuck (the store counted it): no retry for the same texts, and the note logs as local.
    const claimed = { date: TODAY, notes: {}, requests: 1, asked: THREE.map((t) => coachTaskKey(t.text)), logged: false };
    mockStore = makeStore({ tasks: THREE, coachNotes: claimed });
    await view.rerender(<HomeScreen />);
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("coach-note-start")).toHaveTextContent(localCoachLine("start", "Walk the dog", TODAY));
    expect(mockTrack).toHaveBeenCalledWith("coach_note_loaded", { source: "local" });
  });

  it("never calls for free users, unconfirmed Plus, fewer than three on an open day, or no proxy", async () => {
    at(9);
    mockProxyUrl = PROXY;
    mockStore = { ...makeStore({ tasks: THREE }), plusConfirmed: false, hasPlus: false };
    const view = await render(<HomeScreen />);
    expect(screen.getByTestId("coach-note")).toBeOnTheScreen();

    mockStore = { ...makeStore({ tasks: THREE }), plusConfirmed: false, hasPlus: true };
    await view.rerender(<HomeScreen />);
    mockStore = makeStore({ tasks: tasks("Walk", "Read") });
    await view.rerender(<HomeScreen />);
    mockProxyUrl = null;
    mockStore = makeStore({ tasks: THREE });
    await view.rerender(<HomeScreen />);
    expect(request).not.toHaveBeenCalled();
    expect(mockStore.claimCoachRequest).not.toHaveBeenCalled();
  });

  it("a set day with one task counts as three set, and a spent daily cap means no call", async () => {
    at(9);
    mockProxyUrl = PROXY;
    mockStore = makeStore({ ...SET, tasks: tasks("Walk"), coachNotes: { date: TODAY, notes: {}, requests: 2, asked: [], logged: true } });
    const view = await render(<HomeScreen />);
    expect(request).not.toHaveBeenCalled();

    mockStore = makeStore({ ...SET, tasks: tasks("Walk") });
    await view.rerender(<HomeScreen />);
    expect(request).toHaveBeenCalledTimes(1);
  });

  const claimed = (texts: string[], requests: number, notes = {}) => ({
    date: TODAY,
    notes,
    requests,
    asked: texts.map(coachTaskKey),
    logged: false,
  });

  it("an edit mid-call: one more call for the new texts once the first settles, then no third (2/day)", async () => {
    at(9);
    mockProxyUrl = PROXY;
    const pending: ((notes: typeof AI) => void)[] = [];
    request.mockImplementation(() => new Promise((r) => pending.push(r)));
    mockStore = makeStore({ tasks: THREE });
    const view = await render(<HomeScreen />);
    expect(request).toHaveBeenCalledTimes(1);

    // "Read" becomes "Read a chapter" while the first call is in flight.
    const edited = tasks("Walk the dog", "Read a chapter", "Call mum");
    mockStore = makeStore({ tasks: edited, coachNotes: claimed(THREE.map((t) => t.text), 1) });
    await view.rerender(<HomeScreen />);
    expect(request).toHaveBeenCalledTimes(1);

    await act(async () => pending[0](AI));
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0].input.tasks).toEqual(["Walk the dog", "Read a chapter", "Call mum"]);

    // Both calls spent: another edit gets the built-in line, never a third call.
    await act(async () => pending[1]({}));
    const again = tasks("Walk the dog", "Read a chapter", "Call dad");
    mockStore = makeStore({
      tasks: again,
      coachNotes: claimed(["Walk the dog", "Read", "Call mum", "Read a chapter"], 2),
    });
    await view.rerender(<HomeScreen />);
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("the session guard: the same day and texts are never asked twice, even if the claim didn't stick", async () => {
    at(9);
    mockProxyUrl = PROXY;
    request.mockRejectedValue(new MomentumAiError("network", "offline"));
    // claimCoachRequest is a no-op jest.fn: the stored cache never records the ask.
    mockStore = makeStore({ tasks: THREE });
    const view = await render(<HomeScreen />);
    await act(async () => {});
    await view.rerender(<HomeScreen />);
    mockStore = makeStore({ tasks: tasks("Walk the dog", "Read", "Call mum") });
    await view.rerender(<HomeScreen />);
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("coach_note_loaded: never while Plus is still being checked; then local for a free user, once a day", async () => {
    at(9);
    mockProxyUrl = PROXY;
    mockStore = { ...makeStore({ tasks: THREE }), plusConfirmed: false, hasPlus: false, plusPending: true };
    const view = await render(<HomeScreen />);
    expect(screen.getByTestId("coach-note")).toBeOnTheScreen();
    expect(mockTrack).not.toHaveBeenCalledWith("coach_note_loaded", expect.anything());

    mockStore = { ...makeStore({ tasks: THREE }), plusConfirmed: false, hasPlus: false, plusPending: false };
    await view.rerender(<HomeScreen />);
    expect(mockTrack).toHaveBeenCalledWith("coach_note_loaded", { source: "local" });
    expect(mockStore.markCoachNoteLogged).toHaveBeenCalledWith(TODAY);

    // Already logged today: not again.
    mockTrack.mockClear();
    mockStore = {
      ...makeStore({ tasks: THREE, coachNotes: { ...claimed([], 0), logged: true } }),
      plusConfirmed: false,
      hasPlus: false,
      plusPending: false,
    };
    await view.rerender(<HomeScreen />);
    expect(mockTrack).not.toHaveBeenCalledWith("coach_note_loaded", expect.anything());
  });

  it("coach_note_loaded for an AI user: not before the three are set, and ai once the call settles with the line", async () => {
    at(9);
    mockProxyUrl = PROXY;
    let resolve: (notes: typeof AI) => void = () => {};
    request.mockImplementation(() => new Promise((r) => (resolve = r)));
    // A morning with two tasks one ticked shows the note, but the AI call waits for the three.
    mockStore = makeStore({ tasks: tasks("Walk the dog", "Read"), todayCompletions: ["t1"] });
    const view = await render(<HomeScreen />);
    expect(screen.getByTestId("coach-note")).toBeOnTheScreen();
    expect(request).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalledWith("coach_note_loaded", expect.anything());

    mockStore = makeStore({ tasks: THREE });
    const caller = mockStore;
    await view.rerender(<HomeScreen />);
    expect(request).toHaveBeenCalledTimes(1);
    // The claim landed (no call due any more) but the answer hasn't: still not logged.
    mockStore = makeStore({ tasks: THREE, coachNotes: claimed(THREE.map((t) => t.text), 1) });
    await view.rerender(<HomeScreen />);
    expect(mockTrack).not.toHaveBeenCalledWith("coach_note_loaded", expect.anything());

    // Like the real store: the answer is stored before the screen next renders.
    const withLines = makeStore({ tasks: THREE, coachNotes: claimed(THREE.map((t) => t.text), 1, AI) });
    caller.setCoachNotes.mockImplementation(() => {
      mockStore = withLines;
    });
    await act(async () => resolve(AI));
    expect(screen.getByTestId("coach-note-start")).toHaveTextContent("Find the lead by the door.");
    expect(mockTrack.mock.calls.filter((c) => c[0] === "coach_note_loaded")).toHaveLength(1);
    expect(mockTrack).toHaveBeenCalledWith("coach_note_loaded", { source: "ai" });
  });

  it("coach_note_loaded for an AI user who never sets three: local once it's midday, with no call", async () => {
    at(14);
    mockProxyUrl = PROXY;
    mockStore = makeStore({ tasks: tasks("Walk the dog", "Read") });
    await render(<HomeScreen />);
    expect(screen.getByTestId("coach-note")).toBeOnTheScreen();
    expect(request).not.toHaveBeenCalled();
    expect(mockTrack.mock.calls.filter((c) => c[0] === "coach_note_loaded")).toEqual([
      ["coach_note_loaded", { source: "local" }],
    ]);
  });

  it("the icon follows the source: a leaf for the built-in line, sparkles for the AI line", async () => {
    at(9);
    mockStore = makeStore({ tasks: THREE });
    const view = await render(<HomeScreen />);
    // Ionicons renders its glyph as text: look for each icon's character.
    const glyph = (name: "sparkles" | "leaf-outline") => String.fromCodePoint(Ionicons.glyphMap[name] as number);
    const icons = () =>
      (["sparkles", "leaf-outline"] as const).filter(
        (name) => within(screen.getByTestId("coach-note")).queryByText(glyph(name), { includeHiddenElements: true }) !== null,
      );
    expect(icons()).toEqual(["leaf-outline"]);

    mockStore = makeStore({ tasks: THREE, coachNotes: claimed(THREE.map((t) => t.text), 1, AI) });
    await view.rerender(<HomeScreen />);
    expect(icons()).toEqual(["sparkles"]);
  });
});

describe("Focus mode from the coach's note (1.2)", () => {
  const at = (hour: number) =>
    jest.useFakeTimers({
      now: new Date(2026, 8, 26, hour, 0),
      doNotFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask", "nextTick"],
    });
  const THREE = tasks("Walk the dog", "Read", "Call mum");
  const AI_NOTES = {
    date: TODAY,
    notes: { [coachTaskKey("Walk the dog")]: { start: "Find the lead by the door.", momentum: "Fresh air helps." } },
    requests: 1,
    asked: THREE.map((t) => coachTaskKey(t.text)),
    logged: true,
  };
  const focusEvents = () => mockTrack.mock.calls.filter((c) => String(c[0]).startsWith("focus_"));

  it("Start opens focus mode on the note's task, with the same start line as the note", async () => {
    at(9);
    mockStore = makeStore({ tasks: THREE, ...SET, coachNotes: AI_NOTES });
    await render(<HomeScreen />);
    expect(screen.getByTestId("coach-note-start")).toHaveTextContent("Find the lead by the door.");
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    await fireEvent.press(screen.getByTestId("coach-note-start-button"));
    expect(screen.getByTestId("focus-task-text")).toHaveTextContent("Walk the dog");
    expect(screen.getByTestId("focus-start-line")).toHaveTextContent("Find the lead by the door.");
    expect(focusEvents()).toEqual([["focus_opened"]]);
  });

  it("after a tick the note moves on to momentum, but focus mode opens on the next open task with its start line", async () => {
    at(9);
    mockStore = makeStore({ tasks: THREE, todayCompletions: ["t0"] });
    await render(<HomeScreen />);
    expect(screen.getByTestId("coach-note-momentum")).toHaveTextContent(localCoachLine("momentum", "Read", TODAY));
    await fireEvent.press(screen.getByTestId("coach-note-start-button"));
    expect(screen.getByTestId("focus-task-text")).toHaveTextContent("Read");
    expect(screen.getByTestId("focus-start-line")).toHaveTextContent(localCoachLine("start", "Read", TODAY));
  });

  it("Done ticks the task through the normal path, tracks focus_completed after focus_opened, announces it, and closes", async () => {
    at(9);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    mockStore = makeStore({ tasks: THREE, ...SET });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("coach-note-start-button"));
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(mockStore.toggleTask).toHaveBeenCalledTimes(1);
    expect(mockStore.toggleTask).toHaveBeenCalledWith("t0");
    expect(mockTrack).toHaveBeenCalledWith("task_completed", { count: 1 });
    expect(focusEvents()).toEqual([["focus_opened"], ["focus_completed", { timer: 0 }]]);
    expect(announce).toHaveBeenCalledWith("Done: Walk the dog");
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    announce.mockRestore();
  });

  it("Done on the third task leaves the announcement to the celebration", async () => {
    at(9);
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    mockStore = makeStore({ tasks: THREE, ...SET, todayCompletions: ["t0", "t1"] });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("coach-note-start-button"));
    expect(screen.getByTestId("focus-task-text")).toHaveTextContent("Call mum");
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(mockStore.toggleTask).toHaveBeenCalledWith("t2");
    expect(announce).not.toHaveBeenCalledWith("Done: Call mum");
    announce.mockRestore();
  });

  it("focus_opened goes out on open; focus_timer_started each time a timer starts; completed carries the timer", async () => {
    at(9);
    mockStore = makeStore({ tasks: THREE, ...SET });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("coach-note-start-button"));
    expect(focusEvents()).toEqual([["focus_opened"]]);
    await fireEvent.press(screen.getByRole("button", { name: "25 minute timer" }));
    // The running one again: a no-op, no event.
    await fireEvent.press(screen.getByRole("button", { name: "25 minute timer" }));
    await fireEvent.press(screen.getByRole("button", { name: "10 minute timer" }));
    expect(focusEvents()).toEqual([
      ["focus_opened"],
      ["focus_timer_started", { timer: 25 }],
      ["focus_timer_started", { timer: 10 }],
    ]);
    await fireEvent.press(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    expect(mockStore.toggleTask).not.toHaveBeenCalled();
    expect(focusEvents()).toHaveLength(3);

    // A fresh open starts with no timer.
    await fireEvent.press(screen.getByTestId("coach-note-start-button"));
    expect(screen.getByRole("button", { name: "No timer" })).toBeSelected();
    await fireEvent.press(screen.getByRole("button", { name: "10 minute timer" }));
    await fireEvent.press(screen.getByRole("button", { name: "Done" }));
    expect(focusEvents().slice(3)).toEqual([
      ["focus_opened"],
      ["focus_timer_started", { timer: 10 }],
      ["focus_completed", { timer: 10 }],
    ]);
  });

  it("closes when the day rolls over", async () => {
    at(9);
    mockStore = makeStore({ tasks: THREE, ...SET });
    const view = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("coach-note-start-button"));
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    // Same tasks (e.g. carried over), a new day.
    mockStore = { ...makeStore({ tasks: THREE, ...SET }), today: "2026-09-27" };
    await view.rerender(<HomeScreen />);
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    expect(mockStore.toggleTask).not.toHaveBeenCalled();
  });

  it("closes on its own when its task is ticked elsewhere (e.g. the widget) or removed", async () => {
    at(9);
    mockStore = makeStore({ tasks: THREE, ...SET });
    const view = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("coach-note-start-button"));
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    mockStore = makeStore({ tasks: THREE, ...SET, todayCompletions: ["t0"] });
    await view.rerender(<HomeScreen />);
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    expect(focusEvents()).toEqual([["focus_opened"]]);
    // Unticked again (e.g. from the widget): it stays closed, it doesn't pop back.
    mockStore = makeStore({ tasks: THREE, ...SET });
    await view.rerender(<HomeScreen />);
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    mockStore = makeStore({ tasks: THREE, ...SET, todayCompletions: ["t0"] });
    await view.rerender(<HomeScreen />);

    // Removed: open it on "Read" (now next), then drop it from the list.
    await fireEvent.press(screen.getByTestId("coach-note-start-button"));
    expect(screen.getByTestId("focus-task-text")).toHaveTextContent("Read");
    mockStore = makeStore({ tasks: [THREE[0], THREE[2]], ...SET, todayCompletions: ["t0"] });
    await view.rerender(<HomeScreen />);
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    // Nothing was ticked by the close itself.
    expect(mockStore.toggleTask).not.toHaveBeenCalled();
  });
});
