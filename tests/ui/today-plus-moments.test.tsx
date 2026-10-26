// Plus moments on Today (1.5, PR #102): the evening teaser for a free user, the
// honest free copy around the evening close, and the one free Break it down.
// Same harness as today-screen.test.tsx: a controllable store, no native side
// effects, the clock pinned (local-time dates, so every time zone agrees).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { requestBreakDown, sortBrainDump } from "@/lib/daily-tasks/ai-helpers";
import type { PlusTrial } from "@/lib/daily-tasks/plus";
import { closeDay } from "@/lib/daily-tasks/evening";
import { MomentumAiError } from "@/lib/daily-tasks/ai-status";
import { requestCoachNotes } from "@/lib/daily-tasks/coach-note";
import { addDays } from "@/lib/daily-tasks/date";
import { buildMilestoneIdeaGroup } from "@/lib/daily-tasks/milestone-ideas";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, Task } from "@/lib/daily-tasks/types";
import type { AhaPaywallState } from "@/lib/daily-tasks/aha-paywall";

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
  paywallEnabled?: boolean;
  paywallSource: string | null;
  entitlementActive: boolean;
  purchaseCount?: number;
  winBackDue?: boolean;
  winBackOfferPending?: boolean;
  checkWinBackOffer?: () => Promise<boolean>;
  trial?: PlusTrial | null;
  ahaPaywallState?: AhaPaywallState | null;
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
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
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

function makeStore(overrides: Partial<AppState> = {}) {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 8, 26)),
    hasSeenOnboarding: true,
    // The one-time reorder hint (1.4) has been shown, unless a test says otherwise.
    reorderHintSeen: true,
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
    addSuggestions: jest.fn((texts: string[]) => texts.length),
    editTask: jest.fn(),
    deleteTask: jest.fn(),
    notToday: jest.fn(),
    moveTask: jest.fn(),
    makeTaskNext: jest.fn(),
    markReorderHintSeen: jest.fn(),
    toggleTask: jest.fn(),
    lockToday: jest.fn(),
    noteOpenEdit: jest.fn(),
    resolveRollover: jest.fn(),
    completeMomentumOnboarding: jest.fn(),
    setTodayReflection: jest.fn(),
    setTodayReflectionResult: jest.fn(),
    requestMomentumPlan: jest.fn(async () => {}),
    journeyLevel: 4,
    markReviewPrompted: jest.fn(),
    markReviewDue: jest.fn(),
    clearReviewDue: jest.fn(),
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
    startFocusSession: jest.fn(),
    pauseFocusSession: jest.fn(),
    resumeFocusSession: jest.fn(),
    extendFocusSession: jest.fn(),
    keepGoingFocusSession: jest.fn(),
    stopFocusSession: jest.fn(),
    addRoutineToToday: jest.fn(() => true),
    addRoutine: jest.fn(() => "added"),
    canAddRoutine: true,
    updateRoutine: jest.fn(),
    setRoutinePaused: jest.fn(),
    removeRoutine: jest.fn(),
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


// --- Fixtures ----------------------------------------------------------------

const BREAK_DOWN_KEY = "daily-tasks/free-break-downs-used";
const PROXY = "https://proxy.test/api/momentum/plan";
const TOMORROW = addDays(TODAY, 1);
const ALL_TIMERS = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask", "nextTick"] as const;

/** The clock at `hour` on TODAY, faking only Date (the screen's own timers still run). */
const at = (hour: number): Parameters<typeof jest.useFakeTimers>[0] => ({
  now: new Date(2026, 8, 26, hour, 0),
  doNotFake: [...ALL_TIMERS],
});

/** The store with today's history synced to its tasks, as the reducer keeps it. */
function storeFor(overrides: Partial<AppState> = {}, extra: Record<string, unknown> = {}) {
  const base = makeStore(overrides);
  return { ...base, state: syncTodayHistory(base.state, TODAY), ...extra } as MockStore;
}

// Who is looking: a free user, Plus, and Plus whose RevenueCat check hasn't answered yet.
const FREE = { hasPlus: false, plusConfirmed: false, plusPending: false };
const PLUS = { hasPlus: true, plusConfirmed: true, plusPending: false };
const CHECKING = { hasPlus: true, plusConfirmed: false, plusPending: true };

