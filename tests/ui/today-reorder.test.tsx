// Reordering on Today with the REAL store (1.4, PR #90; principal tester).
// The rows, the drag hook, the reducer and storage together: "Up next", the
// coach's note, the widget's snapshot and the focus link follow the new first
// open task; a timer stays on its task; a set day stays set; the order and
// the one-time hint survive a relaunch; and nothing is logged, said or saved
// for a reorder that didn't happen.
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AccessibilityInfo, ActionSheetIOS, AppState as RNAppState, Keyboard, StyleSheet } from "react-native";
import { act, fireEvent, screen, within } from "@testing-library/react-native";
import { getByGestureTestId } from "react-native-gesture-handler/jest-utils";

import HomeScreen from "@/app/(tabs)/index";
import { DROP_SWAP_DELAY_MS } from "@/components/daily-tasks/task-reorder";
import { track } from "@/lib/daily-tasks/analytics";
import { localCoachLine, requestCoachNotes } from "@/lib/daily-tasks/coach-note";
import { planFocusStart } from "@/lib/daily-tasks/focus-link";
import { syncTodayHistory } from "@/lib/daily-tasks/rollover";
import { DailyTasksProvider } from "@/lib/daily-tasks/store";
import { __resetStorageForTests, buildInitialState } from "@/lib/daily-tasks/storage";
import { DEFAULT_AUTO_LOCK, type AppState, type Task } from "@/lib/daily-tasks/types";
import { writeWidgetSnapshot } from "@/lib/daily-tasks/widget-bridge";
import type { WidgetSnapshot } from "@/lib/daily-tasks/widget-snapshot";

import { spyOnAnnouncements } from "./focus-harness";
import { renderWithProviders as render } from "./render";

// A drop's settle (withTiming) can be held open: the row's copy stays in the air.
const mockTiming = { hold: false, held: [] as (() => void)[] };

// As in task-reorder.test.tsx: shared values that are kept for the component's
// life (the library's mock makes new ones every render; the drag's gesture is
// made once and outlives every re-render).
jest.mock("react-native-reanimated", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
  const { useRef } = require("react");
  return {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted jest.mock factory
    ...require("react-native-reanimated/mock"),
    useReducedMotion: jest.fn(() => false),
    useSharedValue: <T,>(initial: T) => useRef({ value: initial }).current,
    withTiming: (toValue: number, _config?: unknown, callback?: (finished: boolean) => void) => {
      if (callback) {
        if (mockTiming.hold) mockTiming.held.push(() => callback(true));
        else callback(true);
      }
      return toValue;
    },
  };
});
jest.mock("@/lib/daily-tasks/widget-bridge", () => ({
  invalidateFocusSession: jest.fn(),
  readFocusCommands: jest.fn(() => ({ raw: null, processedSeq: 0 })),
  markFocusCommandsProcessed: jest.fn(),
  readFocusStartRequest: jest.fn(() => ({ raw: null, handledId: null })),
  markFocusStartRequestHandled: jest.fn(),
  focusSessionJson: jest.fn((session: object, rev: number) => JSON.stringify({ v: 1, rev, ...session })),
  writeWidgetSnapshot: jest.fn(),
  writeFocusSession: jest.fn(),
  invalidateWidgetSnapshot: jest.fn(),
  readWidgetToggles: jest.fn(() => ({ raw: null, processedSeq: 0 })),
  markWidgetTogglesProcessed: jest.fn(),
}));
jest.mock("@/lib/daily-tasks/notifications", () => ({
  scheduleFocusSessionNotification: jest.fn(async () => {}),
  cancelFocusTimerNotification: jest.fn(async () => {}),
  dismissFocusTimerNotification: jest.fn(async () => {}),
  getNotificationPermissionStatus: jest.fn(async () => "granted"),
  requestNotificationPermission: jest.fn(async () => "granted"),
  syncNotifications: jest.fn(async () => {}),
  registerFocusCategory: jest.fn(async () => {}),
  registerNagCategory: jest.fn(async () => {}),
  subscribeNagResponses: jest.fn(() => () => {}),
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
jest.mock("@/lib/daily-tasks/coach-note", () => ({
  ...jest.requireActual("@/lib/daily-tasks/coach-note"),
  requestCoachNotes: jest.fn(async () => {
    throw new Error("no proxy in tests");
  }),
}));
jest.mock("@/components/daily-tasks/onboarding-modal", () => ({ OnboardingModal: () => null }));
jest.mock("@/components/daily-tasks/rollover-modal", () => ({ RolloverModal: () => null }));
jest.mock("@/components/daily-tasks/celebration-overlay", () => ({ CelebrationOverlay: () => null }));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));
const PHONE = { width: 390, height: 844, scale: 3, fontScale: 1 };
let mockWindow = PHONE;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => mockWindow,
}));

const TODAY = "2026-10-10";
// Local time, mid-morning (the coach's note shows; nowhere near midnight).
const START = new Date(2026, 9, 10, 9, 0);
const NOW = START.getTime();
const MIN = 60_000;
const KEY = "daily-tasks/state/v1";

const WALK: Task = { id: "t0", text: "Walk", createdAt: "", carriedOver: false };
const STRETCH: Task = { id: "t1", text: "Stretch", createdAt: "", carriedOver: false };
const HYDRATE: Task = { id: "t2", text: "Hydrate", createdAt: "", carriedOver: false };
const THREE = [WALK, STRETCH, HYDRATE];
const SET = { todayLocked: true, todayLockSource: "manual" as const, todayLockedAt: new Date(2026, 9, 10, 8).toISOString() };

type Session = NonNullable<AppState["focusSession"]>;
const session = (taskId: string, taskText: string): Session => ({
  id: "s1",
  taskId,
  taskText,
  stepText: null,
  date: TODAY,
  kind: "timer",
  durationMs: 10 * MIN,
  startedAt: NOW - 3 * MIN,
  endAt: NOW + 7 * MIN,
  pausedRemainingMs: null,
  status: "running",
});

let said: () => string[];
let sheet: jest.SpyInstance;
let errors: jest.SpyInstance;

