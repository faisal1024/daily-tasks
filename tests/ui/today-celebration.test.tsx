// The Today screen with the REAL CelebrationOverlay (fake timers): the overlay
// restarts its auto-dismiss timer whenever onDismiss changes identity, so the
// screen must pass a stable dismissCelebration or re-renders keep it on screen
// and delay the rating prompt.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";

import HomeScreen from "@/app/(tabs)/index";
import { requestAppReview } from "@/lib/daily-tasks/app-review";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, DayRecord, Task } from "@/lib/daily-tasks/types";

import { renderWithProviders as render } from "./render";

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
// Reanimated's jest mock returns a NEW shared value on every render, which would
// re-run the overlay's effect (and restart its timer) on every re-render for
// reasons that don't exist in the app. Give this file stable shared values, as
// the real library has, so only onDismiss's identity can restart the timer.
jest.mock("react-native-reanimated", () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- hoisted jest.mock factory */
  const mock = require("react-native-reanimated/mock");
  const { useRef } = require("react");
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    ...mock,
    // Not in the library's mock (tests/ui/setup.ts adds it too, but this factory replaces that one).
    useReducedMotion: () => false,
    useSharedValue: <T,>(init: T) => {
      const ref = useRef(null) as { current: { value: T } | null };
      if (!ref.current) ref.current = { value: init };
      return ref.current;
    },
  };
});
jest.mock("@/components/daily-tasks/onboarding-modal", () => ({ OnboardingModal: () => null }));
jest.mock("@/components/daily-tasks/rollover-modal", () => ({ RolloverModal: () => null }));

const TODAY = "2026-09-26";
// Matches CelebrationOverlay's DURATION.
const OVERLAY_MS = 2600;

const threeTasks: Task[] = ["Walk", "Stretch", "Hydrate"].map((text, i) => ({
  id: `t${i}`,
  text,
  createdAt: "",
  carriedOver: false,
}));

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

// Stable store callbacks, like the real provider's useCallback'd actions.
const actions = {
  addTask: jest.fn(),
  addTasks: jest.fn(),
  addSuggestions: jest.fn((texts: string[]) => texts.length),
  editTask: jest.fn(),
  deleteTask: jest.fn(),
  toggleTask: jest.fn(),
  lockToday: jest.fn(),
  noteOpenEdit: jest.fn(),
  resolveRollover: jest.fn(),
  completeMomentumOnboarding: jest.fn(),
  setTodayReflection: jest.fn(),
  setTodayReflectionResult: jest.fn(),
  requestMomentumPlan: jest.fn(async () => {}),
  markReviewPrompted: jest.fn(),
  markReviewDue: jest.fn(),
  unlockToday: jest.fn(),
  parkTasks: jest.fn(),
  removeParkedTask: jest.fn(),
  addParkedTask: jest.fn(),
  setTaskSteps: jest.fn(),
  toggleTaskStep: jest.fn(),
  clearTaskSteps: jest.fn(),
  claimCoachRequest: jest.fn(),
  setCoachNotes: jest.fn(),
  markCoachNoteLogged: jest.fn(),
  hasPlus: true,
};

function makeStore(overrides: Partial<AppState> = {}, journeyLevel = 4) {
  const state: AppState = {
    ...buildInitialState(new Date(2026, 8, 26)),
    hasSeenOnboarding: true,
    tasks: threeTasks,
    history: {
      "2026-09-20": perfectDay("2026-09-20"),
      "2026-09-21": perfectDay("2026-09-21"),
      "2026-09-22": perfectDay("2026-09-22"),
    },
    ...overrides,
  };
  return {
    ready: true,
    state,
    today: TODAY,
    completedCount: state.todayCompletions.length,
    remainingSlots: 3 - state.tasks.length,
    isCompleted: (id: string) => state.todayCompletions.includes(id),
    journeyLevel,
    ...actions,
  };
}