const PARKED = [
  { id: "p1", text: "Call the dentist", parkedAt: "2026-09-25T10:00:00.000Z" },
  { id: "p2", text: "Water the plants", parkedAt: "2026-09-25T11:00:00.000Z" },
];
/** A perfect day, answered and closed, with nothing drafted for tomorrow. */
const PERFECT_CLOSED: Partial<AppState> = {
  tasks: tasks("Walk", "Read", "Stretch"),
  todayCompletions: ["t0", "t1", "t2"],
  todayReflectionResult: "good",
  eveningClose: { date: TODAY, result: "good", note: "A good day." },
  parkedTasks: PARKED,
};
/** Three tasks, two done, the day not closed yet. */
const OPEN_EVENING: Partial<AppState> = { tasks: tasks("Walk", "Read", "Stretch"), todayCompletions: ["t0", "t1"] };

const step = (id: string, title: string) => ({ id, title, description: "", completedAt: null });
const M1 = step("m1", "Run 1 km");
const PATH_PLAN = {
  id: "plan1",
  goalTitle: "Run a 5K",
  generatedAt: new Date(2026, 8, 26, 8).toISOString(),
  provider: "ai" as const,
  milestones: [M1, step("m2", "Run 3 km")],
  taskPool: [],
  todaySuggestions: [],
  promptSummary: "",
  version: 1,
};

const TOMORROW_CLOSE = {
  note: "A good day. You showed up.",
  because: "Picking up where today left off.",
  tomorrow: ["Stretch"],
  memory: null,
  source: "local" as const,
};

/** A text match that ignores what else is in the element (and any glyph beside it). */
const has = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const teaser = () => screen.queryByTestId("evening-teaser");

// --- The evening teaser ------------------------------------------------------