beforeEach(async () => {
  jest.useFakeTimers({ now: START });
  jest.spyOn(RNAppState, "addEventListener").mockImplementation((() => ({ remove: () => {} })) as never);
  said = spyOnAnnouncements();
  sheet = jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
  errors = jest.spyOn(console, "error").mockImplementation(() => {});
  mockTiming.hold = false;
  mockTiming.held = [];
  mockWindow = PHONE;
  __resetStorageForTests();
  await AsyncStorage.clear();
});

afterEach(() => {
  // Nothing in these flows may log an error (a state update after unmount, a bad key...).
  // (Not ours: under the reanimated mock the library's own swipe row, in every
  // TaskRow with or without a handle, is told its callbacks are a mix of worklets.)
  const logged = errors.mock.calls.filter(([message]) => !/Some of the callbacks in the gesture are worklets/.test(String(message)));
  expect(logged).toEqual([]);
  jest.useRealTimers();
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

const flush = async (times = 6) => {
  for (let i = 0; i < times; i++) await act(async () => {});
};
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });
/** Past everything a reorder leaves easing: the "Up next" swap, then its layout pass, then the focus timer. */
async function settle() {
  await advance(DROP_SWAP_DELAY_MS + 1);
  await advance(400);
  await advance(400);
  await flush(2);
}

