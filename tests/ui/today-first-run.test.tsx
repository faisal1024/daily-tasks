// Today wiring for the Phase 9b first run (FirstRun replaced OnboardingModal).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { sortBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

type MockStore = ReturnType<typeof makeStore>;
let mockStore: MockStore;

jest.mock("@/lib/daily-tasks/store", () => ({ useDailyTasks: () => mockStore }));
jest.mock("@/hooks/use-app-update", () => ({
  useAppUpdate: () => ({ update: null, dismiss: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/app-review", () => ({ requestAppReview: jest.fn(async () => true) }));
jest.mock("@/lib/daily-tasks/ai-helpers", () => ({
  ...jest.requireActual("@/lib/daily-tasks/ai-helpers"),
  sortBrainDump: jest.fn(),
}));
const mockOpenPaywall = jest.fn(() => true);
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({ paywallEnabled: true, openPaywall: mockOpenPaywall, paywallSource: null, purchaseCount: 0 }),
}));
// The old questionnaire must not come back on Today.
jest.mock("@/components/daily-tasks/onboarding-modal", () => {
  const { Text } = jest.requireActual("react-native");
  return { OnboardingModal: () => <Text>old-onboarding-modal</Text> };
});
jest.mock("@/components/daily-tasks/rollover-modal", () => ({ RolloverModal: () => null }));

function makeStore(overrides: Partial<AppState> = {}, extra: Record<string, unknown> = {}) {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 8, 26)),
    hasSeenOnboarding: false,
    ...overrides,
  };
  return {
    ready: true,
    state,
    today: "2026-09-26",
    completedCount: 0,
    remainingSlots: 3 - state.tasks.length,
    isCompleted: () => false,
    addTask: jest.fn(),
    addTasks: jest.fn(),
    editTask: jest.fn(),
    deleteTask: jest.fn(),
    toggleTask: jest.fn(),
    lockToday: jest.fn(),
    unlockToday: jest.fn(),
    resolveRollover: jest.fn(),
    markOnboardingSeen: jest.fn(),
    requestNotificationPermission: jest.fn(async () => "granted"),
    completeMomentumOnboarding: jest.fn(),
    setTodayReflection: jest.fn(),
    setTodayReflectionResult: jest.fn(),
    requestMomentumPlan: jest.fn(async () => {}),
    journeyLevel: 1,
    markReviewPrompted: jest.fn(),
    markReviewDue: jest.fn(),
    plusConfirmed: true,
    daysShowedUp: 0,
    setEveningClose: jest.fn(),
    applyTomorrowDraft: jest.fn(),
    dismissTomorrowDraft: jest.fn(),
    parkTasks: jest.fn(),
    removeParkedTask: jest.fn(),
    addParkedTask: jest.fn(),
    setTaskSteps: jest.fn(),
    toggleTaskStep: jest.fn(),
    clearTaskSteps: jest.fn(),
    hasPlus: false,
    ...extra,
  };
}

const button = (name: string) => screen.getByRole("button", { name });
const tasks = (...texts: string[]): Task[] =>
  texts.map((text, i) => ({ id: `t${i}`, text, createdAt: "", carriedOver: false }));
const ROLLOVER = { fromDate: "2026-09-25", tasks: [] } as unknown as AppState["pendingRollover"];

async function dump(text: string) {
  await fireEvent.changeText(screen.getByLabelText("What's on your mind today"), text);
  await fireEvent.press(button("Pick my three"));
}

beforeEach(async () => {
  await AsyncStorage.clear();
  (sortBrainDump as jest.Mock).mockResolvedValue({
    result: { picks: ["Walk", "Call mum", "Report"], parked: ["Groceries"], source: "ai" },
    notice: null,
  });
});

afterEach(() => {
  jest.clearAllMocks();
});