beforeEach(() => {
  // Pinned to a morning on TODAY: the lower section depends on the hour (1.2).
  jest.useFakeTimers({ now: new Date(2026, 8, 26, 9, 0) });
});

afterEach(() => {
  jest.useRealTimers();
  jest.clearAllMocks();
});

async function reachPerfectDay() {
  mockStore = makeStore({ todayCompletions: ["t0", "t1"] });
  const view = await render(<HomeScreen />);
  mockStore = makeStore({ todayCompletions: ["t0", "t1", "t2"] });
  await view.rerender(<HomeScreen />);
  return view;
}

describe("celebration with the real overlay", () => {
  it("auto-dismisses on schedule, marking a rating due instead of asking on top of it", async () => {
    await reachPerfectDay();
    expect(screen.getByText("All Done!")).toBeOnTheScreen();
    await act(async () => {
      jest.advanceTimersByTime(OVERLAY_MS);
    });
    expect(screen.queryByText("All Done!")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(actions.markReviewDue).toHaveBeenCalledTimes(1);
    expect(requestAppReview).not.toHaveBeenCalled();
  });

  it("re-renders while it's showing don't restart its auto-dismiss timer", async () => {
    const { rerender } = await reachPerfectDay();
    await act(async () => {
      jest.advanceTimersByTime(OVERLAY_MS - 600);
    });
    // Unrelated updates arrive (new state object, a level-up) while it's up.
    mockStore = makeStore({ todayCompletions: ["t0", "t1", "t2"] }, 5);
    await rerender(<HomeScreen />);
    mockStore = makeStore({ todayCompletions: ["t0", "t1", "t2"], lastOpenedDate: TODAY }, 5);
    await rerender(<HomeScreen />);
    expect(screen.getByText("All Done!")).toBeOnTheScreen();

    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(screen.queryByText("All Done!")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(actions.markReviewDue).toHaveBeenCalledTimes(1);
    expect(requestAppReview).not.toHaveBeenCalled();
  });

  it("with VoiceOver on, focus moves to the card after a moment, and it stays until the card is tapped", async () => {
    const reader = jest.spyOn(AccessibilityInfo, "isScreenReaderEnabled").mockResolvedValue(true);
    const focus = jest.spyOn(AccessibilityInfo, "sendAccessibilityEvent");
    const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    const announceQueued = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions");
    focus.mockClear();
    announce.mockClear();
    announceQueued.mockClear();
    try {
      await reachPerfectDay();
      // The card comes first and is the close button, labelled with what it says.
      const card = screen.getByTestId("celebration-card");
      expect(card).toHaveProp("accessibilityLabel", "All Done! Three for three. Nice work.");
      expect(card).toHaveProp("accessibilityHint", "Double-tap to close");
      expect(focus).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
      expect(focus).toHaveBeenCalledTimes(1);
      expect(focus.mock.calls[0][1]).toBe("focus");
      // On iOS the focus move reads the card: no separate announcement of it.
      const spoken = [...announce.mock.calls, ...announceQueued.mock.calls].map((call) => call[0]);
      expect(spoken).not.toContain("All Done! Three for three. Nice work.");
      await act(async () => {
        jest.advanceTimersByTime(OVERLAY_MS * 2);
      });
      expect(screen.getByText("All Done!")).toBeOnTheScreen();
      await fireEvent.press(card);
      expect(screen.queryByText("All Done!")).toBeNull();
    } finally {
      // These are react-native's own jest.fn mocks: put the "off" answer back
      // (mockRestore would leave them returning undefined).
      reader.mockImplementation(() => Promise.resolve(false));
      focus.mockClear();
      announce.mockClear();
      announceQueued.mockClear();
    }
  });

  it("tapping dismisses it immediately, and nothing is asked on top of it", async () => {
    await reachPerfectDay();
    await fireEvent.press(screen.getByLabelText("Dismiss"));
    expect(screen.queryByText("All Done!")).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(OVERLAY_MS * 2);
    });
    expect(requestAppReview).not.toHaveBeenCalled();
  });
});
