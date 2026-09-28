// Today wiring for the Phase 9b first run (FirstRun replaced OnboardingModal).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { sortBrainDump } from "@/lib/daily-tasks/ai-helpers";
import { track } from "@/lib/daily-tasks/analytics";
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
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
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
  jest.useRealTimers();
  jest.clearAllMocks();
});

const FIRST_KEY = "daily-tasks/first-ai-sort-used";
const FREE_KEY = "daily-tasks/free-ai-dumps-used";
const sortedEvents = () =>
  (track as jest.Mock).mock.calls.filter(([name]) => name === "brain_dump_sorted").map(([, props]) => props);

/** Set the picks, skip the nudge, finish: back on an empty Today. */
async function finishFirstRun(label = "Set my three") {
  await fireEvent.press(button(label));
  await fireEvent.press(button("Not now"));
  await fireEvent.press(button("Done"));
  expect(screen.queryByTestId(/^first-run-/)).toBeNull();
}

async function openTodayBrainDump() {
  await fireEvent.press(screen.getByRole("button", { name: /What's on your mind today\?/ }));
  expect(screen.getByTestId("brain-dump-sheet")).toBeOnTheScreen();
}

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

  it("after Start over, the second sort uses one of the free Today AI sorts", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("walk");
    await fireEvent.press(button("Start over"));
    await dump("swim, bike");
    expect(sortBrainDump).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem("daily-tasks/free-ai-dumps-used")).toBe("1");
  });

  it("first-run sort already used (e.g. after Reset all data): a free Today sort is used instead", async () => {
    await AsyncStorage.setItem("daily-tasks/first-ai-sort-used", "2026-09-01T00:00:00.000Z");
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("swim, bike");
    expect(sortBrainDump).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem("daily-tasks/free-ai-dumps-used")).toBe("1");
  });

  it("no AI sorts left: the tidied simple split, and it says so", async () => {
    await AsyncStorage.setItem("daily-tasks/first-ai-sort-used", "2026-09-01T00:00:00.000Z");
    await AsyncStorage.setItem("daily-tasks/free-ai-dumps-used", "3");
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("need to swim\ndon't forget to bike!");
    expect(sortBrainDump).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "Swim" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Bike" })).toBeOnTheScreen();
    expect(screen.getByText(/free AI sorts are used up/)).toBeOnTheScreen();
  });

  it("with Plus, every first-run sort (Start over too) uses the AI and no free sort", async () => {
    await AsyncStorage.setItem("daily-tasks/first-ai-sort-used", "2026-09-01T00:00:00.000Z");
    mockStore = makeStore({}, { hasPlus: true });
    await render(<HomeScreen />);
    await dump("walk");
    await fireEvent.press(button("Start over"));
    await dump("swim, bike");
    expect(sortBrainDump).toHaveBeenCalledTimes(2);
    expect(await AsyncStorage.getItem("daily-tasks/free-ai-dumps-used")).toBeNull();
  });

  it("a free sort that falls back (AI unreachable) is given back", async () => {
    await AsyncStorage.setItem("daily-tasks/first-ai-sort-used", "2026-09-01T00:00:00.000Z");
    (sortBrainDump as jest.Mock).mockResolvedValueOnce({
      result: { picks: ["Swim"], parked: [], source: "local" },
      notice: "Couldn't reach smart sorting, so here's a simple split you can adjust.",
    });
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("swim");
    expect(await AsyncStorage.getItem("daily-tasks/free-ai-dumps-used")).toBe("0");
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

describe("Today: first run, AI sort accounting", () => {
  it("a free sort that hits the 12 s timeout is given back once (no double count) and shows the fallback copy", async () => {
    await AsyncStorage.setItem(FIRST_KEY, "2026-09-01T00:00:00.000Z");
    // One already used: a double refund would show 0, a missing refund 2.
    await AsyncStorage.setItem(FREE_KEY, "1");
    (sortBrainDump as jest.Mock).mockReturnValue(new Promise(() => {}));
    jest.useFakeTimers({ now: new Date(2026, 8, 26, 9, 0) });
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("swim, bike");
    expect(sortBrainDump).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(11_999);
    });
    expect(screen.queryByTestId("first-run-three")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByTestId("first-run-three")).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Swim" })).toBeOnTheScreen();
    expect(screen.getByText(/We couldn't sort this one, so here are the first few/)).toBeOnTheScreen();
    expect(screen.queryByText(/free AI sorts are used up/)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(await AsyncStorage.getItem(FREE_KEY)).toBe("1");
    expect(sortedEvents()).toEqual([{ source: "local", count: 2 }]);
  });

  it("the one-per-install first sort that times out doesn't touch the free Today sorts", async () => {
    (sortBrainDump as jest.Mock).mockReturnValue(new Promise(() => {}));
    jest.useFakeTimers({ now: new Date(2026, 8, 26, 9, 0) });
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("swim");
    await act(async () => {
      jest.advanceTimersByTime(12_000);
    });
    expect(screen.getByTestId("first-run-three")).toBeOnTheScreen();
    expect(await AsyncStorage.getItem(FIRST_KEY)).not.toBeNull();
    expect(await AsyncStorage.getItem(FREE_KEY)).toBeNull();
  });

  it("a Plus user uses the AI and never a free sort; the first-run claim is still made (no second one after a reset)", async () => {
    mockStore = makeStore({}, { hasPlus: true });
    await render(<HomeScreen />);
    await dump("walk");
    expect(sortBrainDump).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(FIRST_KEY)).not.toBeNull();
    expect(await AsyncStorage.getItem(FREE_KEY)).toBeNull();
  });

  it("a free sort used during first run says how many are left", async () => {
    await AsyncStorage.setItem(FIRST_KEY, "2026-09-01T00:00:00.000Z");
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("walk");
    expect(screen.getByText("Sorted by AI · 2 free sorts left.")).toBeOnTheScreen();
  });

  it("the Today sheet counts a free sort used during first run", async () => {
    await AsyncStorage.setItem(FIRST_KEY, "2026-09-01T00:00:00.000Z");
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("walk, call mum, report");
    await finishFirstRun();
    await openTodayBrainDump();
    expect(await screen.findByText("AI will sort this one. 2 free AI sorts left.")).toBeOnTheScreen();
  });

  it("the Today sheet still offers all 3 free sorts after a first-run free sort was given back", async () => {
    await AsyncStorage.setItem(FIRST_KEY, "2026-09-01T00:00:00.000Z");
    (sortBrainDump as jest.Mock).mockResolvedValueOnce({
      result: { picks: ["Swim"], parked: [], source: "local" },
      notice: "Couldn't reach smart sorting, so here's a simple split you can adjust.",
    });
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("swim");
    await finishFirstRun("Set this one");
    await openTodayBrainDump();
    expect(await screen.findByText("AI will sort this one. You have 3 free AI sorts to try.")).toBeOnTheScreen();
  });

  it("the first-run one-per-install sort doesn't reduce the Today sheet's free sorts", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("walk, call mum, report");
    await finishFirstRun();
    await openTodayBrainDump();
    expect(await screen.findByText("AI will sort this one. You have 3 free AI sorts to try.")).toBeOnTheScreen();
  });

  it("logs brain_dump_sorted with the source: ai, then local when no AI sorts are left", async () => {
    mockStore = makeStore();
    await render(<HomeScreen />);
    await dump("walk, call mum, report");
    expect(sortedEvents()).toEqual([{ source: "ai", count: 3 }]);
    await AsyncStorage.setItem(FREE_KEY, "3");
    await fireEvent.press(button("Start over"));
    await dump("need to swim\ndon't forget to bike!");
    expect(sortBrainDump).toHaveBeenCalledTimes(1);
    expect(sortedEvents()).toEqual([
      { source: "ai", count: 3 },
      { source: "local", count: 2 },
    ]);
  });
});