describe("Evening teaser for a free user (1.5)", () => {
  beforeEach(() => {
    jest.useFakeTimers(at(20));
    mockProxyUrl = PROXY;
  });

  it("shows on a closed perfect day: one real line, two shapes with no text, the Plus copy and button", async () => {
    mockStore = storeFor(PERFECT_CLOSED, FREE);
    await render(<HomeScreen />);
    const card = within(screen.getByTestId("evening-teaser"));
    // Review: the copy never suggests a draft already exists.
    expect(card.getByRole("header", { name: "Tomorrow could start with" })).toBeOnTheScreen();
    expect(card.getByTestId("evening-teaser-line")).toHaveTextContent("Call the dentist");
    expect(
      card.getByText("Plus drafts a full three each night, from how today went. Your three stay free either way."),
    ).toBeOnTheScreen();
    expect(card.getByRole("button", { name: "Have my coach draft tomorrow" })).toBeOnTheScreen();
    expect(screen.queryByText(/See all three|Tomorrow's three/)).toBeNull();

    // The placeholder lines are two empty shapes, hidden from VoiceOver (the body says what Plus does).
    const shapes = screen.getByTestId("evening-teaser-placeholders", { includeHiddenElements: true });
    expect(shapes.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(shapes.props.accessibilityElementsHidden).toBe(true);
    expect(shapes.children).toHaveLength(2);
    expect(within(shapes).queryAllByText(/./, { includeHiddenElements: true })).toHaveLength(0);
    // The second saved task is nowhere on the screen: it is not part of the teaser.
    expect(screen.queryByText(/Water the plants/)).toBeNull();
  });

  it.each<[string, () => MockStore, string]>([
    ["Plus", () => storeFor(PERFECT_CLOSED, PLUS), "Tomorrow starts fresh. Pick three when you're ready."],
    ["the Plus check is still pending", () => storeFor(PERFECT_CLOSED, CHECKING), "Tomorrow starts fresh. Pick three when you're ready."],
    [
      "the build has no paywall",
      () => {
        mockPaywall = { ...mockPaywall, paywallEnabled: false };
        return storeFor(PERFECT_CLOSED, FREE);
      },
      "Tomorrow starts fresh. Pick three when you're ready.",
    ],
    [
      "the day wasn't perfect",
      () =>
        storeFor(
          {
            ...OPEN_EVENING,
            todayReflectionResult: "hard",
            eveningClose: { date: TODAY, result: "hard", note: "A hard one." },
            parkedTasks: PARKED,
          },
          FREE,
        ),
      "Tomorrow starts fresh. Pick three when you're ready.",
    ],
    [
      "every task is done but there were only two",
      () => storeFor({ ...PERFECT_CLOSED, tasks: tasks("Walk", "Read"), todayCompletions: ["t0", "t1"] }, FREE),
      "Tomorrow starts fresh. Pick three when you're ready.",
    ],
    [
      "the close already drafted tomorrow",
      () =>
        storeFor(
          {
            ...PERFECT_CLOSED,
            tomorrowDraft: { forDate: TOMORROW, tasks: ["Stretch"], note: "", because: "", source: "local" },
          },
          FREE,
        ),
      "Tomorrow's three are ready",
    ],
    ["no line is available (nothing saved, no goal path)", () => storeFor({ ...PERFECT_CLOSED, parkedTasks: [] }, FREE), "Tomorrow starts fresh. Pick three when you're ready."],
  ])("is hidden when %s", async (_name, build, instead) => {
    mockStore = build();
    await render(<HomeScreen />);
    expect(teaser()).toBeNull();
    expect(screen.queryByRole("button", { name: "Have my coach draft tomorrow" })).toBeNull();
    expect(screen.getByTestId("evening-result")).toHaveTextContent(has(instead));
    // The saved-for-later task was never put on show.
    expect(screen.queryByText(/Call the dentist/)).toBeNull();
  });

  it("is not there before the day is closed", async () => {
    mockStore = storeFor({ ...PERFECT_CLOSED, eveningClose: null, todayReflectionResult: null }, FREE);
    await render(<HomeScreen />);
    expect(teaser()).toBeNull();
    expect(screen.getByText("How did today feel?")).toBeOnTheScreen();
  });

  it("the line comes from the oldest saved task first, then the built-in idea for tomorrow's date", async () => {
    mockStore = storeFor({ ...PERFECT_CLOSED, momentumPlan: PATH_PLAN }, FREE);
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getByTestId("evening-teaser-line")).toHaveTextContent(has("Call the dentist"));

    mockStore = storeFor({ ...PERFECT_CLOSED, parkedTasks: [], momentumPlan: PATH_PLAN }, FREE);
    await rerender(<HomeScreen />);
    const idea = buildMilestoneIdeaGroup({ milestones: PATH_PLAN.milestones, completedMilestoneIds: [], today: TOMORROW });
    expect(idea?.source).toBe("local");
    expect(screen.getByTestId("evening-teaser-line")).toHaveTextContent(has(idea!.ideas[0].text));
  });

  it("Have my coach draft tomorrow opens the paywall as evening_draft, without calling the AI", async () => {
    mockStore = storeFor(PERFECT_CLOSED, FREE);
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Have my coach draft tomorrow" }));
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
    expect(mockOpenPaywall).toHaveBeenCalledWith("evening_draft");
    expect(mockTrack).toHaveBeenCalledWith("plus_gate_hit", { feature: "evening_draft" });
    expect(closeDay).not.toHaveBeenCalled();
  });

  it("buying from the teaser closes the same day again with the AI coach; closing the paywall does not", async () => {
    jest.useFakeTimers({ now: new Date(2026, 8, 26, 20, 0) });
    (closeDay as jest.Mock).mockResolvedValue(TOMORROW_CLOSE);
    const free = storeFor(PERFECT_CLOSED, FREE);
    mockStore = free;
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Have my coach draft tomorrow" }));

    // The paywall shows and is closed without buying: nothing happens.
    mockPaywall = { paywallSource: "evening_draft", entitlementActive: false };
    await rerender(<HomeScreen />);
    mockPaywall = { paywallSource: null, entitlementActive: false };
    await rerender(<HomeScreen />);
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(closeDay).not.toHaveBeenCalled();

    // Again, and this time Plus is bought.
    await fireEvent.press(screen.getByRole("button", { name: "Have my coach draft tomorrow" }));
    mockPaywall = { paywallSource: "evening_draft", entitlementActive: false };
    await rerender(<HomeScreen />);
    mockPaywall = { paywallSource: null, entitlementActive: true };
    mockStore = { ...free, ...PLUS } as MockStore;
    await rerender(<HomeScreen />);
    expect(closeDay).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(700);
    });
    expect(closeDay).toHaveBeenCalledTimes(1);
    const [input, options] = (closeDay as jest.Mock).mock.calls[0];
    expect(input).toMatchObject({ result: "good" });
    expect(options).toEqual({ useAi: true });
    expect(mockStore.setEveningClose).toHaveBeenCalledWith(TOMORROW_CLOSE, TODAY, "good", expect.any(Number));
  });

  it.each([
    ["a free user", FREE, false],
    ["a user whose Plus check is still pending", CHECKING, false],
    ["a confirmed Plus user (control)", PLUS, true],
  ])("the evening close for %s asks the AI route only if Plus is confirmed", async (_name, who, useAi) => {
    (closeDay as jest.Mock).mockResolvedValue(TOMORROW_CLOSE);
    mockStore = storeFor(OPEN_EVENING, who);
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Today felt good" }));
    expect(closeDay).toHaveBeenCalledTimes(1);
    expect((closeDay as jest.Mock).mock.calls[0][1]).toEqual({ useAi });
  });
});

