// "One timer, on the task" (1.3, PR #74): Today with the REAL store. The
// Now bar is gone; the timed task's row carries the day's one timer as a pill
// (⏸/▶ and the time left) that pauses and resumes the store's session, its
// words open the focus screen, and at zero the check-in shows under that row.
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import { ActionSheetIOS, AppState as RNAppState, StyleSheet } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";

import HomeScreen from "@/app/(tabs)/index";
import { track } from "@/lib/daily-tasks/analytics";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, Task } from "@/lib/daily-tasks/types";

import { spyOnAnnouncements } from "./focus-harness";
import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusSessionNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
  requestNotificationPermission: jest.fn(async () => "granted"),
  syncNotifications: jest.fn(async () => {}),
  registerFocusCategory: jest.fn(async () => {}),
  subscribeFocusResponses: jest.fn(() => () => {}),
}));
jest.mock("@/lib/daily-tasks/navigation", () => ({ navigateToToday: jest.fn() }));
jest.mock("@/hooks/use-app-update", () => ({
  useAppUpdate: () => ({ update: null, dismiss: jest.fn() }),
}));
jest.mock("@/lib/daily-tasks/app-review", () => ({ requestAppReview: jest.fn(async () => false) }));
jest.mock("@/lib/daily-tasks/plus-context", () => ({
  usePlus: () => ({
    paywallEnabled: true,
    openPaywall: jest.fn(() => true),
    paywallSource: null,
    entitlementActive: false,
    purchaseCount: 0,
    winBackDue: false,
  }),
}));
jest.mock("@/lib/daily-tasks/analytics", () => ({
  ...jest.requireActual("@/lib/daily-tasks/analytics"),
  track: jest.fn(),
}));
jest.mock("@/components/daily-tasks/onboarding-modal", () => ({ OnboardingModal: () => null }));
jest.mock("@/components/daily-tasks/rollover-modal", () => ({ RolloverModal: () => null }));
jest.mock("@/components/daily-tasks/celebration-overlay", () => ({ CelebrationOverlay: () => null }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));

const TODAY = "2026-09-26";
const START = new Date(2026, 8, 26, 9, 0);
const NOW = START.getTime();
const MIN = 60_000;

const TASKS: Task[] = [
  { id: "t0", text: "Walk", createdAt: "", carriedOver: false, steps: [{ id: "s1", text: "Find the lead", done: false }] },
  { id: "t1", text: "Read", createdAt: "", carriedOver: false },
];

type Session = NonNullable<AppState["focusSession"]>;
function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    taskId: "t0",
    taskText: "Walk",
    stepText: null,
    date: TODAY,
    kind: "timer",
    durationMs: 10 * MIN,
    startedAt: NOW - 3 * MIN,
    endAt: NOW + 7 * MIN,
    pausedRemainingMs: null,
    status: "running",
    ...overrides,
  };
}

let said: () => string[];
let sheet: jest.SpyInstance;

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  jest.spyOn(RNAppState, "addEventListener").mockImplementation((() => ({ remove: () => {} })) as never);
  said = spyOnAnnouncements();
  sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

