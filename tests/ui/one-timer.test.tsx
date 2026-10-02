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
import { subscribeFocusResponses, type FocusNotificationResponse } from "@/lib/daily-tasks/notifications";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { buildInitialState } from "@/lib/daily-tasks/storage";
import type { AppState, Task } from "@/lib/daily-tasks/types";

import { spyOnAnnouncements } from "./focus-harness";
import { renderWithProviders as render } from "./render";

jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusSessionNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  dismissFocusTimerNotification: jest.fn(async () => {}),
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
    expect(pill().props.accessibilityLabel).toBe("Timer, 5 minutes left");
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
    expect(node.props.accessibilityHint).toBe("Pauses the timer.");
    await advance(30_000);
    // 6:30 left reads as 7 minutes (rounded up), never seconds.
    expect(left()).toHaveTextContent("6:30");
    expect(pill().props.accessibilityLabel).toBe("Timer, 7 minutes left");
  });

  it("tap pauses the store's session (▶, frozen time, Resume label, 'Paused'); tap again resumes and it counts down", async () => {
    await openToday(session());
    await fireEvent.press(pill());
    await act(async () => {});
    expect(screen.getByTestId("task-timer-play-t0")).toHaveTextContent(glyph("play"));
    expect(screen.queryByTestId("task-timer-pause-t0")).toBeNull();
    expect(left()).toHaveTextContent("7:00");
    expect(pill().props.accessibilityLabel).toBe("Timer paused, 7 minutes left");
    expect(said()).toContain("Paused");
    expect(pill().props.accessibilityHint).toBe("Resumes the timer.");
    expect(screen.getByTestId("task-session-line-t0")).toHaveTextContent("Paused.");
    // Frozen while paused, and it never ends.
    await advance(10 * MIN);
    expect(left()).toHaveTextContent("7:00");
    expect(screen.queryByTestId("task-check-in-t0")).toBeNull();

    await fireEvent.press(pill());
    await act(async () => {});
    expect(said()).toContain("Resumed");
    expect(screen.getByTestId("task-timer-pause-t0")).toBeOnTheScreen();
    expect(pill().props.accessibilityLabel).toBe("Timer, 7 minutes left");
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

  it("time's up: bell in the pill (no tick), check-in under the row, said and felt once; 5 more restarts the pill, ✓ Mark task done ticks the task and clears it", async () => {
    await openToday(session());
    await advance(7 * MIN + 1000);
    expect(screen.getByTestId("task-timer-times-up-t0")).toHaveTextContent(glyph("notifications-outline"));
    expect(within(pill()).queryByText(glyph("checkmark"))).toBeNull();
    expect(within(pill()).queryByText(glyph("checkmark-circle"))).toBeNull();
    expect(screen.queryByTestId("task-timer-left-t0")).toBeNull();
    const checkIn = within(within(screen.getByTestId("today-tasks")).getByTestId("task-check-in-t0"));
    expect(checkIn.getByTestId("task-check-in-title")).toHaveTextContent("Time's up.");
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(said().filter((s) => s === "Time's up on “Walk”. 5 more minutes, or take a break.")).toHaveLength(1);
    await advance(MIN);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);

    await fireEvent.press(checkIn.getByRole("button", { name: "5 more minutes" }));
    await act(async () => {});
    expect(screen.queryByTestId("task-check-in-t0")).toBeNull();
    expect(left()).toHaveTextContent("5:00");

    await advance(5 * MIN + 1000);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    await fireEvent.press(within(screen.getByTestId("task-check-in-t0")).getByRole("button", { name: "Mark task done" }));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(screen.getByRole("checkbox", { name: "Task 1: Walk" })).toBeChecked();
    expect(screen.queryByTestId("task-timer-running-t0")).toBeNull();
    expect(screen.queryByTestId("task-check-in-t0")).toBeNull();
  });

  it("time's up: Take a break clears the session (reported as a break), the task stays open and the row gets its ▶ back", async () => {
    await openToday(session({ status: "ended", endAt: NOW - 1000 }));
    const takeBreak = within(screen.getByTestId("task-check-in-t0")).getByRole("button", { name: "Take a break" });
    expect(takeBreak.props.accessibilityHint).toBe("Ends the timer. The task stays open.");
    await fireEvent.press(takeBreak);
    await act(async () => {});
    expect(track).toHaveBeenCalledWith("focus_session_ended", expect.objectContaining({ outcome: "break" }));
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
    expect(line).toHaveTextContent(/Just start\. You can stop after 5 minutes\./);
    await advance(5 * MIN + 1000);
    // At time's up the step stays; "Just start" goes.
    expect(screen.getByTestId("task-session-line-t0")).toHaveTextContent("Now: Find the lead");
    expect(screen.getByTestId("task-session-line-t0")).not.toHaveTextContent(/Just start/);
    const checkIn = within(screen.getByTestId("task-check-in-t0"));
    expect(checkIn.getByTestId("task-check-in-title")).toHaveTextContent("5 minutes in. Keep going?");
    expect(checkIn.queryByRole("button", { name: "5 more minutes" })).toBeNull();
    expect(checkIn.queryByRole("button", { name: "Done" })).toBeNull();
    expect(checkIn.getByRole("button", { name: "Stop for now" })).toBeOnTheScreen();
    expect(checkIn.queryByRole("button", { name: "Take a break" })).toBeNull();
    expect(checkIn.getByRole("button", { name: "Mark task done" })).toBeOnTheScreen();
    await fireEvent.press(checkIn.getByRole("button", { name: "Keep going" }));
    await act(async () => {});
    expect(screen.queryByTestId("task-check-in-t0")).toBeNull();
    expect(left()).toHaveTextContent("20:00");
    expect(pill().props.accessibilityLabel).toBe("Timer, 20 minutes left");
    // No longer a 5-minute starter: its "Just start" line is gone.
    expect(screen.queryByText(/Just start/)).toBeNull();
  });

  // PR #76: a starter's Take a break ends it, and the task stays open (it
  // was only the first five minutes).
  it("a starter reaching 5 on its row: Stop for now clears it (break, 5 min), the task stays open, nothing completed", async () => {
    await openToday(
      session({ kind: "starter", stepText: "Find the lead", durationMs: 5 * MIN, startedAt: NOW, endAt: NOW + 5 * MIN }),
    );
    await advance(5 * MIN + 1000);
    (track as jest.Mock).mockClear();
    const checkIn = within(screen.getByTestId("task-check-in-t0"));
    await fireEvent.press(checkIn.getByRole("button", { name: "Stop for now" }));
    for (let i = 0; i < 3; i++) await act(async () => {});
    const calls = (track as jest.Mock).mock.calls;
    expect(calls.filter((c) => c[0] === "focus_session_ended")).toEqual([
      ["focus_session_ended", { outcome: "break", minutes: 5 }],
    ]);
    expect(calls.filter((c) => c[0] === "focus_completed" || c[0] === "task_completed")).toEqual([]);
    expect(screen.queryByTestId("task-check-in-t0")).toBeNull();
    expect(screen.queryByTestId("task-timer-running-t0")).toBeNull();
    expect(screen.queryByTestId("task-session-line-t0")).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Task 1: Walk" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Start a timer: Walk" })).toBeOnTheScreen();
  });
  // R9 (1.3 polish): the timed task's long-press menu leads with its timer's
  // choices, and every sheet is tinted with the app's primary.
  it("long press on the timed task: Open focus, Pause timer, Stop timer first, then the row's actions, tinted", async () => {
    await openToday(session());
    await fireEvent(words("t0"), "longPress");
    const [options, pick] = sheet.mock.calls.at(-1) as [
      { options: string[]; tintColor?: string; cancelButtonIndex: number },
      (index: number) => void,
    ];
    expect(options.options.slice(0, 3)).toEqual(["Open focus", "Pause timer", "Stop timer"]);
    expect(options.options).toContain("Not today");
    expect(options.options.at(-1)).toBe("Cancel");
    expect(options.tintColor).toMatch(/^#/);
    await act(async () => pick(1));
    await act(async () => {});
    expect(pill().props.accessibilityHint).toBe("Resumes the timer.");
    // Like the pill: felt and said.
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(said()).toContain("Paused");
    // Paused: the menu offers Resume timer instead.
    await fireEvent(words("t0"), "longPress");
    const [paused, pickPaused] = sheet.mock.calls.at(-1) as [{ options: string[] }, (index: number) => void];
    expect(paused.options.slice(0, 3)).toEqual(["Open focus", "Resume timer", "Stop timer"]);
    await act(async () => pickPaused(2));
    await act(async () => {});
    expect(screen.queryByTestId("task-timer-running-t0")).toBeNull();
    expect(screen.getByRole("button", { name: "Start a timer: Walk" })).toBeOnTheScreen();
  });

  it("Not today on the timed task stops its timer and says so", async () => {
    await openToday(session());
    await fireEvent(words("t0"), "longPress");
    const [options, pick] = sheet.mock.calls.at(-1) as [{ options: string[] }, (index: number) => void];
    await act(async () => pick(options.options.indexOf("Not today")));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(screen.queryByTestId("task-timer-running-t0")).toBeNull();
    expect(said()).toContain("Saved for later. Timer stopped.");
  });

  // R2 (1.3 polish), revised: extend on the left (the solid lead), Take a
  // break next to it, and the quiet "✓ Mark task done" link under them.
  it("the timer's check-in: 5 more minutes (solid, the lead), Take a break (tint), then ✓ Mark task done; no Done or Stop here", async () => {
    await openToday(session({ status: "ended", endAt: NOW - 1000 }));
    const checkIn = within(screen.getByTestId("task-check-in-t0"));
    const buttons = checkIn.getAllByRole("button").map((button) => button.props.accessibilityLabel);
    expect(buttons).toEqual(["5 more minutes", "Take a break", "Mark task done"]);
    const takeBreak = StyleSheet.flatten(checkIn.getByRole("button", { name: "Take a break" }).props.style);
    const extend = StyleSheet.flatten(checkIn.getByRole("button", { name: "5 more minutes" }).props.style);
    // One emphasis rule at time's up: extend is the solid lead, as on the Live Activity.
    expect(extend.backgroundColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(takeBreak.backgroundColor).toMatch(/1F$/);
    expect(checkIn.getByRole("button", { name: "Mark task done" }).props.accessibilityHint).toBe("Ticks off Walk");
    // Time's up: the pill is the ring and bell alone, no outline.
    expect(StyleSheet.flatten(pill().props.style).borderWidth).toBe(0);
  });

  // R3 (1.3 polish): the ring shows what's left (it drains), like Clock and
  // the Live Activity.
  it("the pill's ring drains: it shows the time left, not the time gone", async () => {
    await openToday(session());
    // The filled arc's share: 1 - dashoffset / circumference.
    type Node = { props: Record<string, unknown>; children: (Node | string)[] };
    const arc = (node: Node): Node | null => {
      if (node.props.strokeDashoffset !== undefined) return node;
      for (const child of node.children) {
        if (typeof child === "string") continue;
        const found = arc(child);
        if (found) return found;
      }
      return null;
    };
    const filled = () => {
      const node = arc(pill() as unknown as Node)!;
      const dash = node.props.strokeDasharray;
      const circumference = Number(Array.isArray(dash) ? dash[0] : String(dash).split(/[ ,]/)[0]);
      return 1 - Number(node.props.strokeDashoffset) / circumference;
    };
    expect(filled()).toBeCloseTo(0.7, 3);
    await advance(2 * MIN);
    expect(filled()).toBeCloseTo(0.5, 3);
  });

  // R15 (1.3 polish): the pill's pause / resume is felt (a selection tick).
  it("tapping the pill to pause or resume gives a selection haptic each time", async () => {
    await openToday(session());
    (Haptics.selectionAsync as jest.Mock).mockClear();
    await fireEvent.press(pill());
    await act(async () => {});
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    await fireEvent.press(pill());
    await act(async () => {});
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(2);
  });

  // R4 (1.3 polish): paused, the row's line is just "Paused." (a starter's
  // "Just start" line goes with it), and comes back on resume.
  it("a paused starter's row line is only 'Paused.'; resumed, the starter line is back", async () => {
    await openToday(session({ kind: "starter", durationMs: 5 * MIN, startedAt: NOW, endAt: NOW + 5 * MIN }));
    const line = () => screen.getByTestId("task-session-line-t0");
    expect(line()).toHaveTextContent("Just start. You can stop after 5 minutes.", { exact: true });
    await fireEvent.press(pill());
    await act(async () => {});
    expect(line()).toHaveTextContent("Paused.", { exact: true });
    await fireEvent.press(pill());
    await act(async () => {});
    expect(line()).toHaveTextContent("Just start. You can stop after 5 minutes.", { exact: true });
  });

  // 1.3 polish (PR #82): the pill is one element, said once ("Timer, 7
  // minutes left" + a hint); no value repeating the state, no task words, and
  // nothing inside it read again. "Paused." under the words is hidden from
  // VoiceOver (the pill says it); a starter's line is still read.
  it("the pill's VoiceOver: label + hint (running and paused), no value, nothing inside it read again", async () => {
    await openToday(session());
    expect(pill().props.accessibilityLabel).toBe("Timer, 7 minutes left");
    expect(pill().props.accessibilityLabel).not.toMatch(/Walk/);
    expect(pill().props.accessibilityHint).toBe("Pauses the timer.");
    expect(pill().props.accessibilityValue?.text).toBeUndefined();
    // The pill is the accessible element, so iOS reads what's inside as part of it.
    expect(pill().props.accessible).toBe(true);
    // Only the pill answers to the timer's name.
    expect(screen.getAllByRole("button", { name: "Timer, 7 minutes left" })).toHaveLength(1);

    await fireEvent.press(pill());
    await act(async () => {});
    expect(pill().props.accessibilityLabel).toBe("Timer paused, 7 minutes left");
    expect(pill().props.accessibilityHint).toBe("Resumes the timer.");
    expect(pill().props.accessibilityValue?.text).toBeUndefined();
    expect(pill().props.accessible).toBe(true);
    expect(screen.getByTestId("task-timer-play-t0")).toBeTruthy();
    // "Paused." is on screen but not read: the pill already said it.
    const paused = screen.getByText("Paused.", { includeHiddenElements: true });
    expect(paused.props.accessibilityElementsHidden).toBe(true);
    expect(paused.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(screen.queryByText("Paused.")).toBeNull();
  });

  it("a running starter's line (and its step) is still read; only 'Paused.' is hidden", async () => {
    await openToday(
      session({ kind: "starter", stepText: "Find the lead", durationMs: 5 * MIN, startedAt: NOW, endAt: NOW + 5 * MIN }),
    );
    const starter = screen.getByText("Just start. You can stop after 5 minutes.");
    expect(starter.props.accessibilityElementsHidden).toBe(false);
    expect(starter.props.importantForAccessibility).toBe("auto");
    expect(screen.getByText("Now: Find the lead")).toBeOnTheScreen();
    await fireEvent.press(pill());
    await act(async () => {});
    expect(screen.queryByText("Paused.")).toBeNull();
    // The step stays readable while paused.
    expect(screen.getByText("Now: Find the lead")).toBeOnTheScreen();
  });

  it("at time's up the pill is one 'Time's up: <task>' button; its bell isn't an element of its own", async () => {
    await openToday(session());
    await advance(7 * MIN + 1000);
    expect(pill().props.accessibilityLabel).toBe("Time's up: Walk");
    expect(pill().props.accessibilityHint).toBe("Opens focus");
    expect(pill().props.accessible).toBe(true);
    expect(screen.getAllByRole("button", { name: "Time's up: Walk" })).toHaveLength(1);
  });

  // R8 (1.3 polish): the timed row stays calm: no "Clear steps" (the focus
  // screen has the steps), and its bottom padding tightens while the
  // check-in shows.
  it("the timed row hides Clear steps (back once the timer stops) and tightens its bottom padding at time's up", async () => {
    await openToday(session());
    expect(screen.getByText("Find the lead")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Clear steps" })).toBeNull();
    const padding = () => StyleSheet.flatten(screen.getByTestId("task-row-t0").props.style).paddingBottom;
    expect(padding()).toBeUndefined();
    await advance(7 * MIN + 1000);
    expect(padding()).toBe(8);
    await fireEvent.press(within(screen.getByTestId("task-check-in-t0")).getByRole("button", { name: "Take a break" }));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(screen.queryByTestId("task-timer-running-t0")).toBeNull();
    expect(padding()).toBeUndefined();
    expect(screen.getByRole("button", { name: "Clear steps" })).toBeOnTheScreen();
  });

  // R20 (1.3 polish): a tap on the "Time's up" notification itself, with its
  // check-in due, opens that session's focus screen.
  it("a tap on the notification with the check-in due opens that task's focus screen (source notification)", async () => {
    let respond: ((response: FocusNotificationResponse) => void) | null = null;
    (subscribeFocusResponses as jest.Mock).mockImplementation((listener: (r: FocusNotificationResponse) => void) => {
      respond = listener;
      return () => {};
    });
    await openToday(session({ status: "ended", startedAt: NOW - 10 * MIN, endAt: NOW - 1000 }));
    expect(screen.queryByTestId("focus-mode")).toBeNull();
    await act(async () => respond!({ action: "open", sessionId: "s1" }));
    for (let i = 0; i < 3; i++) await act(async () => {});
    expect(screen.getByTestId("focus-mode")).toBeOnTheScreen();
    expect(screen.getByTestId("focus-task-text")).toHaveTextContent("Walk");
    expect(focusOpened()).toEqual([["focus_opened", { source: "notification" }]]);
  });
});
