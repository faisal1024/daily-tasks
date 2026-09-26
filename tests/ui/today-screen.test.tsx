import { act, fireEvent, screen } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { requestAppReview } from "@/lib/daily-tasks/app-review";
import { buildInitialState } from "@/lib/daily-tasks/storage";
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
  const { Text } = jest.requireActual("react-native");
  return {
    CelebrationOverlay: ({ visible }: { visible: boolean }) =>
      visible ? <Text>celebration-visible</Text> : null,
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

  it("locks the day from the status line", async () => {
    mockStore = makeStore({ tasks: tasks("Walk") });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Lock in today's tasks" }));
    expect(mockStore.lockToday).toHaveBeenCalledTimes(1);
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
          { id: "a", text: "Run 1 mile", estimatedMinutes: 15, difficulty: "easy", reason: "", source: "ai" },
        ],
        promptSummary: "",
        version: 1,
      },
      momentumPlanStatus: "error",
      momentumPlanError: "busy",
    });
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("need-ideas"));
    expect(screen.getByText("Personalized for Run a 5K")).toBeOnTheScreen();
    expect(
      screen.getByText("Smart suggestions are taking a break for today. Your ideas below still work."),
    ).toBeOnTheScreen();
  });
});

describe("perfect-day moment", () => {
  const threeTasks = tasks("Walk", "Stretch", "Hydrate");
  const history = { "2026-09-20": perfectDay("2026-09-20"), "2026-09-21": perfectDay("2026-09-21"), "2026-09-22": perfectDay("2026-09-22") };

  it("does not celebrate or ask for a rating when the app opens on a finished day", async () => {
    mockStore = makeStore({ tasks: threeTasks, todayCompletions: ["t0", "t1", "t2"], history });
    await render(<HomeScreen />);
    expect(screen.queryByText("celebration-visible")).toBeNull();
    expect(mockStore.markReviewPrompted).not.toHaveBeenCalled();
  });

  it("celebrates when the third task is checked off, and asks for a rating when eligible", async () => {
    jest.useFakeTimers();
    mockStore = makeStore({ tasks: threeTasks, todayCompletions: ["t0", "t1"], history });
    const { rerender } = await render(<HomeScreen />);
    expect(screen.queryByText("celebration-visible")).toBeNull();

    mockStore = { ...mockStore, ...makeStore({ tasks: threeTasks, todayCompletions: ["t0", "t1", "t2"], history }) };
    await rerender(<HomeScreen />);
    expect(screen.getByText("celebration-visible")).toBeOnTheScreen();
    expect(mockStore.markReviewPrompted).toHaveBeenCalledTimes(1);

    // The system rating sheet waits for the celebration to land.
    expect(requestAppReview).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(requestAppReview).toHaveBeenCalledTimes(1);
  });

  it("celebrates but doesn't ask again within the cooldown", async () => {
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
    mockStore = makeStore({ tasks: threeTasks, todayCompletions: ["t0", "t1"], history, lastReviewPromptAt: recent });
    const { rerender } = await render(<HomeScreen />);
    mockStore = {
      ...mockStore,
      ...makeStore({
        tasks: threeTasks,
        todayCompletions: ["t0", "t1", "t2"],
        history,
        lastReviewPromptAt: recent,
      }),
    };
    await rerender(<HomeScreen />);
    expect(screen.getByText("celebration-visible")).toBeOnTheScreen();
    expect(mockStore.markReviewPrompted).not.toHaveBeenCalled();
  });
});