/** Today on the real store, from saved state (optionally with a session). */
async function openToday(focusSession: Session | null = null) {
  await AsyncStorage.setItem(
    "daily-tasks/state/v1",
    JSON.stringify({ ...buildInitialState(START), hasSeenOnboarding: true, tasks: TASKS, focusSession }),
  );
  await render(
    <DailyTasksProvider>
      <HomeScreen />
    </DailyTasksProvider>,
  );
  for (let i = 0; i < 6; i++) await act(async () => {});
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
const pill = () => screen.getByTestId("task-timer-running-t0");
const left = () => screen.getByTestId("task-timer-left-t0");
const words = (id: string) => screen.getByTestId(`task-words-${id}`, { includeHiddenElements: true });
const glyph = (name: keyof typeof Ionicons.glyphMap) => String.fromCodePoint(Ionicons.glyphMap[name] as number);
const focusOpened = () => (track as jest.Mock).mock.calls.filter((c) => c[0] === "focus_opened");

/** Starts a timer from a row's ▶ via its sheet. */
async function startFromRow(taskText: string, length: string) {
  await fireEvent.press(screen.getByRole("button", { name: `Start a timer: ${taskText}` }));
  const [options, pick] = sheet.mock.calls.at(-1) as [{ options: string[] }, (i: number) => void];
  await act(async () => pick(options.options.indexOf(length)));
  for (let i = 0; i < 3; i++) await act(async () => {});
}

describe("One timer, on the task (real store)", () => {
  it("a timer started from the row shows only as that row's pill (⏸ and time): no Now bar, no second clock", async () => {
    await openToday();
    await startFromRow("Walk", "5 minutes");
    expect(screen.queryByTestId("now-bar")).toBeNull();
    expect(screen.getByTestId("task-timer-pause-t0")).toHaveTextContent(glyph("pause"));
    expect(left()).toHaveTextContent("5:00");
    expect(pill().props.accessibilityLabel).toBe("Pause timer: Walk, 5 minutes left");
    // Exactly one countdown on Today.
    expect(screen.queryAllByText(/^\d+:\d\d/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Start a timer: Walk" })).toBeNull();
    // The cues hook still says the start, once.
    expect(said().filter((s) => s === "Timer started, 5 minutes")).toHaveLength(1);
  });

  it("the pill: a button with a 44pt target (30pt + hit slop), and its label in whole minutes", async () => {
    await openToday(session());
    const node = pill();
    expect(node.props.accessibilityRole).toBe("button");
    const style = StyleSheet.flatten(node.props.style);
    const slop = node.props.hitSlop as { top: number; bottom: number };
    expect(style.height + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(node.props.accessibilityValue).toEqual({ text: "Running" });
    await advance(30_000);
    // 6:30 left reads as 7 minutes (rounded up), never seconds.
    expect(left()).toHaveTextContent("6:30");
    expect(pill().props.accessibilityLabel).toBe("Pause timer: Walk, 7 minutes left");
  });

  it("tap pauses the store's session (▶, frozen time, Resume label, 'Paused'); tap again resumes and it counts down", async () => {
    await openToday(session());
    await fireEvent.press(pill());
    await act(async () => {});
    expect(screen.getByTestId("task-timer-play-t0")).toHaveTextContent(glyph("play"));
    expect(screen.queryByTestId("task-timer-pause-t0")).toBeNull();
    expect(left()).toHaveTextContent("7:00");
    expect(pill().props.accessibilityLabel).toBe("Resume timer: Walk, 7 minutes left");
    expect(said()).toContain("Paused");
    expect(pill().props.accessibilityValue).toEqual({ text: "Paused" });
    expect(screen.getByTestId("task-session-line-t0")).toHaveTextContent("Paused.");
    // Frozen while paused, and it never ends.
    await advance(10 * MIN);
    expect(left()).toHaveTextContent("7:00");
    expect(screen.queryByTestId("task-check-in-t0")).toBeNull();

    await fireEvent.press(pill());
    await act(async () => {});
    expect(said()).toContain("Resumed");
    expect(screen.getByTestId("task-timer-pause-t0")).toBeOnTheScreen();
    expect(pill().props.accessibilityLabel).toBe("Pause timer: Walk, 7 minutes left");
    await advance(2 * MIN);
    expect(left()).toHaveTextContent("5:00");
    // The pill never opens the focus screen while it runs.
    expect(screen.queryByTestId("focus-mode")).toBeNull();
  });

  it("the timed task's words open focus (source row_words); another row's words still open its menu; long press on the timed row opens the menu", async () => {
    await openToday(session());
    await fireEvent.press(words("t1"));
    expect(sheet).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    expect(focusOpened()).toEqual([]);

    await fireEvent(words("t0"), "longPress");
    expect(sheet).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("focus-mode")).toBeNull();

    await fireEvent.press(words("t0"));
    expect(sheet).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    expect(screen.getByTestId("focus-task-text")).toHaveTextContent("Walk");
    expect(focusOpened()).toEqual([["focus_opened", { source: "row_words" }]]);
  });

  it("VoiceOver: Open focus on the timed task's checkbox opens its focus screen; other rows have no such action", async () => {
    await openToday(session());
    const box = screen.getByRole("checkbox", { name: "Task 1: Walk" });
    expect(box.props.accessibilityActions).toContainEqual({ name: "openFocus", label: "Open focus" });
    const other = screen.getByRole("checkbox", { name: "Task 2: Read" });
    expect(other.props.accessibilityActions).not.toContainEqual({ name: "openFocus", label: "Open focus" });
    // A stray openFocus on another row does nothing.
    await fireEvent(other, "accessibilityAction", { nativeEvent: { actionName: "openFocus" } });
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    await fireEvent(box, "accessibilityAction", { nativeEvent: { actionName: "openFocus" } });
    expect(screen.getByTestId("focus-task-text")).toHaveTextContent("Walk");
  });

  it("time's up: bell in the pill (no tick), check-in under the row, said and felt once; 5 more restarts the pill, Done ticks the task and clears it", async () => {
    await openToday(session());
    await advance(7 * MIN + 1000);
    expect(screen.getByTestId("task-timer-times-up-t0")).toHaveTextContent(glyph("notifications-outline"));
    expect(within(pill()).queryByText(glyph("checkmark"))).toBeNull();
    expect(within(pill()).queryByText(glyph("checkmark-circle"))).toBeNull();
    expect(screen.queryByTestId("task-timer-left-t0")).toBeNull();
    const checkIn = within(within(screen.getByTestId("today-tasks")).getByTestId("task-check-in-t0"));
    expect(checkIn.getByTestId("task-check-in-title")).toHaveTextContent("Time's up.");
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(said().filter((s) => s === 'Time\'s up on "Walk".')).toHaveLength(1);
    await advance(MIN);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);

    await fireEvent.press(checkIn.getByRole("button", { name: "5 more minutes" }));
    await act(async () => {});
    expect(screen.queryByTestId("task-check-in-t0")).toBeNull();
    expect(left()).toHaveTextContent("5:00");

    await advance(5 * MIN + 1000);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    await fireEvent.press(within(screen.getByTestId("task-check-in-t0")).getByRole("button", { name: "Done" }));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(screen.getByRole("checkbox", { name: "Task 1: Walk" })).toBeChecked();
    expect(screen.queryByTestId("task-timer-running-t0")).toBeNull();
    expect(screen.queryByTestId("task-check-in-t0")).toBeNull();
  });

  it("time's up: Stop here clears the session and the row gets its ▶ back", async () => {
    await openToday(session({ status: "ended", endAt: NOW - 1000 }));
    await fireEvent.press(within(screen.getByTestId("task-check-in-t0")).getByRole("button", { name: "Stop here" }));
    await act(async () => {});
    expect(screen.queryByTestId("task-timer-running-t0")).toBeNull();
    expect(screen.queryByTestId("task-check-in-t0")).toBeNull();
    expect(screen.getByRole("button", { name: "Start a timer: Walk" })).toBeOnTheScreen();
    expect(screen.getByRole("checkbox", { name: "Task 1: Walk" })).not.toBeChecked();
  });

  it("a running starter on a step: 'Now: <step>' and 'Just start' under the words; at 5 its check-in's Keep going starts a 20-minute timer", async () => {
    await openToday(
      session({ kind: "starter", stepText: "Find the lead", durationMs: 5 * MIN, startedAt: NOW, endAt: NOW + 5 * MIN }),
    );
    const line = screen.getByTestId("task-session-line-t0");
    expect(line).toHaveTextContent(/Now: Find the lead/);
    expect(line).toHaveTextContent(/Just start\. You can stop after 5\./);
    await advance(5 * MIN + 1000);
    // At time's up the step stays; "Just start" goes.
    expect(screen.getByTestId("task-session-line-t0")).toHaveTextContent("Now: Find the lead");
    expect(screen.getByTestId("task-session-line-t0")).not.toHaveTextContent(/Just start/);
    const checkIn = within(screen.getByTestId("task-check-in-t0"));
    expect(checkIn.getByTestId("task-check-in-title")).toHaveTextContent("5 minutes in. Keep going?");
    expect(checkIn.queryByRole("button", { name: "5 more minutes" })).toBeNull();
    expect(checkIn.getByRole("button", { name: "Done" })).toBeOnTheScreen();
    expect(checkIn.getByRole("button", { name: "Stop here" })).toBeOnTheScreen();
    await fireEvent.press(checkIn.getByRole("button", { name: "Keep going" }));
    await act(async () => {});
    expect(screen.queryByTestId("task-check-in-t0")).toBeNull();
    expect(left()).toHaveTextContent("20:00");
    expect(pill().props.accessibilityLabel).toBe("Pause timer: Walk, 20 minutes left");
    // No longer a 5-minute starter: its "Just start" line is gone.
    expect(screen.queryByText(/Just start/)).toBeNull();
  });
});
