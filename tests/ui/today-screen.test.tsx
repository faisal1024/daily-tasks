import { Alert, AppState as RNAppState } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { requestBreakDown, sortBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { MomentumAiError } from "@/lib/daily-tasks/ai-status";
import { requestAppReview } from "@/lib/daily-tasks/app-review";
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
const mockOpenPaywall = jest.fn(() => true);
let mockPaywall: {
  paywallSource: string | null;
  entitlementActive: boolean;
  purchaseCount?: number;
} = {
  paywallSource: null,
  entitlementActive: false,
};
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallEnabled: true, openPaywall: mockOpenPaywall, ...mockPaywall }),
}));
jest.mock("@/components/daily-tasks/onboarding-modal", () => ({ OnboardingModal: () => null }));
jest.mock("@/components/daily-tasks/rollover-modal", () => ({ RolloverModal: () => null }));

const TODAY = "2026-09-26";

function tasks(...texts: string[]): Task[] {
  return texts.map((text, i) => ({ id: `t${i}`, text, createdAt: "", carriedOver: false }));
}

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
    toggleTask: jest.fn(),
    lockToday: jest.fn(),
    resolveRollover: jest.fn(),
    completeMomentumOnboarding: jest.fn(),
    setTodayReflection: jest.fn(),
    setTodayReflectionResult: jest.fn(),
    requestMomentumPlan: jest.fn(async () => {}),
    journeyLevel: 4,
    markReviewPrompted: jest.fn(),
    parkTasks: jest.fn(),
    removeParkedTask: jest.fn(),
    addParkedTask: jest.fn(),
    setTaskSteps: jest.fn(),
    toggleTaskStep: jest.fn(),
    clearTaskSteps: jest.fn(),
    hasPlus: true,
  };
}