// --- Honest copy around the evening close -------------------------------------

describe("Free copy promises no coach draft (1.5)", () => {
  const COACH_CHECK_IN = "One tap and your coach drafts tomorrow's three. A note is optional.";
  const COACH_DONE = "Close the day below and your coach drafts tomorrow.";
  const COACH_TONIGHT = "Tonight, one tap closes the day and drafts tomorrow.";
  const PERFECT_OPEN: Partial<AppState> = {
    tasks: tasks("Walk", "Read", "Stretch"),
    todayCompletions: ["t0", "t1", "t2"],
  };
  const MIDDAY: Partial<AppState> = { tasks: tasks("Walk", "Read", "Stretch"), todayCompletions: ["t0"] };

  it("check-in card: a free user is told what the on-device close does; the coach line is for Plus with the AI", async () => {
    jest.useFakeTimers(at(20));
    mockProxyUrl = PROXY;
    mockStore = storeFor(OPEN_EVENING, FREE);
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getByText("One tap closes the day and carries what's open to tomorrow. A note is optional.")).toBeOnTheScreen();
    expect(screen.queryByText(COACH_CHECK_IN)).toBeNull();

    // A finished day has nothing to carry over.
    mockStore = storeFor(PERFECT_OPEN, FREE);
    await rerender(<HomeScreen />);
    expect(screen.getByText("One tap closes the day. A note is optional.")).toBeOnTheScreen();

    mockStore = storeFor(OPEN_EVENING, PLUS);
    await rerender(<HomeScreen />);
    expect(screen.getByText(COACH_CHECK_IN)).toBeOnTheScreen();

    // Plus, but this build has no AI proxy: the close is on the device, and the copy says so.
    mockProxyUrl = null;
    await rerender(<HomeScreen />);
    expect(screen.queryByText(COACH_CHECK_IN)).toBeNull();
    expect(screen.getByText("One tap closes the day and carries what's open to tomorrow. A note is optional.")).toBeOnTheScreen();
  });

  it("done card: 'Close the day below.' for free, the coach line for Plus with the AI", async () => {
    jest.useFakeTimers(at(20));
    mockProxyUrl = PROXY;
    mockStore = storeFor(PERFECT_OPEN, FREE);
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getByText("Close the day below.")).toBeOnTheScreen();
    expect(screen.queryByText(COACH_DONE)).toBeNull();

    mockStore = storeFor(PERFECT_OPEN, PLUS);
    await rerender(<HomeScreen />);
    expect(screen.getByText(COACH_DONE)).toBeOnTheScreen();
    expect(screen.queryByText("Close the day below.")).toBeNull();
  });

  it("'Tonight' line: one tap closes the day for free; 'and drafts tomorrow' only for Plus with the AI", async () => {
    jest.useFakeTimers(at(14));
    mockProxyUrl = PROXY;
    mockStore = storeFor(MIDDAY, FREE);
    const { rerender } = await render(<HomeScreen />);
    expect(screen.getByTestId("tonight-teaser")).toHaveTextContent(has("Tonight, one tap closes the day."));
    expect(screen.queryByText(COACH_TONIGHT)).toBeNull();

    mockStore = storeFor(MIDDAY, PLUS);
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("tonight-teaser")).toHaveTextContent(has(COACH_TONIGHT));

    mockProxyUrl = null;
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("tonight-teaser")).toHaveTextContent(has("Tonight, one tap closes the day."));
    expect(screen.queryByText(COACH_TONIGHT)).toBeNull();
  });
});

// --- One free Break it down --------------------------------------------------

