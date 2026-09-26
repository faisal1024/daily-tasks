import { Alert, AppState as RNAppState } from "react-native";
import { act, fireEvent, screen } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
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
  };
}

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
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

  it("says how many slots are open in the header while unlocked, and the bar speaks the same label", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    expect(screen.getByRole("progressbar")).toHaveAccessibilityValue({
      text: "0 of 1 done · 2 open",
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
    expect(message).toMatch(/unlock in Settings/);
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

  it("uses the new empty-slot copy, and 'Left open' once locked", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getAllByText("Add a task")).toHaveLength(2);
    expect(screen.getAllByText("Something you'll stand behind today.")).toHaveLength(2);

    mockStore = makeStore({ tasks: tasks("Walk"), todayLocked: true, todayLockSource: "manual" });
    await rerender(<HomeScreen />);
    expect(screen.queryByText("Add a task")).toBeNull();
    expect(screen.getAllByText("Left open")).toHaveLength(2);
    expect(screen.getAllByText("Today is set.")).toHaveLength(2);
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