beforeEach(() => {
  // The real fallback-aware sorter by default (no proxy → simple local split).
  (sortBrainDump as jest.Mock).mockImplementation(
    jest.requireActual("@/lib/daily-tasks/ai-helpers").sortBrainDump,
  );
  (requestBreakDown as jest.Mock).mockImplementation(async () => {
    throw new MomentumAiError("unavailable", "not stubbed");
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockProxyUrl = null;
  mockPaywall = { paywallSource: null, entitlementActive: false };
});

describe("Today screen layout", () => {
  it("puts the tasks first, with one status line and a Need ideas entry", async () => {
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch") });
    await render(<HomeScreen />);

    expect(screen.getByRole("checkbox", { name: "Task 1: Walk" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Task 2: Stretch" })).toBeOnTheScreen();
    expect(screen.getByText("Still choosing. Lock in when the day feels right.")).toBeOnTheScreen();
    expect(screen.getByTestId("need-ideas")).toBeOnTheScreen();
    // The old stacked cards are gone.
    expect(screen.queryByText(/Accountability check-in/i)).toBeNull();
    expect(screen.queryByText(/Today's Three is set/)).toBeNull();
  });

  it("asks for confirmation before locking, and only locks on confirm", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Lock in today's tasks" }));
    expect(mockStore.lockToday).not.toHaveBeenCalled();

    const [title, message, buttons] = alert.mock.calls[0] as unknown as [
      string,
      string,
      { text: string; onPress?: () => void }[],
    ];
    expect(title).toBe("Lock in today?");
    expect(message).toContain("Your empty slots stay empty.");
    await act(async () => buttons.find((b) => b.text === "Cancel")?.onPress?.());
    expect(mockStore.lockToday).not.toHaveBeenCalled();
    await act(async () => buttons.find((b) => b.text === "Lock in")?.onPress?.());
    expect(mockStore.lockToday).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });

  it("makes ideas the obvious next step on an empty day", async () => {
    mockStore = makeStore({
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Run a 5K" },
    });
    await render(<HomeScreen />);
    expect(screen.getByText("See ideas for Run a 5K")).toBeOnTheScreen();
  });

  it("hides Need ideas and Lock in once the day is locked", async () => {
    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    await render(<HomeScreen />);
    expect(screen.queryByTestId("need-ideas")).toBeNull();
    expect(screen.queryByRole("button", { name: "Lock in today's tasks" })).toBeNull();
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
    expect(
      screen.getByText("0 of 1 done · 2 open", { includeHiddenElements: true }),
    ).toBeOnTheScreen();
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
      screen.getByText("Locked automatically at 2:07 PM. 2 to go. Change this in Settings."),
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
      screen.getByText("Locked automatically at 1:30 PM. 1 to go. Change this in Settings."),
    ).toBeOnTheScreen();
  });

  it("invites picking or ideas on an empty day", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    expect(
      screen.getByText("Pick what matters, grab an idea, or brain dump it all."),
    ).toBeOnTheScreen();
  });

  it("explains an automatic lock with its time and where to change it", async () => {
    mockStore = makeStore({
      tasks: tasks("Walk", "Stretch"),
      todayLocked: true,
      todayLockSource: "auto",
      autoLock: { enabled: true, hour: 13, minute: 30 },
    });
    await render(<HomeScreen />);
    expect(
      screen.getByText("Locked automatically at 1:30 PM. 2 to go. Change this in Settings."),
    ).toBeOnTheScreen();
  });

  it("names the empty slots in the lock confirmation only when some are open", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch", "Hydrate") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Lock in today's tasks" }));
    const message = alert.mock.calls[0][1] as string;
    expect(message).not.toMatch(/empty slot/);
    // Lighter copy when all three are chosen: nothing is lost by locking.
    expect(message).toBe(
      "You can still check tasks off. Editing pauses until tomorrow (unlock in Settings).",
    );
    alert.mockRestore();
  });

  it("styles the empty-day ideas entry as the primary action, and steps it back once tasks exist", async () => {
    mockStore = makeStore({
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Run a 5K" },
    });
    const { rerender } = await render(<HomeScreen />);
    const prominent = screen.getByRole("button", {
      name: "See ideas for Run a 5K. Opens suggestions",
    });
    expect(prominent).toHaveStyle({ backgroundColor: themeColors.primary.light });

    mockStore = makeStore({
      tasks: tasks("Walk"),
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Run a 5K" },
    });
    await rerender(<HomeScreen />);
    const quiet = screen.getByRole("button", { name: "Need ideas?. Opens suggestions" });
    expect(quiet).not.toHaveStyle({ backgroundColor: themeColors.primary.light });
  });

  it("uses the new empty-slot copy, and 'Left open on purpose' once locked", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getAllByText("Add a task")).toHaveLength(2);
    expect(screen.getAllByText("Something you'll stand behind today.")).toHaveLength(2);

    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    await rerender(<HomeScreen />);
    expect(screen.queryByText("Add a task")).toBeNull();
    expect(screen.getAllByText("Left open on purpose")).toHaveLength(2);
    expect(screen.getAllByText("Room to breathe.")).toHaveLength(2);
  });
});