describe("Today: first run", () => {
  it("shows for a new user, not the old onboarding modal", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    expect(screen.getByTestId("first-run-dump")).toBeOnTheScreen();
    expect(screen.queryByText("old-onboarding-modal")).toBeNull();
  });

  it("doesn't show for a returning user", async () => {
    mockStore = makeStore({ hasSeenOnboarding: true });
    await render(<HomeScreen />);
    expect(screen.queryByTestId(/^first-run-/)).toBeNull();
    expect(screen.queryByText("old-onboarding-modal")).toBeNull();
  });

  it("first sort uses the AI; set adds the kept picks and parks the rest (onboarding not yet marked seen)", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("walk, call mum, report");
    expect(sortBrainDump).toHaveBeenCalledWith({ text: "walk, call mum, report", openSlots: 3, goalTitle: null });
    await fireEvent.press(screen.getByRole("checkbox", { name: "Report" }));
    await fireEvent.press(button("Set my two"));
    expect(mockStore.addTasks).toHaveBeenCalledWith(["Walk", "Call mum"]);
    expect(mockStore.parkTasks).toHaveBeenCalledWith(["Report", "Groceries"]);
    // Only finishing marks it seen, so a relaunch mid-way resumes.
    expect(mockStore.markOnboardingSeen).not.toHaveBeenCalled();
  });

  it("after Start over, the second sort is the simple on-device split (no second AI call)", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("walk");
    await fireEvent.press(button("Start over"));
    await dump("swim, bike");
    expect(sortBrainDump).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("checkbox", { name: "Swim" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Bike" })).toBeOnTheScreen();
  });

  it("the free AI sort is once per install: already claimed → on-device split", async () => {
    await AsyncStorage.setItem("daily-tasks/first-ai-sort-used", "2026-09-01T00:00:00.000Z");
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("swim, bike");
    expect(sortBrainDump).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Swim" })).toBeOnTheScreen();
  });

  it("finishing asks for notifications, marks onboarding seen, and offers the trial to a free user", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    await fireEvent.press(button("I'll add my own"));
    await fireEvent.press(button("Yes, nudge me"));
    expect(mockStore.requestNotificationPermission).toHaveBeenCalledTimes(1);
    // jest-expo runs as iOS: the widget step shows.
    await fireEvent.press(button("Done"));
    expect(mockStore.markOnboardingSeen).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(/^first-run-/)).toBeNull();
    await waitFor(() => expect(mockOpenPaywall).toHaveBeenCalledWith("onboarding"), { timeout: 2000 });
  });

  it("doesn't offer the trial to someone who already has Plus", async () => {
    mockStore = makeStore({}, { hasPlus: true });
    await render(<HomeScreen />);
    await fireEvent.press(button("I'll add my own"));
    await fireEvent.press(button("Not now"));
    await fireEvent.press(button("Done"));
    expect(mockStore.markOnboardingSeen).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });

  it("waits for a pending rollover before starting", async () => {
    mockStore = makeStore({ pendingRollover: ROLLOVER });
    await render(<HomeScreen />);
    expect(screen.queryByTestId(/^first-run-/)).toBeNull();
  });

  it("a relaunch with tasks already set resumes at the nudge", async () => {
    mockStore = makeStore({ tasks: tasks("Walk", "Swim") });
    await render(<HomeScreen />);
    expect(screen.getByTestId("first-run-nudge")).toBeOnTheScreen();
    expect(screen.getByText("Your two are set.")).toBeOnTheScreen();
  });

  it("hides for a rollover mid-flow, then comes back at the nudge", async () => {
    mockStore = makeStore();
    const { rerender } = await render(<HomeScreen />);
    await dump("walk, call mum, report");
    await fireEvent.press(button("Set my three"));
    const seen = mockStore.markOnboardingSeen;
    mockStore = makeStore({ tasks: tasks("Walk", "Call mum", "Report"), pendingRollover: ROLLOVER }, { markOnboardingSeen: seen });
    await rerender(<HomeScreen />);
    expect(screen.queryByTestId(/^first-run-/)).toBeNull();
    mockStore = makeStore({ tasks: tasks("Walk", "Call mum", "Report") }, { markOnboardingSeen: seen });
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("first-run-nudge")).toBeOnTheScreen();
    expect(screen.getByText("Your three are set.")).toBeOnTheScreen();
  });
});