/** Save a day the app could have written (today's record mirrors the list). */
async function save(saved: Partial<AppState> & { raw?: (state: AppState) => object } = {}) {
  const { raw, ...rest } = saved;
  const state: AppState = syncTodayHistory(
    {
      ...buildInitialState(START),
      hasSeenOnboarding: true,
      reorderHintSeen: true,
      autoLock: { ...DEFAULT_AUTO_LOCK, enabled: false },
      tasks: THREE,
      ...rest,
    },
    TODAY,
  );
  await AsyncStorage.setItem(KEY, JSON.stringify(raw ? raw(state) : state));
}
async function launch() {
  const view = await render(
    <DailyTasksProvider>
      <HomeScreen />
    </DailyTasksProvider>,
  );
  await flush();
  return view;
}
/** Today on the real store, from saved state. */
async function openToday(saved: Parameters<typeof save>[0] = {}) {
  await save(saved);
  return launch();
}
/** Quit and open again: only what was saved comes back. */
async function relaunch() {
  await flush();
  await screen.unmount();
  __resetStorageForTests();
  return launch();
}
const savedState = async (): Promise<AppState> => JSON.parse((await AsyncStorage.getItem(KEY)) ?? "{}");
const savedOrder = async () => {
  const state = await savedState();
  return state.tasks.map((task) => (state.todayCompletions.includes(task.id) ? `${task.text}✓` : task.text)).join(" ");
};
const lastSnapshot = (): WidgetSnapshot => {
  const calls = (writeWidgetSnapshot as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
};

const hidden = { includeHiddenElements: true };
/** The task rows' checkboxes as VoiceOver meets them, top to bottom: "Up next. Task 1: Walk" ... */
const rows = () =>
  screen
    .queryAllByRole("checkbox")
    .map((node) => `${node.props.accessibilityLabel}${node.props.accessibilityState?.checked ? " ✓" : ""}`)
    .filter((label) => /Task \d: /.test(label));
const box = (text: string) => screen.getByRole("checkbox", { name: new RegExp(`Task \\d: ${text}`) });
const actionsOf = (text: string) =>
  (box(text).props.accessibilityActions as { name: string }[])
    .map((action) => action.name)
    .filter((name) => ["doNext", "moveUp", "moveDown"].includes(name));
const a11y = (text: string, actionName: string) =>
  act(async () => {
    fireEvent(box(text), "accessibilityAction", { nativeEvent: { actionName } });
  });
const handleOf = (id: string) => screen.queryByTestId(`task-drag-${id}`, hidden);
const ghost = () => screen.queryByTestId("task-drag-ghost", hidden);
/** A row's menu, opened from its words: its labels and a way to pick one. */
async function menuOf(id: string) {
  sheet.mockClear();
  await fireEvent.press(screen.getByTestId(`task-words-${id}`, hidden));
  if (sheet.mock.calls.length === 0) return { options: [] as string[], pick: async () => {} };
  const [{ options }, callback] = sheet.mock.calls[0] as [{ options: string[] }, (index: number) => void];
  return { options, pick: (label: string) => act(async () => callback(options.indexOf(label))) };
}
const reorderEvents = () => (track as jest.Mock).mock.calls.filter(([event]) => event === "task_reordered");
const impacts = () => (Haptics.impactAsync as jest.Mock).mock.calls.length;
const ticks = () => (Haptics.selectionAsync as jest.Mock).mock.calls.length;

/** Lay the rows out as they stand: 40pt each, a hairline between (the wrapper holds the hairline). */
async function layOut() {
  await act(async () => {
    screen.getAllByTestId(/^task-slot-/, hidden).forEach((slot, index) => {
      const gap = index > 0 ? 1 : 0;
      slot.props.onLayout({ nativeEvent: { layout: { x: 0, y: index * 41 - gap, width: 390, height: 40 + gap } } });
    });
  });
}
const pan = (id: string) => getByGestureTestId(`task-drag-pan-${id}`);
async function pickUp(id: string) {
  await layOut();
  const gesture = pan(id);
  await act(async () => {
    gesture.handlers.onBegin?.({} as never);
    gesture.handlers.onStart?.({ translationY: 0 } as never);
  });
  return gesture;
}
const dragBy = (gesture: ReturnType<typeof pan>, dy: number) =>
  act(async () => gesture.handlers.onUpdate?.({ translationY: dy } as never));
const letGo = (gesture: ReturnType<typeof pan>, success = true) =>
  act(async () => gesture.handlers.onFinalize?.({} as never, success));
/**
 * Pick a row up by its handle, carry it `rows` rows up (-) or down (rows are
 * 41pt apart; a done row in the way is a row to cross too) and let go.
 */
async function drag(id: string, rows: number, success = true) {
  const gesture = await pickUp(id);
  expect(ghost()).not.toBeNull();
  await dragBy(gesture, rows * 41);
  await letGo(gesture, success);
  expect(ghost()).toBeNull();
}

describe("Today, real store: what says 'next' follows a reorder", () => {
  it("Do this next on a set day: 'Up next', the coach's note, the saved list, the widget and the focus link all move to it", async () => {
    await openToday(SET);
    expect(rows()).toEqual(["Up next. Task 1: Walk", "Task 2: Stretch", "Task 3: Hydrate"]);
    expect(screen.getByTestId("coach-note-start")).toHaveTextContent(localCoachLine("start", "Walk", TODAY));
    expect(screen.getAllByText("Up next", hidden)).toHaveLength(1);

    const menu = await menuOf("t2");
    // A set day: reordering is the row's one choice.
    expect(menu.options).toEqual(["Do this next", "Cancel"]);
    await menu.pick("Do this next");
    await settle();

    expect(rows()).toEqual(["Up next. Task 1: Hydrate", "Task 2: Walk", "Task 3: Stretch"]);
    expect(screen.getAllByText("Up next", hidden)).toHaveLength(1);
    expect(screen.getByTestId("coach-note-start")).toHaveTextContent(localCoachLine("start", "Hydrate", TODAY));
    expect(screen.getByRole("button", { name: "Start: Hydrate" })).toBeOnTheScreen();
    expect(said()).toContain("Hydrate is next");

    const saved = await savedState();
    expect(await savedOrder()).toBe("Hydrate Walk Stretch");
    expect(saved.history[TODAY].tasks.map((task) => task.text)).toEqual(["Hydrate", "Walk", "Stretch"]);
    expect(lastSnapshot().tasks.map((task) => task.text)).toEqual(["Hydrate", "Walk", "Stretch"]);
    expect(planFocusStart(saved)).toEqual({ type: "start", taskId: "t2" });
    // Still set, exactly as it was.
    expect(saved).toMatchObject(SET);
    expect(screen.getByTestId("status-line").props.accessibilityLabel).toBe("Today is set. 3 to go.");
    // The built-in line only: a move never asks the coach again.
    expect(requestCoachNotes).not.toHaveBeenCalled();
    expect(reorderEvents()).toEqual([["task_reordered", { source: "next" }]]);
  });

  it("a drag around a done task: the done row keeps its slot, 'Up next' follows just after the drop", async () => {
    await openToday({ todayCompletions: ["t1"] });
    // Something is ticked, so the first open task is the hero.
    expect(rows()).toEqual(["Up next. Task 1: Walk", "Task 2: Stretch ✓", "Task 3: Hydrate"]);
    expect(handleOf("t1")).toBeNull();

    const gesture = await pickUp("t2");
    await dragBy(gesture, -82);
    // In the air over the first place: nothing has changed yet, anywhere.
    expect(rows()).toEqual(["Up next. Task 1: Walk", "Task 2: Stretch ✓", "Task 3: Hydrate"]);
    expect(await savedOrder()).toBe("Walk Stretch✓ Hydrate");
    await letGo(gesture);
    // The drop's own render: the new order, with the old row still looking "next" (nothing changes height).
    expect(rows()).toEqual(["Task 1: Hydrate", "Task 2: Stretch ✓", "Up next. Task 3: Walk"]);
    await settle();
    expect(rows()).toEqual(["Up next. Task 1: Hydrate", "Task 2: Stretch ✓", "Task 3: Walk"]);

    expect(await savedOrder()).toBe("Hydrate Stretch✓ Walk");
    expect(lastSnapshot().tasks).toEqual([
      { id: "t2", text: "Hydrate", done: false },
      { id: "t1", text: "Stretch", done: true },
      { id: "t0", text: "Walk", done: false },
    ]);
    expect(planFocusStart(await savedState())).toEqual({ type: "start", taskId: "t2" });
    expect(said()).toContain("Hydrate is next");
    expect(reorderEvents()).toEqual([["task_reordered", { source: "drag" }]]);
    // Midday-style note (one done): about the new next task.
    expect(screen.getByTestId("coach-note-momentum")).toHaveTextContent(localCoachLine("momentum", "Hydrate", TODAY));
  });

  describe("Do this next, chosen in a menu that was opened before the list changed underneath", () => {
    const nextSaid = () => said().filter((text) => /is next|Moved/.test(text));

    it("the task was ticked meanwhile (a widget tick): nothing moves, nothing is tracked, nothing is said", async () => {
      await openToday();
      const menu = await menuOf("t2");
      expect(menu.options).toContain("Do this next");
      // Hydrate is ticked while its menu is still up.
      await fireEvent.press(box("Hydrate"));
      await settle();
      const hapticsBefore = impacts();
      await menu.pick("Do this next");
      await settle();
      expect(rows()).toEqual(["Up next. Task 1: Walk", "Task 2: Stretch", "Task 3: Hydrate ✓"]);
      expect(await savedOrder()).toBe("Walk Stretch Hydrate✓");
      expect(reorderEvents()).toEqual([]);
      expect(nextSaid()).toEqual([]);
      expect(impacts()).toBe(hapticsBefore);
    });

    it("the task became next another way meanwhile: counted and said once, not twice", async () => {
      await openToday();
      const menu = await menuOf("t2");
      await a11y("Hydrate", "doNext");
      await settle();
      expect(reorderEvents()).toEqual([["task_reordered", { source: "next" }]]);
      expect(nextSaid()).toEqual(["Hydrate is next"]);
      await menu.pick("Do this next");
      await settle();
      expect(await savedOrder()).toBe("Hydrate Walk Stretch");
      expect(reorderEvents()).toEqual([["task_reordered", { source: "next" }]]);
      expect(nextSaid()).toEqual(["Hydrate is next"]);
    });

    it("midnight passed with the menu up: the store turns the day, and no move is counted or said", async () => {
      await openToday();
      const menu = await menuOf("t2");
      jest.setSystemTime(new Date(2026, 9, 11, 0, 0, 10));
      await menu.pick("Do this next");
      await flush();
      expect(reorderEvents()).toEqual([]);
      expect(nextSaid()).toEqual([]);
      // Yesterday's order was not touched on the way out.
      expect((await savedState()).history[TODAY].tasks.map((task) => task.text)).toEqual(["Walk", "Stretch", "Hydrate"]);
    });

    it("nothing changed underneath: it still moves, is counted and is said", async () => {
      await openToday();
      const menu = await menuOf("t2");
      await flush();
      await menu.pick("Do this next");
      await settle();
      expect(await savedOrder()).toBe("Hydrate Walk Stretch");
      expect(reorderEvents()).toEqual([["task_reordered", { source: "next" }]]);
      expect(nextSaid()).toEqual(["Hydrate is next"]);
    });
  });

  it("ticking the new next task off hands 'Up next' to the one behind it in the NEW order", async () => {
    await openToday(SET);
    await a11y("Hydrate", "doNext");
    await settle();
    await fireEvent.press(box("Hydrate"));
    await settle();
    expect(rows()).toEqual(["Task 1: Hydrate ✓", "Up next. Task 2: Walk", "Task 3: Stretch"]);
    expect(planFocusStart(await savedState())).toEqual({ type: "start", taskId: "t0" });
    // Two open rows left: the first can only go down, the second only become next.
    expect(actionsOf("Walk")).toEqual(["moveDown"]);
    expect(actionsOf("Stretch")).toEqual(["doNext"]);
    expect(actionsOf("Hydrate")).toEqual([]);
  });
});

describe("Today, real store: a set day", () => {
  it("drag, Do this next and VoiceOver's moves all work, and the day is exactly as set afterwards", async () => {
    await openToday({ ...SET, todayCompletions: ["t1"] });
    const before = await savedState();

    // Past the done row and the open one below it.
    await drag("t0", 2);
    await settle();
    expect(await savedOrder()).toBe("Hydrate Stretch✓ Walk");
    await a11y("Walk", "doNext");
    await settle();
    expect(await savedOrder()).toBe("Walk Stretch✓ Hydrate");
    await a11y("Walk", "moveDown");
    await settle();
    expect(await savedOrder()).toBe("Hydrate Stretch✓ Walk");

    const after = await savedState();
    expect(after).toMatchObject(SET);
    expect(after.todayCompletions).toEqual(["t1"]);
    expect(after.history[TODAY]).toMatchObject({ locked: true, lockSource: "manual", total: 3, completed: 1 });
    // Only the order differs.
    expect({ ...after, tasks: [], history: {} }).toEqual({ ...before, tasks: [], history: {} });
    expect([...after.tasks].sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.tasks);
    expect(reorderEvents().map(([, props]) => props.source)).toEqual(["drag", "next", "move"]);
  });

  it("nothing else the lock forbids comes with it: no edit, delete, Not today or add, from any row's menu, action or swipe", async () => {
    await openToday(SET);
    await a11y("Hydrate", "doNext");
    await settle();
    await drag("t0", 1);
    await settle();
    expect(await savedOrder()).toBe("Hydrate Stretch Walk");
    const set = await savedState();

    for (const id of ["t0", "t1", "t2"]) {
      const { options } = await menuOf(id);
      for (const label of ["Edit", "Delete", "Not today", "Move up", "Move down"]) expect(options).not.toContain(label);
    }
    for (const node of screen.getAllByRole("checkbox", hidden)) {
      const names = ((node.props.accessibilityActions ?? []) as { name: string }[]).map((action) => action.name);
      for (const name of ["edit", "delete", "notToday"]) expect(names).not.toContain(name);
      // Asked for anyway (a stale VoiceOver rotor): nothing.
      for (const name of ["edit", "delete", "notToday"]) {
        await act(async () => {
          fireEvent(node, "accessibilityAction", { nativeEvent: { actionName: name } });
        });
      }
    }
    expect(screen.queryByTestId(/^row-actions-/, hidden)).toBeNull();
    expect(screen.queryByLabelText(/^Add task/, hidden)?.props.accessibilityState?.disabled ?? true).toBe(true);
    await flush();
    const still = await savedState();
    expect(still.tasks).toEqual(set.tasks);
    expect(still).toMatchObject(SET);
    expect(still.parkedTasks).toEqual(set.parkedTasks);
  });

  it("the first open row on a set day has no reorder choice of its own; its handle still drags", async () => {
    await openToday(SET);
    expect((await menuOf("t0")).options).toEqual([]);
    expect(actionsOf("Walk")).toEqual(["moveDown"]);
    expect(handleOf("t0")).not.toBeNull();
    await drag("t0", 2);
    await settle();
    expect(rows()).toEqual(["Up next. Task 1: Stretch", "Task 2: Hydrate", "Task 3: Walk"]);
  });
});

describe("Today, real store: a timer stays on its task", () => {
  const pill = (id: string) => screen.queryByTestId(`task-timer-running-${id}`);

  it("another task made next, then the timed task dragged: the pill and the session stay with the task", async () => {
    await openToday({ ...SET, focusSession: session("t0", "Walk") });
    expect(within(screen.getByTestId("task-row-t0")).getByTestId("task-timer-left-t0")).toHaveTextContent("7:00");
    const running = (await savedState()).focusSession;

    await a11y("Hydrate", "doNext");
    await settle();
    expect(rows()).toEqual(["Up next. Task 1: Hydrate", "Task 2: Walk", "Task 3: Stretch"]);
    expect(within(screen.getByTestId("task-row-t0")).getByTestId("task-timer-running-t0")).toBeOnTheScreen();
    expect(pill("t2")).toBeNull();
    expect(pill("t1")).toBeNull();

    // The timed task itself, by its handle.
    await drag("t0", 1);
    await settle();
    expect(rows()).toEqual(["Up next. Task 1: Hydrate", "Task 2: Stretch", "Task 3: Walk"]);
    expect(within(screen.getByTestId("task-row-t0")).getByTestId("task-timer-running-t0")).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^task-timer-running-/)).toHaveLength(1);
    const now = (await savedState()).focusSession;
    expect(now).toEqual(running);
    expect(now).toMatchObject({ taskId: "t0", status: "running", endAt: NOW + 7 * MIN });
    // "Start my next task" asks about the new next one; it never replaces Walk's timer.
    expect(planFocusStart(await savedState())).toEqual({ type: "confirm", taskId: "t2" });
    // The clock kept running through it all: the row mounted by the drop ticks on.
    await advance(1000);
    expect(screen.getByTestId("task-timer-left-t0")).toHaveTextContent(/^6:5\d$/);
  });

  it("the timed row in the air: a copy with a stopped clock and no ids of its own, over an invisible real row", async () => {
    await openToday({ ...SET, focusSession: session("t0", "Walk") });
    const testIds = () => screen.queryAllByTestId(/./, hidden).map((node) => node.props.testID as string);
    const atRest = testIds().sort();
    expect(new Set(atRest).size).toBe(atRest.length);

    const gesture = await pickUp("t0");
    const copy = ghost()!;
    expect(copy).not.toBeNull();
    // The whole screen: the same ids as at rest, plus the copy's one wrapper. Nothing twice.
    const inAir = testIds();
    expect(new Set(inAir).size).toBe(inAir.length);
    expect(inAir.sort()).toEqual([...atRest, "task-drag-ghost"].sort());
    // It looks like the row (words, time left), is for looking at only, and VoiceOver skips it.
    expect(within(copy).getByText("Walk", hidden)).toBeTruthy();
    expect(within(copy).getByText("7:00", hidden)).toBeTruthy();
    expect(copy.props.pointerEvents).toBe("none");
    expect(copy.props.accessibilityElementsHidden).toBe(true);
    expect(copy.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(screen.getAllByRole("checkbox").filter((node) => /Walk/.test(node.props.accessibilityLabel))).toHaveLength(1);
    // The real row is still mounted, in place, invisible.
    expect(StyleSheet.flatten(screen.getByTestId("task-slot-t0", hidden).props.style).opacity).toBe(0);
    expect(StyleSheet.flatten(screen.getByTestId("task-slot-t1", hidden).props.style).opacity).toBeUndefined();

    // Five seconds in the air: the real clock ticks, the copy's doesn't.
    await advance(5000);
    expect(screen.getByTestId("task-timer-left-t0", hidden)).toHaveTextContent("6:55");
    expect(within(ghost()!).getByText("7:00", hidden)).toBeTruthy();
    expect(within(ghost()!).queryByText("6:55", hidden)).toBeNull();

    await dragBy(gesture, 82);
    await letGo(gesture);
    await settle();
    expect(ghost()).toBeNull();
    // As at rest, less the coach's Open button: the note is about Stretch now,
    // and the timer is on Walk (that row has it).
    expect(testIds().sort()).toEqual(atRest.filter((id) => id !== "coach-note-start-button"));
    expect(atRest).toContain("coach-note-start-button");
    expect(StyleSheet.flatten(screen.getByTestId("task-slot-t0", hidden).props.style).opacity).toBeUndefined();
    expect(await savedOrder()).toBe("Stretch Hydrate Walk");
    expect((await savedState()).focusSession).toMatchObject({ taskId: "t0", status: "running" });
  });
});