describe("The free Break it down try (1.5)", () => {
  const freeStore = () => storeFor({ ...SET, tasks: tasks("Clean kitchen") }, FREE);
  const pressBreakDown = () => fireEvent.press(screen.getByRole("button", { name: "Break down Clean kitchen" }));

  beforeEach(() => {
    mockProxyUrl = PROXY;
  });

  it("runs without Plus, claims the try before asking the AI, and says so afterwards", async () => {
    let storedWhenAsked: string | null = "unset";
    (requestBreakDown as jest.Mock).mockImplementation(async () => {
      storedWhenAsked = await AsyncStorage.getItem(BREAK_DOWN_KEY);
      return ["Clear counter", "Wipe it"];
    });
    mockStore = freeStore();
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId("break-down-free-try")).toHaveTextContent(has("1 free try")));
    expect(screen.queryByTestId("break-down-plus")).toBeNull();
    await pressBreakDown();
    await waitFor(() => expect(mockStore.setTaskSteps).toHaveBeenCalledWith("t0", ["Clear counter", "Wipe it"], "Clean kitchen"));
    expect(storedWhenAsked).toBe("1");
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    expect(screen.getByTestId("today-toast")).toHaveTextContent(has("Steps added. That was your one free try."));
    expect(mockTrack).toHaveBeenCalledWith("break_down_used", { count: 2, source: "free_try" });
    // Spent: the badge is gone and the row shows Plus.
    expect(screen.queryByTestId("break-down-free-try")).toBeNull();
    expect(screen.getByTestId("break-down-plus")).toBeOnTheScreen();
  });

  it("gives the try back when the AI can't be reached, so the next tap tries again without the paywall", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    (requestBreakDown as jest.Mock).mockRejectedValueOnce(new MomentumAiError("unavailable", "offline"));
    mockStore = freeStore();
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId("break-down-free-try")).toBeOnTheScreen());
    await pressBreakDown();
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Couldn't break it down", expect.any(String)));
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(BREAK_DOWN_KEY)).toBe("0");
    await waitFor(() => expect(screen.getByTestId("break-down-free-try")).toHaveTextContent(has("1 free try")));

    (requestBreakDown as jest.Mock).mockResolvedValueOnce(["Clear counter"]);
    await pressBreakDown();
    await waitFor(() => expect(mockStore.setTaskSteps).toHaveBeenCalledWith("t0", ["Clear counter"], "Clean kitchen"));
    expect(requestBreakDown).toHaveBeenCalledTimes(2);
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("a 402 means the server has no try left: mark it used, say so, open the paywall, show no error", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    (requestBreakDown as jest.Mock).mockRejectedValue(new MomentumAiError("needs_plus", "Free limit reached"));
    mockStore = freeStore();
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId("break-down-free-try")).toBeOnTheScreen());
    await pressBreakDown();
    await waitFor(() => expect(mockOpenPaywall).toHaveBeenCalledWith("break_down"));
    expect(alert).not.toHaveBeenCalled();
    expect(screen.getByTestId("today-toast")).toHaveTextContent(has("Your free try was already used."));
    expect(await AsyncStorage.getItem(BREAK_DOWN_KEY)).toBe("1");
    await waitFor(() => expect(screen.getByTestId("break-down-plus")).toBeOnTheScreen());
    expect(screen.queryByTestId("break-down-free-try")).toBeNull();

    // The try is gone for good: the next tap goes straight to the paywall, no request.
    await pressBreakDown();
    expect(requestBreakDown).toHaveBeenCalledTimes(1);
    expect(mockOpenPaywall).toHaveBeenCalledTimes(2);
    alert.mockRestore();
  });

  it("is not a try for Plus: no badge, no claim, and it counts as Plus use", async () => {
    (requestBreakDown as jest.Mock).mockResolvedValue(["Clear counter"]);
    mockStore = storeFor({ ...SET, tasks: tasks("Clean kitchen") }, PLUS);
    await render(<HomeScreen />);
    expect(screen.queryByTestId("break-down-free-try")).toBeNull();
    expect(screen.queryByTestId("break-down-plus")).toBeNull();
    await pressBreakDown();
    await waitFor(() => expect(mockStore.setTaskSteps).toHaveBeenCalled());
    expect(await AsyncStorage.getItem(BREAK_DOWN_KEY)).toBeNull();
    expect(mockTrack).toHaveBeenCalledWith("break_down_used", { count: 1 });
    expect(screen.queryByTestId("today-toast")).toBeNull();
  });

  describe("from the timer's check-in (the starter path)", () => {
    const MIN = 60_000;
    const NOW = MORNING.getTime();
    const ended = () => ({
      id: "s1",
      taskId: "t0",
      taskText: "Walk",
      stepText: null,
      date: TODAY,
      kind: "timer" as const,
      durationMs: 10 * MIN,
      startedAt: NOW - 11 * MIN,
      endAt: NOW - 1000,
      pausedRemainingMs: null,
      status: "ended" as const,
    });

    it("Stuck? uses the free try, ends the timer, offers the 5-minute starter, and says it was the free try", async () => {
      const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
      (requestBreakDown as jest.Mock).mockResolvedValue(["Find the lead", "Put shoes on"]);
      mockStore = storeFor({ tasks: tasks("Walk", "Read"), focusSession: ended() }, FREE);
      await render(<HomeScreen />);
      await fireEvent.press(screen.getByRole("button", { name: "Stuck? Break it down" }));
      await waitFor(() => expect(alert).toHaveBeenCalledWith("Start with the first step?", expect.any(String), expect.any(Array)));
      expect(mockOpenPaywall).not.toHaveBeenCalled();
      expect(mockStore.stopFocusSession).toHaveBeenCalledWith("broken_down");
      expect(await AsyncStorage.getItem(BREAK_DOWN_KEY)).toBe("1");
      expect(screen.getByTestId("today-toast")).toHaveTextContent(has("Steps added. That was your one free try."));
      alert.mockRestore();
    });

    it("a 402 on the starter path keeps the timer and opens the paywall", async () => {
      (requestBreakDown as jest.Mock).mockRejectedValue(new MomentumAiError("needs_plus", "Free limit reached"));
      mockStore = storeFor({ tasks: tasks("Walk", "Read"), focusSession: ended() }, FREE);
      await render(<HomeScreen />);
      await fireEvent.press(screen.getByRole("button", { name: "Stuck? Break it down" }));
      await waitFor(() => expect(mockOpenPaywall).toHaveBeenCalledWith("break_down"));
      expect(await AsyncStorage.getItem(BREAK_DOWN_KEY)).toBe("1");
    });
  });
});