describe("Need ideas sheet", () => {
  it("opens with starter ideas when there's no AI plan, and adds one", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    expect(screen.getByText("Starter ideas")).toBeOnTheScreen();
    const firstIdea = screen.getAllByRole("button", { name: /^Add (?!all|\d)/ })[0];
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
    expect(screen.getByText("Add the first 1 ✨")).toBeOnTheScreen();
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

  it("closes so the rollover modal can show (iOS presents one modal at a time)", async () => {
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
    expect(screen.queryByTestId("ideas-sheet")).toBeNull();
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

  it("does not celebrate or ask for a rating when the app opens on a finished day", async () => {
    mockStore = makeStore({ tasks: threeTasks, todayCompletions: ["t0", "t1", "t2"], history });
    await render(<HomeScreen />);
    expect(screen.queryByText("celebration-visible")).toBeNull();
    expect(mockStore.markReviewPrompted).not.toHaveBeenCalled();
  });

  async function reachPerfectDay(overrides: Partial<AppState> = {}) {
    mockStore = makeStore({
      tasks: threeTasks,
      todayCompletions: ["t0", "t1"],
      history,
      ...overrides,
    });
    const view = await render(<HomeScreen />);
    mockStore = makeStore({
      tasks: threeTasks,
      todayCompletions: ["t0", "t1", "t2"],
      history,
      ...overrides,
    });
    await view.rerender(<HomeScreen />);
    return view;
  }

  it("celebrates when the third task is checked, and asks for a rating only after the celebration", async () => {
    jest.useFakeTimers();
    await reachPerfectDay();
    expect(screen.getByText("celebration-visible")).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(requestAppReview).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(requestAppReview).toHaveBeenCalledTimes(1);
    expect(mockStore.markReviewPrompted).toHaveBeenCalledTimes(1);
  });

  it("doesn't spend the cooldown if the rating prompt wasn't available", async () => {
    jest.useFakeTimers();
    (requestAppReview as jest.Mock).mockResolvedValueOnce(false);
    await reachPerfectDay();
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(requestAppReview).toHaveBeenCalledTimes(1);
    expect(mockStore.markReviewPrompted).not.toHaveBeenCalled();
  });

  // jest-expo's AppState mock has no real currentState; set it per test.
  async function dismissWithAppState(value: unknown) {
    const appState = RNAppState as unknown as { currentState: unknown };
    const original = appState.currentState;
    appState.currentState = value;
    try {
      await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
      await act(async () => {
        jest.advanceTimersByTime(600);
      });
    } finally {
      appState.currentState = original;
    }
  }

  it.each(["background", "inactive"])(
    "doesn't ask (or spend the cooldown) while the app is %s",
    async (value) => {
      jest.useFakeTimers();
      await reachPerfectDay();
      await dismissWithAppState(value);
      expect(requestAppReview).not.toHaveBeenCalled();
      expect(mockStore.markReviewPrompted).not.toHaveBeenCalled();
    },
  );

  it.each(["active", "unknown", undefined])(
    "still asks when the app state is %s (unknown can happen briefly at launch)",
    async (value) => {
      jest.useFakeTimers();
      await reachPerfectDay();
      await dismissWithAppState(value);
      expect(requestAppReview).toHaveBeenCalledTimes(1);
      expect(mockStore.markReviewPrompted).toHaveBeenCalledTimes(1);
    },
  );

  it("waits the full 600ms after dismissal before asking", async () => {
    jest.useFakeTimers();
    await reachPerfectDay();
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await act(async () => {
      jest.advanceTimersByTime(599);
    });
    expect(requestAppReview).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(requestAppReview).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending rating if the task is unchecked before the celebration ends", async () => {
    jest.useFakeTimers();
    const { rerender } = await reachPerfectDay();
    mockStore = makeStore({ tasks: threeTasks, todayCompletions: ["t0", "t1"], history });
    await rerender(<HomeScreen />);
    // The overlay is still up and may be dismissed afterwards; no rating follows.
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(requestAppReview).not.toHaveBeenCalled();
    expect(mockStore.markReviewPrompted).not.toHaveBeenCalled();
  });

  it("cancels a scheduled rating if the task is unchecked in the 600ms after dismissal", async () => {
    jest.useFakeTimers();
    const { rerender } = await reachPerfectDay();
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    mockStore = makeStore({ tasks: threeTasks, todayCompletions: ["t0", "t1"], history });
    await rerender(<HomeScreen />);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(requestAppReview).not.toHaveBeenCalled();
  });

  it("cancels the rating timer when the screen unmounts", async () => {
    jest.useFakeTimers();
    const { unmount } = await reachPerfectDay();
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(requestAppReview).not.toHaveBeenCalled();
  });

  it("celebrates but doesn't ask again within the cooldown", async () => {
    jest.useFakeTimers();
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
    await reachPerfectDay({ lastReviewPromptAt: recent });
    expect(screen.getByText("celebration-visible")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
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

describe("Brain dump entry", () => {
  it("sits next to the ideas entry, worded for an empty day", async () => {
    mockStore = makeStore();
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getByTestId("brain-dump-entry")).toHaveTextContent(/Brain dump everything/);
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
    await fireEvent.press(screen.getByTestId("brain-dump-entry"));
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
    [
      "the rollover modal needs the screen",
      {
        pendingRollover: {
          sourceDate: "2026-09-25",
          tasks: [
            {
              id: "x",
              text: "Old",
              completed: false,
              carriedOver: false,
              rolloverOutcome: "unresolved" as const,
            },
          ],
        },
      },
    ],
  ])("closes when %s", async (_why, overrides) => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("brain-dump-entry"));
    expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
    mockStore = makeStore({ tasks: tasks("Walk"), ...overrides });
    await rerender(<HomeScreen />);
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
  });

  it("closes from its close button without adding anything", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("brain-dump-entry"));
    await fireEvent.press(screen.getByRole("button", { name: "Close brain dump" }));
    expect(screen.queryByTestId("brain-dump-sheet")).toBeNull();
    expect(mockStore.addTasks).not.toHaveBeenCalled();
    expect(mockStore.parkTasks).not.toHaveBeenCalled();
  });
});

describe("Ideas sheet: parked items and Lock them in", () => {
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

  it("offers Lock them in once the list fills up, going through the lock confirmation", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch") });
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    mockStore = makeStore({ tasks: tasks("Walk", "Stretch", "Hydrate") });
    await rerender(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Lock them in" }));
    expect(mockStore.lockToday).not.toHaveBeenCalled();
    const [title, , buttons] = alert.mock.calls[0] as unknown as [
      string,
      string,
      { text: string; onPress?: () => void }[],
    ];
    expect(title).toBe("Lock in today?");
    await act(async () => buttons.find((b) => b.text === "Lock in")?.onPress?.());
    expect(mockStore.lockToday).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });
});

describe("Break it down", () => {
  it("isn't offered without an AI proxy", async () => {
    mockStore = makeStore({ tasks: tasks("Clean kitchen") });
    await render(<HomeScreen />);
    expect(screen.queryByText("Break it down")).toBeNull();
  });

  it("asks the AI with the task and goal, shows busy, then saves the steps", async () => {
    mockProxyUrl = "https://proxy.test/api/momentum/plan";
    const pending = deferred<string[]>();
    (requestBreakDown as jest.Mock).mockImplementation(() => pending.promise);
    mockStore = makeStore({
      tasks: tasks("Clean kitchen", "Walk"),
      momentumProfile: { ...buildInitialState().momentumProfile, goalTitle: "Tidy home" },
    });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Break down Clean kitchen" }));
    expect(requestBreakDown).toHaveBeenCalledWith({ task: "Clean kitchen", goalTitle: "Tidy home" });
    expect(screen.getByRole("button", { name: "Break down Clean kitchen" })).toBeDisabled();
    expect(screen.getByText("Breaking it down…")).toBeOnTheScreen();
    // One at a time: the other card's link is disabled (but not busy) meanwhile.
    expect(screen.getByRole("button", { name: "Break down Walk" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Break down Walk" })).not.toBeBusy();

    await act(async () => pending.resolve(["Clear counter", "Wipe"]));
    // Passes the text it was asked about, so an edit meanwhile drops the steps.
    expect(mockStore.setTaskSteps).toHaveBeenCalledWith(
      "t0",
      ["Clear counter", "Wipe"],
      "Clean kitchen",
    );
    expect(screen.getByRole("button", { name: "Break down Walk" })).toBeEnabled();
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
    mockStore = makeStore({ tasks: tasks("Clean kitchen") });
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
    mockStore = makeStore({ tasks: tasks("Clean kitchen", "Walk") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Break down Clean kitchen" }));
    await fireEvent.press(screen.getByRole("button", { name: "Break down Walk" }));
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

describe("perfect-day moment: once per day and one rating at a time", () => {
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

  it("doesn't replay the celebration (or ask again) when the third task is un-checked and re-checked", async () => {
    jest.useFakeTimers();
    mockStore = withToday(TODAY, { todayCompletions: ["t0", "t1"] });
    const { rerender } = await render(<HomeScreen />);
    mockStore = withToday(TODAY, { todayCompletions: ["t0", "t1", "t2"] });
    await rerender(<HomeScreen />);
    expect(screen.getByText("celebration-visible")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(requestAppReview).toHaveBeenCalledTimes(1);

    mockStore = withToday(TODAY, { todayCompletions: ["t0", "t1"] });
    await rerender(<HomeScreen />);
    mockStore = withToday(TODAY, { todayCompletions: ["t0", "t1", "t2"] });
    await rerender(<HomeScreen />);
    expect(screen.queryByText("celebration-visible")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(requestAppReview).toHaveBeenCalledTimes(1);
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

  it("doesn't queue a second rating while the first request is still in flight", async () => {
    jest.useFakeTimers();
    const review = deferred<boolean>();
    (requestAppReview as jest.Mock).mockImplementationOnce(() => review.promise);

    mockStore = withToday(TODAY, { todayCompletions: ["t0", "t1"] });
    const { rerender } = await render(<HomeScreen />);
    mockStore = withToday(TODAY, { todayCompletions: ["t0", "t1", "t2"] });
    await rerender(<HomeScreen />);
    // The store's callbacks are stable in the app; this mock store's instance is
    // the one the in-flight request closed over.
    const { markReviewPrompted } = mockStore;
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(requestAppReview).toHaveBeenCalledTimes(1);

    // A new perfect day arrives while the rating sheet is still up (e.g. past
    // midnight); lastReviewPromptAt hasn't been updated yet.
    mockStore = withToday("2026-09-27", { todayCompletions: ["t0", "t1"] });
    await rerender(<HomeScreen />);
    mockStore = withToday("2026-09-27", { todayCompletions: ["t0", "t1", "t2"] });
    await rerender(<HomeScreen />);
    expect(screen.getByText("celebration-visible")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "dismiss celebration" }));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(requestAppReview).toHaveBeenCalledTimes(1);

    await act(async () => review.resolve(true));
    expect(markReviewPrompted).toHaveBeenCalledTimes(1);
  });
});

// --- Phase 4: Plus gates for free users --------------------------------------

describe("Plus gates (free plan)", () => {
  it("Break it down opens the paywall right away instead of calling the AI, then runs once Plus is bought", async () => {
    jest.useFakeTimers();
    mockProxyUrl = "https://proxy.test/api/momentum/plan";
    (requestBreakDown as jest.Mock).mockResolvedValue(["Clear counter"]);
    const free = { ...makeStore({ tasks: tasks("Clean kitchen") }), hasPlus: false };
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

  it("brain dump uses the on-device split (no AI call) and offers Plus, which opens the paywall", async () => {
    jest.useFakeTimers();
    mockProxyUrl = "https://proxy.test/api/momentum/plan";
    mockStore = { ...makeStore(), hasPlus: false };
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("brain-dump-entry"));
    await fireEvent.changeText(screen.getByLabelText("Brain dump text"), "a\nb\nc\nd");
    expect(screen.getByTestId("brain-dump-upgrade")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: "Sort it for me" }));
    expect(sortBrainDump).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "A" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "D" })).not.toBeChecked();
    expect(screen.queryByTestId("brain-dump-notice")).toBeNull();

    // Back on the write step the offer is still there for next time; from a
    // fresh sheet, Get Plus closes it and opens the paywall.
    await fireEvent.press(screen.getByRole("button", { name: "Add 3 to today" }));
    await fireEvent.press(screen.getByTestId("brain-dump-entry"));
    await fireEvent.press(screen.getByRole("button", { name: "Get AI sorting with Plus" }));
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
    await fireEvent.press(screen.getByTestId("brain-dump-entry"));
    expect(screen.queryByTestId("brain-dump-upgrade")).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Brain dump text"), "a");
    await fireEvent.press(screen.getByRole("button", { name: "Sort it for me" }));
    expect(sortBrainDump).toHaveBeenCalledTimes(1);
  });
});