describe("Today, real store: the order survives a relaunch", () => {
  it("a drag, quit, open: the same order, the same 'Up next'; then Do this next, quit, open again", async () => {
    await openToday({ todayCompletions: ["t1"] });
    await drag("t2", -2);
    await settle();
    await relaunch();
    expect(rows()).toEqual(["Up next. Task 1: Hydrate", "Task 2: Stretch ✓", "Task 3: Walk"]);

    await a11y("Walk", "doNext");
    await settle();
    await relaunch();
    expect(rows()).toEqual(["Up next. Task 1: Walk", "Task 2: Stretch ✓", "Task 3: Hydrate"]);
    expect(await savedOrder()).toBe("Walk Stretch✓ Hydrate");
    // The relaunched screen drags from the saved order.
    await drag("t0", 2);
    await settle();
    expect(await savedOrder()).toBe("Hydrate Stretch✓ Walk");
  });

  it("the day after: yesterday's record keeps the reordered list; the rows on screen aren't yesterday's", async () => {
    await openToday(SET);
    await a11y("Hydrate", "doNext");
    await settle();
    jest.setSystemTime(new Date(2026, 9, 11, 0, 0, 30));
    // The store's minute tick sees the new day.
    await advance(61_000);
    await flush();
    const state = await savedState();
    expect(state.lastOpenedDate).toBe("2026-10-11");
    expect(state.history[TODAY].tasks.map((task) => task.text)).toEqual(["Hydrate", "Walk", "Stretch"]);
    expect(state.history[TODAY]).toMatchObject({ locked: true, lockSource: "manual" });
    expect(state.pendingRollover?.tasks.map((task) => task.text)).toEqual(["Hydrate", "Walk", "Stretch"]);
    expect(state.tasks).toEqual([]);
    expect(rows()).toEqual([]);
    expect(screen.queryByTestId(/^task-drag-/, hidden)).toBeNull();
  });
});