// --- Review fixes (PR #102) ---------------------------------------------------

describe("1.5 review fixes", () => {
  beforeEach(() => {
    mockProxyUrl = PROXY;
  });

  it("no teaser in a build that can't reach the AI evening coach", async () => {
    jest.useFakeTimers(at(20));
    mockProxyUrl = null;
    mockStore = storeFor(PERFECT_CLOSED, FREE);
    await render(<HomeScreen />);
    expect(teaser()).toBeNull();
    expect(screen.getByTestId("evening-result")).toHaveTextContent(has("Tomorrow starts fresh."));
  });

  it("'Drafting tomorrow…' only when the coach drafts; otherwise 'Closing the day…'", async () => {
    jest.useFakeTimers(at(20));
    (closeDay as jest.Mock).mockImplementation(() => new Promise(() => {}));
    mockStore = storeFor(OPEN_EVENING, FREE);
    const first = await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Today felt good" }));
    expect(screen.getByTestId("evening-closing")).toHaveTextContent(has("Closing the day…"));
    await first.unmount();

    mockStore = storeFor(OPEN_EVENING, PLUS);
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Today felt good" }));
    expect(screen.getByTestId("evening-closing")).toHaveTextContent(has("Drafting tomorrow…"));
  });

  it("while Plus is still being checked, the copy makes no coach promise", async () => {
    jest.useFakeTimers(at(20));
    mockStore = storeFor(OPEN_EVENING, CHECKING);
    await render(<HomeScreen />);
    expect(
      screen.getByText("One tap closes the day and carries what's open to tomorrow. A note is optional."),
    ).toBeOnTheScreen();
  });

  it("an AI close that falls back with nothing drafted offers Try again, which asks the coach again", async () => {
    jest.useFakeTimers(at(20));
    const fallback = { note: "A good day.", because: "", tomorrow: [], memory: null, source: "local" as const };
    (closeDay as jest.Mock).mockResolvedValue(fallback);
    const before = { ...PERFECT_CLOSED, todayReflectionResult: null, eveningClose: null };
    mockStore = storeFor(before, PLUS);
    const { rerender } = await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Today felt good" }));
    await act(async () => {});
    expect((closeDay as jest.Mock).mock.calls[0][1]).toEqual({ useAi: true });
    const { setEveningClose } = mockStore;
    mockStore = { ...storeFor(PERFECT_CLOSED, PLUS), setEveningClose } as MockStore;
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("evening-retry")).toHaveTextContent(has("Couldn't draft tomorrow."));
    await fireEvent.press(screen.getByRole("button", { name: "Try drafting tomorrow again" }));
    await act(async () => {});
    expect(closeDay).toHaveBeenCalledTimes(2);
    expect((closeDay as jest.Mock).mock.calls[1]).toEqual([expect.objectContaining({ result: "good" }), { useAi: true }]);
  });

  it("while Plus is pending, Break it down is the free try; confirmed Plus by the end gives it back, no toast", async () => {
    let resolve!: (steps: string[]) => void;
    (requestBreakDown as jest.Mock).mockImplementation(() => new Promise<string[]>((r) => (resolve = r)));
    mockStore = storeFor({ ...SET, tasks: tasks("Clean kitchen") }, CHECKING);
    const { rerender } = await render(<HomeScreen />);
    await act(async () => {});
    await fireEvent.press(screen.getByRole("button", { name: "Break down Clean kitchen" }));
    await waitFor(() => expect(requestBreakDown).toHaveBeenCalledTimes(1));
    expect(await AsyncStorage.getItem(BREAK_DOWN_KEY)).toBe("1");

    mockStore = { ...mockStore, ...PLUS } as MockStore;
    await rerender(<HomeScreen />);
    await act(async () => resolve(["Clear counter", "Wipe it"]));
    await waitFor(async () => expect(await AsyncStorage.getItem(BREAK_DOWN_KEY)).toBe("0"));
    expect(screen.queryByTestId("today-toast")).toBeNull();
    expect(mockTrack).toHaveBeenCalledWith("break_down_used", { count: 2 });
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });

  it("a 429 (the network's free tries are used today) gives the try back", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    (requestBreakDown as jest.Mock).mockRejectedValueOnce(new MomentumAiError("rate_limited", "Too many requests", 429));
    mockStore = storeFor({ ...SET, tasks: tasks("Clean kitchen") }, FREE);
    await render(<HomeScreen />);
    await waitFor(() => expect(screen.getByTestId("break-down-free-try")).toBeOnTheScreen());
    await fireEvent.press(screen.getByRole("button", { name: "Break down Clean kitchen" }));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Couldn't break it down", expect.any(String)));
    expect(mockOpenPaywall).not.toHaveBeenCalled();
    await waitFor(async () => expect(await AsyncStorage.getItem(BREAK_DOWN_KEY)).toBe("0"));
    alert.mockRestore();
  });
});

// --- 1.6 F: saved items due tomorrow lead tomorrow's draft (Plus) ------------

describe("1.6 F: the evening draft puts what is due tomorrow first", () => {
  const parkedAt = "2026-09-20T08:00:00.000Z";
  const due = (id: string, text: string, date = TOMORROW, kind: "on" | "by" = "on") => ({
    id,
    text,
    parkedAt,
    when: { date, kind },
  });
  const AI_CLOSE = {
    note: "A good day.",
    because: "Lighter tomorrow.",
    tomorrow: ["Stretch", "send  DECK", "Read"],
    memory: null,
    source: "ai" as const,
  };

  async function closeEvening(parkedTasks: AppState["parkedTasks"], who: Record<string, unknown>, close: unknown) {
    jest.useFakeTimers(at(20));
    mockProxyUrl = PROXY;
    (closeDay as jest.Mock).mockResolvedValue(close);
    mockStore = storeFor({ ...OPEN_EVENING, parkedTasks }, who);
    const view = await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Today felt good" }));
    await act(async () => {});
    return view;
  }
  const closed = () => (mockStore.setEveningClose as jest.Mock).mock.calls[0][0];

  it("due tomorrow first, each wording once, at most three, the coach's reason kept", async () => {
    await closeEvening(
      [
        due("p1", "Send deck"),
        due("p2", "Call mum", TOMORROW, "by"),
        due("p3", "Sign form"),
        due("p4", "Fourth one"),
        due("p5", "Not tomorrow", addDays(TODAY, 2)),
        due("p6", "Overdue", addDays(TODAY, -3)),
        { id: "p7", text: "Undated", parkedAt },
      ],
      PLUS,
      AI_CLOSE,
    );
    expect(closeDay).toHaveBeenCalledWith(expect.anything(), { useAi: true });
    expect(closed().tomorrow).toEqual(["Send deck", "Call mum", "Sign form"]);
    // The coach's picks were pushed out, so its line would describe a draft that isn't there (review fix).
    expect(closed().because).toBe("A few things you saved are for tomorrow.");
    expect(closed()).toMatchObject({ note: "A good day.", source: "ai" });
    expect(mockTrack).toHaveBeenCalledWith("evening_closed", { source: "ai", count: 3 });
  });

  it("the coach's own picks follow when there is room, without repeating a due one", async () => {
    await closeEvening([due("p1", "Send deck")], PLUS, AI_CLOSE);
    expect(closed().tomorrow).toEqual(["Send deck", "Stretch", "Read"]);
    // All of the coach's picks made it: its line stays.
    expect(closed().because).toBe("Lighter tomorrow.");
  });

  it("leaves the close untouched when nothing is due tomorrow", async () => {
    await closeEvening([due("p1", "Later", addDays(TODAY, 2)), due("p2", "Today's", TODAY)], PLUS, AI_CLOSE);
    expect(closed()).toBe(AI_CLOSE);
  });

  it("a failed AI close still gets the due items and a reason line, and still offers Try again (review fix)", async () => {
    const local = { note: "A good day.", because: "", tomorrow: [], memory: null, source: "local" as const };
    const { rerender } = await closeEvening([due("p1", "Send deck")], PLUS, local);
    expect(closed().tomorrow).toEqual(["Send deck"]);
    expect(closed().because).toBe("Something you saved is for tomorrow.");
    // evening_closed counts what the coach (here the on-device close) drafted, not the saved items.
    expect(mockTrack).toHaveBeenCalledWith("evening_closed", { source: "local", count: 0 });
    const { setEveningClose } = mockStore;
    mockStore = {
      ...storeFor(
        { ...PERFECT_CLOSED, parkedTasks: [due("p1", "Send deck")], tomorrowDraft: undefined },
        PLUS,
      ),
      setEveningClose,
    } as MockStore;
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("evening-retry")).toBeOnTheScreen();
  });

  it("with a draft of saved items, Try again says the coach couldn't add to it", async () => {
    const local = { note: "A good day.", because: "", tomorrow: [], memory: null, source: "local" as const };
    const { rerender } = await closeEvening([due("p1", "Send deck")], PLUS, local);
    const { setEveningClose } = mockStore;
    mockStore = {
      ...storeFor(
        {
          ...PERFECT_CLOSED,
          parkedTasks: [due("p1", "Send deck")],
          tomorrowDraft: { forDate: TOMORROW, tasks: ["Send deck"], note: "", because: "Something you saved is for tomorrow.", source: "local" },
        },
        PLUS,
      ),
      setEveningClose,
    } as MockStore;
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("evening-retry")).toHaveTextContent(/The coach couldn't add to it\./);
  });

  it("with two or more due and nothing else drafted, the reason line is plural", async () => {
    const local = { note: "A good day.", because: "", tomorrow: [], memory: null, source: "local" as const };
    await closeEvening([due("p1", "Send deck"), due("p2", "Call mum")], PLUS, local);
    expect(closed().tomorrow).toEqual(["Send deck", "Call mum"]);
    expect(closed().because).toBe("A few things you saved are for tomorrow.");
  });

  it("control: the same fallback with nothing due still offers Try again", async () => {
    const local = { note: "A good day.", because: "", tomorrow: [], memory: null, source: "local" as const };
    const { rerender } = await closeEvening([due("p1", "Later", addDays(TODAY, 2))], PLUS, local);
    const { setEveningClose } = mockStore;
    mockStore = { ...storeFor(PERFECT_CLOSED, PLUS), setEveningClose } as MockStore;
    await rerender(<HomeScreen />);
    expect(screen.getByTestId("evening-retry")).toBeOnTheScreen();
  });

  it("a free user's close is the on-device one: no AI, and nothing put in the draft", async () => {
    await closeEvening([due("p1", "Send deck")], FREE, TOMORROW_CLOSE);
    expect(closeDay).toHaveBeenCalledWith(expect.anything(), { useAi: false });
    expect(closed()).toBe(TOMORROW_CLOSE);
  });

  it("the morning card says 'For today' (a plan) or 'Due today' (a deadline) under a drafted saved item, and only there", async () => {
    mockStore = storeFor(
      {
        tasks: [],
        tomorrowDraft: { forDate: TODAY, tasks: ["Send deck", "Stretch", "Pay rent"], note: "", because: "", source: "ai" },
        parkedTasks: [
          due("p1", "send deck", TODAY),
          due("p2", "Stretch", addDays(TODAY, 10)),
          due("p3", "Pay rent", TODAY, "by"),
        ],
      },
      PLUS,
    );
    await render(<HomeScreen />);
    const reasons = screen.getAllByTestId("tomorrow-draft-reason");
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toHaveTextContent("For today");
    expect(reasons[1]).toHaveTextContent("Due today");
    expect(screen.getByRole("checkbox", { name: "Send deck, For today" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Pay rent, Due today" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Stretch" })).toBeOnTheScreen();
  });
});