describe("Today, real store: the list changes while a row is in the air", () => {
  it("a task ticked meanwhile: the row goes back, nothing is saved, logged or felt as a drop, and the next drag works", async () => {
    await openToday();
    const gesture = await pickUp("t0");
    await dragBy(gesture, 82);
    expect(ghost()).not.toBeNull();
    expect(ticks()).toBe(1);
    const felt = impacts();

    // Hydrate is ticked (the widget, or another finger on its circle).
    await fireEvent.press(box("Hydrate"));
    await flush();
    expect(ghost()).toBeNull();
    expect(rows()).toEqual(["Up next. Task 1: Walk", "Task 2: Stretch", "Task 3: Hydrate ✓"]);
    const afterTick = impacts();
    expect(afterTick).toBe(felt + 1); // the tick's own tap

    // The finger that held the row moves on, then lifts.
    await dragBy(gesture, 0);
    await dragBy(gesture, 82);
    await letGo(gesture);
    await settle();
    expect(await savedOrder()).toBe("Walk Stretch Hydrate✓");
    expect(reorderEvents()).toEqual([]);
    expect(impacts()).toBe(afterTick);
    expect(ticks()).toBe(1);
    expect(said().filter((text) => /is next|Moved/.test(text))).toEqual([]);
    expect(StyleSheet.flatten(screen.getByTestId("task-slot-t0", hidden).props.style).opacity).toBeUndefined();

    // Two open rows now.
    expect(handleOf("t2")).toBeNull();
    await drag("t0", 1);
    await settle();
    expect(await savedOrder()).toBe("Stretch Walk Hydrate✓");
    expect(reorderEvents()).toEqual([["task_reordered", { source: "drag" }]]);
  });

  it("a task taken off today meanwhile (Not today): the row goes back and the two left can still be reordered", async () => {
    await openToday();
    const gesture = await pickUp("t2");
    await dragBy(gesture, -82);
    await a11y("Stretch", "notToday");
    await flush();
    expect(ghost()).toBeNull();
    await letGo(gesture);
    await settle();
    expect(await savedOrder()).toBe("Walk Hydrate");
    expect((await savedState()).parkedTasks.map((task) => task.text)).toEqual(["Stretch"]);
    expect(reorderEvents()).toEqual([]);

    await drag("t2", -1);
    await settle();
    expect(await savedOrder()).toBe("Hydrate Walk");
  });

  it("midnight meanwhile: the day changes under the held row; yesterday is recorded in its saved order, not the dragged one", async () => {
    await openToday(SET);
    const gesture = await pickUp("t0");
    await dragBy(gesture, 82);
    expect(ghost()).not.toBeNull();
    jest.setSystemTime(new Date(2026, 9, 11, 0, 0, 30));
    await advance(61_000);
    await flush();
    expect(ghost()).toBeNull();
    await letGo(gesture);
    await settle();
    const state = await savedState();
    expect(state.lastOpenedDate).toBe("2026-10-11");
    expect(state.history[TODAY].tasks.map((task) => task.text)).toEqual(["Walk", "Stretch", "Hydrate"]);
    expect(state.tasks).toEqual([]);
    expect(reorderEvents()).toEqual([]);
  });

  it("the screen closed with a row in the air, or just after a drop: nothing runs afterwards", async () => {
    await openToday();
    const gesture = await pickUp("t0");
    await dragBy(gesture, 82);
    await flush();
    await screen.unmount();
    await dragBy(gesture, 0);
    await letGo(gesture);
    await advance(5000);
    expect(await savedOrder()).toBe("Walk Stretch Hydrate");
    expect(reorderEvents()).toEqual([]);

    __resetStorageForTests();
    await launch();
    await drag("t0", 2);
    await flush();
    // Gone inside the 50 ms the old "Up next" is held for.
    await screen.unmount();
    await advance(5000);
    expect(await savedOrder()).toBe("Stretch Hydrate Walk");
    expect(reorderEvents()).toEqual([["task_reordered", { source: "drag" }]]);
  });
});

describe("Today, real store: a task's words being edited when a row is picked up", () => {
  // The drop mounts every row anew, and a row's edit lives in the row. So the
  // pick-up dismisses the keyboard: the field blurs, and the blur saves.
  const editing = (text: string) => screen.queryByDisplayValue(text);
  async function edit(task: string, to: string) {
    await a11y(task, "edit");
    await fireEvent.changeText(screen.getByDisplayValue(task), to);
  }

  it.each([
    ["another row", "t1", 1, "Walk far Hydrate Stretch"],
    ["a row that then crosses the edited one", "t2", -2, "Hydrate Walk far Stretch"],
  ])("%s is dragged: the new words are saved and the order changes", async (_name, id, rowsMoved, order) => {
    const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
    await openToday();
    await edit("Walk", "  Walk far ");
    // Typed, not saved; the row being edited has no handle of its own.
    expect(await savedOrder()).toBe("Walk Stretch Hydrate");
    expect(handleOf("t0")).toBeNull();
    expect(dismiss).not.toHaveBeenCalled();

    const gesture = await pickUp(id);
    expect(dismiss).toHaveBeenCalledTimes(1);
    // What the keyboard going does on a device: the field blurs.
    await fireEvent(editing("  Walk far ")!, "blur");
    // Saved (trimmed) while the row is still in the air: a change of words isn't a change of list.
    expect(await savedOrder()).toBe("Walk far Stretch Hydrate");
    expect(ghost()).not.toBeNull();
    expect(editing("  Walk far ")).toBeNull();

    await dragBy(gesture, rowsMoved * 41);
    await letGo(gesture);
    await settle();
    expect(await savedOrder()).toBe(order);
    expect(rows()).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: /Task \d: Walk far/ })).toBeOnTheScreen();
    expect((await savedState()).history[TODAY].tasks.map((task) => task.text).join(" ")).toBe(order);
    expect(reorderEvents()).toEqual([["task_reordered", { source: "drag" }]]);
    expect(JSON.stringify((track as jest.Mock).mock.calls)).not.toMatch(/Walk|far/);
  });

  it("every pick-up dismisses the keyboard once, and a tap or a refused touch doesn't", async () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
    await openToday();
    // A touch that never moves (a tap on the handle): nothing is picked up.
    await layOut();
    await act(async () => {
      pan("t1").handlers.onBegin?.({} as never);
      pan("t1").handlers.onFinalize?.({} as never, false);
    });
    expect(dismiss).not.toHaveBeenCalled();
    await drag("t0", 1);
    expect(dismiss).toHaveBeenCalledTimes(1);
    await settle();
    await drag("t0", 0);
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it("unchanged or emptied words save nothing, and the drag goes on as usual", async () => {
    jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
    await openToday();
    await edit("Walk", "   ");
    const gesture = await pickUp("t2");
    await fireEvent(editing("   ")!, "blur");
    await dragBy(gesture, -82);
    await letGo(gesture);
    await settle();
    expect(await savedOrder()).toBe("Hydrate Walk Stretch");
  });
});

describe("Today, real store: logged once per real reorder, and never otherwise", () => {
  it("a whole session: every change of order is one event with its source and nothing else; no-ops send none", async () => {
    await openToday();
    const expected: string[] = [];
    const check = async (order: string) => {
      await settle();
      expect(await savedOrder()).toBe(order);
      expect(reorderEvents().map(([, props]) => props.source)).toEqual(expected);
    };

    // Things that change nothing.
    await drag("t1", 0);
    await check("Walk Stretch Hydrate");
    await drag("t0", 2, false); // interrupted (a call)
    await check("Walk Stretch Hydrate");
    const held = await pickUp("t2"); // out to the first place and back again
    await dragBy(held, -82);
    await dragBy(held, 0);
    await letGo(held);
    await check("Walk Stretch Hydrate");
    await a11y("Walk", "doNext"); // already next
    await a11y("Walk", "moveUp");
    await a11y("Stretch", "moveUp"); // not offered: that is Do this next
    await a11y("Hydrate", "moveDown"); // already last
    await check("Walk Stretch Hydrate");

    // Things that do.
    await drag("t0", 2);
    expected.push("drag");
    await check("Stretch Hydrate Walk");
    await a11y("Walk", "moveUp");
    expected.push("move");
    await check("Stretch Walk Hydrate");
    await a11y("Stretch", "moveDown");
    expected.push("move");
    await check("Walk Stretch Hydrate");
    await (await menuOf("t2")).pick("Do this next");
    expected.push("next");
    await check("Hydrate Walk Stretch");
    await a11y("Walk", "doNext");
    expected.push("next");
    await check("Walk Hydrate Stretch");

    // A done task: nothing, from anywhere.
    await fireEvent.press(box("Hydrate"));
    await settle();
    await a11y("Hydrate", "doNext");
    await a11y("Hydrate", "moveUp");
    await a11y("Hydrate", "moveDown");
    expect((await menuOf("t2")).options).not.toContain("Do this next");
    await check("Walk Hydrate✓ Stretch");

    // Each event is its source and nothing else; no task's words are in anything logged.
    for (const [, props] of reorderEvents()) expect(Object.keys(props)).toEqual(["source"]);
    expect(JSON.stringify((track as jest.Mock).mock.calls)).not.toMatch(/Walk|Stretch|Hydrate/);
  });

  it("what was said and felt matches: a tap for the pick-up and for a real drop, a tick per place passed", async () => {
    await openToday();
    // Down two places: pick-up tap, one tick (it went straight to the last place), drop tap.
    await drag("t0", 2);
    await settle();
    expect(impacts()).toBe(2);
    expect(ticks()).toBe(1);
    expect(said()).toEqual(["Moved down: Walk"]);

    // Back where it started: the pick-up only.
    await drag("t1", 0);
    await settle();
    expect(impacts()).toBe(3);
    expect(ticks()).toBe(1);

    // Up one place, not to the top.
    await drag("t0", -1);
    await settle();
    expect(await savedOrder()).toBe("Stretch Walk Hydrate");
    expect(said()).toEqual(["Moved down: Walk", "Moved up: Walk"]);
    // To the top.
    await drag("t2", -2);
    await settle();
    expect(said()).toEqual(["Moved down: Walk", "Moved up: Walk", "Hydrate is next"]);

    // VoiceOver's own moves.
    await a11y("Hydrate", "moveDown");
    await settle();
    await a11y("Walk", "moveUp");
    await settle();
    await a11y("Hydrate", "doNext");
    await settle();
    expect(said().slice(3)).toEqual(["Moved down: Hydrate", "Moved up: Walk", "Hydrate is next"]);
    expect(await savedOrder()).toBe("Hydrate Stretch Walk");
  });
});

describe("Today, real store: VoiceOver", () => {
  it("each row offers only the moves that would do something, wherever the done tasks are", async () => {
    await openToday();
    expect(actionsOf("Walk")).toEqual(["moveDown"]);
    expect(actionsOf("Stretch")).toEqual(["doNext", "moveDown"]);
    expect(actionsOf("Hydrate")).toEqual(["doNext", "moveUp"]);

    await fireEvent.press(box("Walk"));
    await settle();
    expect(actionsOf("Walk")).toEqual([]);
    expect(actionsOf("Stretch")).toEqual(["moveDown"]);
    expect(actionsOf("Hydrate")).toEqual(["doNext"]);

    await fireEvent.press(box("Stretch"));
    await settle();
    // One open task: nothing to reorder, and no handle.
    for (const text of ["Walk", "Stretch", "Hydrate"]) expect(actionsOf(text)).toEqual([]);
    for (const id of ["t0", "t1", "t2"]) expect(handleOf(id)).toBeNull();
  });

  it("focus goes back to the moved row after a move or Do this next, and is left alone after a drag", async () => {
    const focus = AccessibilityInfo.sendAccessibilityEvent as jest.Mock;
    await openToday();
    focus.mockClear();

    await a11y("Walk", "moveDown");
    await settle();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(focus.mock.calls[0][1]).toBe("focus");
    await a11y("Hydrate", "doNext");
    await settle();
    expect(focus).toHaveBeenCalledTimes(2);

    // A drag is a finger's doing: VoiceOver's focus isn't pulled anywhere, though the rows are mounted anew.
    await drag("t2", 1);
    await settle();
    expect(await savedOrder()).toBe("Stretch Hydrate Walk");
    expect(focus).toHaveBeenCalledTimes(2);
    // And the next move still brings it back.
    await a11y("Walk", "doNext");
    await settle();
    expect(focus).toHaveBeenCalledTimes(3);
  });

  it("the handle and the dragged copy are not VoiceOver's: the checkbox carries the moves", async () => {
    await openToday();
    for (const id of ["t0", "t1", "t2"]) {
      expect(screen.queryByTestId(`task-drag-${id}`)).toBeNull();
      expect(handleOf(id)!.props.accessibilityElementsHidden).toBe(true);
    }
    await pickUp("t1");
    expect(screen.queryByTestId("task-drag-ghost")).toBeNull();
    expect(ghost()).not.toBeNull();
    expect(rows()).toHaveLength(3);
  });
});

describe("Today, real store: with and without room for the handle", () => {
  const menuMoves = async (id: string) =>
    (await menuOf(id)).options.filter((label) => ["Do this next", "Move up", "Move down"].includes(label));

  it.each([
    ["exactly 360 wide", { ...PHONE, width: 360 }],
    ["text just under 1.5x", { ...PHONE, fontScale: 1.49 }],
    ["an iPad", { width: 1024, height: 1366, scale: 2, fontScale: 1 }],
  ])("%s: the handle is there, and the menu has Do this next only", async (_name, window) => {
    mockWindow = window;
    await openToday({ reorderHintSeen: false });
    for (const id of ["t0", "t1", "t2"]) expect(handleOf(id)).not.toBeNull();
    expect(await menuMoves("t0")).toEqual([]);
    expect(await menuMoves("t1")).toEqual(["Do this next"]);
    expect(await menuMoves("t2")).toEqual(["Do this next"]);
    expect(screen.getByTestId("reorder-hint").props.children).toBe("Drag ≡ to reorder");
    await drag("t0", 1);
    await settle();
    expect(await savedOrder()).toBe("Stretch Walk Hydrate");
  });

  it.each([
    ["359 wide", { ...PHONE, width: 359 }],
    ["text at 1.5x", { ...PHONE, fontScale: 1.5 }],
    ["both (a small phone at the largest text)", { width: 320, height: 568, scale: 2, fontScale: 3.1 }],
  ])("%s: no handle; the menu moves a row one place, saved and logged as a move", async (_name, window) => {
    mockWindow = window;
    await openToday({ reorderHintSeen: false });
    for (const id of ["t0", "t1", "t2"]) expect(handleOf(id)).toBeNull();
    expect(screen.queryByTestId(/^task-drag-/, hidden)).toBeNull();
    expect(await menuMoves("t0")).toEqual(["Move down"]);
    expect(await menuMoves("t1")).toEqual(["Do this next", "Move down"]);
    expect(await menuMoves("t2")).toEqual(["Do this next", "Move up"]);
    expect(screen.getByTestId("reorder-hint").props.children).toBe(
      "To reorder, open a task's menu and choose Move up or Move down",
    );
    expect(screen.getByTestId("reorder-hint")).not.toHaveTextContent(/Drag/);

    await (await menuOf("t2")).pick("Move up");
    await settle();
    expect(await savedOrder()).toBe("Walk Hydrate Stretch");
    await (await menuOf("t0")).pick("Move down");
    await settle();
    expect(await savedOrder()).toBe("Hydrate Walk Stretch");
    await (await menuOf("t1")).pick("Do this next");
    await settle();
    expect(await savedOrder()).toBe("Stretch Hydrate Walk");
    expect(reorderEvents().map(([, props]) => props.source)).toEqual(["move", "move", "next"]);
    expect(said()).toEqual(["Moved up: Hydrate", "Moved down: Walk", "Stretch is next"]);
    // VoiceOver's actions are the same with or without the handle.
    expect(actionsOf("Stretch")).toEqual(["moveDown"]);
    expect(actionsOf("Hydrate")).toEqual(["doNext", "moveDown"]);
    expect(actionsOf("Walk")).toEqual(["doNext", "moveUp"]);
  });

  it("no room, a set day, one task done: the menu's moves count open tasks only", async () => {
    mockWindow = { ...PHONE, width: 320 };
    await openToday({ ...SET, todayCompletions: ["t1"] });
    expect((await menuOf("t0")).options).toEqual(["Move down", "Cancel"]);
    expect((await menuOf("t1")).options).toEqual([]);
    expect((await menuOf("t2")).options).toEqual(["Do this next", "Cancel"]);
    await (await menuOf("t0")).pick("Move down");
    await settle();
    expect(rows()).toEqual(["Up next. Task 1: Hydrate", "Task 2: Stretch ✓", "Task 3: Walk"]);
  });
});

describe("Today, real store: the one-time hint", () => {
  const HANDLE = "Drag ≡ to reorder";
  const hint = () => screen.queryByTestId("reorder-hint");

  it("shows the first time two or more tasks are open, is saved as shown, and reads its own line to VoiceOver", async () => {
    await openToday({ reorderHintSeen: false });
    expect(hint()).toHaveTextContent(HANDLE);
    expect(hint()!.props.accessibilityLabel).toBe("To reorder, use a task's actions: Do this next, Move up or Move down.");
    expect((await savedState()).reorderHintSeen).toBe(true);
    // It stays for the visit, through other things happening.
    await advance(60_000);
    await menuOf("t1");
    expect(hint()).not.toBeNull();
  });

  it.each([
    ["a drag", () => drag("t0", 1)],
    ["Do this next", () => a11y("Hydrate", "doNext")],
    ["a move", () => a11y("Walk", "moveDown")],
  ])("goes after %s, and is not back after a relaunch", async (_name, reorderIt) => {
    await openToday({ reorderHintSeen: false });
    expect(hint()).not.toBeNull();
    await reorderIt();
    await settle();
    expect(hint()).toBeNull();
    await relaunch();
    expect(hint()).toBeNull();
    expect((await savedState()).reorderHintSeen).toBe(true);
  });

  it("a drop back in the same place is not a reorder: the hint stays", async () => {
    await openToday({ reorderHintSeen: false });
    await drag("t1", 0);
    await drag("t0", 2, false);
    await a11y("Walk", "doNext");
    await settle();
    expect(hint()).not.toBeNull();
  });

  it("seen once without reordering: never again, on the next launch or the next day", async () => {
    await openToday({ reorderHintSeen: false });
    expect(hint()).not.toBeNull();
    await relaunch();
    expect(hint()).toBeNull();
    expect(rows()).toHaveLength(3);
  });

  it("state saved before 1.4 (no flag at all) loads, shows the hint once and saves the flag", async () => {
    await openToday({
      raw: (state) => {
        const { reorderHintSeen: _dropped, ...old } = state;
        return old;
      },
    });
    expect(rows()).toEqual(["Task 1: Walk", "Task 2: Stretch", "Task 3: Hydrate"]);
    expect(hint()).toHaveTextContent(HANDLE);
    expect((await savedState()).reorderHintSeen).toBe(true);
  });

  it("waits for a second open task: not with one open, there when one is unticked, gone again when only one is left", async () => {
    await openToday({ reorderHintSeen: false, tasks: [WALK, STRETCH], todayCompletions: ["t0"] });
    expect(hint()).toBeNull();
    expect((await savedState()).reorderHintSeen).toBe(false);

    await fireEvent.press(box("Walk"));
    await settle();
    expect(hint()).toHaveTextContent(HANDLE);
    expect((await savedState()).reorderHintSeen).toBe(true);
    // One ticked again: nothing to reorder, so nothing to say. Unticked: it is still this visit.
    await fireEvent.press(box("Stretch"));
    await settle();
    expect(hint()).toBeNull();
    await fireEvent.press(box("Stretch"));
    await settle();
    expect(hint()).not.toBeNull();
  });

  it("shows on a set day too (reordering is allowed there), and never with fewer than two tasks", async () => {
    await openToday({ ...SET, reorderHintSeen: false, tasks: [WALK, STRETCH] });
    expect(hint()).toHaveTextContent(HANDLE);
    await screen.unmount();
    await AsyncStorage.clear();
    __resetStorageForTests();
    await openToday({ reorderHintSeen: false, tasks: [WALK] });
    expect(hint()).toBeNull();
    expect((await savedState()).reorderHintSeen).toBe(false);
    expect(handleOf("t0")).toBeNull();
  });
});
